# Plan 1 / Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up monorepo, docker compose infra, Prisma data model + seed, and an apps/api Hono skeleton with health/auth/me endpoints. After this plan: `pnpm dev` starts infra + api, `GET http://localhost:4000/api/_health` returns 200, `pnpm db:studio` shows seeded data.

**Architecture:** pnpm workspaces with `apps/web` (existing Next.js, moved), `apps/api` (Hono REST skeleton), and `packages/shared` (Prisma schema, errors, logger, enums). Docker compose runs postgres + redis + minio + minio-init. Node apps run on host with `tsx watch`.

**Tech Stack:** pnpm 9, Node 22+, TypeScript 5, Hono 4, Prisma 5, Postgres 16, Redis 7, MinIO, pino, zod, vitest.

**Linked spec:** `docs/superpowers/specs/2026-05-14-backend-design.md` (§§1-3, 4.1, 4.2 health/auth/me, 6 not in scope, 7.1-7.3, 7.5, 8).

**Conventions:**
- After every task, run the verification commands then commit.
- Every code block is complete — copy verbatim unless told to adapt.
- If a step says "Run: X" — run X and confirm the listed expected output before checking the box.

---

## Pre-flight

### Task 0: Verify environment

**Files:** none — verification only.

- [x] **Step 0.1: Confirm Node and pnpm versions**

Run:
```bash
node --version
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm --version
docker --version
docker compose version
```

Expected:
- node: `v22.x` or higher (you have `v24.x` from the project — OK)
- pnpm: `9.12.0`
- docker compose: `v2.x` or higher

- [x] **Step 0.2: Remove npm lockfile (we are switching to pnpm)**

Run:
```bash
rm -f package-lock.json
```

Expected: file gone, no error.

- [x] **Step 0.3: Commit the pre-flight cleanup**

```bash
git add -A
git commit -m "chore: remove npm lockfile in preparation for pnpm workspace"
```

---

## Task 1: pnpm workspace + root scaffolding

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Modify: `package.json` (rewrite to workspace root)
- Modify: `.gitignore` (add env/dist patterns)

- [x] **Step 1.1: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [x] **Step 1.2: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [x] **Step 1.3: Replace root `package.json`**

> **Post-Group-B note:** `dotenv-cli` wraps every script that needs env vars. Without it, `pnpm --filter` switches cwd into the sub-package and Prisma / tsx no longer find the repo-root `.env`. Add `dotenv-cli` as a `devDependency` (installed via `pnpm add -D -w dotenv-cli`).

```json
{
  "name": "oneness-ai",
  "version": "0.1.0",
  "private": true,
  "description": "Oneness-AI — 专业 AI 影视创作平台",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "infra:up": "docker compose -f docker/docker-compose.yml up -d postgres redis minio minio-init",
    "infra:down": "docker compose -f docker/docker-compose.yml down",
    "infra:logs": "docker compose -f docker/docker-compose.yml logs -f",
    "dev:web": "pnpm --filter web dev",
    "dev:api": "dotenv -e .env -- pnpm --filter api dev",
    "dev": "pnpm infra:up && concurrently -k -n api,web -c blue,green \"pnpm dev:api\" \"pnpm dev:web\"",
    "db:migrate": "dotenv -e .env -- pnpm --filter @oneness/shared exec prisma migrate dev",
    "db:reset": "dotenv -e .env -- pnpm --filter @oneness/shared exec prisma migrate reset --force",
    "db:seed": "dotenv -e .env -- pnpm --filter @oneness/shared exec tsx prisma/seed.ts",
    "db:studio": "dotenv -e .env -- pnpm --filter @oneness/shared exec prisma studio",
    "db:generate": "dotenv -e .env -- pnpm --filter @oneness/shared exec prisma generate",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "concurrently": "^9.1.0",
    "dotenv-cli": "^11.0.0",
    "typescript": "^5.6.3"
  }
}
```

- [x] **Step 1.4: Update `.gitignore`**

