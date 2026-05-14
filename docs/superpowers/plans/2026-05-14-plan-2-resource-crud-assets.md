# Plan 2 / Resource CRUD + Assets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the frontend mock CRUD with real Postgres-backed routes covering every resource in the data model, add a MinIO proxy upload endpoint, wire asset URL signing into all resource responses, and expose the project analytics aggregation. After this plan: the entire frontend `src/lib/api.ts` surface (minus AI tasks) can be served by the real backend, and curling each resource produces the same shapes the frontend already consumes.

**Architecture:** Plan 1's Hono skeleton, extended with `routes/<resource>.ts` files (one per resource), Zod schemas living in `@oneness/shared/schemas/<resource>.ts`, a single `lib/assets.ts` helper in apps/api that produces presigned GET URLs (1 h expiry) used by every serializer. Ownership scoping is enforced through `requireUser` + per-query `where: { ownerId: user.id, ... }` (or `project.ownerId` for sub-resources). Pagination is offset-based (`?page=&pageSize=`) and returns `{ items, total, page, pageSize }`.

**Tech Stack:** Continuing Plan 1's stack — Hono 4, Prisma 5, zod 3, vitest 2 — plus `@hono/zod-validator` already installed in Plan 1.

**Linked spec:** `docs/superpowers/specs/2026-05-14-backend-design.md` (§3 data model, §4.1 conventions, §4.2 routes for projects/characters/items/scenes/episodes/knowledge-docs, §5 storage, §3.5 analytics aggregation).

**Depends on:** Plan 1 fully complete. `apps/api`, `packages/shared`, docker compose infra, seed data, `requireUser`/`tryReadUser`, `serializeUser`, `errorHandler`, `prisma`/`redis`/`minioClient` singletons must all exist.

**Out of scope (deferred to Plan 3/4):**
- AI tasks routes (`POST /api/tasks`, etc.)
- Cancel / internal callback
- Frontend `src/lib/api.ts` rewrite (Plan 4)
- Auth enforcement beyond mock user

**Conventions:**
- Every resource gets: zod schemas in shared, routes file, mount in `index.ts`, integration test, commit.
- Every list endpoint paginates. Every read endpoint returns the resource scoped to the current user. Every mutation endpoint scopes by `ownerId` (or `project.ownerId` for sub-resources) and 404s if the target doesn't belong to the user.
- All DateTime returned as ISO string. All asset references serialized to a stable shape: `{ id, url, contentType, sizeBytes, width, height }`.
- Run `pnpm dev:api` (the dotenv-wrapped script) for smoke tests; vitest reads .env via the in-file parser.

---

## Task 1: Shared building blocks

Pagination, zod common helpers, and an asset-URL signing helper. These are used by every subsequent task; nailing them down once avoids drift.

**Files:**
- Create: `packages/shared/src/schemas/index.ts` (barrel)
- Create: `packages/shared/src/schemas/common.ts` (pagination, cuid id, project-id param)
- Create: `apps/api/src/lib/pagination.ts` (offset → Prisma `skip/take`, count helper)
- Create: `apps/api/src/lib/assets.ts` (presigned GET URL + asset DTO serializer)
- Modify: `packages/shared/src/index.ts` (re-export schemas barrel)

- [x] **Step 1.1: Write `packages/shared/src/schemas/common.ts`**

```ts
import { z } from 'zod';

// Cuid validator (Prisma default ids start with c, 25 chars, alphanumeric lowercase).
// Loose enough to also accept cuid2 outputs that older code may have generated.
export const CuidSchema = z.string().regex(/^[a-z0-9]{20,32}$/, 'invalid id');

export const IdParamSchema = z.object({ id: CuidSchema });

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageQuery = z.infer<typeof PageQuerySchema>;

export type Paged<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
```

- [x] **Step 1.2: Write `packages/shared/src/schemas/index.ts`**

```ts
export * from './common.js';
```

- [x] **Step 1.3: Update `packages/shared/src/index.ts` to re-export schemas**

Open `packages/shared/src/index.ts` and add the line `export * from './schemas/index.js';` after the existing re-exports. The file becomes:

```ts
export * from './enums.js';
export * from './errors.js';
export * from './logger.js';
export * from './prisma-client.js';
export * from './schemas/index.js';
```

- [x] **Step 1.4: Add the schemas export path to `packages/shared/package.json`**

Open `packages/shared/package.json` and add a new entry under `exports`:

```jsonc
{
  "exports": {
    ".": "./src/index.ts",
    "./enums": "./src/enums.ts",
    "./errors": "./src/errors.ts",
    "./logger": "./src/logger.ts",
    "./prisma": "./src/prisma-client.ts",
    "./schemas": "./src/schemas/index.ts"
  }
}
```

- [x] **Step 1.5: Write `apps/api/src/lib/pagination.ts`**

```ts
import type { PageQuery, Paged } from '@oneness/shared/schemas';

export function paginate(q: PageQuery): { skip: number; take: number } {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function asPaged<T>(items: T[], total: number, q: PageQuery): Paged<T> {
  return { items, total, page: q.page, pageSize: q.pageSize };
}
```

- [x] **Step 1.6: Write `apps/api/src/lib/assets.ts`**

```ts
import { minioClient } from './minio.js';
import type { Asset } from '@oneness/shared/prisma';

export type AssetDTO = {
  id: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

const URL_EXPIRY_SECONDS = 60 * 60; // 1 hour

export async function presignGet(bucket: string, key: string): Promise<string> {
  return minioClient.presignedGetObject(bucket, key, URL_EXPIRY_SECONDS);
}

export async function serializeAsset(asset: Asset): Promise<AssetDTO> {
  const url = await presignGet(asset.bucket, asset.key);
  return {
    id: asset.id,
    url,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
  };
}

export async function serializeOptionalAsset(asset: Asset | null): Promise<AssetDTO | null> {
  return asset ? serializeAsset(asset) : null;
}

/**
 * For a key stored directly on a row (e.g. User.avatarKey, Character.avatarKey)
 * — when there's no full Asset record. Returns a presigned URL or null.
 */
export async function presignKey(bucket: string, key: string | null): Promise<string | null> {
  if (!key) return null;
  return presignGet(bucket, key);
}
```

- [x] **Step 1.7: Typecheck**

Run:
```bash
pnpm --filter @oneness/shared typecheck
pnpm --filter api typecheck
```

Expected: both exit 0.

- [x] **Step 1.8: Commit**

```bash
git add packages/shared/src/schemas/ packages/shared/src/index.ts packages/shared/package.json apps/api/src/lib/pagination.ts apps/api/src/lib/assets.ts
git commit -m "feat: shared schemas/pagination helpers + asset URL signing"
```

---

## Task 2: Assets upload + delete routes

Implement the MinIO proxy upload (`POST /api/assets`) and `DELETE /api/assets/:id` before any resource task, so character styles / items / scenes can immediately bind real `assetId` values during their CRUD development.

**Files:**
- Create: `packages/shared/src/schemas/assets.ts`
- Create: `apps/api/src/routes/assets.ts`
- Modify: `apps/api/src/index.ts` (mount)
- Create: `apps/api/tests/integration/assets.test.ts`

**Limits:** 100 MB per file; `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `video/mp4`, `video/webm`, `audio/mpeg`, `audio/wav` allowed. Width/height extracted via `sharp` for images. Video `durationMs` skipped (no ffmpeg in MVP — leave `null`).

- [x] **Step 2.1: Add `sharp` to apps/api**

Run:
```bash
pnpm --filter api add sharp
```

Expected: lockfile updated, `sharp` listed in `apps/api/package.json` dependencies.

- [x] **Step 2.2: Write `packages/shared/src/schemas/assets.ts`**

```ts
import { z } from 'zod';

export const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export const MAX_ASSET_BYTES = 100 * 1024 * 1024;

export function isAllowedContentType(ct: string): ct is AllowedContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(ct);
}

// Optional metadata accompanying the file upload (sent as fields).
export const UploadMetadataSchema = z.object({
  // For future use: a hint about where the asset will be used.
  // Stays optional; MVP ignores it but accepts it without erroring.
  intent: z.string().max(60).optional(),
});

export type UploadMetadata = z.infer<typeof UploadMetadataSchema>;
```

- [x] **Step 2.3: Update `packages/shared/src/schemas/index.ts`**

```ts
export * from './common.js';
export * from './assets.js';
```

- [x] **Step 2.4: Write `apps/api/src/routes/assets.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createId } from '@paralleldrive/cuid2';
import sharp from 'sharp';
import { prisma } from '../lib/prisma.js';
import { minioClient, Buckets } from '../lib/minio.js';
import { serializeAsset } from '../lib/assets.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  ALLOWED_CONTENT_TYPES,
  MAX_ASSET_BYTES,
  isAllowedContentType,
} from '@oneness/shared/schemas';
import { IdParamSchema } from '@oneness/shared/schemas';

export const assetRoutes = new Hono();

assetRoutes.use('/assets', tryReadUser, requireUser);
assetRoutes.use('/assets/*', tryReadUser, requireUser);

