# Plan 4 / Frontend Switch + Closure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the frontend over to the real backend. Replace every mock function in `apps/web/src/lib/api.ts` with real HTTP calls to `http://localhost:4000/api/*`, wire token storage + Authorization header, verify the full app loads with real Postgres data. Add Dockerfiles for `apps/api` + `apps/worker` so `pnpm dev:full` can boot everything inside docker compose, sample CI workflow, and close out with a polished README. After this plan: open `http://localhost:3000`, log in (any email+code), see the 2 seed projects with the 9 characters / 6 items / 16 scenes / 1 episode from Postgres, not from `mock.ts`.

**Architecture:** New `apps/web/src/lib/api-client.ts` is the single fetch wrapper — handles `NEXT_PUBLIC_API_BASE_URL`, injects `Authorization: Bearer <token>` from localStorage, unwraps `{ error: { code, message } }` envelopes into a thrown `ApiError`. `apps/web/src/lib/api.ts` is rewritten function-by-function to call `apiFetch(...)` and adapt response shapes (e.g. unwrap paginated `{ items, total }` to flat arrays where the frontend currently expects arrays). The `mock.ts` file stays untouched (it's the seed source for `packages/shared/prisma/seed.ts`), but nothing in production frontend code imports it anymore.

**Tech Stack:** No new deps in frontend. Container layer adds nothing runtime — only Dockerfile build assets.

**Linked spec:** `docs/superpowers/specs/2026-05-14-backend-design.md` (§8 Dev workflow, §9 frontend switch path).

**Depends on:** Plans 1 + 2 + 3 fully complete. All resource routes + assets upload + task system live. `STUB_FAIL_RATE=0` in `.env` for deterministic verification (Plan 3 Group B left it there).

**Out of scope:**
- Real AI provider integration (user supplies later)
- SSE / WebSocket task push (polling stays in place)
- Email/SMTP for real verification codes (mock auth stays — any email + code logs in as seed user)
- Frontend visual redesign — UI stays as-is; only data source changes

**Conventions:**
- `apps/web/src/lib/api.ts` keeps its current public signature so callers don't change. Internals swap from mock to fetch.
- All errors surface to callers as `ApiError` (thrown). Pages already wrap calls in try/catch or `.then(...)`; rejections propagate normally.
- `getCurrentUser()` returns `null` when there's no token (matches today's mock behaviour) — preserves the logged-out UX.
- Pagination: backend returns `{ items, total, page, pageSize }` for projects / knowledge-docs; frontend api.ts unwraps to `.items` because the existing UI doesn't render page controls. The pagination meta is silently discarded (callers don't need it yet — leave that hook for later).

---

## Task 1: Frontend API client wrapper

**Files:**
- Create: `apps/web/src/lib/api-client.ts`

Single source of truth for the `fetch` call. Handles base URL, auth header, error envelope.

- [x] **Step 1.1: Write `apps/web/src/lib/api-client.ts`**

```ts
const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type FetchOpts = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;          // JSON-serialisable (or FormData — see formData option below)
  formData?: FormData;     // when set, body is ignored; multipart upload
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
};

function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('auth_token');
}

function buildQuery(q: FetchOpts['query']): string {
  if (!q) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export async function apiFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const token = readToken();
  const headers: Record<string, string> = { ...opts.headers };
  if (token) headers['authorization'] = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData; // browser sets Content-Type with boundary
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const url = `${BASE_URL}${path}${buildQuery(opts.query)}`;
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body,
    credentials: 'include',
  });

  if (res.status === 204) return undefined as T;

  let parsed: unknown = null;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    parsed = await res.json();
  } else {
    parsed = await res.text();
  }

  if (!res.ok) {
    if (
      parsed &&
      typeof parsed === 'object' &&
      'error' in parsed &&
      parsed.error &&
      typeof (parsed.error as { code?: unknown }).code === 'string'
    ) {
      const err = (parsed as { error: { code: string; message: string; details?: unknown } }).error;
      throw new ApiError(err.code, err.message, res.status, err.details);
    }
    throw new ApiError('UNKNOWN', `${res.status} ${res.statusText}`, res.status, parsed);
  }

  return parsed as T;
}

export function setAuthToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token === null) window.localStorage.removeItem('auth_token');
  else window.localStorage.setItem('auth_token', token);
}
```