Append the following lines (don't replace existing content):

```gitignore

# Workspace artifacts
.env
.env.local
.env.docker
*.tsbuildinfo
dist/
.turbo/
```

Run:
```bash
cat >> .gitignore <<'EOF'

# Workspace artifacts
.env
.env.local
.env.docker
*.tsbuildinfo
dist/
.turbo/
EOF
```

- [x] **Step 1.5: Install root-level dependencies**

Run:
```bash
rm -rf node_modules
pnpm install
```

Expected: `Done in Xs`. `pnpm-lock.yaml` should now exist at the repo root.

- [x] **Step 1.6: Verify the workspace is recognized**

Run:
```bash
pnpm -r ls --depth -1
```

Expected: shows `oneness-ai` and no other packages yet (we haven't created apps yet).

- [x] **Step 1.7: Commit**

```bash
git add pnpm-workspace.yaml tsconfig.base.json package.json .gitignore pnpm-lock.yaml
git commit -m "chore: bootstrap pnpm workspace and root scripts"
```

---

## Task 2: Migrate existing Next.js app into `apps/web/`

**Files:**
- Create directory: `apps/web/`
- Move all current top-level web assets into it

The existing tree has `src/`, `public/`, `next.config.ts`, `next-env.d.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `components.json`. The package.json for web becomes `apps/web/package.json`.

- [x] **Step 2.1: Create the app folder and move files with `git mv` (preserves history)**

Run:
```bash
mkdir -p apps/web
git mv src apps/web/src
git mv public apps/web/public
git mv next.config.ts apps/web/next.config.ts
git mv next-env.d.ts apps/web/next-env.d.ts
git mv tsconfig.json apps/web/tsconfig.json
git mv eslint.config.mjs apps/web/eslint.config.mjs
git mv postcss.config.mjs apps/web/postcss.config.mjs
git mv components.json apps/web/components.json
```

- [x] **Step 2.2: Create `apps/web/package.json`**

```json
{
  "name": "web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.6.0",
    "next": "16.2.1",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "tailwind-merge": "^3.5.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^24",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.1",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
```

- [x] **Step 2.3: Patch `apps/web/tsconfig.json` to extend the shared base**

Open `apps/web/tsconfig.json` and change the top to extend `tsconfig.base.json`. Replace the whole file with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "noEmit": true,
    "incremental": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [x] **Step 2.4: Reinstall to wire the workspace package**

Run:
```bash
pnpm install
```

Expected: pnpm lists `web` as a workspace package. `apps/web/node_modules` should appear.

- [x] **Step 2.5: Verify the web app still type-checks and builds the dev server**

Run:
```bash
pnpm --filter web typecheck
```

Expected: exits 0.

Run:
```bash
pnpm --filter web dev &
sleep 8
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
kill %1
```

Expected: prints `200`. Background dev server is killed at the end.

- [x] **Step 2.6: Commit**

```bash
git add apps/ pnpm-lock.yaml
git commit -m "chore: move Next.js app into apps/web workspace"
```

---

## Task 3: Docker compose infra + .env templates

**Files:**
- Create: `docker/docker-compose.yml`
- Create: `.env.example`
- Create: `.env.docker.example`

- [x] **Step 3.1: Create `docker/docker-compose.yml`**

```yaml
name: oneness-ai

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: oneness
      POSTGRES_PASSWORD: oneness
      POSTGRES_DB: oneness
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U oneness -d oneness"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: oneness
      MINIO_ROOT_PASSWORD: oneness-secret
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      sh -c "
        mc alias set local http://minio:9000 oneness oneness-secret &&
        mc mb --ignore-existing local/user-uploads local/task-outputs &&
        echo 'buckets ready' &&
        exit 0
      "

volumes:
  pg_data:
  minio_data:
```

> Note: `api` and `worker` services with `profiles: ["full"]` are deferred to Plan 4 (containerized prod-style run). Plan 1 only needs infra services.

- [x] **Step 3.2: Create `.env.example`**

```bash
# Database (host dev — connects to docker postgres on localhost)
DATABASE_URL=postgresql://oneness:oneness@localhost:5432/oneness?schema=public

# Redis (host dev)
REDIS_URL=redis://localhost:6379

# MinIO (host dev — browser AND host services use localhost:9000)
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=oneness
MINIO_SECRET_KEY=oneness-secret
MINIO_BUCKET_USER_UPLOADS=user-uploads
MINIO_BUCKET_TASK_OUTPUTS=task-outputs

# API server
PORT=4000
NODE_ENV=development
LOG_LEVEL=info

# CORS — comma-separated origins allowed to call the API
WEB_ORIGINS=http://localhost:3000

# Shared secret used by future external workflows hitting /api/internal/*
INTERNAL_SECRET=change-me-to-a-long-random-string

# Frontend → API base URL (read by Next.js)
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

- [x] **Step 3.3: Create `.env.docker.example`**

This file is used when the api/worker run **inside** docker compose (Plan 4 profile). It swaps localhost for service names.

```bash
DATABASE_URL=postgresql://oneness:oneness@postgres:5432/oneness?schema=public
REDIS_URL=redis://redis:6379
MINIO_ENDPOINT=http://minio:9000
MINIO_ACCESS_KEY=oneness
MINIO_SECRET_KEY=oneness-secret
MINIO_BUCKET_USER_UPLOADS=user-uploads
MINIO_BUCKET_TASK_OUTPUTS=task-outputs
PORT=4000
NODE_ENV=development
LOG_LEVEL=info
WEB_ORIGINS=http://localhost:3000
INTERNAL_SECRET=change-me-to-a-long-random-string
```

- [x] **Step 3.4: Copy `.env.example` to `.env` for local dev**

Run:
```bash
cp .env.example .env
```

`.env` is gitignored.

- [x] **Step 3.5: Validate compose file syntactically**

Run:
```bash
docker compose -f docker/docker-compose.yml config > /dev/null
```

Expected: exits 0, no errors. (Sends parsed config to /dev/null.)

- [x] **Step 3.6: Bring up infra**

Run:
```bash
pnpm infra:up
```

Wait ~15 seconds for healthchecks to settle.

- [x] **Step 3.7: Verify each service is healthy**

Run:
```bash
docker compose -f docker/docker-compose.yml ps
```

Expected: `postgres` and `redis` and `minio` all show `Up X seconds (healthy)`. `minio-init` shows `Exited (0)`.

Run:
```bash
docker exec oneness-ai-postgres-1 pg_isready -U oneness
docker exec oneness-ai-redis-1 redis-cli ping
curl -s http://localhost:9000/minio/health/live | head -c 30 ; echo
docker exec oneness-ai-minio-1 mc ls local 2>/dev/null | head
```

Expected:
- `accepting connections`
- `PONG`
- (empty body, but `curl -i` would show 200)
- `[date] user-uploads/` and `[date] task-outputs/`

- [x] **Step 3.8: Commit**

```bash
git add docker/ .env.example .env.docker.example
git commit -m "chore: docker compose infra (postgres + redis + minio) and env templates"
```

---

## Task 4: `packages/shared` scaffold

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/enums.ts`

- [x] **Step 4.1: Create `packages/shared/package.json`**

```json
{
  "name": "@oneness/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./enums": "./src/enums.ts",
    "./errors": "./src/errors.ts",
    "./logger": "./src/logger.ts",
    "./prisma": "./src/prisma-client.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@prisma/client": "^5.22.0",
    "@paralleldrive/cuid2": "^2.2.2",
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "prisma": "^5.22.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "@types/node": "^22.9.0"
  }
}
```

- [x] **Step 4.2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [x] **Step 4.3: Create `packages/shared/src/enums.ts`**

```ts
export const AnalysisStatus = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
} as const;
export type AnalysisStatus = typeof AnalysisStatus[keyof typeof AnalysisStatus];

export const KnowledgeDocType = {
  CREATED: 'CREATED',
  FAVORITED: 'FAVORITED',
  COLLABORATED: 'COLLABORATED',
} as const;
export type KnowledgeDocType = typeof KnowledgeDocType[keyof typeof KnowledgeDocType];

export const TaskType = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  TEXT_ANALYZE: 'TEXT_ANALYZE',
} as const;
export type TaskType = typeof TaskType[keyof typeof TaskType];

export const TaskStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

export const AssetBucket = {
  USER_UPLOADS: 'user-uploads',
  TASK_OUTPUTS: 'task-outputs',
} as const;
export type AssetBucket = typeof AssetBucket[keyof typeof AssetBucket];

export const TaskAssetRole = {
  INPUT: 'input',
  OUTPUT: 'output',
  REFERENCE: 'reference',
} as const;
export type TaskAssetRole = typeof TaskAssetRole[keyof typeof TaskAssetRole];
```

- [x] **Step 4.4: Create `packages/shared/src/index.ts` (barrel — will grow over later plans)**

```ts
export * from './enums.js';
export * from './errors.js';
export * from './logger.js';
export * from './prisma-client.js';
```

> Note: `errors.ts`, `logger.ts`, `prisma-client.ts` are created in subsequent tasks. The barrel re-exports them now so import paths stay stable.

- [x] **Step 4.5: Install dependencies**

Run:
```bash
pnpm install
```

Expected: `@oneness/shared` is now linked into the workspace. No type errors yet (next tasks fill the remaining files).

- [x] **Step 4.6: Commit**

```bash
git add packages/shared/package.json packages/shared/tsconfig.json packages/shared/src/enums.ts packages/shared/src/index.ts pnpm-lock.yaml
git commit -m "feat(shared): scaffold @oneness/shared package with enum constants"
```

---

## Task 5: Prisma schema + initial migration

**Files:**
- Create: `packages/shared/prisma/schema.prisma`
- Create: `packages/shared/src/prisma-client.ts`
- Generated: `packages/shared/prisma/migrations/<timestamp>_init/migration.sql`

- [x] **Step 5.1: Create `packages/shared/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum AnalysisStatus {
  PENDING
  COMPLETED
}

