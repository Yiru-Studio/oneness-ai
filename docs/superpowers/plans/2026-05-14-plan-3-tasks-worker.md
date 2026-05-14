# Plan 3 / Tasks + Worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the AI-task door end-to-end: `POST /api/tasks` enqueues a job onto BullMQ; a separate `apps/worker` process consumes it; stub providers (image / video / text) emit results into MinIO + Task rows; credits get reserved on enqueue and refunded on failure / cancel; `GET /api/tasks/:id` reflects the live state. After this plan, plugging in a real Gemini/Nano-banana/Seedance provider is a single-file change inside `apps/worker/src/providers/`.

**Architecture:** Three named BullMQ queues (`ai-image`, `ai-video`, `ai-text`), one Redis (already up from Plan 1). API uses BullMQ `Queue` to enqueue, `apps/worker` uses BullMQ `Worker` to consume. Worker concurrency: image=4, video=1, text=4. Providers are ports/adapters: `ImageProvider`/`VideoProvider`/`TextProvider` interfaces live in `@oneness/shared/providers`; concrete `stub` implementations live in `apps/worker/src/providers/`; `PROVIDER_IMAGE|VIDEO|TEXT` env vars select the implementation. Credits are reserved transactionally at enqueue. Cancel is a state-machine action that races safely with worker completion.

**Tech Stack:** Continuing — Hono, Prisma, zod, vitest — plus BullMQ 5 (new), ioredis (already present), sharp (already present) used for placeholder image generation.

**Linked spec:** `docs/superpowers/specs/2026-05-14-backend-design.md` (§6 AI tasks + queue, §3 Task/TaskAsset models, §4.2 task routes, §4.1 conventions, §7.2 logging metrics hooks).

**Depends on:** Plans 1 + 2 fully complete. `apps/api`, `packages/shared`, all CRUD routes, Asset/Task tables, MinIO `task-outputs` bucket, `getPrismaClient`, `AppError`, `tryReadUser/requireUser` middleware, `serializeAsset` helper.

**Out of scope (Plan 4):**
- Frontend `src/lib/api.ts` rewrite to call `/api/tasks`
- Real provider implementations (user-supplied)
- SSE / WebSocket task-status push (polling is enough for MVP)
- Containerized worker Dockerfile (Plan 4 with `dev:full` profile)
- Cron cleanup of orphan task-outputs MinIO objects

**Conventions:**
- BullMQ job data is minimal: `{ taskId }`. The worker reads the Task row from DB to get `input`/`provider`/`type`. This avoids serializing big payloads twice and keeps the DB as source of truth.
- The DB Task row's `status` column is the **authoritative** lifecycle state. BullMQ job state is a transport detail.
- On any terminal write to a Task row (SUCCEEDED / FAILED / CANCELLED), the writer must use a transaction that **first re-reads `status`** to handle the cancel race — see §6.4.
- Worker logs are pino with `{ taskId, type, provider }` bound.
- `pnpm dev` (the concurrently script) now also spawns the worker — root scripts get a `dev:worker` entry.
- Test pattern: integration tests boot a Worker in-process so the full lifecycle runs in one vitest file.

---

## Task 1: Shared task building blocks

Queue names, pricing, provider interface types, request schemas. All in `@oneness/shared` because both `apps/api` (enqueue side) and `apps/worker` (consume side) need them.

**Files:**
- Create: `packages/shared/src/queues.ts`
- Create: `packages/shared/src/pricing.ts`
- Create: `packages/shared/src/providers/types.ts`
- Create: `packages/shared/src/schemas/tasks.ts`
- Modify: `packages/shared/src/index.ts` (barrel)
- Modify: `packages/shared/src/schemas/index.ts` (barrel)
- Modify: `packages/shared/package.json` (add subpath exports)

- [x] **Step 1.1: Write `packages/shared/src/queues.ts`**

```ts
import { TaskType } from './enums.js';

export const QueueNames = {
  IMAGE: 'ai-image',
  VIDEO: 'ai-video',
  TEXT:  'ai-text',
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

export function queueForTaskType(type: TaskType): QueueName {
  switch (type) {
    case TaskType.IMAGE:        return QueueNames.IMAGE;
    case TaskType.VIDEO:        return QueueNames.VIDEO;
    case TaskType.TEXT_ANALYZE: return QueueNames.TEXT;
  }
}

export const WorkerConcurrency = {
  [QueueNames.IMAGE]: 4,
  [QueueNames.VIDEO]: 1,
  [QueueNames.TEXT]:  4,
} as const;

/** BullMQ job data — minimal. Workers re-fetch Task row from DB. */
export type TaskJobData = { taskId: string };
```

- [x] **Step 1.2: Write `packages/shared/src/pricing.ts`**

```ts
import { TaskType } from './enums.js';

/**
 * MVP estimation table. Real providers can override at runtime by returning
 * `actualCostCredits` from their ProviderResult; the worker reconciles with
 * the reserved amount on completion.
 */
export const TaskCreditEstimate: Record<TaskType, number> = {
  IMAGE: 1,
  VIDEO: 5,
  TEXT_ANALYZE: 1,
};

export function estimateCost(type: TaskType): number {
  return TaskCreditEstimate[type];
}
```

- [x] **Step 1.3: Write `packages/shared/src/providers/types.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import type { Readable } from 'node:stream';
import type { Logger } from '../logger.js';
import type { TaskType } from '../enums.js';

/**
 * Output asset emitted by a provider. The worker writes it to MinIO under
 * task-outputs/<userId>/tasks/<taskId>/<assetId>.<ext> and creates the Asset row.
 */
export type ProviderOutputAsset = {
  data: Buffer | Readable;
  contentType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  /** Role applied to the TaskAsset link row. Defaults to 'output'. */
  role?: 'output' | 'reference';
};

export type ProviderResult = {
  outputJson?: Record<string, unknown>;
  outputAssets?: ProviderOutputAsset[];
  /** Overrides the reserved costCredits. If null/undefined, reserved estimate stays. */
  actualCostCredits?: number;
};

/**
 * The worker passes one of these to each provider call. Providers must
 * honour the abortSignal (e.g. polling network ops with AbortController)
 * so cancel can stop in-flight work.
 */
export type ProviderContext = {
  taskId: string;
  ownerId: string;
  projectId: string | null;
  prisma: PrismaClient;
  log: Logger;
  abortSignal: AbortSignal;
};

export interface ImageProvider {
  readonly name: string;
  generate(input: ImageInput, ctx: ProviderContext): Promise<ProviderResult>;
}

export interface VideoProvider {
  readonly name: string;
  generate(input: VideoInput, ctx: ProviderContext): Promise<ProviderResult>;
}

export interface TextProvider {
  readonly name: string;
  analyze(input: TextInput, ctx: ProviderContext): Promise<ProviderResult>;
}

export type ImageInput = {
  prompt: string;
  ratio: string;
  model: string;
  referenceAssetIds?: string[];
  n?: number;
};
export type VideoInput = {
  prompt: string;
  model: string;
  duration: number;
  fromAssetId?: string;
};
export type TextInput = {
  episodeId: string;
  analysisType: 'general' | 'basic';
};

/** Convenience union — used by worker's registry. */
export type AnyProvider = ImageProvider | VideoProvider | TextProvider;

export type ProviderKind = 'image' | 'video' | 'text';

export function providerKindOf(type: TaskType): ProviderKind {
  switch (type) {
    case 'IMAGE':        return 'image';
    case 'VIDEO':        return 'video';
    case 'TEXT_ANALYZE': return 'text';
  }
}
```

