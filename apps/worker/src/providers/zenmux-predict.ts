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
 * ZenMux serves its non-Google image models (Qwen-Image, Doubao Seedream, …)
 * on a Vertex-AI-style "predict" path — NOT the OpenAI images API and NOT
 * gemini's `generateContent`:
 *
 *   POST {ZENMUX_VERTEX_BASE_URL}/v1/models/{model}:predict
 *   { "instances":  [{ "prompt": "…", "image"?: { bytesBase64Encoded, mimeType } }],
 *     "parameters": { "sampleCount": n } }
 *
 * Each prediction comes back EITHER as `bytesBase64Encoded` (+`mimeType`) OR as
 * a signed `gcsUri` we must download ourselves. Verified end-to-end against:
 *   - qwen/qwen-image-2.0                  (returns gcsUri)
 *   - qwen/qwen-image-2.0-pro              (returns gcsUri)
 *   - bytedance/doubao-seedream-5.0-lite   (returns bytesBase64Encoded)
 *
 * Routing lives in the web's `imageProviderForModel` (qwen/* and bytedance/*
 * image models → this provider); the API/worker just key off the provider name.
 */

type Prediction = { gcsUri?: string; bytesBase64Encoded?: string; mimeType?: string };
type PredictResponse = { predictions?: Prediction[] };

function apiKey(): string {
  const k = config.ZENMUX_API_KEY || config.OPENAI_API_KEY;
  if (!k) {
    throw new Error(
      'ZENMUX_API_KEY (or OPENAI_API_KEY) is not set — cannot use the ' +
        'zenmux-predict provider. Set ZENMUX_API_KEY in .env.',
    );
  }
  return k;
}

async function readAssetBase64(
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

function normalizeError(status: number, bodyText: string): Error {
  let code = `http_${status}`;
  let message = bodyText.slice(0, 300);
  try {
    const j = JSON.parse(bodyText) as { error?: { code?: unknown; message?: unknown } };
    if (j?.error?.code != null) code = String(j.error.code);
    if (typeof j?.error?.message === 'string') message = j.error.message;
  } catch {
    // body wasn't JSON — keep the raw slice
  }
  return new Error(`zenmux-predict[${code}]: ${message}`);
}

async function fetchGcs(uri: string): Promise<ProviderOutputAsset> {
  const res = await fetch(uri);
  if (!res.ok) {
    throw new Error(
      `zenmux-predict[gcs_fetch]: HTTP ${res.status} downloading prediction image`,
    );
  }
  return {
    data: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'image/png',
  };
}

export const zenmuxPredictImageProvider: ImageProvider = {
  name: 'zenmux-predict',

  async generate(input: ImageInput, ctx: ProviderContext): Promise<ProviderResult> {
    const model = input.model?.trim();
    if (!model) {
      throw new Error('zenmux-predict[no_model]: an explicit model id is required');
    }
    const n = Math.min(Math.max(input.n ?? 1, 1), 4);

    const refs = input.referenceAssetIds?.length
      ? await Promise.all(
          input.referenceAssetIds.map((id) => readAssetBase64(ctx.prisma, id)),
        )
      : [];

    const instance: Record<string, unknown> = { prompt: input.prompt };
    // Image-to-image: these models take a single reference image. Pass the
    // first reference in the models' own I/O shape ({bytesBase64Encoded,mimeType}).
    if (refs.length > 0) {
      instance.image = { bytesBase64Encoded: refs[0].data, mimeType: refs[0].mimeType };
    }

    ctx.log.info(
      {
        provider: 'zenmux-predict',
        op: refs.length > 0 ? 'edit' : 'generate',
        model,
        n,
        refs: refs.length,
      },
      'zenmux-predict image start',
    );

    const url =
      `${config.ZENMUX_VERTEX_BASE_URL}/v1/models/` +
      `${encodeURI(model)}:predict`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ instances: [instance], parameters: { sampleCount: n } }),
      signal: ctx.abortSignal,
    });
    if (!res.ok) {
      throw normalizeError(res.status, await res.text());
    }

    const json = (await res.json()) as PredictResponse;
    const preds = json.predictions ?? [];

    const outputAssets: ProviderOutputAsset[] = [];
    for (const p of preds) {
      if (p.bytesBase64Encoded) {
        outputAssets.push({
          data: Buffer.from(p.bytesBase64Encoded, 'base64'),
          contentType: p.mimeType || 'image/png',
        });
      } else if (p.gcsUri) {
        outputAssets.push(await fetchGcs(p.gcsUri));
      }
    }
    if (outputAssets.length === 0) {
      throw new Error('zenmux-predict[empty]: predictions contained no image');
    }

    return {
      outputJson: {
        provider: 'zenmux-predict',
        mode: refs.length > 0 ? 'edit' : 'generate',
        model,
        n,
      },
      outputAssets,
    };
  },
};
