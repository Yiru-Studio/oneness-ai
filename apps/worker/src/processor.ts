import { createId } from '@paralleldrive/cuid2';
import { Prisma } from '@prisma/client';
import { prisma } from './lib/prisma.js';
import { minioClient, TaskOutputsBucket } from './lib/minio.js';
import { logger, metrics } from '@oneness/shared/logger';
import { TaskStatus, type TaskType } from '@oneness/shared/enums';
import {
  providerKindOf,
  type ProviderContext,
  type ProviderResult,
} from '@oneness/shared/providers';
import { selectProvider } from './providers/registry.js';
import { distillForThreeView } from './lib/three-view-distill.js';

const CANCEL_POLL_MS = 1000;

export async function processTask(taskId: string) {
  const taskLog = logger.child({ taskId });

  // 1. Re-read task. If not in QUEUED, exit cleanly.
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      ownerId: true,
      projectId: true,
      type: true,
      provider: true,
      status: true,
      input: true,
      costCredits: true,
    },
  });
  if (!task) {
    taskLog.warn('task row not found, skipping');
    return;
  }
  if (task.status !== TaskStatus.QUEUED) {
    taskLog.info({ status: task.status }, 'task not in QUEUED state, skipping');
    return;
  }

  // 2. Claim — set RUNNING. If concurrent claim raced, bail.
  const claim = await prisma.task.updateMany({
    where: { id: taskId, status: TaskStatus.QUEUED },
    data: { status: TaskStatus.RUNNING, startedAt: new Date() },
  });
  if (claim.count === 0) {
    taskLog.info('lost claim race, another worker took it');
    return;
  }
  metrics.incr('task.start', { type: task.type, provider: task.provider });

  // 3. AbortController + cancel poller
  const ac = new AbortController();
  const poller = setInterval(async () => {
    const fresh = await prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true },
    });
    if (fresh?.status === TaskStatus.CANCELLED) {
      taskLog.info('cancel detected mid-flight, aborting provider');
      ac.abort();
    }
  }, CANCEL_POLL_MS);

  const ctx: ProviderContext = {
    taskId,
    ownerId: task.ownerId,
    projectId: task.projectId,
    prisma,
    log: taskLog,
    abortSignal: ac.signal,
  };

  let result: ProviderResult | null = null;
  let providerError: Error | null = null;
  try {
    const kind = providerKindOf(task.type as TaskType);
    const provider = selectProvider(kind, task.provider);
    let providerInput = task.input;
    if (
      kind === 'image' &&
      providerInput &&
      typeof providerInput === 'object' &&
      typeof (providerInput as Record<string, unknown>).prompt === 'string'
    ) {
      const inputObj = providerInput as { prompt: string; referenceAssetIds?: string[] };
      // Expand @三视图 marker into a canonical three-view layout prompt.
      if (inputObj.prompt.trimStart().startsWith(THREE_VIEW_MARKER)) {
        providerInput = await expandThreeViewPrompt(inputObj, taskLog);
      }
      if (
        Array.isArray(inputObj.referenceAssetIds) &&
        inputObj.referenceAssetIds.length > 0
      ) {
        providerInput = injectFaceReferencePrompt(providerInput as { prompt: string });
      }
    }

    if (kind === 'text') {
      // TextProvider has an `analyze` method instead of `generate`.
      result = await (
        provider as {
          analyze: (i: unknown, c: ProviderContext) => Promise<ProviderResult>;
        }
      ).analyze(task.input as never, ctx);
    } else {
      result = await (
        provider as {
          generate: (i: unknown, c: ProviderContext) => Promise<ProviderResult>;
        }
      ).generate(providerInput as never, ctx);
    }
  } catch (err) {
    providerError = err as Error;
  } finally {
    clearInterval(poller);
  }

  // 4. Was it cancelled during run?
  const final = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true },
  });

  if (final?.status === TaskStatus.CANCELLED) {
    // API already set CANCELLED. We refund here because API skipped refund for
    // RUNNING-state cancels (waiting for us to handle it).
    await prisma.$transaction([
      prisma.user.update({
        where: { id: task.ownerId },
        data: { credits: { increment: task.costCredits } },
      }),
      prisma.task.update({
        where: { id: taskId },
        data: { completedAt: new Date() },
      }),
    ]);
    metrics.incr('task.cancel.refunded', {
      type: task.type,
      provider: task.provider,
    });
    taskLog.info('task cancelled mid-run, refunded credits');
    return;
  }

  if (providerError) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: task.ownerId },
        data: { credits: { increment: task.costCredits } },
      }),
      prisma.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.FAILED,
          error: providerError.message,
          completedAt: new Date(),
        },
      }),
    ]);
    metrics.incr('task.fail', { type: task.type, provider: task.provider });
    taskLog.warn({ err: providerError.message }, 'task failed');
    throw providerError; // re-throw so BullMQ retries (until attempts exhausted)
  }

  // 5. Success path — persist outputs.
  const r = result!;
  await persistSuccess(taskId, task.ownerId, task.costCredits, r);
  // If this VIDEO task was generating for a shot, link the produced asset back
  // to the Shot row so the UI can display it without polling assets manually.
  if (task.type === 'VIDEO') {
    const shotId = readShotId(task.input);
    if (shotId) await linkShotVideo(shotId, taskId, r, taskLog);
  }
  metrics.incr('task.success', { type: task.type, provider: task.provider });
  taskLog.info({ outputAssets: r.outputAssets?.length ?? 0 }, 'task succeeded');
}