enum KnowledgeDocType {
  CREATED
  FAVORITED
  COLLABORATED
}

enum TaskType {
  IMAGE
  VIDEO
  TEXT_ANALYZE
}

enum TaskStatus {
  QUEUED
  RUNNING
  SUCCEEDED
  FAILED
  CANCELLED
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  avatarKey String?
  credits   Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  projects      Project[]
  knowledgeDocs KnowledgeDoc[]
  tasks         Task[]
  assets        Asset[]
}

model Project {
  id              String         @id @default(cuid())
  ownerId         String
  name            String
  ratio           String
  style           String
  stylePrompt     String         @db.Text
  analysisModel   String
  imageModel      String
  videoModel      String
  generalAnalysis AnalysisStatus @default(PENDING)
  basicAnalysis   AnalysisStatus @default(PENDING)
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  owner      User                @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  characters Character[]
  items      Item[]
  scenes     Scene[]
  episodes   StoryboardEpisode[]
  tasks      Task[]

  @@index([ownerId, createdAt])
}

model Character {
  id          String   @id @default(cuid())
  projectId   String
  name        String
  description String   @db.Text
  bio         String   @db.Text
  voice       String?
  avatarKey   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  project Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  styles  CharacterStyle[]

  @@index([projectId])
}

model CharacterStyle {
  id          String   @id @default(cuid())
  characterId String
  name        String
  assetId     String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  character Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
  asset     Asset?    @relation(fields: [assetId], references: [id], onDelete: SetNull)

  @@index([characterId])
}

model Item {
  id        String   @id @default(cuid())
  projectId String
  name      String
  assetId   String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  asset   Asset?  @relation(fields: [assetId], references: [id], onDelete: SetNull)

  @@index([projectId])
}

model Scene {
  id        String   @id @default(cuid())
  projectId String
  name      String
  assetId   String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  asset   Asset?  @relation(fields: [assetId], references: [id], onDelete: SetNull)

  @@index([projectId])
}

model StoryboardEpisode {
  id        String   @id @default(cuid())
  projectId String
  number    Int
  title     String
  content   String   @db.Text
  analyzed  Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, number])
}

model KnowledgeDoc {
  id        String           @id @default(cuid())
  ownerId   String
  title     String
  type      KnowledgeDocType
  content   String?          @db.Text
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@index([ownerId, type])
}

model Task {
  id          String     @id @default(cuid())
  ownerId     String
  projectId   String?
  type        TaskType
  status      TaskStatus @default(QUEUED)
  provider    String
  input       Json
  output      Json?
  error       String?
  costCredits Int        @default(0)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  startedAt   DateTime?
  completedAt DateTime?

  owner   User        @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  project Project?    @relation(fields: [projectId], references: [id], onDelete: SetNull)
  assets  TaskAsset[]

  @@index([ownerId, status, createdAt])
  @@index([projectId, type])
}

model Asset {
  id          String   @id @default(cuid())
  ownerId     String
  bucket      String
  key         String
  contentType String
  sizeBytes   Int
  width       Int?
  height      Int?
  durationMs  Int?
  createdAt   DateTime @default(now())

  owner           User             @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  characterStyles CharacterStyle[]
  items           Item[]
  scenes          Scene[]
  taskAssets      TaskAsset[]

  @@unique([bucket, key])
  @@index([ownerId, createdAt])
}

model TaskAsset {
  taskId  String
  assetId String
  role    String

  task  Task  @relation(fields: [taskId], references: [id], onDelete: Cascade)
  asset Asset @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@id([taskId, assetId, role])
}
```

- [x] **Step 5.2: Create `packages/shared/src/prisma-client.ts`**

```ts
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

export function getPrismaClient(opts?: ConstructorParameters<typeof PrismaClient>[0]): PrismaClient {
  if (!globalThis.__prismaClient) {
    globalThis.__prismaClient = new PrismaClient(opts);
  }
  return globalThis.__prismaClient;
}

export { PrismaClient };
export type {
  User, Project, Character, CharacterStyle, Item, Scene,
  StoryboardEpisode, KnowledgeDoc, Task, Asset, TaskAsset,
} from '@prisma/client';
```

- [x] **Step 5.3: Validate the schema**

Run:
```bash
pnpm --filter @oneness/shared exec prisma format
pnpm --filter @oneness/shared exec prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [x] **Step 5.4: Generate the migration against the running Postgres**

Make sure `pnpm infra:up` is still up. Then run:
```bash
pnpm --filter @oneness/shared exec prisma migrate dev --name init
```

Expected:
- A new folder `packages/shared/prisma/migrations/<timestamp>_init/` is created with `migration.sql`.
- Prisma Client is generated.
- Output ends with `✔ Generated Prisma Client (v5.x.x)`.

- [x] **Step 5.5: Verify tables in Postgres**

Run:
```bash
docker exec oneness-ai-postgres-1 psql -U oneness -d oneness -c "\dt"
```

Expected: lists `User, Project, Character, CharacterStyle, Item, Scene, StoryboardEpisode, KnowledgeDoc, Task, Asset, TaskAsset` (plus `_prisma_migrations`).

- [ ] **Step 5.6: Quick type-check of the Prisma client export**

Run:
```bash
pnpm --filter @oneness/shared typecheck
```

Expected: exits 0.

- [x] **Step 5.7: Commit**

```bash
git add packages/shared/prisma/ packages/shared/src/prisma-client.ts
git commit -m "feat(shared): Prisma schema, initial migration, and PrismaClient export"
```

---

## Task 6: Seed data from existing mock

**Files:**
- Create: `packages/shared/prisma/seed.ts`

