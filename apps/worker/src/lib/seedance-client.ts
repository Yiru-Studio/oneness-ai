import { config } from '../config.js';

/**
 * Minimal Volcengine Ark REST client for the content_generation tasks endpoint.
 * The Volcengine Python/Java/Go SDKs are thin wrappers over the same two
 * REST calls; we use native fetch to avoid pulling another runtime.
 *
 * No retries here — BullMQ owns retry policy. A retry that bypasses our
 * credit reservation logic would double-charge.
 */

export type SeedanceContentItem =
  | { type: 'text'; text: string }
  | {
      type: 'image_url';
      image_url: { url: string };
      role?: 'reference_image' | 'first_frame' | 'last_frame';
    }
  | {
      type: 'video_url';
      video_url: { url: string };
      role?: 'reference_video';
    }
  | {
      type: 'audio_url';
      audio_url: { url: string };
      role?: 'reference_audio';
    };

export type SeedanceCreateBody = {
  model: string;
  content: SeedanceContentItem[];
  ratio?: string;
  duration?: number;
  generate_audio?: boolean;
  watermark?: boolean;
  return_last_frame?: boolean;
  tools?: Array<{ type: 'web_search' }>;
  service_tier?: 'flex';
};

export type SeedanceCreateResult = {
  id: string;
  model?: string;
  status?: string;
  created_at?: number;
};

export type SeedanceTaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | string;

export type SeedanceGetResult = {
  id: string;
  model?: string;
  status: SeedanceTaskStatus;
  content?: {
    video_url?: string;
    last_frame_url?: string;
  } | null;
  usage?: {
    completion_tokens?: number;
    total_tokens?: number;
    tool_usage?: { web_search?: number };
  } | null;
  error?: { code?: string; message?: string } | null;
  created_at?: number;
  updated_at?: number;
};

function getAuth(): { apiKey: string; baseUrl: string } {
  if (!config.ARK_API_KEY) {
    throw new Error(
      'ARK_API_KEY is not set — cannot use seedance provider. ' +
        'Set ARK_API_KEY in .env (get one at ' +
        'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey).',
    );
  }
  return { apiKey: config.ARK_API_KEY, baseUrl: config.ARK_BASE_URL };
}

async function parseError(res: Response): Promise<{ status: number; code?: string; message: string }> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* ignore — fall back to status text */
  }
  const errObj =
    body && typeof body === 'object' && 'error' in body
      ? (body as { error?: { code?: string; message?: string } }).error
      : undefined;
  return {
    status: res.status,
    code: errObj?.code,
    message: errObj?.message ?? res.statusText ?? `HTTP ${res.status}`,
  };
}

export async function createGenerationTask(
  body: SeedanceCreateBody,
  opts: { signal: AbortSignal },
): Promise<SeedanceCreateResult> {
  const { apiKey, baseUrl } = getAuth();
  const res = await fetch(`${baseUrl}/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const e = await parseError(res);
    throw makeHttpError(e);
  }
  return (await res.json()) as SeedanceCreateResult;
}

export async function getGenerationTask(
  taskId: string,
  opts: { signal: AbortSignal },
): Promise<SeedanceGetResult> {
  const { apiKey, baseUrl } = getAuth();
  const res = await fetch(`${baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: opts.signal,
  });
  if (!res.ok) {
    const e = await parseError(res);
    throw makeHttpError(e);
  }
  return (await res.json()) as SeedanceGetResult;
}

type HttpFailure = { status: number; code?: string; message: string };

function makeHttpError(e: HttpFailure): Error {
  const err = new Error(e.message) as Error & HttpFailure;
  err.status = e.status;
  err.code = e.code;
  return err;
}

/**
 * Map any error from the seedance client into a tagged one-line Error suitable
 * for Task.error. Mirrors normalizeOpenAIError shape:
 *   seedance[rate_limit]: ...           (HTTP 429)
 *   seedance[task_failed]: ...          (poll status=failed)
 *   seedance[http_500]: ...             (fallback)
 *   seedance[aborted]                   (cancel path)
 *   seedance[no_video_url]              (succeeded but missing content.video_url)
 */
export function normalizeSeedanceError(err: unknown): Error {
  if (err instanceof Error && (err.name === 'AbortError' || err.message === 'aborted')) {
    return new Error('seedance[aborted]');
  }
  if (err && typeof err === 'object' && 'status' in err && 'message' in err) {
    const e = err as { status?: number; code?: string; message: string };
    const tag = e.code ?? `http_${e.status ?? 'unknown'}`;
    return new Error(`seedance[${tag}]: ${e.message}`);
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}