assetRoutes.post('/assets', async (c) => {
  const user = c.var.user!;
  const form = await c.req.parseBody();

  const file = form['file'];
  if (!(file instanceof File)) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_FAILED,
      'file field is required and must be a file',
    );
  }
  if (file.size === 0) {
    throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'file is empty');
  }
  if (file.size > MAX_ASSET_BYTES) {
    throw AppError.badRequest(
      ErrorCodes.ASSET_TOO_LARGE,
      `file exceeds ${MAX_ASSET_BYTES} bytes`,
      { sizeBytes: file.size, maxBytes: MAX_ASSET_BYTES },
    );
  }
  const contentType = file.type || 'application/octet-stream';
  if (!isAllowedContentType(contentType)) {
    throw AppError.badRequest(
      ErrorCodes.ASSET_TYPE_NOT_ALLOWED,
      `contentType ${contentType} is not allowed`,
      { allowed: ALLOWED_CONTENT_TYPES },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // Image dimensions (skip silently if sharp can't read it).
  let width: number | null = null;
  let height: number | null = null;
  if (contentType.startsWith('image/')) {
    try {
      const meta = await sharp(buf).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch {
      // Non-fatal — leave dimensions null.
    }
  }

  const assetId = createId();
  const ext = extFromContentType(contentType);
  const today = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
  const key = `${user.id}/${today}/${assetId}.${ext}`;

  await minioClient.putObject(
    Buckets.USER_UPLOADS,
    key,
    buf,
    buf.length,
    { 'Content-Type': contentType },
  );

  const asset = await prisma.asset.create({
    data: {
      id: assetId,
      ownerId: user.id,
      bucket: Buckets.USER_UPLOADS,
      key,
      contentType,
      sizeBytes: buf.length,
      width,
      height,
      durationMs: null,
    },
  });

  return c.json(await serializeAsset(asset), 201);
});

assetRoutes.delete('/assets/:id', zValidator('param', IdParamSchema), async (c) => {
  const user = c.var.user!;
  const { id } = c.req.valid('param');
  const asset = await prisma.asset.findFirst({ where: { id, ownerId: user.id } });
  if (!asset) {
    throw AppError.notFound(ErrorCodes.ASSET_NOT_FOUND, 'asset not found');
  }

  await prisma.asset.delete({ where: { id } });
  // Best-effort MinIO removal — log on failure but don't fail the request.
  try {
    await minioClient.removeObject(asset.bucket, asset.key);
  } catch (err) {
    c.var.log.warn({ err: (err as Error).message, key: asset.key }, 'minio removeObject failed');
  }

  return c.body(null, 204);
});

function extFromContentType(ct: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
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

- [x] **Step 2.5: Mount in `apps/api/src/index.ts`**

Add the import:

```ts
import { assetRoutes } from './routes/assets.js';
```

And under the other `app.route('/api', ...)` lines, add:

```ts
app.route('/api', assetRoutes);
```

- [x] **Step 2.6: Write `apps/api/tests/integration/assets.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import sharp from 'sharp';
import { assetRoutes } from '../../src/routes/assets.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';
import { minioClient, Buckets } from '../../src/lib/minio.js';

const SEED_USER_EMAIL = '1280165525@qq.com';

const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', assetRoutes);

async function authHeader(): Promise<Record<string, string>> {
  // Any Bearer value loads the seed user — Plan 1 mock auth.
  return { authorization: 'Bearer test_token' };
}

async function makePng(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 16, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer();
}

describe('POST /api/assets', () => {
  beforeAll(async () => {
    // Ensure seed user exists; reset doesn't run automatically per file
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing. Run pnpm db:seed.');
  });

  afterAll(async () => {
    // Best-effort cleanup of test-uploaded assets
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) return;
    const orphans = await prisma.asset.findMany({
      where: { ownerId: user.id, contentType: 'image/png', sizeBytes: { lt: 500 } },
    });
    for (const a of orphans) {
      await minioClient.removeObject(a.bucket, a.key).catch(() => {});
      await prisma.asset.delete({ where: { id: a.id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('uploads a png and returns a presigned url + dimensions', async () => {
    const png = await makePng();
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'red.png');
    const res = await app.request('/api/assets', {
      method: 'POST',
      headers: await authHeader(),
      body: fd,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      url: string;
      contentType: string;
      sizeBytes: number;
      width: number | null;
      height: number | null;
    };
    expect(body.contentType).toBe('image/png');
    expect(body.width).toBe(32);
    expect(body.height).toBe(16);
    expect(body.sizeBytes).toBe(png.byteLength);
    expect(body.url).toContain(Buckets.USER_UPLOADS);

    // Confirm DB row created
    const row = await prisma.asset.findUnique({ where: { id: body.id } });
    expect(row?.bucket).toBe(Buckets.USER_UPLOADS);

    // DELETE round-trip
    const del = await app.request(`/api/assets/${body.id}`, {
      method: 'DELETE',
      headers: await authHeader(),
    });
    expect(del.status).toBe(204);
    const after = await prisma.asset.findUnique({ where: { id: body.id } });
    expect(after).toBeNull();
  });

  it('rejects unsupported content type', async () => {
    const fd = new FormData();
    fd.append(
      'file',
      new Blob(['hello'], { type: 'application/x-executable' }),
      'bad.bin',
    );
    const res = await app.request('/api/assets', {
      method: 'POST',
      headers: await authHeader(),
      body: fd,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ASSET_TYPE_NOT_ALLOWED');
  });

  it('rejects DELETE for unknown id', async () => {
    const res = await app.request('/api/assets/notarealid01234567890', {
      method: 'DELETE',
      headers: await authHeader(),
    });
    // Either 400 (zod cuid pattern reject) or 404 (lookup miss). Both are acceptable
    // for this contract; we just ensure it's not 204.
    expect([400, 404]).toContain(res.status);
  });

  it('requires auth', async () => {
    const fd = new FormData();
    fd.append('file', new Blob(['x'], { type: 'image/png' }), 'x.png');
    const res = await app.request('/api/assets', { method: 'POST', body: fd });
    expect(res.status).toBe(401);
  });
});
```

- [x] **Step 2.7: Run the test**

Run:
```bash
pnpm --filter api test
```

Expected: 7 tests pass total (3 from Plan 1's health + 4 here). Exit 0.

- [x] **Step 2.8: Smoke-test the live server**

Run:
```bash
pnpm dev:api > /tmp/api.log 2>&1 &
sleep 5

# Create a tiny png with sharp via a one-liner
TOKEN="test_token"
PNG=$(mktemp --suffix=.png)
node -e "require('sharp')({create:{width:8,height:8,channels:3,background:'#00ff00'}}).png().toFile('$PNG').then(()=>console.log('ok'))"

echo "--- POST /api/assets ---"
RESP=$(curl -s -X POST http://localhost:4000/api/assets \
  -H "authorization: Bearer $TOKEN" \
  -F "file=@$PNG;type=image/png")
echo "$RESP"
ID=$(echo "$RESP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

echo
echo "--- DELETE /api/assets/$ID ---"
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE \
  http://localhost:4000/api/assets/"$ID" \
  -H "authorization: Bearer $TOKEN"

rm -f "$PNG"
pkill -f 'tsx watch' 2>/dev/null
```

Expected:
- POST returns a JSON object with `id`, `url`, `contentType:"image/png"`, `width:8`, `height:8`, `sizeBytes:>0`.
- The presigned `url` field is a long signed MinIO URL.
- DELETE returns `204`.

- [x] **Step 2.9: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml packages/shared/src/schemas/assets.ts packages/shared/src/schemas/index.ts apps/api/src/routes/assets.ts apps/api/src/index.ts apps/api/tests/integration/assets.test.ts
git commit -m "feat(api): POST /api/assets (MinIO proxy upload) + DELETE /api/assets/:id"
```

---

## Task 3: Projects CRUD (list / get / create / update / delete)

**Files:**
- Create: `packages/shared/src/schemas/projects.ts`
- Create: `apps/api/src/serializers/project.ts`
- Create: `apps/api/src/routes/projects.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/tests/integration/projects.test.ts`

The Project frontend type expects `createdAt` as ISO string, all the enum fields as lowercase mock-style values (`'pending'`/`'completed'`). The DB stores enums as `PENDING`/`COMPLETED`. The serializer lowercases.

- [x] **Step 3.1: Write `packages/shared/src/schemas/projects.ts`**

```ts
import { z } from 'zod';
import { AnalysisStatus } from '../enums.js';

const AnalysisStatusSchema = z.enum([AnalysisStatus.PENDING, AnalysisStatus.COMPLETED]);

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  ratio: z.string().min(1).max(20),
  style: z.string().min(1).max(60),
  stylePrompt: z.string().max(5000).default(''),
  analysisModel: z.string().min(1).max(80),
  imageModel: z.string().min(1).max(80),
  videoModel: z.string().min(1).max(80),
  generalAnalysis: AnalysisStatusSchema.default(AnalysisStatus.PENDING),
  basicAnalysis: AnalysisStatusSchema.default(AnalysisStatus.PENDING),
});

export const UpdateProjectSchema = CreateProjectSchema.partial();

export const ProjectListQuerySchema = z.object({
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;
```

- [x] **Step 3.2: Update `packages/shared/src/schemas/index.ts`**

```ts
export * from './common.js';
export * from './assets.js';
export * from './projects.js';
```

- [x] **Step 3.3: Write `apps/api/src/serializers/project.ts`**

```ts
import type { Project } from '@oneness/shared/prisma';

export type ProjectDTO = {
  id: string;
  name: string;
  ratio: string;
  style: string;
  createdAt: string;
  stylePrompt: string;
  analysisModel: string;
  imageModel: string;
  videoModel: string;
  generalAnalysis: 'pending' | 'completed';
  basicAnalysis: 'pending' | 'completed';
};

export function serializeProject(p: Project): ProjectDTO {
  return {
    id: p.id,
    name: p.name,
    ratio: p.ratio,
    style: p.style,
    createdAt: p.createdAt.toISOString(),
    stylePrompt: p.stylePrompt,
    analysisModel: p.analysisModel,
    imageModel: p.imageModel,
    videoModel: p.videoModel,
    generalAnalysis: p.generalAnalysis.toLowerCase() as 'pending' | 'completed',
    basicAnalysis: p.basicAnalysis.toLowerCase() as 'pending' | 'completed',
  };
}
```

- [x] **Step 3.4: Write `apps/api/src/routes/projects.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeProject } from '../serializers/project.js';
import { paginate, asPaged } from '../lib/pagination.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  ProjectListQuerySchema,
  IdParamSchema,
} from '@oneness/shared/schemas';

export const projectRoutes = new Hono();

projectRoutes.use('/projects', tryReadUser, requireUser);
projectRoutes.use('/projects/*', tryReadUser, requireUser);

projectRoutes.get('/projects', zValidator('query', ProjectListQuerySchema), async (c) => {
  const user = c.var.user!;
  const q = c.req.valid('query');
  const where = {
    ownerId: user.id,
    ...(q.search ? { name: { contains: q.search } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginate(q),
    }),
  ]);
  return c.json(asPaged(rows.map(serializeProject), total, q));
});

