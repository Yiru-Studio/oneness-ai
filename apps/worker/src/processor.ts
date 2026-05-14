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
      ).generate(task.input as never, ctx);
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
  metrics.incr('task.success', { type: task.type, provider: task.provider });
  taskLog.info({ outputAssets: r.outputAssets?.length ?? 0 }, 'task succeeded');
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