- [x] **Step 1.2: Typecheck**

```bash
pnpm --filter web typecheck
```

Expected: exits 0.

- [x] **Step 1.3: Commit**

```bash
git add apps/web/src/lib/api-client.ts
git commit -m "feat(web): apiFetch wrapper with auth header + error envelope handling"
```

---

## Task 2: Rewrite `apps/web/src/lib/api.ts`

Map every existing function to a backend call. Keep public signatures unchanged (so AuthContext / pages don't move). Unwrap paginated responses to arrays.

**Files:**
- Modify (full rewrite): `apps/web/src/lib/api.ts`

- [x] **Step 2.1: Replace `apps/web/src/lib/api.ts` with the full implementation below**

```ts
import {
  User,
  Project,
  KnowledgeDoc,
  Character,
  Item,
  Scene,
  StoryboardEpisode,
  AnalyticsData,
} from '@/types';
import { apiFetch, setAuthToken, ApiError } from './api-client';

// -- Types received from backend ----------------------------------------

type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
type ProjectDTO = Project; // backend serializer matches the frontend Project shape
type CharacterDTO = Character;
type ItemDTO = Item;
type SceneDTO = Scene;
type EpisodeDTO = StoryboardEpisode;
type KnowledgeDocDTO = KnowledgeDoc;
type UserDTO = User;
type AnalyticsDTO = AnalyticsData;

// -- Auth ----------------------------------------------------------------

export async function getCurrentUser(): Promise<User | null> {
  try {
    return await apiFetch<UserDTO | null>('/api/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export async function login(email: string, code: string): Promise<{ token: string }> {
  const res = await apiFetch<{ token: string; user: UserDTO }>('/api/auth/login', {
    method: 'POST',
    body: { email, code },
  });
  setAuthToken(res.token);
  return { token: res.token };
}

export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/api/auth/logout', { method: 'POST' });
  } finally {
    setAuthToken(null);
  }
}

export async function updateProfile(data: Partial<User>): Promise<User> {
  const payload: { name?: string; email?: string } = {};
  if (data.name !== undefined) payload.name = data.name;
  if (data.email !== undefined) payload.email = data.email;
  return await apiFetch<UserDTO>('/api/me', { method: 'PATCH', body: payload });
}

// -- Projects -----------------------------------------------------------

export async function getProjects(search?: string): Promise<Project[]> {
  const res = await apiFetch<Paged<ProjectDTO>>('/api/projects', {
    query: { search },
  });
  return res.items;
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    return await apiFetch<ProjectDTO>(`/api/projects/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function createProject(
  data: Omit<Project, 'id' | 'createdAt'>,
): Promise<Project> {
  return await apiFetch<ProjectDTO>('/api/projects', { method: 'POST', body: data });
}

export async function deleteProject(id: string): Promise<void> {
  await apiFetch<void>(`/api/projects/${id}`, { method: 'DELETE' });
}

// -- Project sub-resources ---------------------------------------------

export async function getProjectCharacters(projectId: string): Promise<Character[]> {
  return await apiFetch<CharacterDTO[]>(`/api/projects/${projectId}/characters`);
}

export async function getProjectItems(projectId: string): Promise<Item[]> {
  return await apiFetch<ItemDTO[]>(`/api/projects/${projectId}/items`);
}

export async function getProjectScenes(projectId: string): Promise<Scene[]> {
  return await apiFetch<SceneDTO[]>(`/api/projects/${projectId}/scenes`);
}

export async function getProjectStoryboard(
  projectId: string,
): Promise<StoryboardEpisode[]> {
  return await apiFetch<EpisodeDTO[]>(`/api/projects/${projectId}/episodes`);
}

export async function getProjectAnalytics(projectId: string): Promise<AnalyticsData> {
  return await apiFetch<AnalyticsDTO>(`/api/projects/${projectId}/analytics`);
}

// -- Knowledge docs -----------------------------------------------------

export async function getKnowledgeDocs(type: string): Promise<KnowledgeDoc[]> {
  // Backend expects uppercase enum; current callers pass 'created'/'favorited'/'collaborated'
  const upper = type.toUpperCase();
  const res = await apiFetch<Paged<KnowledgeDocDTO>>('/api/knowledge-docs', {
    query: { type: upper },
  });
  return res.items;
}

// -- Asset upload (helper for future avatar/style uploads) -------------

export type AssetDTO = {
  id: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

export async function uploadAsset(file: File): Promise<AssetDTO> {
  const fd = new FormData();
  fd.append('file', file);
  return await apiFetch<AssetDTO>('/api/assets', { method: 'POST', formData: fd });
}

export async function deleteAsset(id: string): Promise<void> {
  await apiFetch<void>(`/api/assets/${id}`, { method: 'DELETE' });
}

// -- Re-export for callers that want to introspect errors -------------

export { ApiError };
```

> **Note on removed function**: `getProjectTabContent` from the old mock returned an empty `{ tab, content }` object and was a placeholder. It's not exported here. If any caller imports it, fix the caller (Task 4 covers this).

- [x] **Step 2.2: Typecheck**

```bash
pnpm --filter web typecheck
```

If `getProjectTabContent` was imported somewhere, this will fail with a clear message. That's expected — move to Task 4.

If typecheck passes outright, no callers used it; skip the import-cleanup part of Task 4 but still update env / verify.

- [x] **Step 2.3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): rewrite src/lib/api.ts to call real backend via apiFetch"
```

---

## Task 3: Frontend env wiring

**Files:**
- Create: `apps/web/.env.local` (or update existing) with `NEXT_PUBLIC_API_BASE_URL`
- Modify: `.env.example` (root) — already has it from Plan 1, just verify

- [x] **Step 3.1: Confirm root `.env.example` already lists `NEXT_PUBLIC_API_BASE_URL`**

Run:
```bash
grep NEXT_PUBLIC_API_BASE_URL .env.example
```

Expected: line `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`. If not present, add it.

- [x] **Step 3.2: Create `apps/web/.env.local`**

Next.js reads `apps/web/.env.local` for local dev (and `.env.local` is gitignored by default in Next.js's gitignore — confirm with `git status` after creating).

```bash
cat > apps/web/.env.local <<'EOF'
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
EOF
```

- [x] **Step 3.3: Verify gitignore covers it**

Run:
```bash
git status --short | grep .env.local || echo "not tracked"
```

Expected: prints `not tracked`. If `apps/web/.env.local` appears in `git status`, add a line to root `.gitignore`:
```
apps/web/.env.local
```
Then re-check.

- [x] **Step 3.4: Commit if anything changed**

```bash
git status --short
# If .gitignore was modified:
git add .gitignore .env.example
git commit -m "chore: ensure apps/web/.env.local is gitignored"
```

(If nothing tracked changed — skip the commit.)

---

## Task 4: Clean up stale `getProjectTabContent` references (if any)

**Files:** likely no changes needed — depends on Task 2.2 result.

- [x] **Step 4.1: Search for any remaining import of `getProjectTabContent`**

```bash
grep -rn "getProjectTabContent" apps/web/src 2>/dev/null || echo "no references"
```

If output is `no references`, skip the rest of this task. If anything is listed, open each file and remove the import + any call site (it was a no-op anyway).

- [x] **Step 4.2: Type-check**

```bash
pnpm --filter web typecheck
```

Expected: exits 0.

- [x] **Step 4.3: Commit (only if files changed)**

```bash
git status --short
git add apps/web/src/...   # exact files based on what changed
git commit -m "chore(web): drop unused getProjectTabContent references"
```

If no changes, no commit.

---

## Task 5: Live verification — frontend ↔ real backend end-to-end

This is the proof Plan 4 is working. No code changes; runs the live stack and inspects what the user sees.

**Files:** none.

- [x] **Step 5.1: Reset DB to known state**

```bash
pkill -f 'tsx watch' 2>/dev/null
pkill -f 'next dev'   2>/dev/null
sleep 1
pnpm db:reset
pnpm db:seed
```

Expected: seed counts 1 user / 2 projects / 9 characters / 16 scenes / 1 episode.

- [x] **Step 5.2: Boot the whole stack**

```bash
pnpm dev > /tmp/oneness-dev.log 2>&1 &
DEV_PID=$!
echo "DEV_PID=$DEV_PID"
sleep 30   # api + worker + next dev all need to compile
```

- [x] **Step 5.3: Verify all three services responded**

```bash
echo "--- web ---"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000

echo "--- api ---"
curl -s http://localhost:4000/api/_health

echo "--- worker (via log) ---"
grep -c 'worker started' /tmp/oneness-dev.log || echo "missing"
```

Expected:
- web: 200
- api: `{"status":"ok",...}`
- worker: `3`

- [x] **Step 5.4: Simulate the login flow via the web layer**

The web page itself runs in a browser, but we can verify the API surface that the page uses:

```bash
# Token-less /api/me (should return null, matches getCurrentUser logged-out state)
echo "--- /api/me without token ---"
curl -s http://localhost:4000/api/me

# Login
echo
echo "--- /api/auth/login ---"
RESP=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"any@example.com","code":"123456"}')
echo "$RESP" | head -c 200
TOKEN=$(echo "$RESP" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

# /api/me with token
echo
echo "--- /api/me with token ---"
curl -s http://localhost:4000/api/me -H "authorization: Bearer $TOKEN"

# Projects (with token)
echo
echo "--- /api/projects ---"
curl -s http://localhost:4000/api/projects -H "authorization: Bearer $TOKEN" | head -c 400

# Project detail (first id)
PID=$(curl -s http://localhost:4000/api/projects -H "authorization: Bearer $TOKEN" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
echo
echo "--- characters of project $PID ---"
curl -s "http://localhost:4000/api/projects/$PID/characters" -H "authorization: Bearer $TOKEN" | head -c 400
```

Expected:
- `null` for unauthenticated /api/me
- Login returns `{ "token": "mock_token_...", "user": {...} }`
- Authenticated /me returns the seed user JSON
- /projects returns paged JSON with 2 items
- /projects/:id/characters returns 9-character array

- [x] **Step 5.5: Browser smoke (manual — required for full verification)**

This step requires opening a browser. Document the expected behaviour for the executor to check manually:

> Open `http://localhost:3000` in a browser.
> 1. Land on the home page. Logged-out state.
> 2. Click "登录". Modal opens. Type any email and any 6-digit code. Click verify.
> 3. Redirected to `/projects`. **You should see the 2 seed projects** (`格斗动画`, `格斗`) loaded from Postgres. (If you see "格斗动画" and "格斗" — that's the seed data; if you see anything else or "no projects", the backend isn't being called.)
> 4. Click into `格斗动画`. Project detail page loads.
> 5. Switch through tabs: 角色 (should show 9 characters), 物品 (6 items), 场景 (16 scenes), 分镜 (1 episode), 数据 (analytics with non-zero counts after Plan 3 smoke tasks).
> 6. Check browser DevTools Network panel: all data requests should go to `http://localhost:4000/api/*` not to a mock.

Record what you observe.

- [x] **Step 5.6: Tear down**

```bash
kill $DEV_PID 2>/dev/null
pkill -f 'tsx watch' 2>/dev/null
pkill -f 'next dev'   2>/dev/null
```

- [x] **Step 5.7: No commit (verification only).** If anything in 5.5 doesn't show real data, STOP and fix before proceeding.

---

## Task 6: Dockerfiles for api + worker

So the `--profile full` part of compose actually works.

**Files:**
- Create: `docker/api.Dockerfile`
- Create: `docker/worker.Dockerfile`
- Modify: `docker/docker-compose.yml` (uncomment / add the `api` + `worker` services under `profiles: ["full"]`)

- [x] **Step 6.1: Write `docker/api.Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /workspace

# ---- deps ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter @oneness/shared --filter api

# ---- builder ----
FROM deps AS builder
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm --filter @oneness/shared exec prisma generate
RUN pnpm --filter api build

# ---- runner ----
FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=builder /workspace/package.json ./
COPY --from=builder /workspace/pnpm-workspace.yaml ./
COPY --from=builder /workspace/pnpm-lock.yaml ./
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/packages/shared ./packages/shared
COPY --from=builder /workspace/apps/api ./apps/api
EXPOSE 4000
WORKDIR /workspace/apps/api
CMD ["sh", "-c", "pnpm --filter @oneness/shared exec prisma migrate deploy && node dist/index.js"]
```

- [x] **Step 6.2: Write `docker/worker.Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /workspace

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter @oneness/shared --filter worker

FROM deps AS builder
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker
RUN pnpm --filter @oneness/shared exec prisma generate
RUN pnpm --filter worker build

FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=builder /workspace/package.json ./
COPY --from=builder /workspace/pnpm-workspace.yaml ./
COPY --from=builder /workspace/pnpm-lock.yaml ./
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/packages/shared ./packages/shared
COPY --from=builder /workspace/apps/worker ./apps/worker
WORKDIR /workspace/apps/worker
CMD ["node", "dist/index.js"]
```

- [x] **Step 6.3: Update `docker/docker-compose.yml` — append `api` and `worker` services with `profiles: ["full"]`**

Append to the `services:` section of `docker/docker-compose.yml` (do NOT modify the existing services / volumes):

```yaml
  api:
    profiles: ["full"]
    build:
      context: ..
      dockerfile: docker/api.Dockerfile
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
      minio:    { condition: service_healthy }
    ports:
      - "4000:4000"
    env_file:
      - ../.env.docker

  worker:
    profiles: ["full"]
    build:
      context: ..
      dockerfile: docker/worker.Dockerfile
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    env_file:
      - ../.env.docker
```

- [x] **Step 6.4: Build smoke**

Make sure the regular infra is down first to free ports, then build the full profile (this will take 2-5 minutes the first time):

```bash
pnpm infra:down
docker compose -f docker/docker-compose.yml --profile full build api worker
```

Expected: builds succeed without errors. Final images are tagged `oneness-ai-api:latest` and `oneness-ai-worker:latest`.

- [x] **Step 6.5: Run the full profile end-to-end**

```bash
# Make sure .env.docker exists (Plan 1 should have set up .env.docker.example — copy it)
[ -f .env.docker ] || cp .env.docker.example .env.docker

docker compose -f docker/docker-compose.yml --profile full up -d
sleep 25   # let migrations run + workers boot

docker compose -f docker/docker-compose.yml --profile full ps
curl -s http://localhost:4000/api/_health
echo
```

Expected: `api` container `Up X seconds`, `_health` returns ok. **Note:** the `api` container will run `prisma migrate deploy` on first start; if migrations have already been applied to the postgres volume from prior `pnpm db:migrate`, the deploy is a no-op.

- [x] **Step 6.6: Tear down**

```bash
docker compose -f docker/docker-compose.yml --profile full down
```

- [x] **Step 6.7: Commit**

```bash
git add docker/api.Dockerfile docker/worker.Dockerfile docker/docker-compose.yml
git commit -m "feat(docker): Dockerfiles for api + worker, compose --profile full"
```

---

## Task 7: Sample CI workflow

Lean GitHub Actions config — pnpm install, docker compose infra, migrate + seed, typecheck, test.

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 7.1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: oneness
          POSTGRES_PASSWORD: oneness
          POSTGRES_DB: oneness
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U oneness"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
      minio:
        image: bitnami/minio:latest
        env:
          MINIO_ROOT_USER: oneness
          MINIO_ROOT_PASSWORD: oneness-secret
          MINIO_DEFAULT_BUCKETS: user-uploads,task-outputs
        ports: ["9000:9000"]

    env:
      DATABASE_URL: postgresql://oneness:oneness@localhost:5432/oneness?schema=public
      REDIS_URL: redis://localhost:6379
      MINIO_ENDPOINT: http://localhost:9000
      MINIO_ACCESS_KEY: oneness
      MINIO_SECRET_KEY: oneness-secret
      INTERNAL_SECRET: ci-internal-secret-change-me
      WEB_ORIGINS: http://localhost:3000
      LOG_LEVEL: warn
      STUB_FAIL_RATE: '0'
      NEXT_PUBLIC_API_BASE_URL: http://localhost:4000

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.0

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Wait for services to be healthy
        run: sleep 5

      - name: Prisma migrate + seed
        run: |
          pnpm db:migrate --name ci-init 2>/dev/null || \
            pnpm --filter @oneness/shared exec prisma migrate deploy
          pnpm db:seed

      - name: Typecheck
        run: pnpm typecheck

      - name: API tests
        run: pnpm --filter api test
```

> Note: `bitnami/minio` is used in CI because it auto-creates buckets via `MINIO_DEFAULT_BUCKETS`. The local docker-compose uses the official `minio/minio` image with a `minio-init` companion — different mechanisms, same outcome.

- [ ] **Step 7.2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: GitHub Actions check workflow (postgres + redis + minio + tests)"
```

---

## Task 8: README final polish

**Files:**
- Modify: `README.md` (replace early sections with Oneness-AI-specific intro; keep the AI-cloner template content below in a "Original template" section since the repo was forked from there)

- [ ] **Step 8.1: Read the current README**

```bash
head -60 README.md
```

Note: the current README still has the AI-website-cloner template text at the top followed by the Plan 1/2/3 sections appended below. We'll insert a clear project intro before the cloner content.

- [ ] **Step 8.2: Prepend a project intro to `README.md`**

This step puts a 30-line Oneness-AI-specific intro at the top of the README without losing existing content. Use a temp file:

```bash
NEW_INTRO=$(cat <<'EOF'
# Oneness-AI

Professional AI film/animation creation platform. Reverse-engineered UI from likeai.pro plus a real backend supporting full CRUD, MinIO-backed assets, and an extensible AI task pipeline.

## Stack

- **Frontend**: Next.js 16 + React 19 + Tailwind v4 + TypeScript strict (in `apps/web/`)
- **API**: Hono 4 on Node 22 (in `apps/api/`)
- **Worker**: BullMQ + stub providers, ready to swap in real models (in `apps/worker/`)
- **DB**: Postgres 16 via Prisma 5
- **Object storage**: MinIO (S3-compatible)
- **Queue**: Redis 7 + BullMQ

## Quick start

```bash
corepack enable && corepack prepare pnpm@9.12.0 --activate
pnpm install
cp .env.example .env       # adjust if needed
pnpm infra:up              # postgres + redis + minio + bucket init
pnpm db:migrate            # creates tables
pnpm db:seed               # 1 user / 2 projects / 9 chars / 16 scenes
pnpm dev                   # api :4000 + worker + web :3000
```

Open `http://localhost:3000`, log in with any email + code → you're the seed user.

## Plugging in a real AI provider

The worker exposes a clean port for image / video / text providers in `apps/worker/src/providers/`. Default is `stub`. To wire your own:

1. Implement `ImageProvider | VideoProvider | TextProvider` from `@oneness/shared/providers`.
2. Register it in `apps/worker/src/providers/registry.ts`.
3. Set `PROVIDER_IMAGE=<name>` (or VIDEO/TEXT) in `.env`.
4. Restart worker only — the API stays up.

Tasks flow through Redis queues. Credits are reserved at enqueue and refunded automatically on failure or cancel. `Project.analytics` reflects this live.

---

EOF
)
echo "$NEW_INTRO" > /tmp/new-readme.md
cat README.md >> /tmp/new-readme.md
mv /tmp/new-readme.md README.md
```

- [ ] **Step 8.3: Verify the README starts with the new intro**

```bash
head -20 README.md
```

Expected: starts with `# Oneness-AI`, then the stack list.

- [ ] **Step 8.4: Commit**

```bash
git add README.md
git commit -m "docs: README intro with project overview + provider plug-in guide"
```

---

## Task 9: Final verification — full suite

**Files:** none.

- [ ] **Step 9.1: Reset state cleanly**

```bash
pkill -f 'tsx watch' 2>/dev/null
pkill -f 'next dev'   2>/dev/null
sleep 1
pnpm infra:up
sleep 8
pnpm db:reset
pnpm db:seed
```

- [ ] **Step 9.2: Full typecheck across all 4 packages**

```bash
pnpm typecheck
```

Expected: 4 packages pass (web, api, worker, shared).

- [ ] **Step 9.3: Full backend test suite**

```bash
pnpm --filter api test
```

Expected: 42 passed.

- [ ] **Step 9.4: End-to-end through `pnpm dev`**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 30

echo "--- web :3000 ---"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000

echo "--- api _health ---"
curl -s http://localhost:4000/api/_health

echo "--- log: worker started ---"
grep -c 'worker started' /tmp/dev.log

echo "--- create and complete an image task ---"
T=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"x@x.com","code":"x"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
R=$(curl -s -X POST http://localhost:4000/api/tasks \
  -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"type":"IMAGE","provider":"stub","input":{"prompt":"final","ratio":"1:1","model":"stub","n":1}}')
TID=$(echo "$R" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
for i in $(seq 1 12); do
  S=$(curl -s http://localhost:4000/api/tasks/$TID -H "authorization: Bearer $T" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  echo "  $i: $S"
  case "$S" in SUCCEEDED|FAILED|CANCELLED) break ;; esac
  sleep 1
done

kill $DEV_PID 2>/dev/null
pkill -f 'tsx watch' 2>/dev/null
pkill -f 'next dev'   2>/dev/null
```

Expected:
- web: 200
- api: status ok
- worker started count: 3
- Image task lands on SUCCEEDED within 5-7 seconds

- [ ] **Step 9.5: Browser final smoke (manual)**

Open `http://localhost:3000`. Verify:
1. Home page loads
2. Login modal works
3. After login, /projects shows the 2 seed projects
4. Project detail page loads characters / items / scenes / episodes from the real backend
5. (If UI has analytics tab) numbers reflect real task counts from Plan 3 smoke

If any of these fail, debug before declaring Plan 4 done.

- [ ] **Step 9.6: No commit (verification only).**

---

## Done

After Plan 4 the project is feature-complete for the MVP boundary:

- Frontend served from real backend; mock data file only used by `seed.ts`
- Full CRUD for users, projects, characters, character-styles, items, scenes, episodes, knowledge-docs
- Real MinIO file uploads with auto-signed GET URLs
- AI task system end-to-end (queue → worker → MinIO → DB → polling) with credit reserve/refund
- Cancel + external workflow callback hooks open
- `pnpm dev` brings the entire stack up
- `docker compose --profile full` runs api + worker in containers
- CI workflow validates typecheck + tests on every push
- README guides a new dev from zero to working in 6 commands

**Future work (not in any plan):**
- Real Gemini / Nano-banana / Seedance providers slot into `apps/worker/src/providers/`
- SSE / WebSocket task progress push (replace polling)
- Real auth (email + SMTP, OAuth, or magic links)
- Cron cleanup for orphan MinIO objects
- Prometheus / Grafana wired through the `metrics` stubs in `@oneness/shared/logger`
- `apps/web` container for full-prod deployment
