# Oneness-AI 后端设计文档

- 起草日期：2026-05-14
- 状态：Draft（待用户审阅）
- 范围：替换前端 mock，提供 CRUD + 真实文件上传 + AI 任务接口的「口子」
- 设计原则：MVP 当前用不上、但未来接真实 provider / workflow 大概率会用到的能力，全部预留接口形状

## 1. 目标与边界

**目标：**
- 替换 `src/lib/api.ts` 里的所有 mock 调用为真实 REST API
- 用户主动上传的素材（头像、参考图、风格图等）真正落到 MinIO
- AI 任务（图片/视频/文本分析）开好后端口子：建任务、查状态、扣 credits、出产物，但 provider 实现是 stub，待用户后续接入
- 本地 `docker compose` 一键拉起所有依赖

**不在本期范围：**
- 真实 AI provider 接入（用户后续自接）
- 真实邮箱验证码 / OAuth（先 mock user）
- 生产环境部署 / K8s
- SSE / WebSocket 实时状态推送（轮询代替）
- Cron / 定时清理孤儿 MinIO 对象
- 监控接入（Prometheus / Grafana）—— 仅留接口形状

## 2. 总体架构

### 2.1 Docker Compose 服务清单

| service | 镜像 | 端口（host） | 用途 |
|---|---|---|---|
| `postgres` | postgres:16-alpine | 5432 | 业务数据库 |
| `redis` | redis:7-alpine | 6379 | BullMQ 队列 |
| `minio` | minio/minio | 9000 (S3) / 9001 (console) | 对象存储 |
| `minio-init` | minio/mc | — | 一次性建 bucket，建完退出 |
| `api`（profile: full） | 自建 Node | 4000 | Hono HTTP server |
| `worker`（profile: full） | 自建 Node | — | BullMQ consumer |

默认 `docker compose up` 只起前 4 个 infra 服务，Node app 在 host 跑 `tsx watch`。`--profile full` 才把 api/worker 也容器化（冒烟测试用）。

`web` 永远在 host 跑，不进 compose。

### 2.2 Monorepo 目录布局

```
oneness-ai/
├── apps/
│   ├── web/              # 现有 Next.js，从根迁过来
│   ├── api/              # Hono + REST
│   └── worker/           # BullMQ consumer
├── packages/
│   └── shared/           # Prisma schema/client + zod schemas + queue types + 错误/枚举/pricing
├── docker/
│   ├── docker-compose.yml
│   ├── api.Dockerfile
│   └── worker.Dockerfile
├── pnpm-workspace.yaml
├── package.json          # 根级 scripts
├── .env.example
└── .env.docker.example
```

### 2.3 关键边界

- **API 不直接调用 AI provider**，只做：入参校验 → credits 预扣 → 写 `Task` 表 → 入 BullMQ 队列 → 立即返回 `taskId`
- **Worker 单向消费队列**，结果通过 Prisma 写回 DB，产物通过 MinIO SDK 上传到 `task-outputs` bucket
- **Provider 用 ports/adapters 抽象**，stub 是默认实现，未来用户实现 `ImageProvider/VideoProvider/TextProvider` 接口，通过环境变量切换
- **Worker 进程独立容器**：替换 provider 只重启 worker，API 不动

## 3. 数据模型

### 3.1 ID 与基础约定

- 全部主键 `cuid()`（URL-safe、不可猜）
- 所有表带 `createdAt`；可变实体加 `updatedAt`
- 删除策略：用户/项目级 `onDelete: Cascade`；Asset 关联 `SetNull`
- 时间戳一律 `DateTime`（Postgres `timestamptz`）

### 3.2 Schema 概览

```
User ─┬─< Project ─┬─< Character ─< CharacterStyle ─> Asset
      │             ├─< Item ─> Asset
      │             ├─< Scene ─> Asset
      │             ├─< StoryboardEpisode
      │             └─< Task ─< TaskAsset >─ Asset
      ├─< KnowledgeDoc
      ├─< Task
      └─< Asset
```

### 3.3 模型字段细节