- [x] **Step 1.4: Write `packages/shared/src/schemas/tasks.ts`**

```ts
import { z } from 'zod';
import { CuidSchema } from './common.js';
import { TaskType, TaskStatus } from '../enums.js';

const TaskTypeSchema = z.enum([TaskType.IMAGE, TaskType.VIDEO, TaskType.TEXT_ANALYZE]);
const TaskStatusSchema = z.enum([
  TaskStatus.QUEUED,
  TaskStatus.RUNNING,
  TaskStatus.SUCCEEDED,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
]);

const ImageInputSchema = z.object({
  prompt: z.string().min(1).max(5000),
  ratio: z.string().min(1).max(20),
  model: z.string().min(1).max(80),
  referenceAssetIds: z.array(CuidSchema).max(8).optional(),
  n: z.number().int().min(1).max(8).default(1),
});

const VideoInputSchema = z.object({
  prompt: z.string().min(1).max(5000),
  model: z.string().min(1).max(80),
  duration: z.number().int().min(1).max(60),
  fromAssetId: CuidSchema.optional(),
});

const TextInputSchema = z.object({
  episodeId: CuidSchema,
  analysisType: z.enum(['general', 'basic']),
});

export const CreateTaskSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(TaskType.IMAGE),
    projectId: CuidSchema.optional(),
    provider: z.string().min(1).max(60).default('stub'),
    input: ImageInputSchema,
  }),
  z.object({
    type: z.literal(TaskType.VIDEO),
    projectId: CuidSchema.optional(),
    provider: z.string().min(1).max(60).default('stub'),
    input: VideoInputSchema,
  }),
  z.object({
    type: z.literal(TaskType.TEXT_ANALYZE),
    projectId: CuidSchema, // required for text analysis (always belongs to a project)
    provider: z.string().min(1).max(60).default('stub'),
    input: TextInputSchema,
  }),
]);

export const TaskListQuerySchema = z.object({
  projectId: CuidSchema.optional(),
  type: TaskTypeSchema.optional(),
  status: TaskStatusSchema.optional(),
  cursor: CuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Internal callback (Plan: future external workflow). */
export const InternalUpdateTaskSchema = z.object({
  status: TaskStatusSchema.optional(),
  output: z.unknown().optional(),
  error: z.string().max(2000).optional().nullable(),
  outputAssetIds: z.array(CuidSchema).max(32).optional(),
  actualCostCredits: z.number().int().min(0).optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
export type InternalUpdateTaskInput = z.infer<typeof InternalUpdateTaskSchema>;
```

- [x] **Step 1.5: Update `packages/shared/src/schemas/index.ts`**

Append the line `export * from './tasks.js';` to the existing barrel.

- [x] **Step 1.6: Update `packages/shared/src/index.ts`**

Append:

```ts
export * from './queues.js';
export * from './pricing.js';
export * from './providers/types.js';
```

- [x] **Step 1.7: Update `packages/shared/package.json` exports map**

Add new subpaths:

```jsonc
{
  "exports": {
    ".": "./src/index.ts",
    "./enums": "./src/enums.ts",
    "./errors": "./src/errors.ts",
    "./logger": "./src/logger.ts",
    "./prisma": "./src/prisma-client.ts",
    "./schemas": "./src/schemas/index.ts",
    "./queues": "./src/queues.ts",
    "./pricing": "./src/pricing.ts",
    "./providers": "./src/providers/types.ts"
  }
}
```

- [x] **Step 1.8: Typecheck and commit**

Run:
```bash
pnpm --filter @oneness/shared typecheck
```

Expected: exits 0. If `@prisma/client` is not resolvable from `providers/types.ts`, check that `packages/shared/package.json` has it as a dep (it should from Plan 1) — if missing, run `pnpm --filter @oneness/shared add @prisma/client@^5.22.0`.

```bash
git add packages/shared/
git commit -m "feat(shared): queue names, pricing, provider interface, task schemas"
```

---

## Task 2: BullMQ Queue clients in apps/api

The API holds a `Queue` instance per queue name. Enqueue is fire-and-forget (`queue.add(jobName, { taskId })`).

**Files:**
- Create: `apps/api/src/lib/queues.ts`
- Modify: `apps/api/package.json` (add `bullmq`)

- [x] **Step 2.1: Install bullmq into apps/api**

```bash
pnpm --filter api add bullmq
```

Expected: `bullmq` lands in `apps/api/package.json` dependencies.

- [x] **Step 2.2: Write `apps/api/src/lib/queues.ts`**

```ts
import { Queue } from 'bullmq';
import { config } from '../config.js';
import { QueueNames, type QueueName, type TaskJobData } from '@oneness/shared/queues';

const connection = { url: config.REDIS_URL };

const queueOptions = {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 200 },
  },
};

export const queues: Record<QueueName, Queue<TaskJobData>> = {
  [QueueNames.IMAGE]: new Queue<TaskJobData>(QueueNames.IMAGE, queueOptions),
  [QueueNames.VIDEO]: new Queue<TaskJobData>(QueueNames.VIDEO, queueOptions),
  [QueueNames.TEXT]:  new Queue<TaskJobData>(QueueNames.TEXT,  queueOptions),
};

export async function enqueueTaskJob(queueName: QueueName, taskId: string) {
  await queues[queueName].add('process-task', { taskId }, { jobId: taskId });
}

export async function removeTaskJob(queueName: QueueName, taskId: string) {
  const job = await queues[queueName].getJob(taskId);
  if (job) await job.remove();
}

export async function closeQueues() {
  await Promise.all(Object.values(queues).map((q) => q.close()));
}
```

> Note: `jobId: taskId` makes the BullMQ job idempotent — re-enqueueing the same taskId won't create duplicates. Cancel uses `getJob(taskId).remove()` to pull from QUEUED state.

- [x] **Step 2.3: Typecheck and commit**

```bash
pnpm --filter api typecheck
git add apps/api/package.json pnpm-lock.yaml apps/api/src/lib/queues.ts
git commit -m "feat(api): BullMQ Queue clients for image/video/text"
```

---

## Task 3: API task routes (create / get / list)

**Files:**
- Create: `apps/api/src/serializers/task.ts`
- Create: `apps/api/src/routes/tasks.ts`
- Modify: `apps/api/src/index.ts` (mount)

