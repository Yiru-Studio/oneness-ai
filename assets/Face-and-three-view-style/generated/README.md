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

The committed prompt (in `processor.ts: THREE_VIEW_LAYOUT_PROMPT`) is v3.
