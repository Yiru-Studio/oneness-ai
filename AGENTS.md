# Oneness AI Agent Notes

These notes apply to the repository at `/Users/wanghaoyu/Desktop/oneness`.

## Global Coding Guidelines

### 1. Clarify Before Implementing

- Do not silently guess requirements when multiple reasonable interpretations exist.
- State key assumptions briefly when they affect the implementation.
- If information is missing and the choice is risky, ask before proceeding.

### 2. Prefer Simple Solutions

- Choose the simplest implementation that fully solves the requested problem.
- Do not add speculative flexibility, abstraction, or configuration that was not requested.
- Match the existing project style and patterns unless there is a strong reason not to.

### 3. Make Surgical Changes

- Change only the code directly needed for the task.
- Do not refactor, reformat, or clean up unrelated areas as part of the same change.
- Remove only unused code or imports created by your own changes unless asked otherwise.

### 4. Verify Outcomes

- Define a concrete success condition before making substantial changes.
- After changes, verify them with the most relevant check available, such as tests, build, lint, or a focused manual run.
- If verification is not possible, say so clearly.

### 4.1 Standard Change And Deployment Flow

- For normal code changes, modify and verify locally first.
- After local verification passes, push the change to the GitHub repository.
- Deploy to the online server only after the GitHub push is complete.
- Treat direct online edits as emergency fixes only. When used, backport the same change into the local repository and follow up with local verification, GitHub push, and redeployment.

### 5. Git Commit Messages

- Use an English conventional prefix followed by Chinese content.
- Examples: `feat: 优化后台入口与顶部导航体验`, `fix: 修复认证页布局边距`.

### 6. Product Interaction Patterns

- For common flows such as login and registration, prioritize mainstream product conventions and proven open-source project patterns.

### 7. Reference-First Development

- For new projects or substantial new features, do not start from a blank slate by default.
- First research mainstream products, documentation, and relevant open-source GitHub projects to understand common patterns and proven implementations.
- Prefer adapting and integrating mature patterns from reference projects over inventing custom behavior from scratch.
- Use references as design and implementation guidance, not as blind copies; adapt them to the current product goals, codebase style, tech stack, and user experience.
- For small fixes, narrow visual adjustments, or clearly specified changes, keep the work surgical and do not perform broad research unless the change touches a common product pattern or the user asks for it.
- When external references influenced the solution, briefly summarize what was learned and how it shaped the final implementation.

## GitHub

- Repository remote: `https://github.com/Yiru-Studio/oneness-ai.git`
- Primary working branch for the current customized version: `feat/legacy-asset-drawer-layout`
- Local remote name: `origin`
- The current remote is configured over HTTPS. If pushing fails because of GitHub network connectivity, retry later before changing remote configuration.
- Normal flow: local change -> local verification -> commit -> push to GitHub -> deploy.
- Do not commit secrets, `.env*` files, server passwords, API keys, generated build output, `node_modules`, or `.next`.

## Aliyun Deployment

### Server

- Cloud provider: Aliyun
- OS: Ubuntu
- Public IP: `116.62.207.233`
- SSH port: `22`
- SSH user: `root`
- SSH command: `ssh root@116.62.207.233`
- SSH password is intentionally not stored in this file. Keep server credentials out of Git and request them from the operator when needed.

### Existing Production Version

- Public entry: `http://116.62.207.233`
- Remote directory: `/root/oneness-ai`
- Docker Compose project: `oneness-prod`
- Treat this as the old deployed version. Do not modify, restart, or redeploy it unless the user explicitly asks.

### Preview Version For Current Branch

- Public entry after security group opens TCP 8080: `http://116.62.207.233:8080`
- Remote directory: `/root/oneness-ai-preview`
- Docker Compose project: `oneness-preview`
- Compose file: `/root/oneness-ai-preview/docker/docker-compose.preview.yml`
- Caddyfile: `/root/oneness-ai-preview/docker/Caddyfile.preview`
- Environment file: `/root/oneness-ai-preview/.env.preview`
- Caddy binds host port `8080:80`.
- Preview API, Web, Worker, Postgres, Redis, and MinIO run in an independent Compose network with independent volumes.
- Preview MinIO is accessed through Caddy routes and should not expose host port `9000`.
- Aliyun security group must allow inbound TCP `8080` before the preview is publicly reachable.

### Preview Public Environment Values

- `NEXT_PUBLIC_API_BASE_URL=http://116.62.207.233:8080`
- `WEB_ORIGINS=http://116.62.207.233:8080`
- `MINIO_PUBLIC_ENDPOINT=http://116.62.207.233:8080`
- `MINIO_SERVER_URL=http://116.62.207.233:8080`
- `PROVIDER_TEXT=openai`
- `PROVIDER_IMAGE=openai`
- `OPENAI_TEXT_MODEL=gpt-5.5`
- `OPENAI_IMAGE_MODEL=gpt-image-2`
- `OPENAI_API_KEY` and any other secrets must stay only in server-side env files or local secret stores. Never print or commit their values.

### Preview Routing

- `/api/*` proxies to preview `api:4000`.
- `/user-uploads/*` proxies to preview `minio:9000`.
- `/task-outputs/*` proxies to preview `minio:9000`.
- All other paths proxy to preview `web:3000`.

### Deployment Commands

Run these from `/root/oneness-ai-preview` on the server when deploying the preview environment:

```bash
docker compose --env-file .env.preview -f docker/docker-compose.preview.yml build api worker web
docker compose --env-file .env.preview -f docker/docker-compose.preview.yml up -d
```

Seed the independent preview database after first start if login seed data is missing.

### Health Checks

Old production:

```bash
curl http://116.62.207.233/api/_health
```

Preview from the server:

```bash
curl http://127.0.0.1:8080/api/_health
```

Preview from public network after opening Aliyun TCP 8080:

```bash
curl http://116.62.207.233:8080/api/_health
```

Isolation check:

```bash
docker compose ls
```

Expected projects include both `oneness-prod` and `oneness-preview`.

## Deployment Safety Rules

- Keep the production and preview deployments isolated.
- Do not reuse production Postgres, Redis, or MinIO data for preview unless explicitly requested.
- Do not restart `oneness-prod` while deploying preview.
- When syncing code to `/root/oneness-ai-preview`, exclude `.git`, `node_modules`, `.next`, local `.env*`, and other local-only artifacts.
- If direct server edits are made for an emergency, immediately backport the same change into the local repository, verify locally, push to GitHub, and redeploy cleanly.
