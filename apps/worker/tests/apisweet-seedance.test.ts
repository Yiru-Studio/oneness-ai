import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Buffer } from 'node:buffer';
import type { PrismaClient } from '@prisma/client';
import type { ProviderContext, VideoInput } from '@oneness/shared/providers';
import { createApiSweetSeedanceProvider } from '../src/providers/apisweet-seedance.js';

type FetchCall = { url: string; init: RequestInit };

function makeContext(): ProviderContext {
  const controller = new AbortController();
  return {
    taskId: 'task_test_1',
    ownerId: 'user_test_1',
    projectId: null,
    prisma: {
      asset: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          bucket: 'user-uploads',
          key: `mock/${where.id}.png`,
          contentType: 'image/png',
          ownerId: 'user_test_1',
          sizeBytes: 100,
          width: null,
          height: null,
          durationMs: null,
          createdAt: new Date(),
        })),
      },
    } as unknown as PrismaClient,
    log: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    } as unknown as ProviderContext['log'],
    abortSignal: controller.signal,
  };
}

function mockFetchSequence(responses: Array<Partial<Response> & { json?: unknown; body?: ArrayBuffer }>): FetchCall[] {
  const calls: FetchCall[] = [];
  let i = 0;
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(i++, responses.length - 1)];
    const status = r.status ?? 200;
    const ok = r.ok ?? (status >= 200 && status < 300);
    return {
      ok,
      status,
      statusText: r.statusText ?? '',
      json: async () => r.json,
      arrayBuffer: async () => r.body ?? new ArrayBuffer(0),
    } as unknown as Response;
  });
  return calls;
}

const provider = createApiSweetSeedanceProvider({
  name: 'apisweet-seedance',
  pinnedModel: 'sd_2.0_fast',
});

const baseInput: VideoInput = {
  prompt: '雨夜网约车缓慢驶入小区门口',
  model: 'sd_2.0_fast',
  duration: 5,
  ratio: '16:9',
  references: [{ assetId: 'asset-1', role: 'reference_image' }],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('APISWEET_API_KEY', 'test-key');
  vi.stubEnv('APISWEET_BASE_URL', 'https://apisweet.test');
  vi.stubEnv('MINIO_PUBLIC_ENDPOINT', 'https://media.example.com');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('apisweet seedance provider', () => {
  it('creates, polls, and downloads a generated video', async () => {
    const fakeMp4 = new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112]);
    const calls = mockFetchSequence([
      { status: 200, json: { success: true, task_id: 'task_api_1', state: 'IN_PROGRESS', message: '任务已提交' } },
      { status: 200, json: { success: true, task_id: 'task_api_1', state: 'IN_PROGRESS' } },
      { status: 200, json: { success: true, task_id: 'task_api_1', state: 'COMPLETED', result: { video_url: 'https://cdn.example.com/v.mp4' } } },
      { status: 200, body: fakeMp4.buffer },
    ]);

    const promise = provider.generate(baseInput, makeContext());
    await vi.advanceTimersByTimeAsync(31_000);
    await vi.advanceTimersByTimeAsync(31_000);
    const result = await promise;

    expect(calls[0].url).toBe('https://apisweet.test/v1/tasks');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect(calls[0].init.body).toBeInstanceOf(FormData);
    const form = calls[0].init.body as FormData;
    expect(form.get('model')).toBe('sd_2.0_fast');
    expect(form.get('duration')).toBe('5');
    expect(form.get('ratio')).toBe('16:9');
    expect(String(form.get('prompt'))).toContain('@image_1');
    expect(JSON.parse(String(form.get('image_urls')))).toHaveLength(1);
    expect(calls[1].url).toBe('https://apisweet.test/v1/tasks/task_api_1');
    expect(calls[3].url).toBe('https://cdn.example.com/v.mp4');
    expect(result.outputAssets).toHaveLength(1);
    expect(Buffer.isBuffer(result.outputAssets![0].data)).toBe(true);
    expect(result.outputJson).toMatchObject({
      provider: 'apisweet-seedance',
      model: 'sd_2.0_fast',
      apiSweetTaskId: 'task_api_1',
    });
  });

  it('rejects unsupported ratios before creating a remote task', async () => {
    const calls = mockFetchSequence([]);

    await expect(provider.generate({ ...baseInput, ratio: '1:1' }, makeContext())).rejects.toThrow(
      /apisweet-seedance\[invalid_ratio\]/,
    );
    expect(calls).toHaveLength(0);
  });
});