| 模型 | 关键字段 | 备注 |
|---|---|---|
| `User` | id, email(unique), name, avatarKey?, credits(Int, default 0) | credits 整数 |
| `Project` | id, ownerId, name, ratio, style, stylePrompt(Text), analysisModel, imageModel, videoModel, generalAnalysis(enum), basicAnalysis(enum) | `(ownerId, createdAt)` 索引 |
| `Character` | id, projectId, name, description(Text), bio(Text), voice?, avatarKey? | `(projectId)` 索引 |
| `CharacterStyle` | id, characterId, name, assetId? | 拆出独立表（非 JSON 数组），便于后期单独换图 |
| `Item` | id, projectId, name, assetId? | |
| `Scene` | id, projectId, name, assetId? | |
| `StoryboardEpisode` | id, projectId, number, title, content(Text), analyzed(Bool) | `(projectId, number)` 唯一 |
| `KnowledgeDoc` | id, ownerId, title, type(enum), content?(Text) | type: CREATED/FAVORITED/COLLABORATED |
| `Task` | id, ownerId, projectId?, type(enum), status(enum), provider(string), input(Json), output(Json?), error?, costCredits(Int), startedAt?, completedAt? | `(ownerId, status, createdAt)` + `(projectId, type)` 索引 |
| `Asset` | id, ownerId, bucket, key, contentType, sizeBytes(Int), width?(Int), height?(Int), durationMs?(Int) | `(bucket, key)` 唯一 |
| `TaskAsset` | taskId, assetId, role(string: input/output/reference) | 复合主键 `(taskId, assetId, role)` |

### 3.4 枚举

集中放 `packages/shared/src/enums.ts`，前后端共用同一份字符串字面量：

- `AnalysisStatus`: `PENDING | COMPLETED`
- `KnowledgeDocType`: `CREATED | FAVORITED | COLLABORATED`
- `TaskType`: `IMAGE | VIDEO | TEXT_ANALYZE`
- `TaskStatus`: `QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED`

### 3.5 Analytics 不建表

`Project` 的 analytics 数据（totalCredits / imageCount / videoCount / textTaskCount / updateTime）全部按 `(projectId)` 聚合 `Task` 表实时算，避免维护漂移的统计。

### 3.6 Seed

`packages/shared/prisma/seed.ts` 把 `src/data/mock.ts`（迁移后位于 `apps/web/src/data/mock.ts`）的所有 mock 数据 import 进来一次性插入：1 个 User + 2 个 Project + 全部 Character/Item/Scene/Episode。让前端切换到真后端时数据一致。

## 4. REST API

### 4.1 通用约定

- Base path：`http://localhost:4000/api`
- 所有路由先过 `mockUserMiddleware`，从 DB 取 seed user 注入 `c.var.user`
- 请求体校验：zod schema，定义在 `packages/shared/src/schemas/`
- 响应：成功直接返回资源 JSON；错误统一 `{ error: { code, message, details? } }` + HTTP 状态码
- 分页：常规列表 offset `?page=1&pageSize=20`，返回 `{ items, total, page, pageSize }`；`Task` 列表 cursor `?cursor=&limit=`
- 时间字段 ISO 8601 字符串
- request-id：每个请求生成 cuid 注入 `X-Request-Id` 响应头

### 4.2 路由清单

```
# 用户 / 鉴权
GET    /api/me
PATCH  /api/me
POST   /api/auth/login          # 接受任意 email/code，返回成功 + seed user
POST   /api/auth/logout         # 204

# 项目
GET    /api/projects?search=&page=&pageSize=
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id
GET    /api/projects/:id/analytics

# 子资源（嵌套创建 / 平铺读改删）
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

# 知识库
GET    /api/knowledge-docs?type=&page=&pageSize=
POST   /api/knowledge-docs
GET    /api/knowledge-docs/:id
PATCH  /api/knowledge-docs/:id
DELETE /api/knowledge-docs/:id

# 资产
POST   /api/assets                  # multipart/form-data，API 代传 MinIO，返回 Asset
DELETE /api/assets/:id

# 任务
POST   /api/tasks                   # 创建并入队
GET    /api/tasks/:id
GET    /api/tasks?projectId=&type=&status=&cursor=&limit=
POST   /api/tasks/:id/cancel        # MVP 实现但不暴露 UI，见 §6.8

# 健康 / 观测性（预留口子）
GET    /api/_health                 # DB + Redis + MinIO 各 ping
GET    /api/_ready
GET    /metrics                     # MVP 返 501，留位

# 内部回调（供未来外部 workflow）
PATCH  /api/internal/tasks/:id      # 需要 X-Internal-Secret header
```

