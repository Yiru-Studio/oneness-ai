import sharp from 'sharp';
import type {
  VideoProvider,
  VideoInput,
  ProviderContext,
  ProviderResult,
} from '@oneness/shared/providers';

function currentFailRate(): number {
  const v = Number(process.env.STUB_FAIL_RATE ?? '0.05');
  return Number.isFinite(v) ? v : 0.05;
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(() => resolve(), ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

export const stubVideoProvider: VideoProvider = {
  name: 'stub',
  async generate(input: VideoInput, ctx: ProviderContext): Promise<ProviderResult> {
    ctx.log.info({ prompt: input.prompt, duration: input.duration }, 'stub-video start');
    const delayMs = 8000 + Math.floor(Math.random() * 4000); // 8-12s
    await sleep(delayMs, ctx.abortSignal);

    if (Math.random() < currentFailRate()) {
      throw new Error('stub-video: random failure (STUB_FAIL_RATE)');
    }

    const poster = await sharp({
      create: {
        width: 128,
        height: 72,
        channels: 3,
        background: { r: 30, g: 30, b: 80 },
      },
    })
      .png()
      .toBuffer();

    return {
      outputJson: {
        kind: 'stub-video-poster',
        note: 'real provider should emit mp4 bytes — stub emits a PNG poster',
        prompt: input.prompt,
        durationSec: input.duration,
      },
      outputAssets: [
        {
          data: poster,
          contentType: 'image/png',
          width: 128,
          height: 72,
        },
      ],
    };
  },
};