- [x] **Step 6.1: Create `packages/shared/prisma/seed.ts`**

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearAll() {
  await prisma.taskAsset.deleteMany();
  await prisma.task.deleteMany();
  await prisma.characterStyle.deleteMany();
  await prisma.character.deleteMany();
  await prisma.item.deleteMany();
  await prisma.scene.deleteMany();
  await prisma.storyboardEpisode.deleteMany();
  await prisma.knowledgeDoc.deleteMany();
  await prisma.project.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  console.log('Clearing existing data...');
  await clearAll();

  console.log('Creating seed user...');
  const user = await prisma.user.create({
    data: {
      email: '1280165525@qq.com',
      name: '黄昱舟',
      credits: 10158,
    },
  });

  console.log('Creating projects...');
  const project1 = await prisma.project.create({
    data: {
      ownerId: user.id,
      name: '格斗动画',
      ratio: '16:9',
      style: '日漫风格',
      stylePrompt:
        '精细的素描和简洁的线条，日式漫画风格，武道主题。故事围绕一位格斗选手展开，场景包括道场、城市街头和地下格斗场。角色设计强调力量感和速度感，配色以深蓝、黑色和金色为主。',
      analysisModel: 'Gemini 3 Pro',
      imageModel: 'Nano banana pro',
      videoModel: 'Seedance 2.0',
      generalAnalysis: 'COMPLETED',
      basicAnalysis: 'COMPLETED',
    },
  });

  await prisma.project.create({
    data: {
      ownerId: user.id,
      name: '格斗',
      ratio: '16:9',
      style: '电影质感',
      stylePrompt:
        '电影级画质，写实风格，强调光影对比和景深效果。动作场面采用快速剪辑和慢镜头结合，色调偏冷，以蓝灰色为主。',
      analysisModel: 'Gemini 3 Pro',
      imageModel: 'Nano banana pro',
      videoModel: 'Seedance 2.0',
      generalAnalysis: 'COMPLETED',
      basicAnalysis: 'COMPLETED',
    },
  });

  console.log('Creating characters for project1...');
  const characters = [
    {
      name: '潘杰',
      description: 'MAX俱乐部新秀选手，铁亮的师弟。从初出茅庐的散打少年成长为WFC职业综合格斗明星，被称为"格斗奶爸"。',
      bio: 'MAX俱乐部新秀选手，铁亮的师弟。从初出茅庐的散打少年成长为WFC职业综合格斗明星，被称为"格斗奶爸"。',
      styles: ['八角笼竞技造型', '都市潮男生活造型', 'WFC职业明星造型'],
    },
    {
      name: '铁亮',
      description: 'MAX俱乐部老将，中国MMA先驱，首位柔术黑带，绰号"草原鹰"，潘杰的师兄与精神导师。',
      bio: 'MAX俱乐部老将，中国MMA先驱，首位柔术黑带，绰号"草原鹰"，潘杰的师兄与精神导师。',
      styles: [],
    },
    {
      name: '叶子',
      description: 'MAX格斗俱乐部总经理，铁亮的未婚妻与事业推手。',
      bio: 'MAX格斗俱乐部总经理，铁亮的未婚妻与事业推手。她不仅是冷峻商业规则的执行者，更是格斗士们情感与生计的最后防线，在精英感与烟火气间完美平衡。',
      styles: [],
    },
    {
      name: '马学军',
      description: '铁亮的师父，前摔跤队退休教练。现经营器械维修仓库。',
      bio: '铁亮的师父，前摔跤队退休教练。现经营器械维修仓库，是主角团的精神导师，洞悉人性，传统而重情义。',
      styles: [],
    },
    {
      name: '小盼',
      description: '男主角潘杰的妻子，一名平凡而伟大的房产中介。',
      bio: '男主角潘杰的妻子，一名平凡而伟大的房产中介，家庭的现实支柱与情感归宿。',
      styles: [],
    },
    {
      name: '乐乐',
      description: '潘杰与小盼的女儿。',
      bio: '潘杰与小盼的女儿。',
      styles: [],
    },
    {
      name: '梁宽',
      description: 'WFC赛事首席配对选材官。',
      bio: 'WFC赛事首席配对选材官。',
      styles: [],
    },
    {
      name: '托尼',
      description: '野火俱乐部选手，泰拳王，曾导致铁亮腿部骨折。',
      bio: '野火俱乐部选手，泰拳王，曾导致铁亮腿部骨折。',
      styles: [],
    },
    {
      name: '钢塔雷斯',
      description: '巴西柔术教练，铁亮曾经的对手，后辅导潘杰。',
      bio: '巴西柔术教练，铁亮曾经的对手，后辅导潘杰。',
      styles: [],
    },
  ];
  for (const c of characters) {
    await prisma.character.create({
      data: {
        projectId: project1.id,
        name: c.name,
        description: c.description,
        bio: c.bio,
        styles: { create: c.styles.map((name) => ({ name })) },
      },
    });
  }

  console.log('Creating items...');
  const items = [
    '马鬃绳', '橡皮人', '旧拳套', '三巨头合照', '五色项圈', '戒指盒',
  ];
  for (const name of items) {
    await prisma.item.create({ data: { projectId: project1.id, name } });
  }

  console.log('Creating scenes...');
  const scenes = [
    '精武杯联赛现场-擂台-夜',
    '精武杯联赛现场-VIP看台-夜',
    '精武杯联赛候场区-夜',
    '精武杯联赛现场-观众席-夜',
    '精武杯联赛入场口-夜',
    '休息区-夜',
    '医院手术室前-夜',
    'MAX俱乐部浴室-夜',
    'MAX俱乐部宿舍-夜',
    '早期MAX俱乐部-室外-日',
    '早期MAX俱乐部-室内-日',
    '医院附属康复中心病房-日',
    '医院附属康复中心走廊-日',
    '机场停车位-日',
    '潘杰车内-日',
    '城郊路旁-日',
  ];
  for (const name of scenes) {
    await prisma.scene.create({ data: { projectId: project1.id, name } });
  }

  console.log('Creating storyboard episode...');
  await prisma.storyboardEpisode.create({
    data: {
      projectId: project1.id,
      number: 1,
      title: '第1集',
      content:
        '《终极格斗》（暂拟）电影剧本 编剧 杜庆春 黄昱舟 刘林青 2021年1月30日 精武杯联赛比赛现场（四角擂台）夜 内 一阵清脆利落的撞击响起，一股鲜血溅射在擂台上。鲜血顺着一位白人选手的颧骨流下...',
      analyzed: true,
    },
  });

  console.log('Seed complete.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [x] **Step 6.2: Run the seed**

Run:
```bash
pnpm db:seed
```

Expected output ends with `Seed complete.` and no errors.

- [x] **Step 6.3: Verify in the database**

Run:
```bash
docker exec oneness-ai-postgres-1 psql -U oneness -d oneness -c \
  "SELECT (SELECT count(*) FROM \"User\") AS users, (SELECT count(*) FROM \"Project\") AS projects, (SELECT count(*) FROM \"Character\") AS characters, (SELECT count(*) FROM \"Scene\") AS scenes;"
```

Expected:
```
 users | projects | characters | scenes
-------+----------+------------+--------
     1 |        2 |          9 |     16
```

- [x] **Step 6.4: Commit**

```bash
git add packages/shared/prisma/seed.ts
git commit -m "feat(shared): Prisma seed script ported from frontend mock data"
```

---

## Task 7: Shared logger and error model

**Files:**
- Create: `packages/shared/src/logger.ts`
- Create: `packages/shared/src/errors.ts`

- [x] **Step 7.1: Write `packages/shared/src/logger.ts`**

```ts
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: undefined,
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
      }
    : undefined,
});

export type Logger = typeof logger;

export const metrics = {
  incr(name: string, tags?: Record<string, string | number>) {
    logger.debug({ metric: name, tags }, 'metric.incr');
  },
  timing(name: string, ms: number, tags?: Record<string, string | number>) {
    logger.debug({ metric: name, ms, tags }, 'metric.timing');
  },
  gauge(name: string, value: number, tags?: Record<string, string | number>) {
    logger.debug({ metric: name, value, tags }, 'metric.gauge');
  },
};
```

- [x] **Step 7.2: Write `packages/shared/src/errors.ts`**

```ts
export const ErrorCodes = {
  INTERNAL: 'INTERNAL',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  // Domain-specific (used in later plans)
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  CHARACTER_NOT_FOUND: 'CHARACTER_NOT_FOUND',
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  SCENE_NOT_FOUND: 'SCENE_NOT_FOUND',
  EPISODE_NOT_FOUND: 'EPISODE_NOT_FOUND',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  ASSET_TOO_LARGE: 'ASSET_TOO_LARGE',
  ASSET_TYPE_NOT_ALLOWED: 'ASSET_TYPE_NOT_ALLOWED',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_NOT_CANCELLABLE: 'TASK_NOT_CANCELLABLE',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, httpStatus = 500, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }

  static notFound(code: ErrorCode, message: string, details?: unknown) {
    return new AppError(code, message, 404, details);
  }
  static badRequest(code: ErrorCode, message: string, details?: unknown) {
    return new AppError(code, message, 400, details);
  }
  static unauthorized(message = 'Unauthorized', details?: unknown) {
    return new AppError(ErrorCodes.UNAUTHORIZED, message, 401, details);
  }
  static forbidden(message = 'Forbidden', details?: unknown) {
    return new AppError(ErrorCodes.FORBIDDEN, message, 403, details);
  }
  static conflict(code: ErrorCode, message: string, details?: unknown) {
    return new AppError(code, message, 409, details);
  }
  static internal(message = 'Internal server error', details?: unknown) {
    return new AppError(ErrorCodes.INTERNAL, message, 500, details);
  }
}
```

- [x] **Step 7.3: Type-check the shared package**

Run:
```bash
pnpm --filter @oneness/shared typecheck
```

Expected: exits 0.

- [x] **Step 7.4: Commit**

```bash
git add packages/shared/src/logger.ts packages/shared/src/errors.ts
git commit -m "feat(shared): pino logger with metrics hooks + AppError model"
```

---

## Task 8: `apps/api` package scaffold

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/index.ts` (minimal "hello" version; expanded in later tasks)

- [ ] **Step 8.1: Create `apps/api/package.json`**

```json
{
  "name": "api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --clear-screen=false src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@oneness/shared": "workspace:*",
    "@hono/node-server": "^1.13.7",
    "@hono/zod-validator": "^0.4.1",
    "@paralleldrive/cuid2": "^2.2.2",
    "hono": "^4.6.12",
    "ioredis": "^5.4.1",
    "minio": "^8.0.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

- [ ] **Step 8.2: Create `apps/api/tsconfig.json`**

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
  "exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 8.3: Create `apps/api/src/config.ts`**

```ts
import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET_USER_UPLOADS: z.string().default('user-uploads'),
  MINIO_BUCKET_TASK_OUTPUTS: z.string().default('task-outputs'),
  WEB_ORIGINS: z.string().default('http://localhost:3000'),
  INTERNAL_SECRET: z.string().min(16),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
```

- [ ] **Step 8.4: Create a minimal `apps/api/src/index.ts`**

This is the "Hello World" version. It will be replaced/expanded in later tasks — putting it here now lets us verify the wiring end-to-end before adding complexity.

```ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import { logger } from '@oneness/shared/logger';

const app = new Hono();

app.get('/api/_hello', (c) => c.json({ ok: true, env: config.NODE_ENV }));

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port }, 'API server started');
});
```

- [ ] **Step 8.5: Install and verify the app boots**

Run:
```bash
pnpm install
pnpm --filter api typecheck
```

Expected: typecheck passes.

Run the dev server briefly:
```bash
pnpm --filter api dev &
sleep 5
curl -s http://localhost:4000/api/_hello
kill %1 2>/dev/null
```

Expected: `{"ok":true,"env":"development"}`

- [ ] **Step 8.6: Commit**

```bash
git add apps/api/ pnpm-lock.yaml
git commit -m "feat(api): scaffold Hono server with config and hello route"
```

---

## Task 9: API library modules (prisma, redis, minio singletons)

**Files:**
- Create: `apps/api/src/lib/prisma.ts`
- Create: `apps/api/src/lib/redis.ts`
- Create: `apps/api/src/lib/minio.ts`

- [ ] **Step 9.1: Write `apps/api/src/lib/prisma.ts`**

```ts
import { getPrismaClient } from '@oneness/shared/prisma';
import { config } from '../config.js';

export const prisma = getPrismaClient({
  log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
```

- [ ] **Step 9.2: Write `apps/api/src/lib/redis.ts`**

```ts
import Redis from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redis.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[redis] connection error:', err.message);
});
```

- [ ] **Step 9.3: Write `apps/api/src/lib/minio.ts`**

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

export const Buckets = {
  USER_UPLOADS: config.MINIO_BUCKET_USER_UPLOADS,
  TASK_OUTPUTS: config.MINIO_BUCKET_TASK_OUTPUTS,
} as const;
```

- [ ] **Step 9.4: Verify**

Run:
```bash
pnpm --filter api typecheck
```

Expected: exits 0.

- [ ] **Step 9.5: Commit**

```bash
git add apps/api/src/lib/
git commit -m "feat(api): prisma/redis/minio client singletons"
```

---

## Task 10: Request-id, CORS, and global error handler middleware

**Files:**
- Create: `apps/api/src/middleware/request-id.ts`
- Create: `apps/api/src/middleware/cors.ts`
- Create: `apps/api/src/middleware/error-handler.ts`
- Create: `apps/api/src/types/hono-env.ts` (shared `ContextVariableMap` extension)

- [ ] **Step 10.1: Write `apps/api/src/types/hono-env.ts`**

This centralizes the Hono `ContextVariableMap` augmentation so every middleware doesn't redeclare it.

```ts
import type { User } from '@prisma/client';
import type { Logger } from '@oneness/shared/logger';

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    log: Logger;
    user: User | null;
  }
}

export {};
```

- [ ] **Step 10.2: Write `apps/api/src/middleware/request-id.ts`**

```ts
import { createMiddleware } from 'hono/factory';
import { createId } from '@paralleldrive/cuid2';
import { logger } from '@oneness/shared/logger';
import '../types/hono-env.js';

export const requestIdMiddleware = createMiddleware(async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const requestId = incoming && incoming.length > 0 ? incoming : createId();
  c.set('requestId', requestId);
  c.set('log', logger.child({ requestId, method: c.req.method, path: c.req.path }));
  c.header('X-Request-Id', requestId);

  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  c.get('log').info({ status: c.res.status, ms }, 'request completed');
});
```

- [ ] **Step 10.3: Write `apps/api/src/middleware/cors.ts`**

```ts
import { cors } from 'hono/cors';
import { config } from '../config.js';

