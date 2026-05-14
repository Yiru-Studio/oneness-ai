# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start everything (infra + api + worker + web)
pnpm dev

# Individual services
pnpm dev:api        # API on :4000
pnpm dev:worker     # BullMQ worker
pnpm dev:web        # Next.js on :3000

# Infrastructure (Postgres + Redis + MinIO)
pnpm infra:up
pnpm infra:down

# Database
pnpm db:migrate     # run pending Prisma migrations
pnpm db:seed        # seed 1 user / 2 projects / 9 chars / 16 scenes
pnpm db:reset       # wipe + re-migrate + re-seed
pnpm db:studio      # Prisma Studio UI

# Tests (integration only — requires infra up)
pnpm --filter api test                                  # run all API tests
pnpm --filter api test:watch                            # watch mode
pnpm --filter api exec vitest run tests/integration/tasks.test.ts   # single file
pnpm --filter api exec vitest run -t "creates a task"   # single test by name

# Type checking and linting
pnpm typecheck       # all packages (recursive `tsc --noEmit`)
pnpm lint            # only apps/web defines `lint` (eslint); api/worker have none

# Production-style builds
pnpm --filter api build && pnpm --filter api start
pnpm --filter worker build && pnpm --filter worker start
pnpm --filter web build && pnpm --filter web start

# Docker (production-like full stack)
docker compose -f docker/docker-compose.yml --profile full up --build
```

Tests live in `apps/api/tests/integration/`. There are no unit tests yet. The vitest config (`apps/api/vitest.config.ts`) auto-loads `.env` / `.env.local` from the repo root, so tests pick up `DATABASE_URL` etc. without manual dotenv wrapping. Test files follow the pattern `tests/integration/**/*.test.ts`; unit tests would use `src/**/*.unit.test.ts`. CI (`.github/workflows/ci.yml`) spins up postgres/redis/minio as services and runs `pnpm typecheck` + `pnpm --filter api test` against them.

## Architecture

This is a **pnpm monorepo** (`pnpm-workspace.yaml`) with three apps and one shared package:

```
packages/shared/   — Prisma schema/client, Zod schemas, enums, errors, queues, pricing, provider types
apps/api/          — Hono 4 REST API (Node 22)
apps/worker/       — BullMQ worker for AI task processing
apps/web/          — Next.js 16 frontend (React 19, Tailwind v4)
```

### Shared package (`@oneness/shared`)

The shared package is the single source of truth for cross-cutting concerns. Key exports:

- `@oneness/shared/prisma` — singleton PrismaClient
- `@oneness/shared/schemas` — Zod schemas used for request validation in the API
- `@oneness/shared/enums` — `TaskType`, `TaskStatus`, `KnowledgeDocType`, `AnalysisStatus`
- `@oneness/shared/queues` — queue names, concurrency config, `queueForTaskType()`
- `@oneness/shared/pricing` — `estimateCost()` and credit estimate table
- `@oneness/shared/providers` — `ImageProvider`, `VideoProvider`, `TextProvider` interfaces + `ProviderContext`/`ProviderResult` types
- `@oneness/shared/errors` — `AppError` with static factory methods; `ErrorCodes` constants

### API (`apps/api`)

Hono app with middleware → route modules structure. Route files add their own `tryReadUser` / `requireUser` middleware per-route rather than globally. All routes are mounted at `/api`.

**Serializers** (`src/serializers/`) convert Prisma rows to API responses. For any entity that has an `assetId` or asset relation, the serializer generates presigned MinIO GET URLs (1-hour expiry) before returning.

**Auth** is currently a stub: any `Bearer <anything>` header resolves to the seed user (`1280165525@qq.com`). Real token verification slots into `src/middleware/auth.ts` without touching route handlers.

### Task pipeline

1. `POST /api/tasks` — validates credits, reserves cost atomically in a Prisma transaction, creates the `Task` row at `QUEUED`, then enqueues a BullMQ job with just `{ taskId }`.
2. Worker (`apps/worker/src/processor.ts`) re-reads the row, claims it (`QUEUED → RUNNING`), calls the provider, then transitions to `SUCCEEDED`/`FAILED` and persists output assets to MinIO.
3. Cancel: API sets `CANCELLED`. For `QUEUED` tasks it refunds immediately and removes the BullMQ job. For `RUNNING` tasks it sets `CANCELLED` and the worker detects it via a 1s poll, then refunds on the next cycle.

Three BullMQ queues: `ai-image` (concurrency 4), `ai-video` (1), `ai-text` (4).

### Provider system

Provider implementations live in `apps/worker/src/providers/`. Only `stub` is registered. To add a real provider:

1. Implement `ImageProvider | VideoProvider | TextProvider` from `@oneness/shared/providers`.
2. Register it in `apps/worker/src/providers/registry.ts`.
3. Set `PROVIDER_IMAGE=<name>` (or `VIDEO` / `TEXT`) in `.env`.

`TextProvider` uses an `analyze()` method instead of `generate()`. The processor dispatches to the right method based on `providerKindOf(task.type)`.

### Frontend (`apps/web`)

Next.js App Router. All API calls go through `src/lib/api-client.ts` (`apiFetch`) which reads `auth_token` from `localStorage` and adds `Authorization: Bearer <token>`. `AuthContext` (`src/contexts/AuthContext.tsx`) wraps the app and provides `useAuthContext()`.

## Key env vars

| Variable | Default |
|---|---|
| `DATABASE_URL` | `postgresql://oneness:oneness@localhost:5432/oneness` |
| `REDIS_URL` | `redis://localhost:6379` |
| `MINIO_ENDPOINT` | `http://localhost:9000` |
| `PROVIDER_IMAGE/VIDEO/TEXT` | `stub` |
| `STUB_FAIL_RATE` | `0.1` (set `0` for deterministic dev) |
| `INTERNAL_SECRET` | shared secret for `/api/internal/*` callbacks |

The `PATCH /api/internal/tasks/:id` endpoint authenticates via `X-Internal-Secret` header only — it is not user-scoped and intentionally bypasses the normal `tryReadUser`/`requireUser` middleware chain.

## Conventions worth knowing

- **Root scripts wrap with `dotenv-cli`.** `pnpm dev:api`, `dev:worker`, and all `db:*` scripts are invoked via `dotenv -e .env --` from `package.json`. Child packages (`apps/api`, `apps/worker`, `packages/shared`) therefore do **not** load `.env` themselves — running `pnpm --filter api dev` directly will start without env vars. Use the root scripts, or vitest (which has its own loader in `apps/api/vitest.config.ts`).
- **`@oneness/shared` is consumed via TS source, not built artifacts.** Its `package.json` `exports` map points directly at `./src/*.ts`. Editing shared code is picked up immediately by `tsx watch` in api/worker; there is no `build` step for the shared package.
- **Prisma client lives in shared.** Run `pnpm db:generate` (or any `db:migrate` / `db:reset`) after changing `packages/shared/prisma/schema.prisma` so the generated client updates.
- **Web `lint` is eslint-only and scoped to `apps/web`.** `apps/api` and `apps/worker` rely on `pnpm typecheck` for static checks.
