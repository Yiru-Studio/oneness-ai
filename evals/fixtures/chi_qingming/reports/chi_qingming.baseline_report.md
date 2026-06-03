# 《池清明》FilmForge Baseline Benchmark

- Dataset: `/Users/wanghaoyu/Desktop/当前工作区/AIGC影视/structured_cases/chi_qingming/chi_qingming.cleaned.dataset.json`
- Project ID: `project-池清明到底是谁-benchmark-baseline-mptl96e8`
- Overall score: **100**
- Requested storyboard shots: 10

## Metrics

- character_recall: 1
- scene_recall: 1
- core_prop_recall: 1
- scene_breakdown_coverage: 1
- image_prompt_completeness: 1
- storyboard_reference_completeness: 1

## Missing Gold Labels

- Characters: None
- Scenes: None
- Core props: None

## Generated Counts

```json
{
  "gold": {
    "characters": 9,
    "scenes": 10,
    "coreProps": 3,
    "scriptScenes": 10
  },
  "generated": {
    "assets": 36,
    "characters": 11,
    "scenes": 10,
    "props": 15,
    "shots": 10
  }
}
```

## Repro

```bash
cd /Users/wanghaoyu/Desktop/当前工作区/AIGC影视/filmforge-workbench
node scripts/benchmark-chi-qingming-baseline.mjs
```

