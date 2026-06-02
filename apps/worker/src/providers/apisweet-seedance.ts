import { Buffer } from 'node:buffer';
import type {
  VideoProvider,
  VideoInput,
  VideoReference,
  ProviderContext,
  ProviderResult,
} from '@oneness/shared/providers';
import { abortableSleep } from '../lib/sleep.js';
import { presignedPublicGetUrl } from '../lib/asset-public-url.js';

const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 30 * 60_000;
const SUPPORTED_RATIOS = new Set(['16:9', '9:16']);
const MIN_DURATION = 4;
const MAX_DURATION = 15;

type Opts = {
  name: string;
  pinnedModel: string;
};

type ApiSweetCreateResult = {
  success?: boolean;
  task_id?: string;
  state?: string;
  message?: string;
  error?: ApiSweetError;
};

type ApiSweetGetResult = {
  success?: boolean;
  task_id?: string;
  state?: string;
  result?: {
    video_url?: string;
  } | null;
  message?: string;
  error?: ApiSweetError;
};

type ApiSweetError = {
  code?: string;
  message?: string;
  type?: string;
};

type ResolvedReferences = {
  imageUrls: string[];
  audioUrls: string[];
  promptPrefix: string;
};

export function createApiSweetSeedanceProvider(opts: Opts): VideoProvider {
  return {
    name: opts.name,
    async generate(input: VideoInput, ctx: ProviderContext): Promise<ProviderResult> {
      try {
        return await run(opts, input, ctx);
      } catch (err) {
        throw normalizeApiSweetError(err);
      }
    },
  };
}

async function run(opts: Opts, input: VideoInput, ctx: ProviderContext): Promise<ProviderResult> {
  const model = input.model && input.model.trim().length > 0 ? input.model : opts.pinnedModel;
  validateInput(input);

  const refs = await resolveReferences(input.references ?? [], ctx);
  const prompt = [refs.promptPrefix, input.prompt].filter(Boolean).join('\n\n');
  const created = await createTask({
    prompt,
    duration: input.duration,
    ratio: input.ratio!,
    model,
    imageUrls: refs.imageUrls,
    audioUrls: refs.audioUrls,
    signal: ctx.abortSignal,
  });
  const apiSweetTaskId = created.task_id;
  if (!apiSweetTaskId) {
    throw taggedError('missing_task_id', created.message || 'create task response missing task_id');
  }

  ctx.log.info(
    {
      provider: opts.name,
      apiSweetTaskId,
      model,
      duration: input.duration,
      ratio: input.ratio,
      imageRefs: refs.imageUrls.length,
      audioRefs: refs.audioUrls.length,
    },
    'apisweet seedance task accepted',
  );

  const final = await pollTask(apiSweetTaskId, ctx);
  const videoUrl = final.result?.video_url;
  if (!videoUrl) throw taggedError('no_video_url', 'completed response missing result.video_url');

  const dlRes = await fetch(videoUrl, { signal: ctx.abortSignal });
  if (!dlRes.ok) {
    throw taggedError('download_failed', `HTTP ${dlRes.status} fetching video_url`);
  }
  const data = Buffer.from(await dlRes.arrayBuffer());

  return {
    outputJson: {
      provider: opts.name,
      model,
      apiSweetTaskId,
      ratio: input.ratio ?? null,
      state: final.state ?? null,
    },
    outputAssets: [
      {
        data,
        contentType: 'video/mp4',
        durationMs: input.duration * 1000,
      },
    ],
  };
}

function validateInput(input: VideoInput): void {
  if (!input.ratio || !SUPPORTED_RATIOS.has(input.ratio)) {
    throw taggedError('invalid_ratio', 'ratio 仅支持 16:9 或 9:16');
  }
  if (!Number.isInteger(input.duration) || input.duration < MIN_DURATION || input.duration > MAX_DURATION) {
    throw taggedError('invalid_duration', 'duration 仅支持 4-15 秒');
  }
}