### 4.3 嵌套写入

不支持。`POST /projects` 不能同时创建 characters/items/scenes，前端按需多次调用。

## 5. 对象存储

### 5.1 Bucket 布局

| bucket | 内容 | 写入方 |
|---|---|---|
| `user-uploads` | 用户主动上传：头像、参考图、风格图、物品图、场景图 | API |
| `task-outputs` | AI 任务产出：生成图、视频、文本附件 | worker |

**区分两 bucket 是为了未来差异化策略**：task-outputs 可加 lifecycle 自动清孤儿对象；user-uploads 永久保留。

### 5.2 Object key 规范

```
user-uploads:  {userId}/{yyyy-mm-dd}/{assetId}.{ext}
task-outputs:  {userId}/tasks/{taskId}/{assetId}.{ext}
```

主键仍是 DB `Asset.id`，key 内嵌 id 仅方便人工排查。扩展名按 `contentType` 推断，未知时退化 `bin`。

### 5.3 上传流（MVP：API 代理上传）

```
浏览器 → multipart/form-data → POST /api/assets → API 流式转发 → MinIO → API 写 Asset 记录 → 返回 { id, url, contentType, sizeBytes, width?, height? }
```

- 限制：默认单文件 100 MB；允许的 contentType 白名单写在 zod schema
- 图片用 `sharp` 抽 width/height（必需）
- 视频用 `fluent-ffmpeg` 抽 durationMs（可选，未装 ffmpeg 时字段留 null）
- **未来切 presigned PUT**：新增 `POST /api/assets/sign` + `POST /api/assets/confirm`，旧路由保留不破坏前端

### 5.4 下载

API 序列化 Asset 时**现场生成 presigned GET URL**（1 小时过期），作为 `url` 字段返给前端。前端拿到 `asset.url` 直接做 `<img src=>`。不开放 MinIO 匿名读。

### 5.5 清理

- 删 Asset 记录时 API 同步删 MinIO 对象（先 DB 后 MinIO，失败留 TODO 给未来的 cron 兜底）
- 删 Character/Item/Scene 时不级联删 Asset（`SetNull`），允许多处复用同一图
- 删 User 时级联删 Asset DB 记录，对应 MinIO 对象留 cron 清（MVP 不做 cron）

## 6. AI 任务 + 队列

### 6.1 队列拓扑

3 个独立 BullMQ 队列：

| 队列 | 默认 concurrency |
|---|---|
| `queue:ai-image` | 4 |
| `queue:ai-video` | 1（视频独占，避免堵图片） |
| `queue:ai-text` | 4 |

worker 进程同时启动 3 个 consumer。

### 6.2 POST /api/tasks 请求体

zod discriminated union on `type`：

```ts
// IMAGE
{ type: "IMAGE", projectId?, provider, input: {
    prompt, ratio, model, referenceAssetIds?, n?   // n: 一次生成几张，默认 1
}}
// VIDEO
{ type: "VIDEO", projectId?, provider, input: {
    prompt, model, duration, fromAssetId?
}}
// TEXT_ANALYZE
{ type: "TEXT_ANALYZE", projectId, provider, input: {
    episodeId, analysisType: "general" | "basic"
}}
```

`input` 整块写进 `Task.input: Json`，给未来 provider 直接消费。

### 6.3 Credits 状态机（预留+退款）

| 时机 | 动作 |
|---|---|
| 入队前 | 事务内：校验 `user.credits >= estimate`，扣 estimate，写 `Task.costCredits = estimate` |
| 成功 | 保留扣款；如有 `actualCostCredits` 则补差（多退少补） |
| 失败 / 取消 | 退还 `Task.costCredits` 给 user |

估价表（`packages/shared/src/pricing.ts`）：`IMAGE=1, VIDEO=5, TEXT_ANALYZE=1`。

### 6.4 Stub worker 行为

