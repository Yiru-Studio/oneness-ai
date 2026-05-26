# Oneness AI — Image & Video Generation API

This guide is everything you need to call the backend image- and video-generation
services with nothing but `curl`. Read it top to bottom once and you can copy a
command, change the prompt, and get a generated asset back.

- **Production base URL:** `https://api.yirustudio.com`
- **Local dev base URL:** `http://localhost:4000`

Every endpoint below is mounted under `/api`, so the full path is e.g.
`https://api.yirustudio.com/api/tasks`. Throughout this doc we use a shell
variable for the base URL:

```bash
export BASE="https://api.yirustudio.com"
```

---

## 1. Authentication

All generation endpoints require an `Authorization: Bearer <token>` header.

```
Authorization: Bearer <token>
```

You can get a token from the login endpoint (it accepts any email + code today):

```bash
curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","code":"000000"}'
```

```json
{
  "token": "mock_token_1716700000000",
  "user": { "id": "...", "email": "...", "name": "...", "credits": 1000 }
}
```

Save the token and reuse it:

```bash
export TOKEN="mock_token_1716700000000"
```

> **⚠️ Security note — read this before sharing the docs.**
> Authentication is currently a **mock/stub**. *Any* non-empty bearer token is
> accepted and every caller resolves to the **same shared seed account** —
> meaning all callers share one credit pool, one project list, and one asset
> store. This is fine for a demo or trusted internal users, but do **not** treat
> the token as a per-user secret and do **not** expose this publicly without
> wiring real auth into `apps/api/src/middleware/auth.ts` first.

Check your account / remaining credits any time:

```bash
curl -s "$BASE/api/me" -H "Authorization: Bearer $TOKEN"
```

---

## 2. How generation works (the request → poll → download loop)

Generation is **asynchronous**. You don't get the image back in the same
response — you get a **task** that runs in the background.

1. **Create a task** — `POST /api/tasks`. Returns a task with `status: "QUEUED"`.
2. **Poll the task** — `GET /api/tasks/:id` until `status` is `SUCCEEDED` (or
   `FAILED` / `CANCELLED`).
3. **Download the result** — read `outputAssets[].url`. These are presigned
   URLs valid for **1 hour**; re-fetch the task to mint fresh ones.

```
POST /api/tasks ──▶ { id, status: QUEUED }
                         │
        GET /api/tasks/:id (poll every ~2s)
                         │
                 status: SUCCEEDED
                         │
        outputAssets[0].url  ──▶  https://s3.yirustudio.com/...  (the image/video)
```

---

## 3. Quickstart — generate an image in 3 commands

```bash
# 1. Create the task
TASK_ID=$(curl -s -X POST "$BASE/api/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "IMAGE",
    "provider": "zenmux-predict",
    "input": {
      "prompt": "a red panda astronaut floating in space, cinematic lighting",
      "model": "qwen/qwen-image-2.0",
      "ratio": "1:1",
      "n": 1
    }
  }' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

echo "task: $TASK_ID"

# 2. Poll until it's done
curl -s "$BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN"

# 3. When status == SUCCEEDED, grab the URL from outputAssets[0].url
```

A one-liner poll loop (needs `jq`):

```bash
until [ "$(curl -s "$BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN" | jq -r .status)" != "QUEUED" ] && \
      [ "$(curl -s "$BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN" | jq -r .status)" != "RUNNING" ]; do
  echo "...still working"; sleep 2;
done
curl -s "$BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN" | jq '{status, url: .outputAssets[0].url}'
```

---

## 4. Image generation — `POST /api/tasks` (`type: "IMAGE"`)

### Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | string | ✅ | Must be `"IMAGE"`. |
| `provider` | string | ✅* | The worker provider that owns the model — **must match the model** (see §6). Defaults to `"stub"` if omitted, which only returns placeholder images. |
| `projectId` | string (cuid) | — | Optional. If set, must be a project you own. |
| `input.prompt` | string | ✅ | 1–5000 chars. |
| `input.model` | string | ✅ | Model id, e.g. `qwen/qwen-image-2.0` (see §6). |
| `input.ratio` | string | ✅ | Aspect ratio, e.g. `"1:1"`, `"16:9"`, `"9:16"`, `"4:3"`. |
| `input.n` | integer | — | How many images, 1–8. Default `1`. |
| `input.referenceAssetIds` | string[] | — | Up to 8 uploaded asset ids to use as reference images (see §7). |

\* `provider` is technically optional and defaults to `stub`, but to get a **real**
image you must pass the provider that matches your model.

### Example — text-to-image (Qwen on ZenMux)

```bash
curl -s -X POST "$BASE/api/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "IMAGE",
    "provider": "zenmux-predict",
    "input": {
      "prompt": "a serene Japanese garden at dawn, koi pond, soft mist",
      "model": "qwen/qwen-image-2.0",
      "ratio": "16:9",
      "n": 2
    }
  }'
```

### Example — image-to-image (with a reference image)

First upload a reference (§7) to get an `assetId`, then:

```bash
curl -s -X POST "$BASE/api/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "IMAGE",
    "provider": "nanobanana",
    "input": {
      "prompt": "same character, now wearing a winter coat in the snow",
      "model": "google/gemini-2.5-flash-image",
      "ratio": "1:1",
      "referenceAssetIds": ["<ASSET_ID>"]
    }
  }'
```

### Response (`201 Created`)

```json
{
  "id": "clx...taskid",
  "type": "IMAGE",
  "status": "QUEUED",
  "provider": "zenmux-predict",
  "projectId": null,
  "input": { "prompt": "...", "model": "qwen/qwen-image-2.0", "ratio": "16:9", "n": 2 },
  "output": null,
  "error": null,
  "costCredits": 1,
  "outputAssets": [],
  "createdAt": "2026-05-26T10:00:00.000Z",
  "startedAt": null,
  "completedAt": null
}
```

---

## 5. Video generation — `POST /api/tasks` (`type: "VIDEO"`)

### Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | string | ✅ | Must be `"VIDEO"`. |
| `provider` | string | ✅* | `"seedance"` or `"seedance-fast"` (must match the model — see §6). |
| `projectId` | string (cuid) | — | Optional, must be a project you own. |
| `input.prompt` | string | ✅ | 1–5000 chars. |
| `input.model` | string | ✅ | e.g. `doubao-seedance-2-0-fast-260128` (see §6). |
| `input.duration` | integer | ✅ | Seconds, 1–60. |
| `input.ratio` | string | — | e.g. `"16:9"`, `"9:16"`. |
| `input.fromAssetId` | string (cuid) | — | Image-to-video: animate this uploaded image. |
| `input.references` | object[] | — | Up to 15 reference assets, each `{ "assetId": "...", "role": "..." }`. Roles: `reference_image`, `reference_video`, `reference_audio`, `first_frame`, `last_frame`. |
| `input.generateAudio` | boolean | — | Generate an audio track. |
| `input.watermark` | boolean | — | Add a watermark. |
| `input.webSearch` | boolean | — | Allow the model to use web search for grounding. |
| `input.returnLastFrame` | boolean | — | Also return the final frame as an image. |

\* Same rule as images: omit `provider` and it defaults to `stub` (placeholder
video only). Pass `seedance` / `seedance-fast` for real output.

### Example — text-to-video

```bash
curl -s -X POST "$BASE/api/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "VIDEO",
    "provider": "seedance-fast",
    "input": {
      "prompt": "a paper boat sailing down a rain-soaked street, slow motion",
      "model": "doubao-seedance-2-0-fast-260128",
      "duration": 5,
      "ratio": "16:9"
    }
  }'
```

### Example — image-to-video (animate an uploaded image)