projectRoutes.post('/projects', zValidator('json', CreateProjectSchema), async (c) => {
  const user = c.var.user!;
  const body = c.req.valid('json');
  const created = await prisma.project.create({
    data: { ...body, ownerId: user.id },
  });
  return c.json(serializeProject(created), 201);
});

projectRoutes.get('/projects/:id', zValidator('param', IdParamSchema), async (c) => {
  const user = c.var.user!;
  const { id } = c.req.valid('param');
  const project = await prisma.project.findFirst({
    where: { id, ownerId: user.id },
  });
  if (!project) {
    throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
  }
  return c.json(serializeProject(project));
});

projectRoutes.patch(
  '/projects/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateProjectSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await prisma.project.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!existing) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    const updated = await prisma.project.update({ where: { id }, data: body });
    return c.json(serializeProject(updated));
  },
);

projectRoutes.delete(
  '/projects/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const existing = await prisma.project.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!existing) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    await prisma.project.delete({ where: { id } });
    return c.body(null, 204);
  },
);
```

- [x] **Step 3.5: Mount in `apps/api/src/index.ts`**

Add `import { projectRoutes } from './routes/projects.js';` and `app.route('/api', projectRoutes);`.

- [x] **Step 3.6: Write `apps/api/tests/integration/projects.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { projectRoutes } from '../../src/routes/projects.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';

const SEED_USER_EMAIL = '1280165525@qq.com';

const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', projectRoutes);

const auth = { authorization: 'Bearer test_token' };