| type | 行为 |
|---|---|
| IMAGE | sleep 3-5s → 把 `apps/worker/assets/placeholders/image.png` 上传到 task-outputs → 创建 Asset + TaskAsset(role=output) → SUCCEEDED |
| VIDEO | sleep 8-12s → 同上拷 mp4 占位 |
| TEXT_ANALYZE | sleep 2s → 写 lorem ipsum 到 `Task.output` JSON |

环境变量 `STUB_FAIL_RATE=0.05`：5% 概率随机抛错，**有意暴露失败路径**让前端的错误状态、退款逻辑被走通。

### 6.5 Provider 接口（ports/adapters）

```ts
// packages/shared/src/providers/types.ts
export interface ProviderContext {
  taskId: string;
  ownerId: string;
  projectId?: string;
  prisma: PrismaClient;
  minio: MinioTaskOutputClient;   // 已绑定 task-outputs bucket + key 前缀
  log: Logger;
  abortSignal: AbortSignal;
}

export interface ImageProvider {
  name: string;
  generate(input: ImageInput, ctx: ProviderContext): Promise<ProviderResult>;
}
// 同理 VideoProvider / TextProvider

export type ProviderResult = {
  outputJson?: Record<string, unknown>;
  outputAssets?: Array<{
    data: Buffer | Readable;
    contentType: string;
    meta?: { width?: number; height?: number; durationMs?: number };
  }>;
  actualCostCredits?: number;
};
```

`apps/worker/src/providers/registry.ts` 按 `(type, provider)` 注册实现。环境变量 `PROVIDER_IMAGE=stub|<your>` 切换。

### 6.6 重试 / 错误

- BullMQ 默认 3 次指数退避
- 最终失败：`task.status=FAILED, task.error=<message>`，credits 退还
- worker 崩溃：BullMQ 自动 requeue

### 6.7 前端状态同步

轮询 `GET /api/tasks/:id`，前端每 2 秒拉一次直到 `SUCCEEDED|FAILED|CANCELLED`。SSE/WebSocket 留到接真 provider 时再加。

### 6.8 取消（MVP 不暴露 UI，路由先实现）

`POST /api/tasks/:id/cancel`：
- QUEUED → 置 CANCELLED + 退款 + BullMQ `job.remove()`
- RUNNING → 置 CANCELLED 标志，触发 worker abortSignal，worker abort 后退款
- 终态 → 409

### 6.9 外部 workflow 回调（预留）

`PATCH /api/internal/tasks/:id` + header `X-Internal-Secret`，body `{ status, output, error, outputAssetIds }`。stub worker 不走 HTTP（直接 Prisma 写库），但未来接非 Node workflow 时用得上。

## 7. 横切关注点

### 7.1 错误模型

```ts
// packages/shared/src/errors.ts
class AppError extends Error {
  code: string;        // PROJECT_NOT_FOUND, INSUFFICIENT_CREDITS, ASSET_TOO_LARGE...
  httpStatus: number;
  details?: unknown;
}
```

Hono 全局 onError 把 `AppError` 序列化为 `{ error: { code, message, details } }`；非 `AppError` → 500 + `INTERNAL`。错误码字符串集中在 `packages/shared/src/errors.ts`，前后端共享避免漂移。

### 7.2 日志

- pino，structured JSON 输出
- 中间件给每请求注入 `requestId`（cuid），response header 回写 `X-Request-Id`
- API + worker 共用 `packages/shared/src/logger.ts`
- worker 处理 task 时 logger 绑定 `{ taskId, type, provider }`
- **观测性口子**：logger 暴露 `metrics.incr/timing/gauge` 空实现，未来换 prom-client / statsd 不动调用方
- task 状态流转关键点调用 `logger.metrics.incr('task.<event>', { type, provider })`

### 7.3 健康 / 就绪 / metrics

- `GET /api/_health`：DB + Redis + MinIO 各 ping 一次，全 OK 返 200，否则 503
- `GET /api/_ready`：进程已加载配置即返 200
- `GET /metrics`：MVP 返 501 + comment `wire prom-client here`

### 7.4 测试策略