```bash
curl -s -X POST "$BASE/api/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "VIDEO",
    "provider": "seedance",
    "input": {
      "prompt": "the character slowly turns and smiles at the camera",
      "model": "doubao-seedance-2-0-260128",
      "duration": 5,
      "fromAssetId": "<ASSET_ID>"
    }
  }'
```

Video tasks cost more credits and run on a single-concurrency queue, so they
take longer to finish — poll patiently.

---

## 6. Models & providers (the one table you must get right)

The `provider` field and the `input.model` field **must agree**. Each model is
served by exactly one provider. Pick a row and copy both columns:

### Image models

| `input.model` | `provider` | Label |
|---|---|---|
| `qwen/qwen-image-2.0` | `zenmux-predict` | Qwen Image 2.0 |
| `qwen/qwen-image-2.0-pro` | `zenmux-predict` | Qwen Image 2.0 Pro |
| `bytedance/doubao-seedream-5.0-lite` | `zenmux-predict` | Doubao Seedream 5.0 Lite |
| `google/gemini-2.5-flash-image` | `nanobanana` | Nano Banana |
| `google/gemini-3.1-flash-image-preview` | `nanobanana` | Gemini 3.1 Flash Image (Preview) |
| `openai/gpt-image-2` | `openai` | GPT Image 2 |
| `openai/gpt-image-1.5` | `openai` | GPT Image 1.5 |
| `stub/placeholder` | `stub` | Placeholder (testing only) |

Rule of thumb: `qwen/*` and `bytedance/*` → `zenmux-predict`; `google/*` →
`nanobanana`; `openai/*` → `openai`.

### Video models

| `input.model` | `provider` | Label |
|---|---|---|
| `doubao-seedance-2-0-260128` | `seedance` | Seedance 2.0 Pro |
| `doubao-seedance-2-0-fast-260128` | `seedance-fast` | Seedance 2.0 Fast |

> Which providers are actually live depends on the server's API keys
> (`ZENMUX_API_KEY`, `ARK_API_KEY`, etc.). If a provider's key is missing the
> task fails with a clear error in the `error` field. The `stub` provider always
> works and returns placeholder assets — handy for testing the flow end-to-end
> without spending real provider credits.

---

## 7. Uploading reference / source images — `POST /api/assets`

For image-to-image (`referenceAssetIds`) and image-to-video (`fromAssetId` /
`references`) you first upload the file, then pass the returned `id`.

```bash
curl -s -X POST "$BASE/api/assets" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/photo.jpg"
```

```json
{
  "id": "clx...assetid",
  "url": "https://s3.yirustudio.com/...",
  "contentType": "image/jpeg",
  "sizeBytes": 184213,
  "width": 1024,
  "height": 1024,
  "durationMs": null
}
```

- **Allowed types:** `image/jpeg`, `image/png`, `image/webp`, `image/gif`,
  `video/mp4`, `video/webm`, `audio/mpeg`, `audio/wav`.
- **Max size:** 100 MB.

Use the returned `id` as the `assetId` in your generation request.

---

## 8. Polling a task — `GET /api/tasks/:id`

```bash
curl -s "$BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN"
```

`status` transitions: `QUEUED → RUNNING → SUCCEEDED` (or `FAILED` / `CANCELLED`).

A successful result:

```json
{
  "id": "clx...taskid",
  "type": "IMAGE",
  "status": "SUCCEEDED",
  "provider": "zenmux-predict",
  "costCredits": 1,
  "output": { "...": "provider-specific metadata" },
  "error": null,
  "outputAssets": [
    {
      "id": "clx...assetid",
      "url": "https://s3.yirustudio.com/task-outputs/...",
      "contentType": "image/png",
      "sizeBytes": 1048576,
      "width": 1024,
      "height": 1024,
      "durationMs": null
    }
  ],
  "createdAt": "2026-05-26T10:00:00.000Z",
  "startedAt": "2026-05-26T10:00:01.000Z",
  "completedAt": "2026-05-26T10:00:09.000Z"
}
```

