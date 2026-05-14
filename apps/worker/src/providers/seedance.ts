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
import {
  createGenerationTask,
  getGenerationTask,
  normalizeSeedanceError,
  type SeedanceContentItem,
  type SeedanceCreateBody,
} from '../lib/seedance-client.js';

const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 30 * 60_000; // 30min hard cap (Seedance video gen rarely exceeds 5min)

type Opts = {
  name: string;
  /** Default model when the caller leaves input.model empty. */
  pinnedModel: string;
};

/**
 * Factory for Volcengine Doubao Seedance 2.0 video providers.
 * The same code path serves the 'seedance' (standard) and 'seedance-fast'
 * registry entries — they differ only by pinnedModel + cosmetic name.
 *
 * input.model still wins when provided (the caller can target any model in
 * the Seedance family, including future 3.0 variants, without touching code).
 */
export function createSeedanceProvider(opts: Opts): VideoProvider {
  const provider: VideoProvider = {
    name: opts.name,
    async generate(input: VideoInput, ctx: ProviderContext): Promise<ProviderResult> {
      try {
        return await run(opts, input, ctx);
      } catch (err) {
        throw normalizeSeedanceError(err);
      }
    },
  };
  return provider;
}

async function run(
  opts: Opts,
  input: VideoInput,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  const model = input.model && input.model.trim().length > 0 ? input.model : opts.pinnedModel;

  const refs = await resolveReferences(input.references ?? [], ctx);
  validateReferenceCounts(input.references ?? []);

  const content: SeedanceContentItem[] = [{ type: 'text', text: input.prompt }, ...refs];

  const body: SeedanceCreateBody = {
    model,
    content,
    duration: input.duration,
  };
  if (input.ratio) body.ratio = input.ratio;
  if (input.generateAudio !== undefined) body.generate_audio = input.generateAudio;
  if (input.watermark !== undefined) body.watermark = input.watermark;
  if (input.returnLastFrame) body.return_last_frame = true;
  if (input.webSearch) body.tools = [{ type: 'web_search' }];

  ctx.log.info(
    {
      provider: opts.name,
      model,
      duration: input.duration,
      ratio: input.ratio,
      refs: refs.length,
    },
    'seedance create task',
  );
  const created = await createGenerationTask(body, { signal: ctx.abortSignal });
  const arkTaskId = created.id;
  ctx.log.info({ provider: opts.name, arkTaskId }, 'seedance task accepted');

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let final: Awaited<ReturnType<typeof getGenerationTask>> | null = null;
  while (true) {
    await abortableSleep(POLL_INTERVAL_MS, ctx.abortSignal);
    if (Date.now() > deadline) {
      throw new Error(`seedance[timeout]: task ${arkTaskId} did not finish within ${POLL_TIMEOUT_MS}ms`);
    }
    const got = await getGenerationTask(arkTaskId, { signal: ctx.abortSignal });
    ctx.log.debug({ provider: opts.name, arkTaskId, status: got.status }, 'seedance poll');
    if (got.status === 'succeeded') {
      final = got;
      break;
    }
    if (got.status === 'failed' || got.status === 'cancelled') {
      const code = got.error?.code ?? 'task_failed';
      const msg = got.error?.message ?? `task ended in status ${got.status}`;
      const err = new Error(msg) as Error & { status?: number; code?: string };
      err.status = 200;
      err.code = code;
      throw err;
    }
    // 'queued' | 'running' | unknown → continue polling
  }

  const videoUrl = final.content?.video_url;
  if (!videoUrl) {
    const err = new Error('succeeded response missing content.video_url') as Error & {
      status?: number;
      code?: string;
    };
    err.code = 'no_video_url';
    throw err;
  }

  ctx.log.info({ provider: opts.name, arkTaskId }, 'seedance succeeded — downloading video');
  const dlRes = await fetch(videoUrl, { signal: ctx.abortSignal });
  if (!dlRes.ok) {
    throw new Error(`seedance[download_failed]: HTTP ${dlRes.status} fetching video_url`);
  }
  const data = Buffer.from(await dlRes.arrayBuffer());

  return {
    outputJson: {
      provider: opts.name,
      model,
      arkTaskId,
      ratio: input.ratio ?? null,
      usage: final.usage ?? null,
      lastFrameUrl: final.content?.last_frame_url ?? null,
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

async function resolveReferences(
  refs: VideoReference[],
  ctx: ProviderContext,
): Promise<SeedanceContentItem[]> {
  const out: SeedanceContentItem[] = [];
  for (const r of refs) {
    const url = await presignedPublicGetUrl(ctx.prisma, r.assetId);
    out.push(toContentItem(url, r.role));
  }
  return out;
}

function toContentItem(url: string, role: VideoReference['role']): SeedanceContentItem {
  switch (role) {
    case 'reference_image':
    case 'first_frame':
    case 'last_frame':
      return { type: 'image_url', image_url: { url }, role };
    case 'reference_video':
      return { type: 'video_url', video_url: { url }, role };
    case 'reference_audio':
      return { type: 'audio_url', audio_url: { url }, role };
  }
}

/** Enforce per-role caps from the Seedance docs (image ≤9, video ≤3, audio ≤3). */
function validateReferenceCounts(refs: VideoReference[]): void {
  let img = 0;
  let vid = 0;
  let aud = 0;
  for (const r of refs) {
    if (r.role === 'reference_image' || r.role === 'first_frame' || r.role === 'last_frame') img++;
    else if (r.role === 'reference_video') vid++;
    else if (r.role === 'reference_audio') aud++;
  }
  if (img > 9) throw new Error(`seedance[too_many_images]: ${img} > 9`);
  if (vid > 3) throw new Error(`seedance[too_many_videos]: ${vid} > 3`);
  if (aud > 3) throw new Error(`seedance[too_many_audios]: ${aud} > 3`);
}