function readShotId(input: unknown): string | null {
  if (input && typeof input === 'object' && 'shotId' in input) {
    const v = (input as { shotId?: unknown }).shotId;
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

async function linkShotVideo(
  shotId: string,
  taskId: string,
  result: ProviderResult,
  log: import('@oneness/shared/logger').Logger,
) {
  // Find the video asset on this task (it was inserted by persistSuccess).
  const ta = await prisma.taskAsset.findFirst({
    where: { taskId, role: 'output' },
    include: { asset: true },
    orderBy: { asset: { createdAt: 'desc' } },
  });
  if (!ta) {
    log.warn({ shotId, taskId }, 'shot video task succeeded but produced no asset; skipping link');
    return;
  }
  // The Seedance provider records the lastFrame URL in outputJson but doesn't
  // download it. Phase-1 omits lastFrame asset persistence; the URL is logged.
  const out = result.outputJson as { lastFrameUrl?: string | null } | undefined;
  if (out?.lastFrameUrl) {
    log.info({ shotId, lastFrameUrl: out.lastFrameUrl }, 'shot last-frame URL recorded (not persisted)');
  }
  await prisma.shot.update({
    where: { id: shotId },
    data: { videoAssetId: ta.assetId },
  });
  log.info({ shotId, assetId: ta.assetId }, 'shot.videoAssetId updated');
}

async function persistSuccess(
  taskId: string,
  ownerId: string,
  reservedCost: number,
  result: ProviderResult,
) {
  // Upload assets to MinIO first (idempotent across retries — keys include assetId).
  const assetRows: Array<{
    id: string;
    bucket: string;
    key: string;
    contentType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    role: 'output' | 'reference';
  }> = [];

  for (const out of result.outputAssets ?? []) {
    const assetId = createId();
    const ext = extFromContentType(out.contentType);
    const key = `${ownerId}/tasks/${taskId}/${assetId}.${ext}`;
    const buf = Buffer.isBuffer(out.data)
      ? out.data
      : await streamToBuffer(out.data);
    await minioClient.putObject(TaskOutputsBucket, key, buf, buf.length, {
      'Content-Type': out.contentType,
    });
    assetRows.push({
      id: assetId,
      bucket: TaskOutputsBucket,
      key,
      contentType: out.contentType,
      sizeBytes: buf.length,
      width: out.width ?? null,
      height: out.height ?? null,
      durationMs: out.durationMs ?? null,
      role: out.role ?? 'output',
    });
  }

  // Reconcile credits: if provider reported a different actual cost, settle the delta.
  const actualCost = result.actualCostCredits;
  const delta = actualCost === undefined ? 0 : reservedCost - actualCost;

  await prisma.$transaction(async (tx) => {
    if (delta > 0) {
      // Provider charged less than estimated → refund the difference.
      await tx.user.update({
        where: { id: ownerId },
        data: { credits: { increment: delta } },
      });
    } else if (delta < 0) {
      // Provider charged more — decrement the extra. May go negative; we tolerate.
      await tx.user.update({
        where: { id: ownerId },
        data: { credits: { decrement: -delta } },
      });
    }
    for (const a of assetRows) {
      await tx.asset.create({
        data: {
          id: a.id,
          ownerId,
          bucket: a.bucket,
          key: a.key,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
          width: a.width,
          height: a.height,
          durationMs: a.durationMs,
        },
      });
      await tx.taskAsset.create({
        data: { taskId, assetId: a.id, role: a.role },
      });
    }
    await tx.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.SUCCEEDED,
        output:
          result.outputJson === undefined || result.outputJson === null
            ? Prisma.JsonNull
            : (result.outputJson as Prisma.InputJsonValue),
        costCredits: actualCost ?? reservedCost,
        completedAt: new Date(),
      },
    });
  });
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string),
    );
  }
  return Buffer.concat(chunks);
}

function extFromContentType(ct: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
  };
  return map[ct] ?? 'bin';
}

/**
 * When a image-generation task carries reference images (e.g. a character
 * avatar), prefix the user prompt with a lightweight instruction that tells
 * the model the face must stay consistent with the reference.
 */