const origins = config.WEB_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

export const corsMiddleware = cors({
  origin: origins,
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Internal-Secret'],
  exposeHeaders: ['X-Request-Id'],
});
```

- [ ] **Step 10.4: Write `apps/api/src/middleware/error-handler.ts`**

```ts
import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';
import { AppError, ErrorCodes } from '@oneness/shared/errors';

type ErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export const errorHandler: ErrorHandler = (err, c) => {
  const log = c.get('log');

  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: { code: err.code, message: err.message, details: err.details },
    };
    log?.warn({ code: err.code, status: err.httpStatus }, err.message);
    return c.json(body, err.httpStatus as Parameters<typeof c.json>[1]);
  }

  if (err instanceof ZodError) {
    const body: ErrorBody = {
      error: {
        code: ErrorCodes.VALIDATION_FAILED,
        message: 'Request validation failed',
        details: err.flatten(),
      },
    };
    log?.warn({ issues: err.issues }, 'validation failed');
    return c.json(body, 400);
  }

  log?.error({ err: err.message, stack: err.stack }, 'unhandled error');
  const body: ErrorBody = {
    error: { code: ErrorCodes.INTERNAL, message: 'Internal server error' },
  };
  return c.json(body, 500);
};
```

- [ ] **Step 10.5: Wire the middleware into `apps/api/src/index.ts`**

Replace the contents of `apps/api/src/index.ts` with:

```ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import { logger } from '@oneness/shared/logger';
import { corsMiddleware } from './middleware/cors.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import './types/hono-env.js';

