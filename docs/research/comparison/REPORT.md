# Side-by-Side Comparison Report — likeai.pro vs oneness-ai (localhost)

**Date:** 2026-05-14 overnight session
**Test script:** docs/test-scripts/comparison-script.md (《最后一班地铁》, ~800字, 3 scenes, 2 main characters)
**likeai.pro auth:** Bearer token via localStorage (working — user has 1931 credits, 5+ projects visible)
**oneness-ai project:** `cmp5trokf000713hipuoipkky` ("cc overnight")

## Methodology

Captured matched screenshots of both sites at 7 stages (A–H) using Playwright headless
Chromium with `--no-sandbox`. likeai.pro requires the SPA to fully hydrate before deep
linking works (`/projects/:id` works, `/project/:id` does not). Tab navigation on
likeai.pro is rendered as label text inside the project shell; on mine it is icon-only
sidebar at fixed left (matching repo PNG `likeai-04-project-detail.png`).

When likeai.pro tab clicks failed (label text changes once project is opened), the
fallback reference is the GUIDE.docx images (image11–image18) which are the official
product spec.

## Step-by-step comparison

### Step A — Projects list

| | likeai.pro | mine |
|---|---|---|
| Reference | live screenshot likeai-A-projects-list.png | mine-A-projects-list.png |
| Layout | Top bar with logo, language switcher, credits (1931), filter chips (project type, status), search/reset, grid of project cards | Top bar with logo, sidebar nav, project list with cards |
| Project card | shows ratio (16:9 / 9:16), style label (电影质感, 日漫风格), status pill (测试中, 协作, 已立项) | shows ratio + style + createdAt date |

**Status pills** ("测试中", "协作", "已立项") on likeai.pro represent project lifecycle
state. **NOT IMPLEMENTED in mine** — medium priority. Status filter chips
("项目类型", "项目状态") **not implemented** — medium priority.

### Step B — New project modal

Both sites successfully open a "新建项目" / "创建新项目" modal with similar form fields.
Detail differences are mostly cosmetic.

### Step C — Project detail (Info tab)

**REFERENCE: image10/image11 from GUIDE + repo PNG likeai-04-project-detail.png**

Mine matches the layout from `likeai-04-project-detail.png`:
- Left sidebar with circular icon buttons (信息, 角色, 物品, 场景, 工作台, 分镜, 数据分析)
- Main content area with project metadata (name, ratio, style, models)
- Script upload area when no episodes uploaded
- Episode summary view when uploaded

Likeai.pro adds: language switcher, credits display, knowledge-base link in topbar.
**Topbar credits display NOT implemented in mine** — minor (credits are not yet a
visible product feature on mine).

### Step D — Characters tab

**REFERENCE: image11/image12 from GUIDE.docx**

Mine has full implementation matching GUIDE:
- 280px left list of character cards (avatar circle + name + description)
- Right detail pane showing "分析角色" + "创建为空白角色" buttons when fresh
- Editable form when blank or analyzed (avatar, name, voice, bio)
- 三视图 (3-view) generation grid: 正面, 侧面, 背面
- Per-style hover delete + AI regenerate

Live likeai.pro tab navigation didn't activate cleanly via label clicks — falling back to
GUIDE image11.png which shows the same general structure as mine. Match: **good**.

### Step E — Items tab

**REFERENCE: image15.png from GUIDE + repo PNG p04-tab-items.png**

Mine has: grid of square cards, "+ 添加物品" placeholder card, hover reveals
regenerate/upload/delete. AI regenerate uses project.imageModel.

Match against GUIDE: **good**.

### Step F — Scenes tab

**REFERENCE: image16.png from GUIDE + repo PNG p05-tab-scenes-loaded.png**

Mine has: grid of cards using project ratio aspect (16:9), "+ 添加场景" placeholder,
hover reveals AI regenerate (script-aware), upload, delete.

Match against GUIDE: **good**.

### Step G — Storyboard tab

**REFERENCE: image17/image18 from GUIDE + repo PNG p07-tab-storyboard.png**