describe('projects CRUD', () => {
  let createdId: string;

  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing. Run pnpm db:seed.');
  });

  afterAll(async () => {
    if (createdId) await prisma.project.deleteMany({ where: { id: createdId } });
    await prisma.$disconnect();
  });

  it('GET /projects returns the seeded 2 projects', async () => {
    const res = await app.request('/api/projects', { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('POST /projects creates and returns 201', async () => {
    const payload = {
      name: '测试项目',
      ratio: '16:9',
      style: '测试风格',
      stylePrompt: '一段测试 prompt',
      analysisModel: 'Gemini 3 Pro',
      imageModel: 'Nano banana pro',
      videoModel: 'Seedance 2.0',
    };
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; generalAnalysis: string };
    expect(body.name).toBe('测试项目');
    expect(body.generalAnalysis).toBe('pending');
    createdId = body.id;
  });

  it('GET /projects/:id returns the created project', async () => {
    const res = await app.request(`/api/projects/${createdId}`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(createdId);
  });

  it('PATCH /projects/:id updates name', async () => {
    const res = await app.request(`/api/projects/${createdId}`, {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试项目-改名' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('测试项目-改名');
  });

  it('DELETE /projects/:id returns 204 and the row is gone', async () => {
    const res = await app.request(`/api/projects/${createdId}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(res.status).toBe(204);
    const after = await app.request(`/api/projects/${createdId}`, { headers: auth });
    expect(after.status).toBe(404);
    createdId = ''; // avoid double cleanup
  });

  it('rejects requests with no auth', async () => {
    const res = await app.request('/api/projects');
    expect(res.status).toBe(401);
  });

  it('search filters by name', async () => {
    const res = await app.request('/api/projects?search=动画', { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ name: string }> };
    expect(body.items.every((p) => p.name.includes('动画'))).toBe(true);
  });
});
```

- [x] **Step 3.7: Run tests**

Run:
```bash
pnpm --filter api test
```

Expected: all tests (health + assets + projects) pass.

- [x] **Step 3.8: Commit**

```bash
git add packages/shared/src/schemas/projects.ts packages/shared/src/schemas/index.ts apps/api/src/serializers/project.ts apps/api/src/routes/projects.ts apps/api/src/index.ts apps/api/tests/integration/projects.test.ts
git commit -m "feat(api): projects CRUD (list/get/create/patch/delete) + tests"
```

---

## Task 4: Characters CRUD

The Character DTO matches the frontend `Character` type (`id, name, avatar, description, bio, voice?, styles[]`). `avatar` derives from `avatarKey` via `presignKey`. `styles` is an array of `CharacterStyle` rows, each serialized as `{ name, image }` where `image` is a presigned URL (or empty string when no asset).

**Files:**
- Create: `packages/shared/src/schemas/characters.ts`
- Create: `apps/api/src/serializers/character.ts`
- Create: `apps/api/src/routes/characters.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/tests/integration/characters.test.ts`

- [x] **Step 4.1: Write `packages/shared/src/schemas/characters.ts`**

```ts
import { z } from 'zod';
import { CuidSchema } from './common.js';

export const CreateCharacterSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(2000).default(''),
  bio: z.string().max(5000).default(''),
  voice: z.string().max(120).optional().nullable(),
  avatarAssetId: CuidSchema.optional().nullable(),
});

export const UpdateCharacterSchema = CreateCharacterSchema.partial();

export type CreateCharacterInput = z.infer<typeof CreateCharacterSchema>;
export type UpdateCharacterInput = z.infer<typeof UpdateCharacterSchema>;
```

`avatarAssetId` is API-only — it's the asset id of an already-uploaded image. The route resolves it to `avatarKey` (the MinIO key) before storing on the DB column. This isolates clients from the DB column shape and lets us swap storage backends without touching the request schema.

- [x] **Step 4.2: Update `packages/shared/src/schemas/index.ts`**

```ts
export * from './common.js';
export * from './assets.js';
export * from './projects.js';
export * from './characters.js';
```

- [x] **Step 4.3: Write `apps/api/src/serializers/character.ts`**

```ts
import type { Character, CharacterStyle, Asset } from '@oneness/shared/prisma';
import { Buckets } from '../lib/minio.js';
import { presignGet, presignKey } from '../lib/assets.js';

export type CharacterStyleDTO = { id: string; name: string; image: string };
export type CharacterDTO = {
  id: string;
  name: string;
  avatar: string;
  description: string;
  bio: string;
  voice?: string;
  styles: CharacterStyleDTO[];
};

type StyleWithAsset = CharacterStyle & { asset: Asset | null };
type CharacterWithStyles = Character & { styles: StyleWithAsset[] };

export async function serializeCharacter(c: CharacterWithStyles): Promise<CharacterDTO> {
  const avatar = (await presignKey(Buckets.USER_UPLOADS, c.avatarKey)) ?? '';
  const styles = await Promise.all(
    c.styles.map(async (s) => ({
      id: s.id,
      name: s.name,
      image: s.asset ? await presignGet(s.asset.bucket, s.asset.key) : '',
    })),
  );
  return {
    id: c.id,
    name: c.name,
    avatar,
    description: c.description,
    bio: c.bio,
    voice: c.voice ?? '',
    styles,
  };
}
```

- [x] **Step 4.4: Write `apps/api/src/routes/characters.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeCharacter } from '../serializers/character.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateCharacterSchema,
  UpdateCharacterSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';
import type { CreateCharacterInput, UpdateCharacterInput } from '@oneness/shared/schemas';

export const characterRoutes = new Hono();

characterRoutes.use('/projects/:id/characters', tryReadUser, requireUser);
characterRoutes.use('/characters/:id', tryReadUser, requireUser);

// GET /projects/:id/characters
characterRoutes.get(
  '/projects/:id/characters',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    const characters = await prisma.character.findMany({
      where: { projectId },
      include: { styles: { include: { asset: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const serialized = await Promise.all(characters.map(serializeCharacter));
    return c.json(serialized);
  },
);

// POST /projects/:id/characters
characterRoutes.post(
  '/projects/:id/characters',
  zValidator('param', IdParamSchema),
  zValidator('json', CreateCharacterSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const body = c.req.valid('json');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    const avatarKey = await resolveAvatarKey(body.avatarAssetId, user.id);
    const created = await prisma.character.create({
      data: {
        projectId,
        name: body.name,
        description: body.description ?? '',
        bio: body.bio ?? '',
        voice: body.voice ?? null,
        avatarKey,
      },
      include: { styles: { include: { asset: true } } },
    });
    return c.json(await serializeCharacter(created), 201);
  },
);

// GET /characters/:id
characterRoutes.get(
  '/characters/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const character = await loadOwnedCharacter(id, user.id);
    return c.json(await serializeCharacter(character));
  },
);

// PATCH /characters/:id
characterRoutes.patch(
  '/characters/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateCharacterSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await loadOwnedCharacter(id, user.id);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.bio !== undefined) data.bio = body.bio;
    if (body.voice !== undefined) data.voice = body.voice;
    if (body.avatarAssetId !== undefined) {
      data.avatarKey = await resolveAvatarKey(body.avatarAssetId, user.id);
    }
    const updated = await prisma.character.update({
      where: { id },
      data,
      include: { styles: { include: { asset: true } } },
    });
    return c.json(await serializeCharacter(updated));
  },
);

// DELETE /characters/:id
characterRoutes.delete(
  '/characters/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    await loadOwnedCharacter(id, user.id);
    await prisma.character.delete({ where: { id } });
    return c.body(null, 204);
  },
);

async function loadOwnedCharacter(id: string, userId: string) {
  const character = await prisma.character.findFirst({
    where: { id, project: { ownerId: userId } },
    include: { styles: { include: { asset: true } } },
  });
  if (!character) {
    throw AppError.notFound(ErrorCodes.CHARACTER_NOT_FOUND, 'character not found');
  }
  return character;
}

async function resolveAvatarKey(
  assetId: string | null | undefined,
  userId: string,
): Promise<string | null> {
  if (!assetId) return null;
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId: userId },
    select: { key: true },
  });
  if (!asset) {
    throw AppError.notFound(ErrorCodes.ASSET_NOT_FOUND, 'avatar asset not found');
  }
  return asset.key;
}
```

- [x] **Step 4.5: Mount in `apps/api/src/index.ts`**

Add `import { characterRoutes } from './routes/characters.js';` and `app.route('/api', characterRoutes);`.

- [x] **Step 4.6: Write `apps/api/tests/integration/characters.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { characterRoutes } from '../../src/routes/characters.js';
import { projectRoutes } from '../../src/routes/projects.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';

const SEED_USER_EMAIL = '1280165525@qq.com';

const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', projectRoutes);
app.route('/api', characterRoutes);

const auth = { authorization: 'Bearer test_token' };

describe('characters CRUD', () => {
  let projectId: string;
  let characterId: string;

  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing. Run pnpm db:seed.');
    const project = await prisma.project.findFirst({
      where: { ownerId: user.id, name: '格斗动画' },
    });
    if (!project) throw new Error('Seed project "格斗动画" missing.');
    projectId = project.id;
  });

  afterAll(async () => {
    if (characterId)
      await prisma.character.deleteMany({ where: { id: characterId } });
    await prisma.$disconnect();
  });

  it('GET /projects/:id/characters returns the 9 seeded characters', async () => {
    const res = await app.request(`/api/projects/${projectId}/characters`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string; styles: unknown[] }>;
    expect(body.length).toBe(9);
    expect(body.find((c) => c.name === '潘杰')?.styles.length).toBe(3);
  });

  it('POST creates a character', async () => {
    const res = await app.request(`/api/projects/${projectId}/characters`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试角色', description: '测试描述', bio: '测试简介' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.name).toBe('测试角色');
    characterId = body.id;
  });

  it('PATCH updates the character bio', async () => {
    const res = await app.request(`/api/characters/${characterId}`, {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ bio: '更新后的简介' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bio: string };
    expect(body.bio).toBe('更新后的简介');
  });

  it('DELETE removes the character', async () => {
    const res = await app.request(`/api/characters/${characterId}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(res.status).toBe(204);
    const after = await app.request(`/api/characters/${characterId}`, { headers: auth });
    expect(after.status).toBe(404);
    characterId = '';
  });

  it('POST 404s when the project does not belong to user', async () => {
    const res = await app.request('/api/projects/zzznotrealxxxxxxxxxxxxx/characters', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [x] **Step 4.7: Run tests**

Run `pnpm --filter api test`. Expect all to pass.

- [x] **Step 4.8: Commit**

```bash
git add packages/shared/src/schemas/characters.ts packages/shared/src/schemas/index.ts apps/api/src/serializers/character.ts apps/api/src/routes/characters.ts apps/api/src/index.ts apps/api/tests/integration/characters.test.ts
git commit -m "feat(api): characters CRUD with style+asset serialization"
```

---

## Task 5: CharacterStyles CRUD

`POST /api/characters/:id/styles` creates a style under a character. `PATCH /api/character-styles/:id` and `DELETE /api/character-styles/:id` operate on existing styles. Reuses the asset resolution helper pattern from Task 4.

**Files:**
- Create: `packages/shared/src/schemas/character-styles.ts`
- Create: `apps/api/src/routes/character-styles.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/tests/integration/character-styles.test.ts`

- [ ] **Step 5.1: Write `packages/shared/src/schemas/character-styles.ts`**

```ts
import { z } from 'zod';
import { CuidSchema } from './common.js';

export const CreateCharacterStyleSchema = z.object({
  name: z.string().min(1).max(120),
  assetId: CuidSchema.optional().nullable(),
});

export const UpdateCharacterStyleSchema = CreateCharacterStyleSchema.partial();

export type CreateCharacterStyleInput = z.infer<typeof CreateCharacterStyleSchema>;
export type UpdateCharacterStyleInput = z.infer<typeof UpdateCharacterStyleSchema>;
```

- [ ] **Step 5.2: Update `packages/shared/src/schemas/index.ts`**

Append `export * from './character-styles.js';`.

- [ ] **Step 5.3: Write `apps/api/src/routes/character-styles.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { presignGet } from '../lib/assets.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateCharacterStyleSchema,
  UpdateCharacterStyleSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';
import type { CharacterStyle, Asset } from '@oneness/shared/prisma';

export const characterStyleRoutes = new Hono();

characterStyleRoutes.use('/characters/:id/styles', tryReadUser, requireUser);
characterStyleRoutes.use('/character-styles/:id', tryReadUser, requireUser);

type StyleDTO = { id: string; name: string; image: string };

async function toDTO(style: CharacterStyle & { asset: Asset | null }): Promise<StyleDTO> {
  return {
    id: style.id,
    name: style.name,
    image: style.asset ? await presignGet(style.asset.bucket, style.asset.key) : '',
  };
}

// POST /characters/:id/styles
characterStyleRoutes.post(
  '/characters/:id/styles',
  zValidator('param', IdParamSchema),
  zValidator('json', CreateCharacterStyleSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: characterId } = c.req.valid('param');
    const { name, assetId } = c.req.valid('json');
    const character = await prisma.character.findFirst({
      where: { id: characterId, project: { ownerId: user.id } },
      select: { id: true },
    });
    if (!character) {
      throw AppError.notFound(ErrorCodes.CHARACTER_NOT_FOUND, 'character not found');
    }
    if (assetId) await assertAssetOwned(assetId, user.id);
    const style = await prisma.characterStyle.create({
      data: { characterId, name, assetId: assetId ?? null },
      include: { asset: true },
    });
    return c.json(await toDTO(style), 201);
  },
);

// PATCH /character-styles/:id
characterStyleRoutes.patch(
  '/character-styles/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateCharacterStyleSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await loadOwnedStyle(id, user.id);
    if (body.assetId !== undefined && body.assetId !== null) {
      await assertAssetOwned(body.assetId, user.id);
    }
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.assetId !== undefined) data.assetId = body.assetId;
    const updated = await prisma.characterStyle.update({
      where: { id: existing.id },
      data,
      include: { asset: true },
    });
    return c.json(await toDTO(updated));
  },
);

// DELETE /character-styles/:id
characterStyleRoutes.delete(
  '/character-styles/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const existing = await loadOwnedStyle(id, user.id);
    await prisma.characterStyle.delete({ where: { id: existing.id } });
    return c.body(null, 204);
  },
);

async function loadOwnedStyle(id: string, userId: string) {
  const row = await prisma.characterStyle.findFirst({
    where: { id, character: { project: { ownerId: userId } } },
    include: { asset: true },
  });
  if (!row) {
    throw AppError.notFound(ErrorCodes.NOT_FOUND, 'character style not found');
  }
  return row;
}

async function assertAssetOwned(assetId: string, userId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId: userId },
    select: { id: true },
  });
  if (!asset) throw AppError.notFound(ErrorCodes.ASSET_NOT_FOUND, 'asset not found');
}
```

- [ ] **Step 5.4: Mount in `apps/api/src/index.ts`**

Add import + `app.route('/api', characterStyleRoutes);`.

- [ ] **Step 5.5: Write `apps/api/tests/integration/character-styles.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { characterStyleRoutes } from '../../src/routes/character-styles.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';

const SEED_USER_EMAIL = '1280165525@qq.com';
const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', characterStyleRoutes);

const auth = { authorization: 'Bearer test_token' };

describe('character-styles CRUD', () => {
  let characterId: string;
  let styleId: string;

  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing.');
    const char = await prisma.character.findFirst({
      where: { project: { ownerId: user.id }, name: '潘杰' },
    });
    if (!char) throw new Error('Seed character "潘杰" missing.');
    characterId = char.id;
  });

  afterAll(async () => {
    if (styleId) await prisma.characterStyle.deleteMany({ where: { id: styleId } });
    await prisma.$disconnect();
  });

  it('POST adds a style', async () => {
    const res = await app.request(`/api/characters/${characterId}/styles`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试造型' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; image: string };
    expect(body.name).toBe('测试造型');
    expect(body.image).toBe('');
    styleId = body.id;
  });

  it('PATCH renames the style', async () => {
    const res = await app.request(`/api/character-styles/${styleId}`, {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试造型-改' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('测试造型-改');
  });

  it('DELETE removes the style', async () => {
    const res = await app.request(`/api/character-styles/${styleId}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(res.status).toBe(204);
    styleId = '';
  });
});
```

- [ ] **Step 5.6: Run tests** — `pnpm --filter api test`. Expect all pass.

- [ ] **Step 5.7: Commit**

```bash
git add packages/shared/src/schemas/character-styles.ts packages/shared/src/schemas/index.ts apps/api/src/routes/character-styles.ts apps/api/src/index.ts apps/api/tests/integration/character-styles.test.ts
git commit -m "feat(api): character-styles CRUD (create under character, patch/delete)"
```

---

## Task 6: Items CRUD

Items follow the same shape as the Item type in the frontend: `{ id, name, image }`. `image` is a presigned URL of the bound asset (or `''`). Items live under a project.

**Files:**
- Create: `packages/shared/src/schemas/items.ts`
- Create: `apps/api/src/serializers/item.ts`
- Create: `apps/api/src/routes/items.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/tests/integration/items.test.ts`

- [ ] **Step 6.1: Write `packages/shared/src/schemas/items.ts`**

```ts
import { z } from 'zod';
import { CuidSchema } from './common.js';

export const CreateItemSchema = z.object({
  name: z.string().min(1).max(120),
  assetId: CuidSchema.optional().nullable(),
});

export const UpdateItemSchema = CreateItemSchema.partial();

export type CreateItemInput = z.infer<typeof CreateItemSchema>;
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;
```

- [ ] **Step 6.2: Append to schemas barrel** — `export * from './items.js';`.

- [ ] **Step 6.3: Write `apps/api/src/serializers/item.ts`**

```ts
import type { Item, Asset } from '@oneness/shared/prisma';
import { presignGet } from '../lib/assets.js';

export type ItemDTO = { id: string; name: string; image: string };

type ItemWithAsset = Item & { asset: Asset | null };

export async function serializeItem(item: ItemWithAsset): Promise<ItemDTO> {
  return {
    id: item.id,
    name: item.name,
    image: item.asset ? await presignGet(item.asset.bucket, item.asset.key) : '',
  };
}
```

- [ ] **Step 6.4: Write `apps/api/src/routes/items.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeItem } from '../serializers/item.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateItemSchema,
  UpdateItemSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';

export const itemRoutes = new Hono();
itemRoutes.use('/projects/:id/items', tryReadUser, requireUser);
itemRoutes.use('/items/:id', tryReadUser, requireUser);

itemRoutes.get(
  '/projects/:id/items',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    const items = await prisma.item.findMany({
      where: { projectId },
      include: { asset: true },
      orderBy: { createdAt: 'asc' },
    });
    return c.json(await Promise.all(items.map(serializeItem)));
  },
);

itemRoutes.post(
  '/projects/:id/items',
  zValidator('param', IdParamSchema),
  zValidator('json', CreateItemSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const { name, assetId } = c.req.valid('json');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    if (assetId) await assertAssetOwned(assetId, user.id);
    const created = await prisma.item.create({
      data: { projectId, name, assetId: assetId ?? null },
      include: { asset: true },
    });
    return c.json(await serializeItem(created), 201);
  },
);

itemRoutes.patch(
  '/items/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateItemSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await loadOwnedItem(id, user.id);
    if (body.assetId !== undefined && body.assetId !== null) {
      await assertAssetOwned(body.assetId, user.id);
    }
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.assetId !== undefined) data.assetId = body.assetId;
    const updated = await prisma.item.update({
      where: { id: existing.id },
      data,
      include: { asset: true },
    });
    return c.json(await serializeItem(updated));
  },
);

itemRoutes.delete(
  '/items/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const existing = await loadOwnedItem(id, user.id);
    await prisma.item.delete({ where: { id: existing.id } });
    return c.body(null, 204);
  },
);

async function loadOwnedItem(id: string, userId: string) {
  const row = await prisma.item.findFirst({
    where: { id, project: { ownerId: userId } },
    include: { asset: true },
  });
  if (!row) throw AppError.notFound(ErrorCodes.ITEM_NOT_FOUND, 'item not found');
  return row;
}

async function assertAssetOwned(assetId: string, userId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId: userId },
    select: { id: true },
  });
  if (!asset) throw AppError.notFound(ErrorCodes.ASSET_NOT_FOUND, 'asset not found');
}
```

- [ ] **Step 6.5: Mount in `apps/api/src/index.ts`** — `import { itemRoutes } from './routes/items.js';` + `app.route('/api', itemRoutes);`

- [ ] **Step 6.6: Write `apps/api/tests/integration/items.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { itemRoutes } from '../../src/routes/items.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';