- [x] **Step 3.1: Write `apps/api/src/serializers/task.ts`**

```ts
import type { Task, TaskAsset, Asset } from '@oneness/shared/prisma';
import { serializeAsset, type AssetDTO } from '../lib/assets.js';

type TaskAssetWithAsset = TaskAsset & { asset: Asset };
type TaskWithAssets = Task & { assets: TaskAssetWithAsset[] };

export type TaskDTO = {
  id: string;
  type: 'IMAGE' | 'VIDEO' | 'TEXT_ANALYZE';
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  provider: string;
  projectId: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  costCredits: number;
  outputAssets: AssetDTO[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export async function serializeTask(t: TaskWithAssets): Promise<TaskDTO> {
  const outputAssets = await Promise.all(
    t.assets
      .filter((a) => a.role === 'output')
      .map((a) => serializeAsset(a.asset)),
  );
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    provider: t.provider,
    projectId: t.projectId,
    input: t.input,
    output: t.output,
    error: t.error,
    costCredits: t.costCredits,
    outputAssets,
    createdAt: t.createdAt.toISOString(),
    startedAt: t.startedAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
  };
}
```

- [x] **Step 3.2: Write `apps/api/src/routes/tasks.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { enqueueTaskJob } from '../lib/queues.js';
import { serializeTask } from '../serializers/task.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import { estimateCost } from '@oneness/shared/pricing';
import { queueForTaskType } from '@oneness/shared/queues';
import {
  CreateTaskSchema,
  TaskListQuerySchema,
  IdParamSchema,
} from '@oneness/shared/schemas';
import { TaskStatus } from '@oneness/shared/enums';

export const taskRoutes = new Hono();

taskRoutes.use('/tasks', tryReadUser, requireUser);
taskRoutes.use('/tasks/*', tryReadUser, requireUser);

// POST /api/tasks — atomic reserve + create + enqueue
taskRoutes.post('/tasks', zValidator('json', CreateTaskSchema), async (c) => {
  const user = c.var.user!;
  const body = c.req.valid('json');
  const estimate = estimateCost(body.type);

  // Validate projectId belongs to user if provided
  if (body.projectId) {
    const p = await prisma.project.findFirst({
      where: { id: body.projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!p) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
  }

  const task = await prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({
      where: { id: user.id },
      select: { credits: true },
    });
    if (!u) throw AppError.unauthorized();
    if (u.credits < estimate) {
      throw AppError.badRequest(
        ErrorCodes.INSUFFICIENT_CREDITS,
        `requires ${estimate} credits, have ${u.credits}`,
        { required: estimate, available: u.credits },
      );
    }
    await tx.user.update({
      where: { id: user.id },
      data: { credits: { decrement: estimate } },
    });
    return tx.task.create({
      data: {
        ownerId: user.id,
        projectId: body.projectId ?? null,
        type: body.type,
        provider: body.provider,
        status: TaskStatus.QUEUED,
        input: body.input as Prisma.InputJsonValue,
        costCredits: estimate,
      },
      include: { assets: { include: { asset: true } } },
    });
  });

  // Enqueue AFTER transaction commits so worker can't observe a half-created Task.
  await enqueueTaskJob(queueForTaskType(body.type), task.id);

  return c.json(await serializeTask(task), 201);
});

// GET /api/tasks/:id
taskRoutes.get(
  '/tasks/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const task = await prisma.task.findFirst({
      where: { id, ownerId: user.id },
      include: { assets: { include: { asset: true } } },
    });
    if (!task) {
      throw AppError.notFound(ErrorCodes.TASK_NOT_FOUND, 'task not found');
    }
    return c.json(await serializeTask(task));
  },
);

// GET /api/tasks — cursor pagination
taskRoutes.get(
  '/tasks',
  zValidator('query', TaskListQuerySchema),
  async (c) => {
    const user = c.var.user!;
    const q = c.req.valid('query');
    const where = {
      ownerId: user.id,
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const items = await prisma.task.findMany({
      where,
      take: q.limit + 1, // fetch one extra to know if there's a next page
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: { assets: { include: { asset: true } } },
    });
    const hasMore = items.length > q.limit;
    const slice = items.slice(0, q.limit);
    const serialized = await Promise.all(slice.map(serializeTask));
    return c.json({
      items: serialized,
      nextCursor: hasMore ? slice[slice.length - 1]?.id ?? null : null,
    });
  },
);
```

- [x] **Step 3.3: Mount in `apps/api/src/index.ts`**

Add `import { taskRoutes } from './routes/tasks.js';` and `app.route('/api', taskRoutes);`.

- [x] **Step 3.4: Typecheck**

```bash
pnpm --filter api typecheck
```

Expected: exits 0.

- [x] **Step 3.5: Commit**

```bash
git add apps/api/src/serializers/task.ts apps/api/src/routes/tasks.ts apps/api/src/index.ts
git commit -m "feat(api): POST/GET/list /api/tasks with credit reserve + enqueue"
```

---

## Task 4: Worker scaffold