const app = new Hono();

app.use('*', corsMiddleware);
app.use('*', requestIdMiddleware);
app.onError(errorHandler);

app.get('/api/_hello', (c) => c.json({ ok: true, env: config.NODE_ENV }));

// Sanity route to verify error handler — remove in later tasks
app.get('/api/_boom', () => {
  throw new Error('boom');
});

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port }, 'API server started');
});
```

- [ ] **Step 10.6: Smoke test the middleware**

Run:
```bash
pnpm --filter api dev &
sleep 5
echo "--- _hello ---"
curl -s -i http://localhost:4000/api/_hello | grep -i 'X-Request-Id\|HTTP/'
echo "--- _boom ---"
curl -s -i http://localhost:4000/api/_boom | head -n 1
curl -s http://localhost:4000/api/_boom
kill %1 2>/dev/null
```

Expected:
- `_hello` returns `HTTP/1.1 200` and an `X-Request-Id` header
- `_boom` returns `HTTP/1.1 500` and body `{"error":{"code":"INTERNAL","message":"Internal server error"}}`

- [ ] **Step 10.7: Remove the `_boom` test route**

Delete the `/api/_boom` handler (the 3 lines starting with `app.get('/api/_boom', ...)`) from `apps/api/src/index.ts`.

- [ ] **Step 10.8: Commit**

```bash
git add apps/api/src/middleware/ apps/api/src/types/ apps/api/src/index.ts
git commit -m "feat(api): request-id, CORS, and global error-handler middleware"
```

---

## Task 11: Optional auth middleware (token-presence based)

**Files:**
- Create: `apps/api/src/middleware/auth.ts`

The mock auth scheme:
- `tryReadUser` — if `Authorization: Bearer <anything>` header is present, load the seed user; otherwise leave `c.var.user = null`.
- `requireUser` — throws `401 UNAUTHORIZED` if `c.var.user` is null. Use this on protected routes.

This preserves the existing frontend UX (logged-out state returns null user).

- [ ] **Step 11.1: Write `apps/api/src/middleware/auth.ts`**

```ts
import { createMiddleware } from 'hono/factory';
import { prisma } from '../lib/prisma.js';
import { AppError } from '@oneness/shared/errors';

const SEED_USER_EMAIL = '1280165525@qq.com';

/**
 * Reads the optional Authorization header. If present (any Bearer value),
 * loads the seed user into c.var.user. Otherwise sets it to null.
 *
 * This is the mock-auth phase; real token verification slots in here later
 * without changing route handler signatures.
 */
export const tryReadUser = createMiddleware(async (c, next) => {
  const auth = c.req.header('authorization');
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    c.set('user', null);
    await next();
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
  if (!user) {
    throw AppError.internal('Seed user not found. Run `pnpm db:seed`.');
  }
  c.set('user', user);
  await next();
});

/**
 * Use on routes that require a logged-in user. Must come after tryReadUser.
 */
export const requireUser = createMiddleware(async (c, next) => {
  if (!c.var.user) throw AppError.unauthorized();
  await next();
});
```

- [ ] **Step 11.2: Type-check**

Run:
```bash
pnpm --filter api typecheck
```

Expected: exits 0.

- [ ] **Step 11.3: Commit**

```bash
git add apps/api/src/middleware/auth.ts
git commit -m "feat(api): optional auth middleware backed by seed user"
```

---

## Task 12: `auth` and `me` routes

**Files:**
- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/routes/me.ts`
- Create: `apps/api/src/lib/serialize.ts`
- Modify: `apps/api/src/index.ts` (mount routes)

- [ ] **Step 12.1: Write `apps/api/src/lib/serialize.ts`**

The DB column is `avatarKey`; the frontend expects `avatar`. Centralize the user-DTO mapping so every route returns the same shape.

```ts
import type { User } from '@prisma/client';

export type UserDTO = {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  credits: number;
};

export function serializeUser(u: User): UserDTO {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatar: u.avatarKey,
    credits: u.credits,
  };
}
```