const SEED_USER_EMAIL = '1280165525@qq.com';
const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', itemRoutes);

const auth = { authorization: 'Bearer test_token' };

describe('items CRUD', () => {
  let projectId: string;
  let createdId = '';

  beforeAll(async () => {
    const u = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!u) throw new Error('Seed user missing.');
    const p = await prisma.project.findFirst({
      where: { ownerId: u.id, name: '格斗动画' },
    });
    if (!p) throw new Error('Seed project missing.');
    projectId = p.id;
  });

  afterAll(async () => {
    if (createdId) await prisma.item.deleteMany({ where: { id: createdId } });
    await prisma.$disconnect();
  });

  it('GET returns the 6 seeded items', async () => {
    const res = await app.request(`/api/projects/${projectId}/items`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string; image: string }>;
    expect(body.length).toBe(6);
    expect(body.every((i) => i.image === '')).toBe(true);
  });

  it('POST adds, PATCH renames, DELETE removes', async () => {
    const post = await app.request(`/api/projects/${projectId}/items`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试道具' }),
    });
    expect(post.status).toBe(201);
    const created = (await post.json()) as { id: string };
    createdId = created.id;

    const patch = await app.request(`/api/items/${createdId}`, {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试道具-改' }),
    });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { name: string }).name).toBe('测试道具-改');

    const del = await app.request(`/api/items/${createdId}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(del.status).toBe(204);
    createdId = '';
  });
});
```

- [ ] **Step 6.7: Run tests + Commit**

```bash
pnpm --filter api test
git add packages/shared/src/schemas/items.ts packages/shared/src/schemas/index.ts apps/api/src/serializers/item.ts apps/api/src/routes/items.ts apps/api/src/index.ts apps/api/tests/integration/items.test.ts
git commit -m "feat(api): items CRUD with asset binding"
```

---

## Task 7: Scenes CRUD

Same structure as Items — `{id, name, image}`. Reuse pattern.

**Files:**
- Create: `packages/shared/src/schemas/scenes.ts`
- Create: `apps/api/src/serializers/scene.ts`
- Create: `apps/api/src/routes/scenes.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/tests/integration/scenes.test.ts`

- [ ] **Step 7.1: Write `packages/shared/src/schemas/scenes.ts`** — copy `items.ts` content from Task 6.1 but rename `CreateItemSchema` → `CreateSceneSchema` and `UpdateItemSchema` → `UpdateSceneSchema`. Concretely:

```ts
import { z } from 'zod';
import { CuidSchema } from './common.js';

export const CreateSceneSchema = z.object({
  name: z.string().min(1).max(120),
  assetId: CuidSchema.optional().nullable(),
});

export const UpdateSceneSchema = CreateSceneSchema.partial();

export type CreateSceneInput = z.infer<typeof CreateSceneSchema>;
export type UpdateSceneInput = z.infer<typeof UpdateSceneSchema>;
```

- [ ] **Step 7.2: Append `export * from './scenes.js';` to the schemas barrel.

- [ ] **Step 7.3: Write `apps/api/src/serializers/scene.ts`**

```ts
import type { Scene, Asset } from '@oneness/shared/prisma';
import { presignGet } from '../lib/assets.js';

export type SceneDTO = { id: string; name: string; image: string };

type SceneWithAsset = Scene & { asset: Asset | null };

export async function serializeScene(s: SceneWithAsset): Promise<SceneDTO> {
  return {
    id: s.id,
    name: s.name,
    image: s.asset ? await presignGet(s.asset.bucket, s.asset.key) : '',
  };
}
```

- [ ] **Step 7.4: Write `apps/api/src/routes/scenes.ts`**

Same shape as `routes/items.ts` (Task 6.4) with substitutions:
- `Item` model → `Scene`
- `serializeItem` → `serializeScene`
- `CreateItemSchema` / `UpdateItemSchema` → `CreateSceneSchema` / `UpdateSceneSchema`
- `ErrorCodes.ITEM_NOT_FOUND` → `ErrorCodes.SCENE_NOT_FOUND`
- Path `/projects/:id/items` → `/projects/:id/scenes`, `/items/:id` → `/scenes/:id`
- `loadOwnedItem` → `loadOwnedScene`
- Prisma calls `prisma.item.*` → `prisma.scene.*`

Full code:

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeScene } from '../serializers/scene.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateSceneSchema,
  UpdateSceneSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';