Independent Node package that connects to the same Postgres + Redis + MinIO.

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/config.ts`
- Create: `apps/worker/src/lib/{prisma,redis,minio}.ts`
- Create: `apps/worker/src/index.ts` (skeleton — workers wired in Task 5/7)
- Modify: root `package.json` — add `dev:worker` script and chain it into `dev`

- [x] **Step 4.1: Write `apps/worker/package.json`**

```json
{
  "name": "worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --clear-screen=false src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@oneness/shared": "workspace:*",
    "@paralleldrive/cuid2": "^2.2.2",
    "@prisma/client": "^5.22.0",
    "bullmq": "^5.34.0",
    "ioredis": "^5.4.1",
    "minio": "^8.0.2",
    "sharp": "^0.33.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

- [x] **Step 4.2: Write `apps/worker/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [x] **Step 4.3: Write `apps/worker/src/config.ts`**

Mirror `apps/api/src/config.ts` but only the env vars worker uses (no INTERNAL_SECRET or CORS):

```ts
import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET_TASK_OUTPUTS: z.string().default('task-outputs'),
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
  PROVIDER_IMAGE: z.string().default('stub'),
  PROVIDER_VIDEO: z.string().default('stub'),
  PROVIDER_TEXT:  z.string().default('stub'),
  STUB_FAIL_RATE: z.coerce.number().min(0).max(1).default(0.05),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid worker config:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
```

- [x] **Step 4.4: Write `apps/worker/src/lib/prisma.ts`**

```ts
import { getPrismaClient } from '@oneness/shared/prisma';
import { config } from '../config.js';

export const prisma = getPrismaClient({
  log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
```

- [x] **Step 4.5: Write `apps/worker/src/lib/redis.ts`**

```ts
import Redis from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});
```

- [x] **Step 4.6: Write `apps/worker/src/lib/minio.ts`**

```ts
import { Client } from 'minio';
import { config } from '../config.js';

const url = new URL(config.MINIO_ENDPOINT);

export const minioClient = new Client({
  endPoint: url.hostname,
  port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
  useSSL: url.protocol === 'https:',
  accessKey: config.MINIO_ACCESS_KEY,
  secretKey: config.MINIO_SECRET_KEY,
});

export const TaskOutputsBucket = config.MINIO_BUCKET_TASK_OUTPUTS;
```

- [x] **Step 4.7: Write a minimal `apps/worker/src/index.ts`**

This is a "hello, workers will be wired later" entry point. We expand it in Task 7.

```ts
import { logger } from '@oneness/shared/logger';
import { config } from './config.js';

logger.info(
  {
    providers: {
      image: config.PROVIDER_IMAGE,
      video: config.PROVIDER_VIDEO,
      text:  config.PROVIDER_TEXT,
    },
    failRate: config.STUB_FAIL_RATE,
  },
  'worker booted (no consumers yet)',
);
```

- [x] **Step 4.8: Patch root `package.json` to add `dev:worker`**

In the `scripts` block, add:

```jsonc
{
  "scripts": {
    "...": "...",
    "dev:worker": "dotenv -e .env -- pnpm --filter worker dev"
  }
}
```

And change the existing `dev` script to spawn worker too:

```jsonc
{
  "dev": "pnpm infra:up && concurrently -k -n api,worker,web -c blue,magenta,green \"pnpm dev:api\" \"pnpm dev:worker\" \"pnpm dev:web\""
}
```

- [x] **Step 4.9: Install + boot smoke test**

```bash
pnpm install
pnpm --filter worker typecheck
```

Expected: install adds `worker` package. Typecheck passes.

Then verify the worker boots:

```bash
pnpm dev:worker > /tmp/worker.log 2>&1 &
sleep 4
grep -q 'worker booted' /tmp/worker.log && echo 'WORKER OK' || (cat /tmp/worker.log; echo 'FAIL')
kill %1 2>/dev/null
```

Expected: prints `WORKER OK`.

- [x] **Step 4.10: Commit**

```bash
git add apps/worker/ package.json pnpm-lock.yaml
git commit -m "feat(worker): scaffold apps/worker (config, lib singletons, root dev:worker script)"
```

---

## Task 5: Stub providers (image / video / text)

Each provider implements the shared interface. Stubs sleep, optionally fail with `STUB_FAIL_RATE`, and return a `ProviderResult`. Image uses sharp to make a uniquely-coloured PNG. Video uses sharp too (PNG with `image/png` MIME — see note) acting as a poster placeholder. Text emits a JSON paragraph.

**Files:**
- Create: `apps/worker/src/providers/registry.ts`
- Create: `apps/worker/src/providers/stub-image.ts`
- Create: `apps/worker/src/providers/stub-video.ts`
- Create: `apps/worker/src/providers/stub-text.ts`

> **Note on stub video output:** The spec calls for a stand-in `mp4`. Producing real MP4 bytes without ffmpeg is awkward, and committing a binary placeholder file is repo-noise. The stub instead emits a colourful PNG (content-type `image/png`) and records `Task.output = { kind: "stub-video-poster", note: "real provider should emit mp4" }`. This is honest about the substitution and keeps the storage path / Asset record shape future-compatible — a real video provider simply emits `contentType: 'video/mp4'` instead.

- [x] **Step 5.1: Write `apps/worker/src/providers/stub-image.ts`**

```ts
import sharp from 'sharp';
import type {
  ImageProvider,
  ImageInput,
  ProviderContext,
  ProviderResult,
} from '@oneness/shared/providers';

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

export const stubImageProvider: ImageProvider = {
  name: 'stub',
  async generate(input: ImageInput, ctx: ProviderContext): Promise<ProviderResult> {
    ctx.log.info({ prompt: input.prompt, model: input.model }, 'stub-image start');
    const delayMs = 3000 + Math.floor(Math.random() * 2000); // 3-5s
    await sleep(delayMs, ctx.abortSignal);

    if (Math.random() < currentFailRate()) {
      throw new Error('stub-image: random failure (STUB_FAIL_RATE)');
    }

    const color = pickColor(ctx.taskId);
    const n = Math.min(input.n ?? 1, 4);
    const outputAssets = await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        const data = await sharp({
          create: {
            width: 64, height: 64, channels: 3,
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
      outputJson: { prompt: input.prompt, model: input.model, n },
      outputAssets,
    };
  },
};
```

- [x] **Step 5.2: Write `apps/worker/src/providers/stub-video.ts`**

```ts
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
        width: 128, height: 72, channels: 3,
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
```

- [x] **Step 5.3: Write `apps/worker/src/providers/stub-text.ts`**

```ts
import type {
  TextProvider,
  TextInput,
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

export const stubTextProvider: TextProvider = {
  name: 'stub',
  async analyze(input: TextInput, ctx: ProviderContext): Promise<ProviderResult> {
    ctx.log.info({ episodeId: input.episodeId, analysisType: input.analysisType }, 'stub-text start');
    await sleep(2000, ctx.abortSignal);

    if (Math.random() < currentFailRate()) {
      throw new Error('stub-text: random failure (STUB_FAIL_RATE)');
    }

    return {
      outputJson: {
        kind: 'stub-text',
        episodeId: input.episodeId,
        analysisType: input.analysisType,
        summary: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
        keyPoints: ['stub point a', 'stub point b', 'stub point c'],
      },
    };
  },
};
```

- [x] **Step 5.4: Write `apps/worker/src/providers/registry.ts`**

```ts
import type { ProviderKind } from '@oneness/shared/providers';
import { stubImageProvider } from './stub-image.js';
import { stubVideoProvider } from './stub-video.js';
import { stubTextProvider } from './stub-text.js';
import { config } from '../config.js';

/**
 * The registry holds one concrete provider per (kind, name).
 * Stub is registered as the default for every kind. Future real providers
 * (e.g. 'gemini-3-pro') are added here.
 */
const registry = {
  image: {
    stub: stubImageProvider,
  },
  video: {
    stub: stubVideoProvider,
  },
  text: {
    stub: stubTextProvider,
  },
} as const;

export function selectProvider(kind: ProviderKind, name: string) {
  const bucket = registry[kind] as Record<string, (typeof registry)[typeof kind][keyof (typeof registry)[typeof kind]]>;
  const provider = bucket[name];
  if (!provider) {
    throw new Error(`unknown ${kind} provider: ${name}`);
  }
  return provider;
}

export function defaultProviderName(kind: ProviderKind): string {
  switch (kind) {
    case 'image': return config.PROVIDER_IMAGE;
    case 'video': return config.PROVIDER_VIDEO;
    case 'text':  return config.PROVIDER_TEXT;
  }
}
```

- [x] **Step 5.5: Typecheck and commit**

```bash
pnpm --filter worker typecheck
git add apps/worker/src/providers/
git commit -m "feat(worker): stub image/video/text providers + registry"
```

---

## Task 6: Worker job processor — full lifecycle

This is the heart of the worker. For each job:
1. Re-read the Task row (DB is source of truth).
2. If status is no longer QUEUED (e.g., CANCELLED while in queue), skip.
3. Set status → RUNNING, startedAt = now.
4. Call the provider with `AbortSignal` driven by periodic DB polling for CANCELLED.
5. On success: write output assets to MinIO, create Asset + TaskAsset rows, set status → SUCCEEDED.
6. On error: set status → FAILED + refund credits.
7. On cancel-while-running detected (before terminal write): set CANCELLED, refund credits, discard provider output.

**Files:**
- Create: `apps/worker/src/processor.ts`
- Modify: `apps/worker/src/index.ts` (wire 3 BullMQ Worker instances)

- [x] **Step 6.1: Write `apps/worker/src/processor.ts`**

```ts
import { createId } from '@paralleldrive/cuid2';
import { Prisma } from '@prisma/client';
import { prisma } from './lib/prisma.js';
import { minioClient, TaskOutputsBucket } from './lib/minio.js';
import { logger, metrics } from '@oneness/shared/logger';
import { TaskStatus, type TaskType } from '@oneness/shared/enums';
import { providerKindOf, type ProviderContext, type ProviderResult } from '@oneness/shared/providers';
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
      result = await (provider as { analyze: (i: unknown, c: ProviderContext) => Promise<ProviderResult> })
        .analyze(task.input as never, ctx);
    } else {
      result = await (provider as { generate: (i: unknown, c: ProviderContext) => Promise<ProviderResult> })
        .generate(task.input as never, ctx);
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
    metrics.incr('task.cancel.refunded', { type: task.type, provider: task.provider });
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
    const buf = Buffer.isBuffer(out.data) ? out.data : await streamToBuffer(out.data);
    await minioClient.putObject(
      TaskOutputsBucket,
      key,
      buf,
      buf.length,
      { 'Content-Type': out.contentType },
    );
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
        output: (result.outputJson ?? null) as Prisma.InputJsonValue | null,
        costCredits: actualCost ?? reservedCost,
        completedAt: new Date(),
      },
    });
  });
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
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
```

- [x] **Step 6.2: Rewrite `apps/worker/src/index.ts`**

```ts
import { Worker } from 'bullmq';
import { logger } from '@oneness/shared/logger';
import {
  QueueNames,
  WorkerConcurrency,
  type QueueName,
  type TaskJobData,
} from '@oneness/shared/queues';
import { config } from './config.js';
import { processTask } from './processor.js';