- 框架：vitest
- 三层：
  - `apps/api/src/**/*.unit.test.ts` —— 路由 handler 用 mock prisma
  - `apps/api/tests/integration/*.test.ts` —— 需要 docker compose infra 起着，真 DB + MinIO，每个文件 beforeAll 跑 migrate + seed-fresh
  - `apps/worker/tests/` —— stub provider 端到端验证 Task 状态机和 credits 退款
- MVP 不强求覆盖率，但 vitest 配置 + CI 步骤 + 1-2 个示范测试要有

### 7.5 CORS

dev 阶段允许 `http://localhost:3000`；生产读 `WEB_ORIGINS` 环境变量（逗号分隔白名单）。

## 8. Dev 工作流

### 8.1 两种模式

| 命令 | 起的服务 | 用途 |
|---|---|---|
| `pnpm dev` | docker: postgres + redis + minio + minio-init；host: api/worker/web 各自 tsx watch | 日常开发 |
| `pnpm dev:full` | docker compose 全部含 api/worker；host 只跑 web | 容器构建烟囱测试 |

### 8.2 根 package.json scripts

```jsonc
{
  "scripts": {
    "infra:up":   "docker compose up -d postgres redis minio minio-init",
    "infra:down": "docker compose down",
    "dev:web":    "pnpm --filter web dev",
    "dev:api":    "pnpm --filter api dev",
    "dev:worker": "pnpm --filter worker dev",
    "dev":        "pnpm infra:up && concurrently -n api,worker,web 'pnpm dev:api' 'pnpm dev:worker' 'pnpm dev:web'",
    "dev:full":   "docker compose --profile full up --build && pnpm dev:web",
    "db:migrate": "pnpm --filter shared exec prisma migrate dev",
    "db:reset":   "pnpm --filter shared exec prisma migrate reset --force",
    "db:seed":    "pnpm --filter shared exec tsx prisma/seed.ts",
    "db:studio":  "pnpm --filter shared exec prisma studio",
    "typecheck":  "pnpm -r typecheck",
    "lint":       "pnpm -r lint",
    "build":      "pnpm -r build"
  }
}
```

### 8.3 .env 策略

- `.env`（host dev）：`localhost` 引用 docker 端口
- `.env.docker`（compose full profile）：service name 引用
- `.env.example` + `.env.docker.example` commit；真实 `.env*` 进 `.gitignore`

### 8.4 首次启动

```bash
pnpm install
cp .env.example .env
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
# 打开 http://localhost:3000，前端表现应与原 mock 一致
```

### 8.5 Dockerfile

- multi-stage（deps / builder / runner），node:22-alpine
- 启动脚本：API 容器 `prisma migrate deploy && node dist/index.js`；worker 容器 `node dist/index.js`（不跑 migrate）

## 9. 前端切换 mock → 真后端

落地实现计划中详细规划，本设计仅约定方向：

- `src/lib/api.ts` 改成统一 fetcher 工厂，每个 export 函数转发到 `${NEXT_PUBLIC_API_BASE_URL}/...`
- `src/data/mock.ts` 不变，作为 seed.ts 的输入，**真实运行环境不再 import**
- `getProjectTabContent` 这种当前返回空的接口随切换一并删除
- 上传场景（头像、风格图）改用 `POST /api/assets` 拿到 `assetId` 后再 PATCH 对应资源

## 10. 实施阶段（writing-plans 阶段细化）

写实现计划时，建议拆为以下里程碑（顺序）：

1. Monorepo 脚手架（pnpm workspaces + apps/* + packages/shared）+ docker compose infra + .env 模板
2. Prisma schema + migration + seed + db:* 脚本验证
3. apps/api 骨架（Hono + 中间件 + 错误模型 + logger + health/ready）
4. CRUD 路由：projects → characters/styles → items → scenes → episodes → knowledge-docs
5. assets 上传路由 + MinIO presigned GET 序列化
6. BullMQ 队列 + worker 骨架 + 3 个 stub provider + Task CRUD
7. Credits 状态机 + cancel + internal callback
8. Analytics 聚合查询
9. 前端切换：`src/lib/api.ts` 全替换 + 环境变量 + 端到端 smoke
10. README / .env.example / CI 配置 / 示范测试