export const sceneRoutes = new Hono();
sceneRoutes.use('/projects/:id/scenes', tryReadUser, requireUser);
sceneRoutes.use('/scenes/:id', tryReadUser, requireUser);

sceneRoutes.get(
  '/projects/:id/scenes',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    const scenes = await prisma.scene.findMany({
      where: { projectId },
      include: { asset: true },
      orderBy: { createdAt: 'asc' },
    });
    return c.json(await Promise.all(scenes.map(serializeScene)));
  },
);

sceneRoutes.post(
  '/projects/:id/scenes',
  zValidator('param', IdParamSchema),
  zValidator('json', CreateSceneSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const { name, assetId } = c.req.valid('json');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    if (assetId) await assertAssetOwned(assetId, user.id);
    const created = await prisma.scene.create({
      data: { projectId, name, assetId: assetId ?? null },
      include: { asset: true },
    });
    return c.json(await serializeScene(created), 201);
  },
);

sceneRoutes.patch(
  '/scenes/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateSceneSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await loadOwnedScene(id, user.id);
    if (body.assetId !== undefined && body.assetId !== null) {
      await assertAssetOwned(body.assetId, user.id);
    }
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.assetId !== undefined) data.assetId = body.assetId;
    const updated = await prisma.scene.update({
      where: { id: existing.id },
      data,
      include: { asset: true },
    });
    return c.json(await serializeScene(updated));
  },
);

sceneRoutes.delete(
  '/scenes/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const existing = await loadOwnedScene(id, user.id);
    await prisma.scene.delete({ where: { id: existing.id } });
    return c.body(null, 204);
  },
);

async function loadOwnedScene(id: string, userId: string) {
  const row = await prisma.scene.findFirst({
    where: { id, project: { ownerId: userId } },
    include: { asset: true },
  });
  if (!row) throw AppError.notFound(ErrorCodes.SCENE_NOT_FOUND, 'scene not found');
  return row;
}

async function assertAssetOwned(assetId: string, userId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId: userId },
    select: { id: true },
  });
  if (!asset) throw AppError.notFound(ErrorCodes.ASSET_NOT_FOUND, 'asset not found');
}
```

- [ ] **Step 7.5: Mount + Test + Commit (mirror Task 6's last step)**

Edit `apps/api/src/index.ts` to import and `app.route('/api', sceneRoutes)`.

Then write `apps/api/tests/integration/scenes.test.ts` — same shape as items test, expecting 16 seeded scenes (from Plan 1 seed):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { sceneRoutes } from '../../src/routes/scenes.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';

const SEED_USER_EMAIL = '1280165525@qq.com';
const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', sceneRoutes);
const auth = { authorization: 'Bearer test_token' };

describe('scenes CRUD', () => {
  let projectId: string;
  let createdId = '';

  beforeAll(async () => {
    const u = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!u) throw new Error('Seed user missing.');
    const p = await prisma.project.findFirst({
      where: { ownerId: u.id, name: '格斗动画' },
    });
    if (!p) throw new Error('Seed project missing.');
    projectId = p.id;
  });

  afterAll(async () => {
    if (createdId) await prisma.scene.deleteMany({ where: { id: createdId } });
    await prisma.$disconnect();
  });

  it('GET returns the 16 seeded scenes', async () => {
    const res = await app.request(`/api/projects/${projectId}/scenes`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.length).toBe(16);
  });

  it('POST/PATCH/DELETE round-trip', async () => {
    const post = await app.request(`/api/projects/${projectId}/scenes`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试场景' }),
    });
    expect(post.status).toBe(201);
    createdId = ((await post.json()) as { id: string }).id;

    const patch = await app.request(`/api/scenes/${createdId}`, {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试场景-改' }),
    });
    expect(((await patch.json()) as { name: string }).name).toBe('测试场景-改');

    const del = await app.request(`/api/scenes/${createdId}`, { method: 'DELETE', headers: auth });
    expect(del.status).toBe(204);
    createdId = '';
  });
});
```

Run tests, then commit:
```bash
pnpm --filter api test
git add packages/shared/src/schemas/scenes.ts packages/shared/src/schemas/index.ts apps/api/src/serializers/scene.ts apps/api/src/routes/scenes.ts apps/api/src/index.ts apps/api/tests/integration/scenes.test.ts
git commit -m "feat(api): scenes CRUD with asset binding"
```

---

## Task 8: Episodes CRUD

Episodes are different from items/scenes: they have `number` (Int, unique per project) and `analyzed: Bool` instead of an asset.

**Files:**
- Create: `packages/shared/src/schemas/episodes.ts`
- Create: `apps/api/src/serializers/episode.ts`
- Create: `apps/api/src/routes/episodes.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/tests/integration/episodes.test.ts`

- [ ] **Step 8.1: Schema**

```ts
// packages/shared/src/schemas/episodes.ts
import { z } from 'zod';

export const CreateEpisodeSchema = z.object({
  number: z.number().int().min(1),
  title: z.string().min(1).max(120),
  content: z.string().max(20000).default(''),
  analyzed: z.boolean().default(false),
});

export const UpdateEpisodeSchema = CreateEpisodeSchema.partial();

export type CreateEpisodeInput = z.infer<typeof CreateEpisodeSchema>;
export type UpdateEpisodeInput = z.infer<typeof UpdateEpisodeSchema>;
```

Append to barrel: `export * from './episodes.js';`

- [ ] **Step 8.2: Serializer**

```ts
// apps/api/src/serializers/episode.ts
import type { StoryboardEpisode } from '@oneness/shared/prisma';

export type EpisodeDTO = {
  id: string;
  number: number;
  title: string;
  content: string;
  analyzed: boolean;
};

export function serializeEpisode(e: StoryboardEpisode): EpisodeDTO {
  return {
    id: e.id,
    number: e.number,
    title: e.title,
    content: e.content,
    analyzed: e.analyzed,
  };
}
```

- [ ] **Step 8.3: Routes**

```ts
// apps/api/src/routes/episodes.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeEpisode } from '../serializers/episode.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateEpisodeSchema,
  UpdateEpisodeSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';

export const episodeRoutes = new Hono();
episodeRoutes.use('/projects/:id/episodes', tryReadUser, requireUser);
episodeRoutes.use('/episodes/:id', tryReadUser, requireUser);

episodeRoutes.get(
  '/projects/:id/episodes',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    const episodes = await prisma.storyboardEpisode.findMany({
      where: { projectId },
      orderBy: { number: 'asc' },
    });
    return c.json(episodes.map(serializeEpisode));
  },
);

episodeRoutes.post(
  '/projects/:id/episodes',
  zValidator('param', IdParamSchema),
  zValidator('json', CreateEpisodeSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const body = c.req.valid('json');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    try {
      const created = await prisma.storyboardEpisode.create({
        data: { projectId, ...body },
      });
      return c.json(serializeEpisode(created), 201);
    } catch (err: unknown) {
      if (isUniqueConstraint(err)) {
        throw AppError.conflict(
          ErrorCodes.CONFLICT,
          `episode number ${body.number} already exists in this project`,
        );
      }
      throw err;
    }
  },
);

episodeRoutes.patch(
  '/episodes/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateEpisodeSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await loadOwned(id, user.id);
    try {
      const updated = await prisma.storyboardEpisode.update({
        where: { id: existing.id },
        data: body,
      });
      return c.json(serializeEpisode(updated));
    } catch (err: unknown) {
      if (isUniqueConstraint(err)) {
        throw AppError.conflict(
          ErrorCodes.CONFLICT,
          `episode number ${body.number} already exists in this project`,
        );
      }
      throw err;
    }
  },
);

episodeRoutes.delete(
  '/episodes/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const existing = await loadOwned(id, user.id);
    await prisma.storyboardEpisode.delete({ where: { id: existing.id } });
    return c.body(null, 204);
  },
);

async function loadOwned(id: string, userId: string) {
  const row = await prisma.storyboardEpisode.findFirst({
    where: { id, project: { ownerId: userId } },
  });
  if (!row) throw AppError.notFound(ErrorCodes.EPISODE_NOT_FOUND, 'episode not found');
  return row;
}

function isUniqueConstraint(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002',
  );
}
```

- [ ] **Step 8.4: Mount + Test**