Download the asset straight from `outputAssets[0].url`:

```bash
curl -s -o result.png "$(curl -s "$BASE/api/tasks/$TASK_ID" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.outputAssets[0].url')"
```

> `outputAssets[*].url` are presigned and expire after **1 hour**. Just GET the
> task again to get fresh URLs.

### List your tasks — `GET /api/tasks`

```bash
curl -s "$BASE/api/tasks?type=IMAGE&status=SUCCEEDED&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

Query params: `type` (`IMAGE`/`VIDEO`/`TEXT_ANALYZE`), `status`, `projectId`,
`limit` (1–100, default 50), `cursor` (the `nextCursor` from the previous page).

---

## 9. Cancelling a task — `POST /api/tasks/:id/cancel`

```bash
curl -s -X POST "$BASE/api/tasks/$TASK_ID/cancel" \
  -H "Authorization: Bearer $TOKEN"
```

Cancelling a `QUEUED` or `RUNNING` task refunds its reserved credits.
Cancelling a task that already finished returns `409 Conflict`.

---

## 10. Credits & cost

Each task **reserves** credits up front and **refunds** them automatically if it
fails or is cancelled.

| Task type | Reserved credits |
|---|---|
| `IMAGE` | 1 |
| `VIDEO` | 5 |
| `TEXT_ANALYZE` | 1 |

If you don't have enough credits, `POST /api/tasks` returns `400` with code
`INSUFFICIENT_CREDITS` and a `details` object showing `required` and `available`.
Check your balance with `GET /api/me`.

---

## 11. Error format

Every error has the same shape, with the HTTP status code set appropriately:

```json
{
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "requires 5 credits, have 2",
    "details": { "required": 5, "available": 2 }
  }
}
```

Common codes:

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Body failed validation (`details` lists the fields). |
| 400 | `INSUFFICIENT_CREDITS` | Not enough credits to start the task. |
| 401 | `UNAUTHORIZED` | Missing/invalid `Authorization` header. |
| 404 | `TASK_NOT_FOUND` / `PROJECT_NOT_FOUND` / `ASSET_NOT_FOUND` | The id doesn't exist or isn't yours. |
| 409 | `TASK_NOT_CANCELLABLE` | Task already in a terminal state. |
| 413 | `ASSET_TOO_LARGE` | Upload exceeds 100 MB. |
| 500 | `INTERNAL` | Unexpected server error. |

When a generation task fails, the task itself still returns `200` from
`GET /api/tasks/:id` — check `status: "FAILED"` and read the `error` string for
the provider's message (e.g. a missing provider API key).

---

## 12. Health check

```bash
curl -s "$BASE/api/_health"
```

```json
{ "status": "ok", "checks": { "database": "ok", "redis": "ok", "minio": "ok" } }
```

---

## Full end-to-end example (image)

```bash
export BASE="https://api.yirustudio.com"

# 1. Get a token
export TOKEN=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","code":"000000"}' | jq -r .token)

# 2. Create an image task
export TASK_ID=$(curl -s -X POST "$BASE/api/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "IMAGE",
    "provider": "zenmux-predict",
    "input": { "prompt": "a lighthouse on a cliff at sunset", "model": "qwen/qwen-image-2.0", "ratio": "16:9" }
  }' | jq -r .id)

# 3. Poll until done
while true; do
  STATUS=$(curl -s "$BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN" | jq -r .status)
  echo "status: $STATUS"
  [ "$STATUS" = "SUCCEEDED" ] && break
  [ "$STATUS" = "FAILED" ] || [ "$STATUS" = "CANCELLED" ] && { echo "task ended: $STATUS"; break; }
  sleep 2
done

# 4. Download the result
curl -s -o result.png "$(curl -s "$BASE/api/tasks/$TASK_ID" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.outputAssets[0].url')"
echo "saved result.png"
```
