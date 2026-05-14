# syntax=docker/dockerfile:1.7
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /workspace

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
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

FROM node:22-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=builder /workspace/package.json ./
COPY --from=builder /workspace/pnpm-workspace.yaml ./
COPY --from=builder /workspace/pnpm-lock.yaml ./
COPY --from=builder /workspace/tsconfig.base.json ./
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/packages/shared ./packages/shared
COPY --from=builder /workspace/apps/worker ./apps/worker
WORKDIR /workspace/apps/worker
CMD ["node_modules/.bin/tsx", "src/index.ts"]