Mine has: episode card grid with "+ 添加剧集" placeholder; clicking a card opens a
slide-in drawer with editable title/content + 重新分析 button.

GUIDE image17 shows what likeai.pro storyboard detail looks like: it includes
**shot-level breakdown within each episode** — i.e. each episode contains scenes,
each scene contains shots, and each shot has its own image + video generation
controls.

**MAJOR GAP: shot-level UI not implemented in mine.** Currently mine shows only
episode-level metadata; there is no per-shot image grid, per-shot video preview,
or shot-level prompt editing.

Severity: **CRITICAL** for full pipeline replication (this is the core production
feature of likeai.pro).

### Step H — Storyboard detail / shot generation

Mine drawer shows: title, content editor, analyze button.
likeai.pro shows: per-shot cards with image + video preview + regen controls.

**Same gap as Step G.**

## Summary of gaps (prioritized)

### CRITICAL (block end-to-end shot generation parity)
1. **Shot-level model + UI**: episodes need a 1:N relationship to Shot, where each Shot
   has prompt, ratio, image asset, video asset, references to scenes/characters/items.
   Currently we only have Episode + analyze fan-out.
2. **Per-shot image generation flow**: button on each shot to gen image with prompt
   editor, model picker, reference asset selector.
3. **Per-shot video generation flow**: button on each shot to gen video using its image
   as first_frame + scene/character refs.

### MEDIUM
4. Project status pills ("测试中", "协作", "已立项") on project list cards.
5. Project type / status filter chips on /projects page.
6. Topbar credits display on web app.
7. Knowledge-base / collaboration / analytics tabs are stubs vs likeai's richer impl.

### MINOR
8. Cosmetic: language switcher, exact button styling, color accents.
9. likeai.pro shows entity counts in tab tooltips.
10. likeai.pro has bulk-select and batch-delete on items/scenes.

## What's working well

- ✅ Real LLM analyze pipeline (chars/items/scenes extraction) using zenmux works
- ✅ Real openai/gpt-image-2 generation works for avatars, items, scenes
- ✅ Real seedance video generation works (5s clip, 16:9, doubao-seedance-2-0-fast)
- ✅ MinIO asset storage works end-to-end
- ✅ All 7 sidebar tabs render with 0 console errors
- ✅ Episode CRUD + drawer + analyze trigger work
- ✅ Character CRUD + 三视图 + avatar upload/gen all functional

## Pipeline verification (done overnight)

For project "cc overnight" `cmp5trokf000713hipuoipkky`:
- Episode #1: 最后一封信 第1集 (1500+ chars Chinese script)
- Analyzed: 2 characters (吴雨华, 陈长庚), 24 items, 2 scenes
- Generated 2 character avatars via gpt-image-2
- Generated 3 item images via gpt-image-2
- Generated 2 scene images via gpt-image-2
- Generated 1 video shot via doubao-seedance-2-0-fast (5s, 16:9)

All assets persisted in MinIO. See scripts/phase5b-orchestrate.mjs for the
orchestrator that drove the run.

## Decision: post-comparison fixes

Given the 30-min/component budget and the scope:
- **Implementing shot-level Prisma model + API + UI** is a 4–8 hour task (schema
  migration + serializer + routes + frontend grid + shot-detail view + image/video
  task wiring). Out of scope for this overnight session — logging as ❌ BLOCKED with
  reason "structural gap, scope > 30min, deferred to next session".
- Will continue with smaller wins: project status pills, credits display, filter chips.

## Files

- Reference images: `docs/research/likeai-screenshots/p01..p09-*.png`,
  `/tmp/likeai-guide-images/imageNN.png` (44 from GUIDE.docx)
- Mine output: `docs/research/my-output/tab-*.png`,
  `docs/research/comparison/mine-{A..H}-*.png`
- Likeai output: `docs/research/comparison/likeai-{A..H}-*.png` (auth working,
  but tab navigation only worked for projects list)
- Test script: `docs/test-scripts/comparison-script.md`
- Orchestrator: `scripts/phase5b-orchestrate.mjs`