Mount in `index.ts`. Write `apps/api/tests/integration/episodes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { episodeRoutes } from '../../src/routes/episodes.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';

const SEED_USER_EMAIL = '1280165525@qq.com';
const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', episodeRoutes);
const auth = { authorization: 'Bearer test_token' };

describe('episodes CRUD', () => {
  let projectId: string;
  let createdId = '';

  beforeAll(async () => {
    const u = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!u) throw new Error('Seed user missing.');
    const p = await prisma.project.findFirst({
      where: { ownerId: u.id, name: '格斗动画' },
    });
    if (!p) throw new Error('Seed project missing.');
    projectId = p.id;
  });

  afterAll(async () => {
    if (createdId) await prisma.storyboardEpisode.deleteMany({ where: { id: createdId } });
    await prisma.$disconnect();
  });

  it('GET returns the seeded episode 1', async () => {
    const res = await app.request(`/api/projects/${projectId}/episodes`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ number: number; analyzed: boolean }>;
    expect(body[0].number).toBe(1);
    expect(body[0].analyzed).toBe(true);
  });

  it('POST creates episode 2', async () => {
    const res = await app.request(`/api/projects/${projectId}/episodes`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ number: 999, title: '第999集', content: '测试' }),
    });
    expect(res.status).toBe(201);
    createdId = ((await res.json()) as { id: string }).id;
  });

  it('POST with duplicate number returns 409', async () => {
    const res = await app.request(`/api/projects/${projectId}/episodes`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ number: 1, title: 'duplicate', content: '' }),
    });
    expect(res.status).toBe(409);
  });

  it('DELETE removes the created one', async () => {
    const res = await app.request(`/api/episodes/${createdId}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(res.status).toBe(204);
    createdId = '';
  });
});
```

- [ ] **Step 8.5: Commit**

```bash
pnpm --filter api test
git add packages/shared/src/schemas/episodes.ts packages/shared/src/schemas/index.ts apps/api/src/serializers/episode.ts apps/api/src/routes/episodes.ts apps/api/src/index.ts apps/api/tests/integration/episodes.test.ts
git commit -m "feat(api): episodes CRUD with unique-number conflict handling"
```

---

## Task 9: KnowledgeDocs CRUD

User-owned (not project-owned). Type-filtered list.

**Files:**
- Create: `packages/shared/src/schemas/knowledge-docs.ts`
- Create: `apps/api/src/serializers/knowledge-doc.ts`
- Create: `apps/api/src/routes/knowledge-docs.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/tests/integration/knowledge-docs.test.ts`

- [ ] **Step 9.1: Schema**

```ts
// packages/shared/src/schemas/knowledge-docs.ts
import { z } from 'zod';
import { KnowledgeDocType } from '../enums.js';

const KnowledgeDocTypeSchema = z.enum([
  KnowledgeDocType.CREATED,
  KnowledgeDocType.FAVORITED,
  KnowledgeDocType.COLLABORATED,
]);

export const CreateKnowledgeDocSchema = z.object({
  title: z.string().min(1).max(200),
  type: KnowledgeDocTypeSchema,
  content: z.string().max(50000).optional().nullable(),
});

export const UpdateKnowledgeDocSchema = CreateKnowledgeDocSchema.partial();

export const KnowledgeDocListQuerySchema = z.object({
  type: KnowledgeDocTypeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateKnowledgeDocInput = z.infer<typeof CreateKnowledgeDocSchema>;
export type UpdateKnowledgeDocInput = z.infer<typeof UpdateKnowledgeDocSchema>;
export type KnowledgeDocListQuery = z.infer<typeof KnowledgeDocListQuerySchema>;
```

Append to barrel.

- [ ] **Step 9.2: Serializer**

```ts
// apps/api/src/serializers/knowledge-doc.ts
import type { KnowledgeDoc } from '@oneness/shared/prisma';

export type KnowledgeDocDTO = {
  id: string;
  title: string;
  type: 'created' | 'favorited' | 'collaborated';
  content?: string;
  createdAt: string;
};

export function serializeKnowledgeDoc(d: KnowledgeDoc): KnowledgeDocDTO {
  return {
    id: d.id,
    title: d.title,
    type: d.type.toLowerCase() as 'created' | 'favorited' | 'collaborated',
    content: d.content ?? undefined,
    createdAt: d.createdAt.toISOString(),
  };
}
```

- [ ] **Step 9.3: Routes**

```ts
// apps/api/src/routes/knowledge-docs.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeKnowledgeDoc } from '../serializers/knowledge-doc.js';
import { paginate, asPaged } from '../lib/pagination.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateKnowledgeDocSchema,
  UpdateKnowledgeDocSchema,
  KnowledgeDocListQuerySchema,
  IdParamSchema,
} from '@oneness/shared/schemas';

export const knowledgeDocRoutes = new Hono();
knowledgeDocRoutes.use('/knowledge-docs', tryReadUser, requireUser);
knowledgeDocRoutes.use('/knowledge-docs/*', tryReadUser, requireUser);

knowledgeDocRoutes.get(
  '/knowledge-docs',
  zValidator('query', KnowledgeDocListQuerySchema),
  async (c) => {
    const user = c.var.user!;
    const q = c.req.valid('query');
    const where = { ownerId: user.id, ...(q.type ? { type: q.type } : {}) };
    const [total, rows] = await Promise.all([
      prisma.knowledgeDoc.count({ where }),
      prisma.knowledgeDoc.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
    ]);
    return c.json(asPaged(rows.map(serializeKnowledgeDoc), total, q));
  },
);

knowledgeDocRoutes.post(
  '/knowledge-docs',
  zValidator('json', CreateKnowledgeDocSchema),
  async (c) => {
    const user = c.var.user!;
    const body = c.req.valid('json');
    const created = await prisma.knowledgeDoc.create({
      data: { ...body, content: body.content ?? null, ownerId: user.id },
    });
    return c.json(serializeKnowledgeDoc(created), 201);
  },
);

knowledgeDocRoutes.get(
  '/knowledge-docs/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const doc = await prisma.knowledgeDoc.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!doc) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'knowledge doc not found');
    return c.json(serializeKnowledgeDoc(doc));
  },
);

knowledgeDocRoutes.patch(
  '/knowledge-docs/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateKnowledgeDocSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await prisma.knowledgeDoc.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!existing) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'knowledge doc not found');
    const updated = await prisma.knowledgeDoc.update({ where: { id }, data: body });
    return c.json(serializeKnowledgeDoc(updated));
  },
);

knowledgeDocRoutes.delete(
  '/knowledge-docs/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const existing = await prisma.knowledgeDoc.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!existing) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'knowledge doc not found');
    await prisma.knowledgeDoc.delete({ where: { id } });
    return c.body(null, 204);
  },
);
```

- [ ] **Step 9.4: Mount + Test + Commit**

Mount in `index.ts`. Tests:

```ts
// apps/api/tests/integration/knowledge-docs.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { knowledgeDocRoutes } from '../../src/routes/knowledge-docs.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';

const SEED_USER_EMAIL = '1280165525@qq.com';
const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', knowledgeDocRoutes);
const auth = { authorization: 'Bearer test_token' };

