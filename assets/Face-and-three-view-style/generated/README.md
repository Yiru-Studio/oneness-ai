# Three-view prompt — ZenMux test runs

Generated via `google/gemini-2.5-flash-image` (Nano Banana) on ZenMux's
vertex-ai endpoint while refining the `@三视图` expansion in
`apps/worker/src/processor.ts`.

| File | Prompt | Outcome |
|---|---|---|
| `v1.png` | `prompt-v1.txt` | layout correct, but middle panel is pure 90° side profile |
| `v2.png` | `prompt-v2.txt` | still 90° profile despite explicit ban; needed stronger "30°, both eyes visible" wording |
| `v3.png` | `prompt-v3.txt` | ✅ middle panel is true 3/4 turn, matches reference style |
| `v3b.png` | `prompt-v3b.txt` | ✅ v3 prompt re-tested on a different demographic (70 y/o woman) — generalizes cleanly |
| `v4-firefighter.png` | `prompt-v4-firefighter.txt` (from `clean-body.txt`) | ✅ end-to-end test of the cached-distillation pipeline: dirty Analyze-Character body → gpt-4o-mini → clean identity+uniform → composed with layout → rendered. Neutral studio, neutral pose, uniform preserved, no contamination. |
| `v4-firefighter-DIRTY-refusal.txt` | `prompt-v4-firefighter-DIRTY.txt` (from `dirty-body.txt`) | ❌ control: same layout but body left dirty (pose + courtyard + film grain). Nano Banana **refused to render** and protested the contradiction — independent proof that the distillation step is load-bearing. |

The committed prompt (in `processor.ts: THREE_VIEW_LAYOUT_PROMPT`) is v3.
The dirty→clean distillation is in `apps/worker/src/lib/three-view-distill.ts`
(gpt-4o-mini via ZenMux, cached in Redis by sha256 of the input body).