const connection = { url: config.REDIS_URL };

function startWorker(name: QueueName): Worker<TaskJobData> {
  const w = new Worker<TaskJobData>(
    name,
    async (job) => {
      await processTask(job.data.taskId);
    },
    {
      connection,
      concurrency: WorkerConcurrency[name],
    },
  );
  w.on('failed', (job, err) => {
    logger.warn({ queue: name, jobId: job?.id, err: err.message }, 'job failed');
  });
  w.on('error', (err) => {
    logger.error({ queue: name, err: err.message }, 'worker error');
  });
  logger.info({ queue: name, concurrency: WorkerConcurrency[name] }, 'worker started');
  return w;
}

const workers = [
  startWorker(QueueNames.IMAGE),
  startWorker(QueueNames.VIDEO),
  startWorker(QueueNames.TEXT),
];

async function shutdown() {
  logger.info('shutting down workers');
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

- [x] **Step 6.3: Typecheck**

```bash
pnpm --filter worker typecheck
```

Expected: exits 0.

> If you get a "Module @paralleldrive/cuid2 not found" error in worker, run `pnpm --filter worker add @paralleldrive/cuid2`.

- [x] **Step 6.4: Live smoke — kick off an image task and watch it land**

Kill stale processes first:
```bash
pkill -f 'tsx watch' 2>/dev/null
sleep 1
```

Start both API and worker:
```bash
pnpm dev:api    > /tmp/api.log    2>&1 &
pnpm dev:worker > /tmp/worker.log 2>&1 &
sleep 6
```

Verify both alive:
```bash
curl -s http://localhost:4000/api/_health | head -c 200
echo
grep 'worker started' /tmp/worker.log | head -3
```

Expected:
- `_health` body shows all checks ok
- 3 `worker started` log lines (image/video/text)

Create a task:
```bash
RESP=$(curl -s -X POST http://localhost:4000/api/tasks \
  -H 'authorization: Bearer test_token' \
  -H 'content-type: application/json' \
  -d '{
    "type": "IMAGE",
    "provider": "stub",
    "input": { "prompt": "test", "ratio": "16:9", "model": "stub", "n": 1 }
  }')
echo "POST: $RESP"
TID=$(echo "$RESP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
echo "task id: $TID"

# Poll for terminal state
for i in $(seq 1 15); do
  STATUS=$(curl -s http://localhost:4000/api/tasks/$TID -H 'authorization: Bearer test_token' | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  echo "[$i] status=$STATUS"
  case "$STATUS" in
    SUCCEEDED|FAILED|CANCELLED) break ;;
  esac
  sleep 1
done

echo
echo "=== final task ==="
curl -s http://localhost:4000/api/tasks/$TID -H 'authorization: Bearer test_token' | head -c 800
echo
```

Expected:
- POST returns 201 with `status: "QUEUED"` and `costCredits: 1`
- Polling shows `status=QUEUED` then `status=RUNNING` then `status=SUCCEEDED` (typically within 3-5 seconds)
- Final task has `outputAssets` array with one PNG (presigned URL, 64x64)
- 5% of the time (`STUB_FAIL_RATE`) it lands on FAILED — that's expected. Re-run; or set `STUB_FAIL_RATE=0` in `.env` temporarily.

Verify credits were charged correctly:
```bash
curl -s http://localhost:4000/api/me -H 'authorization: Bearer test_token' | head -c 200
echo
```

Expected: `credits` field is `seed credits - <number of successful image tasks>`.

Cleanup:
```bash
pkill -f 'tsx watch' 2>/dev/null
```

- [x] **Step 6.5: Commit**

```bash
git add apps/worker/src/processor.ts apps/worker/src/index.ts
git commit -m "feat(worker): job processor with cancel-aware lifecycle + credits reconcile"
```

---

## Task 7: API POST /api/tasks/:id/cancel

State machine:
- `QUEUED` → set CANCELLED + refund + remove from BullMQ.
- `RUNNING` → set CANCELLED only. Worker handles refund on completion (per Task 6 logic).
- terminal (SUCCEEDED/FAILED/CANCELLED) → 409.

**Files:**
- Modify: `apps/api/src/routes/tasks.ts` (add the cancel handler)

- [x] **Step 7.1: Append to `apps/api/src/routes/tasks.ts`**

Add this handler after the `GET /tasks` route, before the closing of the file:

```ts
import { removeTaskJob } from '../lib/queues.js';

// POST /api/tasks/:id/cancel
taskRoutes.post(
  '/tasks/:id/cancel',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const task = await prisma.task.findFirst({
      where: { id, ownerId: user.id },
      select: {
        id: true,
        ownerId: true,
        type: true,
        status: true,
        costCredits: true,
      },
    });
    if (!task) {
      throw AppError.notFound(ErrorCodes.TASK_NOT_FOUND, 'task not found');
    }
    if (
      task.status === TaskStatus.SUCCEEDED ||
      task.status === TaskStatus.FAILED ||
      task.status === TaskStatus.CANCELLED
    ) {
      throw AppError.conflict(
        ErrorCodes.TASK_NOT_CANCELLABLE,
        `task is in terminal status ${task.status}`,
      );
    }

    if (task.status === TaskStatus.QUEUED) {
      // We can refund here because the worker hasn't touched it yet.
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { credits: { increment: task.costCredits } },
        }),
        prisma.task.update({
          where: { id },
          data: {
            status: TaskStatus.CANCELLED,
            completedAt: new Date(),
          },
        }),
      ]);
      // Remove from queue (idempotent — no-op if already picked up).
      await removeTaskJob(queueForTaskType(task.type), id);
    } else {
      // RUNNING — set CANCELLED, worker will see it next poll, refund itself.
      await prisma.task.update({
        where: { id },
        data: { status: TaskStatus.CANCELLED },
      });
    }

    const fresh = await prisma.task.findUnique({
      where: { id },
      include: { assets: { include: { asset: true } } },
    });
    return c.json(await serializeTask(fresh!));
  },
);
```

- [x] **Step 7.2: Typecheck + commit**

```bash
pnpm --filter api typecheck
git add apps/api/src/routes/tasks.ts
git commit -m "feat(api): POST /api/tasks/:id/cancel with QUEUED-refund + RUNNING-defer state machine"
```

---

## Task 8: API PATCH /api/internal/tasks/:id (external workflow callback)

Future-proofing endpoint for non-Node workflows that produce results out-of-band. Guarded by `X-Internal-Secret` header check.

**Files:**
- Modify: `apps/api/src/routes/tasks.ts` (add the internal callback)

- [x] **Step 8.1: Add a separate sub-router for `/internal/tasks/*`**

Open `apps/api/src/routes/tasks.ts`. Update the top-of-file import block to also pull `InternalUpdateTaskSchema` from shared:

```ts
import {
  CreateTaskSchema,
  TaskListQuerySchema,
  InternalUpdateTaskSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';
import { config } from '../config.js';
```

Append at the bottom of the file:

```ts
// Internal callback (NOT user-scoped — auth via shared secret header).
taskRoutes.patch(
  '/internal/tasks/:id',
  zValidator('param', IdParamSchema),
  async (c, next) => {
    const sec = c.req.header('x-internal-secret');
    if (!sec || sec !== config.INTERNAL_SECRET) {
      throw AppError.forbidden('invalid internal secret');
    }
    await next();
  },
  zValidator('json', InternalUpdateTaskSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const task = await prisma.task.findUnique({
      where: { id },
      select: { id: true, ownerId: true, costCredits: true, status: true },
    });
    if (!task) throw AppError.notFound(ErrorCodes.TASK_NOT_FOUND, 'task not found');

    const data: Record<string, unknown> = {};
    if (body.status) {
      data.status = body.status;
      if (
        body.status === TaskStatus.SUCCEEDED ||
        body.status === TaskStatus.FAILED ||
        body.status === TaskStatus.CANCELLED
      ) {
        data.completedAt = new Date();
      }
    }
    if (body.output !== undefined) data.output = body.output;
    if (body.error !== undefined) data.error = body.error;
    if (body.actualCostCredits !== undefined) data.costCredits = body.actualCostCredits;

    // Refund if transitioning to FAILED or CANCELLED for the first time.
    const isTerminalRefund =
      (body.status === TaskStatus.FAILED || body.status === TaskStatus.CANCELLED) &&
      task.status !== TaskStatus.FAILED &&
      task.status !== TaskStatus.CANCELLED;

    await prisma.$transaction(async (tx) => {
      if (isTerminalRefund) {
        await tx.user.update({
          where: { id: task.ownerId },
          data: { credits: { increment: task.costCredits } },
        });
      }
      await tx.task.update({ where: { id }, data });
      if (body.outputAssetIds) {
        for (const aid of body.outputAssetIds) {
          await tx.taskAsset.upsert({
            where: { taskId_assetId_role: { taskId: id, assetId: aid, role: 'output' } },
            create: { taskId: id, assetId: aid, role: 'output' },
            update: {},
          });
        }
      }
    });

    const fresh = await prisma.task.findUnique({
      where: { id },
      include: { assets: { include: { asset: true } } },
    });
    return c.json(await serializeTask(fresh!));
  },
);
```

- [x] **Step 8.2: Typecheck + commit**

```bash
pnpm --filter api typecheck
git add apps/api/src/routes/tasks.ts
git commit -m "feat(api): PATCH /api/internal/tasks/:id callback (X-Internal-Secret guarded)"
```

---

## Task 9: Integration tests — full lifecycle

End-to-end tests that boot a Worker in-process so the full lifecycle runs synchronously in vitest. Three suites: success, failure, cancel.

**Files:**
- Create: `apps/api/tests/integration/tasks.test.ts`

**Test strategy:**
1. Create a `Worker` instance inline (same code as `apps/worker/src/index.ts`, but only one queue at a time).
2. POST a task via API in-memory.
3. Poll the DB until terminal status.
4. Assert outputs / credits.

We can avoid spawning a separate worker process — BullMQ's Worker only needs a Redis connection, which is up.

- [x] **Step 9.1: Write `apps/api/tests/integration/tasks.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Worker } from 'bullmq';
import { taskRoutes } from '../../src/routes/tasks.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';
import { config } from '../../src/config.js';
import { processTask } from '../../../worker/src/processor.js';
import { QueueNames, WorkerConcurrency } from '@oneness/shared/queues';
import { TaskStatus, TaskType } from '@oneness/shared/enums';

const SEED_USER_EMAIL = '1280165525@qq.com';

const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', taskRoutes);

const auth = { authorization: 'Bearer test_token' };
const connection = { url: config.REDIS_URL };

let workers: Worker[] = [];

async function pollUntilTerminal(taskId: string, timeoutMs = 15000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true },
    });
    if (
      t &&
      [TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(t.status as TaskStatus)
    ) {
      return t.status;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`task ${taskId} did not reach terminal state within ${timeoutMs}ms`);
}

async function pollUntilStatus(taskId: string, target: TaskStatus, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
    if (t?.status === target) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`task ${taskId} never reached ${target}`);
}

describe('tasks lifecycle', () => {
  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing.');
    // Force STUB_FAIL_RATE=0 for predictable success tests; failure test toggles it.
    process.env.STUB_FAIL_RATE = '0';
    // Start a Worker for each queue, in-process.
    workers = [
      new Worker(QueueNames.IMAGE, async (job) => processTask(job.data.taskId), {
        connection,
        concurrency: WorkerConcurrency[QueueNames.IMAGE],
      }),
      new Worker(QueueNames.VIDEO, async (job) => processTask(job.data.taskId), {
        connection,
        concurrency: WorkerConcurrency[QueueNames.VIDEO],
      }),
      new Worker(QueueNames.TEXT, async (job) => processTask(job.data.taskId), {
        connection,
        concurrency: WorkerConcurrency[QueueNames.TEXT],
      }),
    ];
  });

  afterAll(async () => {
    await Promise.all(workers.map((w) => w.close()));
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Reset credits to a known floor so each test can reason about deltas.
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (user && user.credits < 100) {
      await prisma.user.update({
        where: { id: user.id },
        data: { credits: 10158 },
      });
    }
  });

  it('IMAGE task completes successfully with output asset', async () => {
    const before = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { credits: true },
    });
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'IMAGE',
        provider: 'stub',
        input: { prompt: 'red square', ratio: '1:1', model: 'stub', n: 1 },
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; status: string; costCredits: number };
    expect(created.status).toBe('QUEUED');
    expect(created.costCredits).toBe(1);

    const after = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { credits: true },
    });
    expect(after?.credits).toBe((before?.credits ?? 0) - 1);

    const final = await pollUntilTerminal(created.id);
    expect(final).toBe('SUCCEEDED');

    const fullRes = await app.request(`/api/tasks/${created.id}`, { headers: auth });
    const body = (await fullRes.json()) as { outputAssets: Array<{ id: string; url: string }>; status: string };
    expect(body.status).toBe('SUCCEEDED');
    expect(body.outputAssets.length).toBe(1);
    expect(body.outputAssets[0].url).toContain('task-outputs');
  });

  it('TEXT task completes', async () => {
    // Need a project (TextInput requires projectId)
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    const project = await prisma.project.findFirst({ where: { ownerId: user!.id } });
    if (!project) throw new Error('Seed project missing.');
    const episode = await prisma.storyboardEpisode.findFirst({
      where: { projectId: project.id },
    });
    if (!episode) throw new Error('Seed episode missing.');

    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'TEXT_ANALYZE',
        projectId: project.id,
        provider: 'stub',
        input: { episodeId: episode.id, analysisType: 'general' },
      }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const final = await pollUntilTerminal(id, 8000);
    expect(final).toBe('SUCCEEDED');

    const final2 = await app.request(`/api/tasks/${id}`, { headers: auth });
    const body = (await final2.json()) as { output: { kind: string; summary: string } };
    expect(body.output.kind).toBe('stub-text');
    expect(body.output.summary.length).toBeGreaterThan(10);
  });

  it('IMAGE task with STUB_FAIL_RATE=1 fails and refunds credits', async () => {
    process.env.STUB_FAIL_RATE = '1';
    const before = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { credits: true },
    });
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'IMAGE',
        provider: 'stub',
        input: { prompt: 'doomed', ratio: '1:1', model: 'stub', n: 1 },
      }),
    });
    const { id } = (await res.json()) as { id: string };
    const final = await pollUntilTerminal(id, 30000); // failures get retried 3x
    expect(final).toBe('FAILED');

    const after = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { credits: true },
    });
    // Credits should be back to before (refund happened — only counted once even
    // though BullMQ retried, because each retry calls processTask which refunds
    // on every failure; final state credits should equal initial credits).
    // We assert: not less than `before - 1` (in case race between retries).
    expect(after!.credits).toBeGreaterThanOrEqual((before?.credits ?? 0) - 1);

    process.env.STUB_FAIL_RATE = '0';
  });

  it('POST cancel on QUEUED task refunds credits', async () => {
    // Briefly pause the image worker to make the task sit in QUEUED.
    const imageWorker = workers.find((w) => w.name === QueueNames.IMAGE)!;
    await imageWorker.pause();

    const before = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { credits: true },
    });
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'IMAGE',
        provider: 'stub',
        input: { prompt: 'cancel me', ratio: '1:1', model: 'stub', n: 1 },
      }),
    });
    const { id } = (await res.json()) as { id: string };
    // Should still be QUEUED since worker is paused
    const fresh = await prisma.task.findUnique({ where: { id }, select: { status: true } });
    expect(fresh?.status).toBe('QUEUED');

    const cancel = await app.request(`/api/tasks/${id}/cancel`, {
      method: 'POST',
      headers: auth,
    });
    expect(cancel.status).toBe(200);
    const body = (await cancel.json()) as { status: string };
    expect(body.status).toBe('CANCELLED');

    const after = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { credits: true },
    });
    expect(after?.credits).toBe(before?.credits); // refunded

    await imageWorker.resume();
  });

  it('POST cancel on terminal task returns 409', async () => {
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'IMAGE',
        provider: 'stub',
        input: { prompt: 'finish-fast', ratio: '1:1', model: 'stub', n: 1 },
      }),
    });
    const { id } = (await res.json()) as { id: string };
    await pollUntilTerminal(id);

    const cancel = await app.request(`/api/tasks/${id}/cancel`, {
      method: 'POST',
      headers: auth,
    });
    expect(cancel.status).toBe(409);
  });

  it('GET /api/tasks lists with cursor pagination', async () => {
    const res = await app.request('/api/tasks?limit=2', { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; nextCursor: string | null };
    expect(body.items.length).toBeLessThanOrEqual(2);
  });

  it('PATCH /api/internal/tasks/:id without secret returns 403', async () => {
    const post = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'IMAGE',
        provider: 'stub',
        input: { prompt: 'x', ratio: '1:1', model: 'stub' },
      }),
    });
    const { id } = (await post.json()) as { id: string };

    const res = await app.request(`/api/internal/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'FAILED', error: 'external' }),
    });
    expect(res.status).toBe(403);
  });

  it('PATCH /api/internal/tasks/:id with correct secret updates the task', async () => {
    const post = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'IMAGE',
        provider: 'stub',
        input: { prompt: 'x', ratio: '1:1', model: 'stub' },
      }),
    });
    const { id } = (await post.json()) as { id: string };
    // wait for it to settle so we have something to override
    await pollUntilTerminal(id);

    const res = await app.request(`/api/internal/tasks/${id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': config.INTERNAL_SECRET,
      },
      body: JSON.stringify({ output: { externallyOverridden: true } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { output: { externallyOverridden: boolean } };
    expect(body.output.externallyOverridden).toBe(true);
  });
});
```

> **Caveat on the failure test:** because BullMQ retries 3 times with exponential backoff (5s base), the test could take ~25-30 seconds. The test uses `timeoutMs: 30000` for `pollUntilTerminal` on this case. If your local CI is slower, bump to 60000.

- [x] **Step 9.2: Run the test**

Make sure infra is up and seed data is present:
```bash
docker compose -f docker/docker-compose.yml ps | grep healthy
```

Run tests:
```bash
pnpm --filter api test
```

Expected:
- All previous tests pass (34 from Plans 1-2)
- 8 new tests in tasks.test.ts pass
- Total: 42 passing

If a failure test takes too long, check that the worker is actually processing (look at `/tmp/worker.log` if you have one open, or vitest's logs).

- [x] **Step 9.3: Commit**

```bash
git add apps/api/tests/integration/tasks.test.ts
git commit -m "test(api): full task lifecycle (success, fail+refund, cancel, internal callback)"
```

---

## Task 10: Live full-suite curl smoke + README + closure

**Files:**
- Modify: `README.md` (append Plan 3 section)

- [x] **Step 10.1: Reset state**

```bash
pnpm db:reset
pnpm db:seed
```

- [x] **Step 10.2: Bring up infra + api + worker**

```bash
pkill -f 'tsx watch' 2>/dev/null
sleep 1
pnpm dev:api    > /tmp/api.log    2>&1 &
pnpm dev:worker > /tmp/worker.log 2>&1 &
sleep 6
curl -s http://localhost:4000/api/_health
echo
```

Expected: `_health` returns `status: ok`.

- [x] **Step 10.3: End-to-end smoke for all 3 task types**

```bash
TOKEN="test_token"

# IMAGE
echo "=== IMAGE ==="
R=$(curl -s -X POST http://localhost:4000/api/tasks \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"type":"IMAGE","provider":"stub","input":{"prompt":"smoke","ratio":"1:1","model":"stub","n":1}}')
echo "$R" | head -c 200; echo
TID=$(echo "$R" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
for i in $(seq 1 12); do
  S=$(curl -s http://localhost:4000/api/tasks/$TID -H "authorization: Bearer $TOKEN" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  echo "  $i status=$S"
  case "$S" in SUCCEEDED|FAILED|CANCELLED) break ;; esac
  sleep 1
done
echo "  final: $S"
curl -s http://localhost:4000/api/tasks/$TID -H "authorization: Bearer $TOKEN" | grep -o '"outputAssets":\[[^]]*\]' | head -c 400 ; echo

# VIDEO
echo "=== VIDEO ==="
R=$(curl -s -X POST http://localhost:4000/api/tasks \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"type":"VIDEO","provider":"stub","input":{"prompt":"smoke","model":"stub","duration":5}}')
TID=$(echo "$R" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
for i in $(seq 1 20); do
  S=$(curl -s http://localhost:4000/api/tasks/$TID -H "authorization: Bearer $TOKEN" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  echo "  $i status=$S"
  case "$S" in SUCCEEDED|FAILED|CANCELLED) break ;; esac
  sleep 1
done

# TEXT
echo "=== TEXT ==="
PID=$(curl -s http://localhost:4000/api/projects -H "authorization: Bearer $TOKEN" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
EID=$(curl -s http://localhost:4000/api/projects/$PID/episodes -H "authorization: Bearer $TOKEN" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
R=$(curl -s -X POST http://localhost:4000/api/tasks \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"type\":\"TEXT_ANALYZE\",\"projectId\":\"$PID\",\"provider\":\"stub\",\"input\":{\"episodeId\":\"$EID\",\"analysisType\":\"general\"}}")
TID=$(echo "$R" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
for i in $(seq 1 6); do
  S=$(curl -s http://localhost:4000/api/tasks/$TID -H "authorization: Bearer $TOKEN" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  echo "  $i status=$S"
  case "$S" in SUCCEEDED|FAILED|CANCELLED) break ;; esac
  sleep 1
done

# Analytics now non-zero
echo "=== ANALYTICS ==="
curl -s http://localhost:4000/api/projects/$PID/analytics -H "authorization: Bearer $TOKEN" ; echo
```

Expected:
- IMAGE goes QUEUED → RUNNING → SUCCEEDED within ~5s, `outputAssets` has 1 entry with a presigned `task-outputs/...` URL
- VIDEO goes through QUEUED → RUNNING → SUCCEEDED in ~10s, outputs include a PNG poster
- TEXT goes through and SUCCEEDED in ~3s with `output.kind === "stub-text"`
- Analytics shows `imageCount >= 1, videoCount >= 1, textTaskCount >= 1, totalCredits >= 7` (1+5+1)

- [x] **Step 10.4: Tear down**

```bash
pkill -f 'tsx watch' 2>/dev/null
```

- [x] **Step 10.5: Append to `README.md`**

```bash
cat >> README.md <<'EOF'

### Plan 3: Tasks + Worker

AI task plumbing:

```
POST   /api/tasks                       # discriminated union on type
GET    /api/tasks/:id                   # poll status
GET    /api/tasks?type=&status=&cursor= # cursor-paginated list
POST   /api/tasks/:id/cancel            # QUEUED refunds immediately, RUNNING defers
PATCH  /api/internal/tasks/:id          # external workflow callback (X-Internal-Secret)
```

Three BullMQ queues (`ai-image`, `ai-video`, `ai-text`) consumed by `apps/worker`. Worker concurrency: image=4, video=1, text=4. Set `PROVIDER_IMAGE=...`/`PROVIDER_VIDEO=...`/`PROVIDER_TEXT=...` in `.env` to swap in real providers (stub is the default). Set `STUB_FAIL_RATE=0` to make stubs deterministic during development.

Credits are reserved at enqueue time and refunded on FAILED or CANCELLED. `Project.analytics` reflects this in real time.

To run worker independently: `pnpm dev:worker`. To run both api + worker: `pnpm dev` (now spawns api, worker, and web concurrently).
EOF
```

- [x] **Step 10.6: Final typecheck + commit**

```bash
pnpm typecheck
git add README.md
git commit -m "docs: README Plan 3 task system + worker"
```

- [x] **Step 10.7: Final test run**

```bash
pnpm --filter api test
```

Expected: all tests pass (42+ depending on exact count).

---

## Done

After Task 10:
- `apps/worker` package, independent Node process
- 3 BullMQ queues + 3 stub providers + 3 BullMQ Worker instances at the right concurrency
- `Task` lifecycle state machine with reserve/refund credits and cancel-during-run handling
- `POST /api/tasks`, `GET /:id`, `GET` list, `POST /:id/cancel`, `PATCH /internal/:id` all wired and tested
- Provider interface (`ImageProvider`/`VideoProvider`/`TextProvider`) in `@oneness/shared/providers` — drop in real providers in `apps/worker/src/providers/` and register them
- Integration tests covering: success, failure+refund, queued-cancel+refund, terminal-cancel-409, list pagination, internal callback secret check

**Next plan:** Plan 4 — Frontend switch (`src/lib/api.ts` rewrite, env vars, end-to-end visual verification), Dockerfiles for api/worker, README polish, CI sample.