- [ ] **Step 12.2: Write `apps/api/src/routes/auth.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { serializeUser } from '../lib/serialize.js';
import { AppError } from '@oneness/shared/errors';

const SEED_USER_EMAIL = '1280165525@qq.com';

const LoginSchema = z.object({
  email: z.string().email(),
  code: z.string().min(1),
});

export const authRoutes = new Hono();

authRoutes.post('/auth/login', zValidator('json', LoginSchema), async (c) => {
  // Mock auth: accepts any email/code, returns seed user.
  const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
  if (!user) throw AppError.internal('Seed user not found. Run `pnpm db:seed`.');
  const token = `mock_token_${Date.now()}`;
  return c.json({ token, user: serializeUser(user) });
});

authRoutes.post('/auth/logout', (c) => c.body(null, 204));
```

- [ ] **Step 12.3: Write `apps/api/src/routes/me.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { serializeUser } from '../lib/serialize.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';

const UpdateMeSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
});

export const meRoutes = new Hono();

// GET /api/me returns the user if logged-in, otherwise null (matches existing
// frontend mock behavior so the LoggedIn/LoggedOut UI states keep working).
meRoutes.get('/me', tryReadUser, (c) => {
  const user = c.var.user;
  if (!user) return c.json(null);
  return c.json(serializeUser(user));
});

meRoutes.patch('/me', tryReadUser, requireUser, zValidator('json', UpdateMeSchema), async (c) => {
  const user = c.var.user!;
  const data = c.req.valid('json');
  const updated = await prisma.user.update({ where: { id: user.id }, data });
  return c.json(serializeUser(updated));
});
```

- [ ] **Step 12.4: Mount routes in `apps/api/src/index.ts`**

Replace the contents of `apps/api/src/index.ts` with:

```ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import { logger } from '@oneness/shared/logger';
import { corsMiddleware } from './middleware/cors.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import './types/hono-env.js';

const app = new Hono();

app.use('*', corsMiddleware);
app.use('*', requestIdMiddleware);
app.onError(errorHandler);

app.route('/api', authRoutes);
app.route('/api', meRoutes);

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port }, 'API server started');
});
```

- [ ] **Step 12.5: Smoke test the auth + me flow**

Run:
```bash
pnpm --filter api dev &
sleep 5

echo "--- GET /api/me without auth (expect null) ---"
curl -s http://localhost:4000/api/me

echo
echo "--- POST /api/auth/login ---"
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"any@example.com","code":"123456"}' \
  | tee /dev/stderr \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
echo "TOKEN=$TOKEN"

echo
echo "--- GET /api/me with token (expect seed user) ---"
curl -s http://localhost:4000/api/me -H "authorization: Bearer $TOKEN"

echo
echo "--- PATCH /api/me name ---"
curl -s -X PATCH http://localhost:4000/api/me \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"name":"黄昱舟-改名"}'

echo
echo "--- PATCH /api/me without auth (expect 401) ---"
curl -s -i -X PATCH http://localhost:4000/api/me \
  -H 'content-type: application/json' \
  -d '{"name":"x"}' | head -n 1

echo
echo "--- restore the seed user name ---"
curl -s -X PATCH http://localhost:4000/api/me \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"name":"黄昱舟"}'
echo

kill %1 2>/dev/null
```

Expected output, in order:
- `null`
- A JSON object containing `"token":"mock_token_<digits>"` and `"user":{...,"name":"黄昱舟",...}`
- A JSON object equal to the user from login
- A JSON object with `"name":"黄昱舟-改名"`
- `HTTP/1.1 401 Unauthorized`
- Final patch returns the user with name back to `"黄昱舟"`

- [ ] **Step 12.6: Commit**

```bash
git add apps/api/src/routes/ apps/api/src/lib/serialize.ts apps/api/src/index.ts
git commit -m "feat(api): /auth/login, /auth/logout, GET/PATCH /me (mock auth)"
```

---

## Task 13: Health, ready, and metrics routes

**Files:**
- Create: `apps/api/src/routes/health.ts`
- Modify: `apps/api/src/index.ts` (mount)

- [ ] **Step 13.1: Write `apps/api/src/routes/health.ts`**

```ts
import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { minioClient } from '../lib/minio.js';

export const healthRoutes = new Hono();

type CheckResult = 'ok' | 'error';

async function check(fn: () => Promise<unknown>): Promise<CheckResult> {
  try {
    await fn();
    return 'ok';
  } catch {
    return 'error';
  }
}

healthRoutes.get('/_health', async (c) => {
  const [database, redisRes, minio] = await Promise.all([
    check(() => prisma.$queryRaw`SELECT 1`),
    check(() => redis.ping()),
    check(() => minioClient.listBuckets()),
  ]);
  const ok = database === 'ok' && redisRes === 'ok' && minio === 'ok';
  return c.json(
    { status: ok ? 'ok' : 'degraded', checks: { database, redis: redisRes, minio } },
    ok ? 200 : 503,
  );
});

healthRoutes.get('/_ready', (c) => c.json({ status: 'ready' }));

healthRoutes.get('/metrics', (c) =>
  c.json(
    { error: { code: 'NOT_IMPLEMENTED', message: 'wire prom-client here' } },
    501,
  ),
);
```

- [ ] **Step 13.2: Mount in `apps/api/src/index.ts`**

Add the import and `app.route` line. The file becomes:

```ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import { logger } from '@oneness/shared/logger';
import { corsMiddleware } from './middleware/cors.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { healthRoutes } from './routes/health.js';
import './types/hono-env.js';

const app = new Hono();

app.use('*', corsMiddleware);
app.use('*', requestIdMiddleware);
app.onError(errorHandler);

app.route('/api', healthRoutes);
app.route('/api', authRoutes);
app.route('/api', meRoutes);

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port }, 'API server started');
});
```

- [ ] **Step 13.3: Smoke test**

Run:
```bash
pnpm --filter api dev &
sleep 5

echo "--- _health ---"
curl -s http://localhost:4000/api/_health

echo
echo "--- _ready ---"
curl -s http://localhost:4000/api/_ready

echo
echo "--- /metrics ---"
curl -s -i http://localhost:4000/api/metrics | head -n 1
curl -s http://localhost:4000/api/metrics

echo

kill %1 2>/dev/null
```

Expected:
- `_health`: `{"status":"ok","checks":{"database":"ok","redis":"ok","minio":"ok"}}`
- `_ready`: `{"status":"ready"}`
- `metrics`: status line `HTTP/1.1 501 Not Implemented` and body `{"error":{"code":"NOT_IMPLEMENTED","message":"wire prom-client here"}}`

- [ ] **Step 13.4: Commit**

```bash
git add apps/api/src/routes/health.ts apps/api/src/index.ts
git commit -m "feat(api): _health/_ready/metrics endpoints"
```

---

## Task 14: Integration test for health endpoints

