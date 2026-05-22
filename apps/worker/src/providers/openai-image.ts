import { Buffer } from 'node:buffer';
import { toFile } from 'openai';
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
import {
  getOpenAIImageClient,
  normalizeOpenAIError,
} from '../lib/openai-client.js';

type GptImageSize = '1024x1024' | '1536x1024' | '1024x1536' | 'auto';

/**
 * Map our aspect ratio strings to a GPT-image-supported size string.
 * gpt-image-1 / gpt-image-1.5 only accept the three sizes (plus auto).
 * For unrecognized ratios we return 'auto' and let the model decide.
 */
function sizeFromRatio(ratio: string): GptImageSize {
  const m: Record<string, GptImageSize> = {
    '1:1': '1024x1024',
    '4:3': '1024x1024',
    '3:4': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '16:9': '1536x1024',
    '9:16': '1024x1536',
  };
  return m[ratio] ?? 'auto';
}

function normalizeImageModel(model: string): string {
  return model.startsWith('openai/') ? model.slice('openai/'.length) : model;
}

function extFromContentType(ct: string): string {
  if (ct === 'image/jpeg') return 'jpg';
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/gif') return 'gif';
  return 'png';
}

async function readAssetBytes(
  prisma: PrismaClient,
  assetId: string,
): Promise<{ buf: Buffer; contentType: string; filename: string }> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error(`reference asset not found: ${assetId}`);
  const stream = await minioClient.getObject(asset.bucket, asset.key);
  const chunks: Buffer[] = [];
  for await (const c of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  return {
    buf: Buffer.concat(chunks),
    contentType: asset.contentType,
    filename: `ref-${asset.id}.${extFromContentType(asset.contentType)}`,
  };
}

async function decodeImageItem(
  item: { b64_json?: string | null; url?: string | null },
  signal: AbortSignal,
): Promise<Buffer> {
  if (item.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item.url) {
    const res = await fetch(item.url, { signal });
    if (!res.ok) {
      throw new Error(
        `openai image url fetch failed: HTTP ${res.status} ${res.statusText}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('openai image item has neither b64_json nor url');
}

export const openaiImageProvider: ImageProvider = {
  name: 'openai',

  async generate(
    input: ImageInput,
    ctx: ProviderContext,
  ): Promise<ProviderResult> {
    const client = getOpenAIImageClient();
    const model =
      input.model && input.model.trim().length > 0
        ? normalizeImageModel(input.model)
        : config.OPENAI_IMAGE_MODEL;
    const n = Math.min(Math.max(input.n ?? 1, 1), 4);
    const size = sizeFromRatio(input.ratio);
    const hasRefs =
      Array.isArray(input.referenceAssetIds) &&
      input.referenceAssetIds.length > 0;

    try {
      const data = hasRefs
        ? await callEdit(client, ctx, {
            model,
            prompt: input.prompt,
            n,
            size,
            referenceAssetIds: input.referenceAssetIds!,
          })
        : await callGenerate(client, ctx, {
            model,
            prompt: input.prompt,
            n,
            size,
          });

      const items = data.images ?? [];
      if (items.length === 0) throw new Error('openai returned no images');

      const outputAssets: ProviderOutputAsset[] = await Promise.all(
        items.map(async (it) => {
          const buf = await decodeImageItem(it, ctx.abortSignal);
          // gpt-image-* models default to PNG. If a future model sets
          // output_format, the response's `output_format` field would tell
          // us — we'd echo it here. For now PNG covers the GPT family.
          return { data: buf, contentType: 'image/png' };
        }),
      );

      return {
        outputJson: {
          provider: 'openai',
          mode: hasRefs ? 'edit' : 'generate',
          model,
          size,
          generationId: data.responseId ?? null,
          revisedPrompts: items
            .map((i) => i.revised_prompt)
            .filter((s): s is string => !!s),
          usage: data.usage ?? null,
        },
        outputAssets,
      };
    } catch (err) {
      throw normalizeOpenAIError(err);
    }
  },
};

// --- internal call wrappers --------------------------------------------------

type GenArgs = {
  model: string;
  prompt: string;
  n: number;
  size: GptImageSize;
};

type EditArgs = GenArgs & { referenceAssetIds: string[] };

type ImageItem = { b64_json?: string | null; url?: string | null; revised_prompt?: string | null };

type CallResult = {
  images: ImageItem[];
  responseId?: string | null;
  usage?: unknown;
};

async function callGenerate(
  client: ReturnType<typeof getOpenAIImageClient>,
  ctx: ProviderContext,
  args: GenArgs,
): Promise<CallResult> {
  ctx.log.info(
    { provider: 'openai', op: 'generate', model: args.model, n: args.n, size: args.size },
    'openai image generate start',
  );
  const resp = await client.images.generate(
    {
      model: args.model,
      prompt: args.prompt,
      n: args.n,
      size: args.size,
    },
    { signal: ctx.abortSignal },
  );
  return {
    images: (resp.data ?? []) as ImageItem[],
    responseId: (resp as unknown as { id?: string }).id ?? null,
    usage: (resp as unknown as { usage?: unknown }).usage ?? null,
  };
}

async function callEdit(
  client: ReturnType<typeof getOpenAIImageClient>,
  ctx: ProviderContext,
  args: EditArgs,
): Promise<CallResult> {
  ctx.log.info(
    {
      provider: 'openai',
      op: 'edit',
      model: args.model,
      n: args.n,
      size: args.size,
      refs: args.referenceAssetIds.length,
    },
    'openai image edit start',
  );
  const refs = await Promise.all(
    args.referenceAssetIds.map((id) => readAssetBytes(ctx.prisma, id)),
  );
  const files = await Promise.all(
    refs.map((r) =>
      toFile(r.buf, r.filename, { type: r.contentType }),
    ),
  );
  const resp = await client.images.edit(
    {
      model: args.model,
      image: files,
      prompt: args.prompt,
      n: args.n,
      size: args.size,
    },
    { signal: ctx.abortSignal },
  );
  return {
    images: (resp.data ?? []) as ImageItem[],
    responseId: (resp as unknown as { id?: string }).id ?? null,
    usage: (resp as unknown as { usage?: unknown }).usage ?? null,
  };
}
