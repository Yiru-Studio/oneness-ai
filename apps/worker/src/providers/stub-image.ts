import sharp from 'sharp';
import type {
  ImageProvider,
  ImageInput,
  ProviderContext,
  ProviderResult,
} from '@oneness/shared/providers';
import { abortableSleep } from '../lib/sleep.js';

/** Read STUB_FAIL_RATE from process.env at every call so tests can toggle it. */
function currentFailRate(): number {
  const v = Number(process.env.STUB_FAIL_RATE ?? '0.05');
  return Number.isFinite(v) ? v : 0.05;
}

function pickColor(seed: string): { r: number; g: number; b: number } {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { r: h & 255, g: (h >> 8) & 255, b: (h >> 16) & 255 };
}

export const stubImageProvider: ImageProvider = {
  name: 'stub',
  async generate(input: ImageInput, ctx: ProviderContext): Promise<ProviderResult> {
    ctx.log.info({ prompt: input.prompt, model: input.model }, 'stub-image start');
    const testError = testOpenAIErrorForPrompt(input.prompt);
    const delayMs = testError ? 10 : 3000 + Math.floor(Math.random() * 2000); // 3-5s
    await abortableSleep(delayMs, ctx.abortSignal);

    if (testError) throw new Error(testError);
    if (Math.random() < currentFailRate()) {
      throw new Error('stub-image: random failure (STUB_FAIL_RATE)');
    }

    const color = pickColor(ctx.taskId);
    const n = Math.min(input.n ?? 1, 4);
    const outputAssets = await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        const data = await sharp({
          create: {
            width: 64,
            height: 64,
            channels: 3,
            background: { r: color.r, g: color.g, b: (color.b + i * 32) & 255 },
          },
        })
          .png()
          .toBuffer();
        return {
          data,
          contentType: 'image/png',
          width: 64,
          height: 64,
        };
      }),
    );

    return {
      outputJson: {
        prompt: input.prompt,
        model: input.model,
        n,
        mode: input.referenceAssetIds?.length ? 'edit' : 'generate',
        identityReferenceAssetId: input.identityReferenceAssetId ?? null,
        referenceAssetIds: input.referenceAssetIds ?? [],
      },
      outputAssets,
    };
  },
};

function testOpenAIErrorForPrompt(prompt: string): string | null {
  if (process.env.NODE_ENV !== 'test') return null;
  if (prompt.includes('[test-openai-429]')) return 'openai[http_429]: rate limit';
  if (prompt.includes('[test-openai-timeout]')) {
    return 'openai[timeout]: image task exceeded 100ms';
  }
  if (prompt.includes('[test-openai-invalid]')) {
    return 'openai[invalid_params]: invalid prompt';
  }
  return null;
}