async function resolveReferences(refs: VideoReference[], ctx: ProviderContext): Promise<ResolvedReferences> {
  const imageUrls: string[] = [];
  const audioUrls: string[] = [];
  for (const ref of refs) {
    const url = await presignedPublicGetUrl(ctx.prisma, ref.assetId);
    if (ref.role === 'reference_audio') {
      audioUrls.push(url);
    } else if (ref.role === 'reference_image' || ref.role === 'first_frame' || ref.role === 'last_frame') {
      imageUrls.push(url);
    }
  }
  if (imageUrls.length > 9) throw taggedError('too_many_images', `${imageUrls.length} > 9`);
  if (audioUrls.length > 0 && imageUrls.length === 0) {
    throw taggedError('audio_requires_image', '传音频时必须同时传至少 1 张参考图');
  }
  return { imageUrls, audioUrls, promptPrefix: buildReferencePromptPrefix(imageUrls.length, audioUrls.length) };
}

function buildReferencePromptPrefix(imageCount: number, audioCount: number): string {
  const parts: string[] = [];
  if (imageCount > 0) {
    const images = Array.from({ length: imageCount }, (_, index) => `@image_${index + 1}`);
    parts.push(`参考图：以 ${images[0]} 作为主分镜图/首帧视觉参考${images.length > 1 ? `，其余参考图 ${images.slice(1).join('、')} 用于角色、场景和道具一致性` : ''}。`);
  }
  if (audioCount > 0) {
    const audios = Array.from({ length: audioCount }, (_, index) => `@audio_${index + 1}`);
    parts.push(`参考音频：跟随 ${audios.join('、')} 的节奏和情绪。`);
  }
  return parts.join('\n');
}

async function createTask(args: {
  prompt: string;
  duration: number;
  ratio: string;
  model: string;
  imageUrls: string[];
  audioUrls: string[];
  signal: AbortSignal;
}): Promise<ApiSweetCreateResult> {
  const { apiKey, baseUrl } = auth();
  const form = new FormData();
  form.set('prompt', args.prompt);
  form.set('duration', String(args.duration));
  form.set('ratio', args.ratio);
  form.set('model', args.model);
  if (args.imageUrls.length > 0) form.set('image_urls', JSON.stringify(args.imageUrls));
  if (args.audioUrls.length > 0) form.set('audio_urls', JSON.stringify(args.audioUrls));

  const res = await fetch(`${baseUrl}/v1/tasks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: args.signal,
  });
  const json = await parseJson<ApiSweetCreateResult>(res);
  if (!res.ok || json.success === false || json.error) throw httpError(res.status, json);
  return json;
}

async function pollTask(taskId: string, ctx: ProviderContext): Promise<ApiSweetGetResult> {
  const { apiKey, baseUrl } = auth();
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (true) {
    await abortableSleep(POLL_INTERVAL_MS, ctx.abortSignal);
    if (Date.now() > deadline) throw taggedError('timeout', `task ${taskId} did not finish within ${POLL_TIMEOUT_MS}ms`);

    const res = await fetch(`${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctx.abortSignal,
    });
    const json = await parseJson<ApiSweetGetResult>(res);
    if (!res.ok || json.success === false || json.error) throw httpError(res.status, json);

    const state = (json.state ?? '').toUpperCase();
    ctx.log.debug({ provider: 'apisweet-seedance', taskId, state }, 'apisweet seedance poll');
    if (state === 'COMPLETED') return json;
    if (state === 'FAILED') {
      throw taggedError('task_failed', json.message || 'task failed');
    }
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}

function auth(): { apiKey: string; baseUrl: string } {
  const apiKey = process.env.APISWEET_API_KEY;
  if (!apiKey) {
    throw taggedError('missing_api_key', 'APISWEET_API_KEY is not set');
  }
  return {
    apiKey,
    baseUrl: (process.env.APISWEET_BASE_URL ?? 'https://apisweet.com').replace(/\/+$/u, ''),
  };
}

function httpError(status: number, body: ApiSweetCreateResult | ApiSweetGetResult): Error {
  const err = body.error;
  return taggedError(err?.code ?? `http_${status}`, err?.message ?? body.message ?? `HTTP ${status}`);
}

function taggedError(code: string, message: string): Error {
  return new Error(`apisweet-seedance[${code}]: ${message}`);
}

function normalizeApiSweetError(err: unknown): Error {
  if (err instanceof Error && (err.name === 'AbortError' || err.message === 'aborted')) {
    return taggedError('aborted', 'aborted');
  }
  if (err instanceof Error) return err;
  return taggedError('unknown', String(err));
}