function injectFaceReferencePrompt<T extends { prompt: string }>(input: T): T {
  const prefix =
    '以下图片为该角色的参考图，新图中该人物的面部轮廓、五官、发型、肤色等长相特征必须与参考图中的人物完全一致。请按以下描述生成：\n\n';
  return { ...input, prompt: prefix + input.prompt };
}

const THREE_VIEW_MARKER = '@三视图';
const THREE_VIEW_RATIO = '16:9';

/**
 * Canonical three-view character reference sheet, tuned against the
 * references in `assets/Face-and-three-view-style/` and validated end-to-end
 * via ZenMux Nano Banana (google/gemini-2.5-flash-image). The layout: a
 * face-filling close-up portrait on the left half, and three equal-width
 * full-body panels on the right half — front, 3/4 turned (NOT 90° profile),
 * and back. Same studio backdrop, outfit, and identity across all 4 panels.
 */
const THREE_VIEW_LAYOUT_PROMPT = [
  '请生成一张写实角色参考图，单张横向 16:9 图像，画面从左到右分为 4 个等高画面：',
  '',
  '【画面 1】（占整图 50% 宽度）：角色脸部大特写，正面 frontal portrait，头肩特写，五官清晰，肤质真实，神情自然平静。',
  '',
  '【画面 2 / 3 / 4】（平分整图右侧 50% 宽度）：同一个角色的全身像（从头顶到脚尖完整入镜，鞋子完整），三个角度并排：',
  '  • 画面 2 = 全身正视图（front view）：身体与镜头完全正对，双臂自然垂在体侧。',
  '  • 画面 3 = 全身 3/4 微侧身视图（three-quarter view，**约 30 度侧身、绝非 90 度侧面**）：身体仅轻微转向一侧，观众仍能清楚看到两只眼睛、整张脸的正面、整个胸腹的正面，只是稍微带一点角度。绝对禁止画成 profile / 全侧面剪影 / 只能看到一只眼睛的纯侧视图。',
  '  • 画面 4 = 全身背视图（back view）：身体完全背对镜头，观众只能看到后脑勺和后背。',
  '',
  '强制约束：',
  '- 4 个画面共用完全一致的中性灰白色摄影棚背景、同样均匀柔和的影棚布光、同一套服装、同一个发型、同样的体型、年龄、肤色、人物身份。',
  '- 全身像必须站立、双脚着地、双臂自然下垂、放松站姿；不做任何动作、不带道具。',
  '- 严格写实摄影风格；禁止任何文字、标签、字幕、水印、logo、画框、白色分隔条、网格。',
  '',
].join('\n');

/**
 * Replaces a leading `@三视图` marker in the prompt with the canonical
 * three-view layout prompt. The marker may optionally be followed by
 * additional user description (the verbose "dirty" prompt produced by the
 * Analyze Character pipeline, which mixes identity + pose + scene + film
 * grain). We first distill the body via gpt-4o-mini to identity + wardrobe
 * only (cached in Redis by sha256(body)), then append it under a
 * "补充描述：" header. The aspect ratio is forced to 16:9 because the
 * 4-panel layout requires a wide canvas to read correctly.
 *
 * The final composed prompt is logged at info level so operators can
 * inspect exactly what the image model received.
 */
async function expandThreeViewPrompt<
  T extends { prompt: string; ratio?: string },
>(input: T, log: import('@oneness/shared/logger').Logger): Promise<T> {
  const trimmed = input.prompt.trimStart();
  const without = trimmed.slice(THREE_VIEW_MARKER.length).replace(/^\s*\n?/, '');
  const rawBody = without.trim();

  let cleansedBody = '';
  if (rawBody.length > 0) {
    try {
      const { cleansed, cacheHit } = await distillForThreeView(rawBody, log);
      cleansedBody = cleansed;
      log.info(
        {
          op: 'three-view-expand',
          cacheHit,
          rawBodyBytes: rawBody.length,
          cleansedBytes: cleansedBody.length,
        },
        'three-view body distilled',
      );
    } catch (err) {
      // Distillation is best-effort: if the LLM call fails we fall back to
      // the raw body rather than failing the whole image task. The layout
      // prompt still enforces neutral pose/background, so even a dirty
      // body usually produces a workable turnaround.
      log.warn(
        { op: 'three-view-expand', err: (err as Error).message },
        'three-view distillation failed, falling back to raw body',
      );
      cleansedBody = rawBody;
    }
  }

  const expanded = cleansedBody
    ? `${THREE_VIEW_LAYOUT_PROMPT}补充描述：\n${cleansedBody}`
    : THREE_VIEW_LAYOUT_PROMPT;

  log.info(
    {
      op: 'three-view-expand',
      ratio: THREE_VIEW_RATIO,
      finalPromptBytes: expanded.length,
      finalPrompt: expanded,
    },
    'three-view final prompt composed',
  );

  return { ...input, prompt: expanded, ratio: THREE_VIEW_RATIO };
}
