import { Buffer } from 'node:buffer';
import type {
  ImageProvider,
  ImageInput,
  ProviderContext,
  ProviderResult,
  ProviderOutputAsset,
} from '@oneness/shared/providers';
import type { PrismaClient } from '@prisma/client';
import { config } from '../config.js';
import { minioClient } from '../lib/minio.js';

/**
 * ZenMux exposes Google Gemini image models (Nano Banana family) on a
 * Vertex-AI-compatible path that is NOT the same as /v1/images/generations.
 *
 *   POST  {ZENMUX_VERTEX_BASE_URL}/v1/models/{model}:generateContent
 *
 * The request and response shapes are Vertex AI's `generateContent`, not the
 * OpenAI images shape — so this provider talks to it via plain fetch rather
 * than the openai SDK.
 *
 * Currently exposed on ZenMux:
 *   - google/gemini-2.5-flash-image  (Nano Banana, paid)
 * Nano Banana Pro / gemini-3-pro-image variants were not reachable on this
 * endpoint at integration time; add their model IDs to the web's
 * IMAGE_MODEL_OPTIONS when ZenMux exposes them.
 */

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type GeminiResponse = {
  candidates?: Array<{
    content?: { role?: string; parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: unknown;
  promptFeedback?: { blockReason?: string };
};

/**
 * Aspect ratios supported by Gemini's `imageConfig.aspectRatio`. We forward
 * the project ratio verbatim when it matches one of these; anything else
 * falls through with no aspect-ratio hint and lets the model choose.
 */
const SUPPORTED_RATIOS = new Set([
  '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3',
]);

async function readAssetInline(
  prisma: PrismaClient,
  assetId: string,
): Promise<{ mimeType: string; data: string }> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error(`reference asset not found: ${assetId}`);
  const stream = await minioClient.getObject(asset.bucket, asset.key);
  const chunks: Buffer[] = [];
  for await (const c of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  return {
    mimeType: asset.contentType || 'image/png',
    data: Buffer.concat(chunks).toString('base64'),
  };
}

function nanobananaApiKey(): string {
  const k = config.ZENMUX_API_KEY || config.OPENAI_API_KEY;
  if (!k) {
    throw new Error(
      'ZENMUX_API_KEY (or OPENAI_API_KEY) is not set — cannot use the ' +
        'nanobanana provider. Set ZENMUX_API_KEY in .env.',
    );
  }
  return k;
}

/**
 * Normalize transport / Vertex errors into a `nanobanana[<tag>]: <msg>`
 * one-liner. Mirrors normalizeOpenAIError so the Task.error column reads
 * the same shape regardless of which provider failed.
 */
function normalizeError(status: number, body: string): Error {
  let code = `http_${status}`;
  let message = body.slice(0, 500);
  try {
    const j = JSON.parse(body);
    if (j?.error) {
      code = String(j.error.code ?? j.error.type ?? code);
      message = String(j.error.message ?? message);
    }
  } catch {
    // body wasn't JSON — keep raw slice
  }
  return new Error(`nanobanana[${code}]: ${message}`);
}

async function callOnce(
  args: {
    model: string;
    prompt: string;
    ratio: string;
    inlineImages: Array<{ mimeType: string; data: string }>;
  },
  ctx: ProviderContext,
): Promise<{ images: ProviderOutputAsset[]; texts: string[] }> {
  const url =
    `${config.ZENMUX_VERTEX_BASE_URL}/v1/models/` +
    `${encodeURI(args.model)}:generateContent`;

  const parts: GeminiPart[] = [{ text: args.prompt }];
  for (const img of args.inlineImages) {
    parts.push({ inlineData: img });
  }

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      ...(SUPPORTED_RATIOS.has(args.ratio)
        ? { imageConfig: { aspectRatio: args.ratio } }
        : {}),
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${nanobananaApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: ctx.abortSignal,
  });

  if (!res.ok) {
    throw normalizeError(res.status, await res.text());
  }
  const json = (await res.json()) as GeminiResponse;
  if (json.promptFeedback?.blockReason) {
    throw new Error(
      `nanobanana[blocked]: ${json.promptFeedback.blockReason}`,
    );
  }
  const candidate = json.candidates?.[0];
  if (!candidate?.content?.parts) {
    throw new Error('nanobanana[empty]: no candidates in response');
  }

  const images: ProviderOutputAsset[] = [];
  const texts: string[] = [];
  for (const p of candidate.content.parts) {
    if ('inlineData' in p && p.inlineData?.data) {
      images.push({
        data: Buffer.from(p.inlineData.data, 'base64'),
        contentType: p.inlineData.mimeType || 'image/png',
      });
    } else if ('text' in p && typeof p.text === 'string' && p.text.length > 0) {
      texts.push(p.text);
    }
  }
  return { images, texts };
}

export const nanobananaImageProvider: ImageProvider = {
  name: 'nanobanana',

  async generate(
    input: ImageInput,
    ctx: ProviderContext,
  ): Promise<ProviderResult> {
    const model =
      input.model && input.model.trim().length > 0
        ? input.model
        : config.NANOBANANA_MODEL;
    const n = Math.min(Math.max(input.n ?? 1, 1), 4);

    const inlineImages = input.referenceAssetIds?.length
      ? await Promise.all(
          input.referenceAssetIds.map((id) => readAssetInline(ctx.prisma, id)),
        )
      : [];

    ctx.log.info(
      {
        provider: 'nanobanana',
        op: inlineImages.length > 0 ? 'edit' : 'generate',
        model,
        n,
        ratio: input.ratio,
        refs: inlineImages.length,
      },
      'nanobanana image start',
    );

    // Gemini generateContent returns 1 image per call. For n>1 we fan out.
    const calls = await Promise.all(
      Array.from({ length: n }, () =>
        callOnce({ model, prompt: input.prompt, ratio: input.ratio, inlineImages }, ctx),
      ),
    );

    const outputAssets = calls.flatMap((c) => c.images);
    if (outputAssets.length === 0) {
      throw new Error('nanobanana[empty]: candidates returned no inline image');
    }

    return {
      outputJson: {
        provider: 'nanobanana',
        mode: inlineImages.length > 0 ? 'edit' : 'generate',
        model,
        ratio: SUPPORTED_RATIOS.has(input.ratio) ? input.ratio : 'auto',
        revisedPrompts: calls.flatMap((c) => c.texts),
      },
      outputAssets,
    };
  },
};
