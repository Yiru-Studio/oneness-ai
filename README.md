# Oneness-AI

Professional AI film/animation creation platform. Reverse-engineered UI from likeai.pro with a real backend supporting full CRUD, MinIO-backed assets, and an extensible AI task pipeline.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 · React 19 · Tailwind v4 · TypeScript strict |
| API | Hono 4 on Node 22 |
| Worker | BullMQ + stub providers (swap in real models) |
| DB | Postgres 16 via Prisma 5 |
| Object storage | MinIO (S3-compatible) |
| Queue | Redis 7 + BullMQ |

## Quick start

```bash
corepack enable && corepack prepare pnpm@9.12.0 --activate
pnpm install
cp .env.example .env       # adjust if needed
pnpm infra:up              # postgres + redis + minio + bucket init
pnpm db:migrate            # create tables
pnpm db:seed               # 1 user / 2 projects / 9 chars / 16 scenes
pnpm dev                   # api :4000 + worker + web :3000
```

Open `http://localhost:3000` and log in with any email + code — you'll be acting as the seed user.

### Useful URLs

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API health | http://localhost:4000/api/_health |
| MinIO console | http://localhost:9001 (oneness / oneness-secret) |
| Prisma Studio | `pnpm db:studio` |

## Daily commands

```bash
pnpm infra:up / infra:down   # start/stop docker services
pnpm db:reset                # wipe db + re-run migrations + seed
pnpm --filter api test       # API integration tests (needs infra up)
pnpm dev:worker              # worker only
```

## Environment variables

See `.env.example` for all variables. Key ones:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://oneness:oneness@localhost:5432/oneness` | Postgres connection |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ / queue |
| `MINIO_ENDPOINT` | `http://localhost:9000` | Object storage |
| `PROVIDER_IMAGE` | `stub` | Image generation provider |
| `PROVIDER_VIDEO` | `stub` | Video generation provider |
| `PROVIDER_TEXT` | `stub` | Text generation provider |
| `STUB_FAIL_RATE` | `0.1` | Stub failure rate (set `0` for deterministic dev) |
| `INTERNAL_SECRET` | — | Shared secret for `/api/internal/*` callbacks |

## Plugging in a real AI provider

Provider implementations live in `apps/worker/src/providers/`. The default is `stub`.

1. Implement `ImageProvider | VideoProvider | TextProvider` from `@oneness/shared/providers`.
2. Register it in `apps/worker/src/providers/registry.ts`.
3. Set `PROVIDER_IMAGE=<name>` (or `VIDEO` / `TEXT`) in `.env`.
4. Restart the worker — the API stays up.

Credits are reserved at enqueue time and refunded automatically on `FAILED` or `CANCELLED`. `Project.analytics` reflects this in real time.

## API reference

### Projects

```
GET    /api/projects               paginated, ?search=
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id
GET    /api/projects/:id/analytics
```

### Characters & styles

```
GET    /api/projects/:id/characters
POST   /api/projects/:id/characters
GET    /api/characters/:id
PATCH  /api/characters/:id
DELETE /api/characters/:id

POST   /api/characters/:id/styles
PATCH  /api/character-styles/:id
DELETE /api/character-styles/:id
```

### Items, scenes, episodes

```
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
```

### Knowledge docs

```
GET    /api/knowledge-docs         ?type=CREATED|FAVORITED|COLLABORATED, paginated
POST   /api/knowledge-docs
GET    /api/knowledge-docs/:id
PATCH  /api/knowledge-docs/:id
DELETE /api/knowledge-docs/:id
```

### Assets

```
POST   /api/assets                 multipart/form-data, file field
DELETE /api/assets/:id
```

Asset URLs in responses are presigned MinIO GET URLs (1-hour expiry). Pass `Bearer <token>` in `Authorization` to act as the seed user.

### Tasks

```
POST   /api/tasks                         discriminated union on type
GET    /api/tasks/:id                     poll status
GET    /api/tasks?type=&status=&cursor=   cursor-paginated list
POST   /api/tasks/:id/cancel
PATCH  /api/internal/tasks/:id            external workflow callback (X-Internal-Secret)
```

Three BullMQ queues: `ai-image` (concurrency 4), `ai-video` (1), `ai-text` (4).

## Docker (production-like)

```bash
docker compose -f docker/docker-compose.yml up --profile full --build
```

See `docker/docker-compose.yml` and `docker/api.Dockerfile` / `docker/worker.Dockerfile` for details.