**Files:**
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/tests/integration/health.test.ts`

This task installs vitest, sets up an integration test that starts the Hono app against real Postgres/Redis/MinIO running in docker compose, and verifies the health endpoint returns 200. Establishes the testing pattern for later plans.

- [ ] **Step 14.1: Write `apps/api/vitest.config.ts`**

The integration test boots up the real `apps/api/src/lib/{prisma,redis,minio}.ts` modules, which load `config.ts` and require env vars like `DATABASE_URL` and `INTERNAL_SECRET`. We use `loadEnv` to pull them from the repo-root `.env` so `pnpm test` works without manual `dotenv` wrapping.

```ts
import { defineConfig, loadEnv } from 'vitest/config';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../..');
const env = loadEnv('', repoRoot, '');

export default defineConfig({
  test: {
    include: ['src/**/*.unit.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    env,
  },
});
```

- [ ] **Step 14.2: Create `apps/api/tests/integration/health.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { healthRoutes } from '../../src/routes/health.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';

describe('GET /api/_health', () => {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.onError(errorHandler);
  app.route('/api', healthRoutes);

  beforeAll(async () => {
    // Touch the connections so the first test does not include cold-start time.
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

  it('returns 200 with all checks "ok" when infra is up', async () => {
    const res = await app.request('/api/_health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: 'ok',
      checks: { database: 'ok', redis: 'ok', minio: 'ok' },
    });
  });

  it('_ready returns 200', async () => {
    const res = await app.request('/api/_ready');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready' });
  });

  it('/metrics returns 501', async () => {
    const res = await app.request('/api/metrics');
    expect(res.status).toBe(501);
  });
});
```

- [ ] **Step 14.3: Make sure infra is running**

Run:
```bash
pnpm infra:up
docker compose -f docker/docker-compose.yml ps
```

Expected: postgres/redis/minio all `(healthy)`.

- [ ] **Step 14.4: Run the test**

Run:
```bash
pnpm --filter api test
```

Expected:
- 3 tests pass
- Exit code 0

- [ ] **Step 14.5: Commit**

```bash
git add apps/api/vitest.config.ts apps/api/tests/
git commit -m "test(api): integration test for health endpoints"
```

---

## Task 15: End-to-end dev workflow verification

**Files:** none — verification of the full `pnpm dev` flow.

- [ ] **Step 15.1: Stop any leftover dev servers and infra**

Run:
```bash
pkill -f 'tsx watch' 2>/dev/null
pkill -f 'next dev'  2>/dev/null
pnpm infra:down
```

- [ ] **Step 15.2: Start fresh via the one command**

Run in a separate terminal or in background:
```bash
pnpm dev > /tmp/oneness-dev.log 2>&1 &
DEV_PID=$!
echo "DEV_PID=$DEV_PID"
sleep 25
```

The `dev` script runs `pnpm infra:up && concurrently pnpm dev:api pnpm dev:web`. We give it 25s to let containers go healthy, migrations be already applied, both servers start.

- [ ] **Step 15.3: Verify all four endpoints work**

Run:
```bash
echo "--- web at :3000 ---"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000

echo "--- api _health at :4000 ---"
curl -s http://localhost:4000/api/_health

echo "--- api me (no auth) ---"
curl -s http://localhost:4000/api/me

echo "--- api login then me ---"
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"any@example.com","code":"x"}' \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -s http://localhost:4000/api/me -H "authorization: Bearer $TOKEN"
echo
```

Expected:
- `200` (web)
- `{"status":"ok","checks":{...}}`
- `null`
- `{"id":"...","email":"1280165525@qq.com","name":"黄昱舟",...}`

- [ ] **Step 15.4: Tear down**

Run:
```bash
kill $DEV_PID 2>/dev/null
pkill -f 'tsx watch' 2>/dev/null
pkill -f 'next dev'  2>/dev/null
pnpm infra:down
```

- [ ] **Step 15.5: Update README with bootstrap instructions**

Append the following section to `README.md` (do not replace existing content):

```markdown

---

## Backend (Plan 1: Foundation)

### Prerequisites
- Node 22+ / Docker Desktop or compatible
- `corepack enable && corepack prepare pnpm@9.12.0 --activate`

### First run
```bash
pnpm install
cp .env.example .env
pnpm infra:up         # docker: postgres + redis + minio + bucket init
pnpm db:migrate       # apply Prisma migrations
pnpm db:seed          # seed user / projects / characters / scenes from mock data
pnpm dev              # starts infra + api (4000) + web (3000)
```

Visit:
- Web: http://localhost:3000
- API health: http://localhost:4000/api/_health
- MinIO console: http://localhost:9001 (oneness / oneness-secret)
- Prisma Studio: `pnpm db:studio`

### Daily commands
- `pnpm infra:up` / `pnpm infra:down` — start/stop docker services
- `pnpm db:reset` — wipe the database and re-run migrations + seed
- `pnpm --filter api test` — run API integration tests (needs infra up)
```

Run:
```bash
cat >> README.md <<'EOF'

---

## Backend (Plan 1: Foundation)

### Prerequisites
- Node 22+ / Docker Desktop or compatible
- `corepack enable && corepack prepare pnpm@9.12.0 --activate`

### First run
```bash
pnpm install
cp .env.example .env
pnpm infra:up         # docker: postgres + redis + minio + bucket init
pnpm db:migrate       # apply Prisma migrations
pnpm db:seed          # seed user / projects / characters / scenes from mock data
pnpm dev              # starts infra + api (4000) + web (3000)
```

Visit:
- Web: http://localhost:3000
- API health: http://localhost:4000/api/_health
- MinIO console: http://localhost:9001 (oneness / oneness-secret)
- Prisma Studio: `pnpm db:studio`

### Daily commands
- `pnpm infra:up` / `pnpm infra:down` — start/stop docker services
- `pnpm db:reset` — wipe the database and re-run migrations + seed
- `pnpm --filter api test` — run API integration tests (needs infra up)
EOF
```

- [ ] **Step 15.6: Final commit**

```bash
git add README.md
git commit -m "docs: README backend bootstrap section for Plan 1"
```

- [ ] **Step 15.7: Final type-check across the whole workspace**

Run:
```bash
pnpm typecheck
```

Expected: every workspace package passes (web, api, @oneness/shared). Exit 0.

---

## Done

After Task 15 you have:
- A monorepo with `apps/web`, `apps/api`, `packages/shared`
- Postgres + Redis + MinIO running locally via `pnpm infra:up`
- Prisma schema migrated and seeded with the original mock data
- Hono API serving `/api/_health`, `/api/_ready`, `/api/metrics`, `/api/auth/login`, `/api/auth/logout`, `/api/me`
- Request-id middleware, structured pino logging, AppError model
- Integration test pattern established
- `pnpm dev` brings everything up

**Next plan:** Plan 2 will add the resource CRUD routes (projects, characters, items, scenes, episodes, knowledge-docs), the MinIO upload proxy, and the analytics aggregation.