describe('knowledge-docs CRUD', () => {
  let userId: string;
  let createdId = '';

  beforeAll(async () => {
    const u = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!u) throw new Error('Seed user missing.');
    userId = u.id;
  });

  afterAll(async () => {
    if (createdId) await prisma.knowledgeDoc.deleteMany({ where: { id: createdId } });
    // also clean any leftover test docs by title
    await prisma.knowledgeDoc.deleteMany({ where: { ownerId: userId, title: '测试文档' } });
    await prisma.$disconnect();
  });

  it('GET empty initially (no seed knowledge docs)', async () => {
    const res = await app.request('/api/knowledge-docs', { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.total).toBe(0);
  });

  it('POST creates, GET filters by type', async () => {
    const post = await app.request('/api/knowledge-docs', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '测试文档', type: 'CREATED', content: 'lorem' }),
    });
    expect(post.status).toBe(201);
    createdId = ((await post.json()) as { id: string }).id;

    const list = await app.request('/api/knowledge-docs?type=CREATED', { headers: auth });
    const body = (await list.json()) as { items: Array<{ type: string }> };
    expect(body.items.every((d) => d.type === 'created')).toBe(true);

    const empty = await app.request('/api/knowledge-docs?type=FAVORITED', { headers: auth });
    const emptyBody = (await empty.json()) as { total: number };
    expect(emptyBody.total).toBe(0);
  });

  it('DELETE removes the doc', async () => {
    const res = await app.request(`/api/knowledge-docs/${createdId}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(res.status).toBe(204);
    createdId = '';
  });
});
```

Commit:
```bash
pnpm --filter api test
git add packages/shared/src/schemas/knowledge-docs.ts packages/shared/src/schemas/index.ts apps/api/src/serializers/knowledge-doc.ts apps/api/src/routes/knowledge-docs.ts apps/api/src/index.ts apps/api/tests/integration/knowledge-docs.test.ts
git commit -m "feat(api): knowledge-docs CRUD with type filter"
```

---

## Task 10: Project Analytics aggregation

`GET /api/projects/:id/analytics` returns the analytics summary, derived live from the Tasks table by aggregating credits and per-type counts. **Tasks table will be empty in MVP** (no AI tasks yet), so the aggregation returns zeros. Wire the logic so Plan 3 only has to start writing Task rows.

**Files:**
- Modify: `apps/api/src/routes/projects.ts` (add `/projects/:id/analytics`)
- Create: `apps/api/src/serializers/analytics.ts`
- Modify: `apps/api/tests/integration/projects.test.ts` (add analytics test)

- [ ] **Step 10.1: Write `apps/api/src/serializers/analytics.ts`**

```ts
export type AnalyticsDTO = {
  totalCredits: number;
  imageCount: number;
  videoCount: number;
  textTaskCount: number;
  updateTime: string;
};
```

- [ ] **Step 10.2: Add the route in `apps/api/src/routes/projects.ts`**

Before the closing of the file (after the DELETE handler), add:

```ts
import type { AnalyticsDTO } from '../serializers/analytics.js';
import { TaskType, TaskStatus } from '@oneness/shared/enums';

projectRoutes.get(
  '/projects/:id/analytics',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    // Only count tasks that actually consumed credits (succeeded or in-flight).
    const includedStatuses = [TaskStatus.SUCCEEDED, TaskStatus.RUNNING, TaskStatus.QUEUED];
    const [byType, totalAgg, latest] = await Promise.all([
      prisma.task.groupBy({
        by: ['type'],
        where: { projectId, status: { in: includedStatuses } },
        _count: { _all: true },
      }),
      prisma.task.aggregate({
        where: { projectId, status: { in: includedStatuses } },
        _sum: { costCredits: true },
      }),
      prisma.task.findFirst({
        where: { projectId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);
    const countOf = (t: typeof TaskType.IMAGE | typeof TaskType.VIDEO | typeof TaskType.TEXT_ANALYZE) =>
      byType.find((b) => b.type === t)?._count._all ?? 0;
    const dto: AnalyticsDTO = {
      totalCredits: totalAgg._sum.costCredits ?? 0,
      imageCount: countOf(TaskType.IMAGE),
      videoCount: countOf(TaskType.VIDEO),
      textTaskCount: countOf(TaskType.TEXT_ANALYZE),
      updateTime: (latest?.updatedAt ?? new Date()).toISOString(),
    };
    return c.json(dto);
  },
);
```

> Note: this route is intentionally placed inside `projects.ts` to keep all `/projects/:id/*` reads on the same router. Mounting was already done in Task 3.

- [ ] **Step 10.3: Append a test to `apps/api/tests/integration/projects.test.ts`**

Add this `it` block inside the `describe('projects CRUD', ...)` block:

```ts
it('GET /projects/:id/analytics returns zeros (no tasks yet)', async () => {
  const seeded = await prisma.project.findFirst({
    where: { name: '格斗动画' },
    select: { id: true },
  });
  if (!seeded) throw new Error('Seed project missing.');
  const res = await app.request(`/api/projects/${seeded.id}/analytics`, { headers: auth });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    totalCredits: number;
    imageCount: number;
    videoCount: number;
    textTaskCount: number;
    updateTime: string;
  };
  expect(body.totalCredits).toBe(0);
  expect(body.imageCount).toBe(0);
  expect(body.videoCount).toBe(0);
  expect(body.textTaskCount).toBe(0);
  expect(typeof body.updateTime).toBe('string');
});
```

- [ ] **Step 10.4: Run + Commit**

```bash
pnpm --filter api test
git add apps/api/src/routes/projects.ts apps/api/src/serializers/analytics.ts apps/api/tests/integration/projects.test.ts
git commit -m "feat(api): /projects/:id/analytics live aggregation over tasks"
```

---

## Task 11: Full-suite smoke test against live server

Stand up the actual server with `pnpm dev:api`, hit every endpoint with curl, confirm shapes. This isolates "code works through fetch + form-data + presigned URLs" from "code works through Hono in-memory `app.request()`".

**Files:** none — bash script run inline.

- [ ] **Step 11.1: Reset DB to known seed state**

Run:
```bash
pnpm db:reset
```

When prompted, confirm. This wipes and re-seeds.

Then:
```bash
pnpm db:seed
```

Expected: counts are 1/2/9/16 (user/project/character/scene), same as Plan 1.

- [ ] **Step 11.2: Start the API**

Run:
```bash
pkill -f 'tsx watch' 2>/dev/null
pnpm dev:api > /tmp/api.log 2>&1 &
echo "API_PID=$!"
sleep 6
curl -s http://localhost:4000/api/_health
echo
```

Expected: `{"status":"ok",...}`

- [ ] **Step 11.3: Walk the resource graph end-to-end**

Run:
```bash
TOKEN="test_token"
H="-H authorization:Bearer\ $TOKEN -H content-type:application/json"

echo "=== projects list ===" && curl -s http://localhost:4000/api/projects -H "authorization: Bearer $TOKEN" | head -c 200 ; echo

PID=$(curl -s http://localhost:4000/api/projects -H "authorization: Bearer $TOKEN" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
echo "Using project: $PID"

echo "=== characters ===" && curl -s http://localhost:4000/api/projects/$PID/characters -H "authorization: Bearer $TOKEN" | head -c 200 ; echo
echo "=== items ===" && curl -s http://localhost:4000/api/projects/$PID/items -H "authorization: Bearer $TOKEN" | head -c 200 ; echo
echo "=== scenes ===" && curl -s http://localhost:4000/api/projects/$PID/scenes -H "authorization: Bearer $TOKEN" | head -c 200 ; echo
echo "=== episodes ===" && curl -s http://localhost:4000/api/projects/$PID/episodes -H "authorization: Bearer $TOKEN" | head -c 200 ; echo
echo "=== analytics ===" && curl -s http://localhost:4000/api/projects/$PID/analytics -H "authorization: Bearer $TOKEN" ; echo
echo "=== knowledge-docs ===" && curl -s "http://localhost:4000/api/knowledge-docs?type=CREATED" -H "authorization: Bearer $TOKEN" ; echo

echo "=== asset upload ===" && \
  node -e "require('sharp')({create:{width:8,height:8,channels:3,background:'#0000ff'}}).png().toFile('/tmp/blue.png').then(()=>console.log('ok'))" && \
  RESP=$(curl -s -X POST http://localhost:4000/api/assets -H "authorization: Bearer $TOKEN" -F "file=@/tmp/blue.png;type=image/png") && \
  echo "$RESP" && \
  AID=$(echo "$RESP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p') && \
  URL=$(echo "$RESP" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p') && \
  echo "=== presigned URL HEAD ===" && curl -s -o /dev/null -w "%{http_code}\n" "$URL" && \
  echo "=== asset delete ===" && curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:4000/api/assets/$AID -H "authorization: Bearer $TOKEN"
```

Expected, in order:
- `projects list` → JSON `{"items":[{"id":...}, ...], "total":2, "page":1, "pageSize":20}`
- `characters` → JSON array of 9 character objects (each with `id, name, avatar, description, bio, styles`)
- `items` → array of 6 (each with `id, name, image:""`)
- `scenes` → array of 16
- `episodes` → array of 1 (number=1)
- `analytics` → `{"totalCredits":0,"imageCount":0,"videoCount":0,"textTaskCount":0,...}`
- `knowledge-docs` → `{"items":[],"total":0,"page":1,"pageSize":20}`
- asset upload → 201 with JSON containing `id`, `url`, `width:8`, `height:8`
- presigned URL HEAD → 200
- asset delete → 204

- [ ] **Step 11.4: Cleanup**

```bash
pkill -f 'tsx watch' 2>/dev/null
rm -f /tmp/blue.png /tmp/api.log
```

- [ ] **Step 11.5: No code changes — no commit. Just record the curls passed.**

If any curl in 11.3 returned the wrong shape, **stop and investigate**. Do not proceed to Plan 3 until all 10 curls succeed.

---

## Task 12: README update + plan closure

**Files:**
- Modify: `README.md` (append Plan 2 summary)

- [ ] **Step 12.1: Append to `README.md`**

Run:
```bash
cat >> README.md <<'EOF'

### Plan 2: Resource CRUD + Assets

Backend now serves the full resource graph the frontend mock used to:

```
GET    /api/projects (paginated, ?search=)
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id
GET    /api/projects/:id/analytics

GET    /api/projects/:id/characters
POST   /api/projects/:id/characters
GET    /api/characters/:id
PATCH  /api/characters/:id
DELETE /api/characters/:id

POST   /api/characters/:id/styles
PATCH  /api/character-styles/:id
DELETE /api/character-styles/:id

GET    /api/projects/:id/items
POST   /api/projects/:id/items
PATCH  /api/items/:id
DELETE /api/items/:id

GET    /api/projects/:id/scenes
POST   /api/projects/:id/scenes
PATCH  /api/scenes/:id
DELETE /api/scenes/:id

GET    /api/projects/:id/episodes
POST   /api/projects/:id/episodes
PATCH  /api/episodes/:id
DELETE /api/episodes/:id

GET    /api/knowledge-docs (?type=CREATED|FAVORITED|COLLABORATED, paginated)
POST   /api/knowledge-docs
GET    /api/knowledge-docs/:id
PATCH  /api/knowledge-docs/:id
DELETE /api/knowledge-docs/:id

POST   /api/assets (multipart/form-data, file field)
DELETE /api/assets/:id
```

All asset references (`avatar`, `image`, `styles[].image`) in responses are presigned MinIO GET URLs with 1-hour expiry. Pass any `Bearer <token>` in `Authorization` to act as the seed user.
EOF
```

- [ ] **Step 12.2: Commit**

```bash
git add README.md
git commit -m "docs: README Plan 2 endpoint catalog"
```

- [ ] **Step 12.3: Final cross-workspace typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 12.4: Final test run**

Run:
```bash
pnpm --filter api test
```

Expected: all tests pass (health + assets + projects + characters + character-styles + items + scenes + episodes + knowledge-docs).

---

## Done

After Task 12 you have:
- 7 new resource routes (projects/characters/styles/items/scenes/episodes/knowledge-docs) with CRUD + ownership scoping
- `POST /api/assets` real MinIO proxy upload + presigned GET URLs in every response
- `/projects/:id/analytics` live aggregation (zeros until Plan 3 starts writing Tasks)
- vitest integration suite covering every resource (round-trip + 404 + auth)
- All asset-referencing serializers return fresh signed URLs each request

**Next plan:** Plan 3 — Tasks + Worker (BullMQ queues, stub providers, credits state machine, cancel, internal callback).
