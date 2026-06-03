# 《池清明》163 镜头全量规则评测报告
- Run ID: `2026-05-30T02-48-21-343Z`
- Dataset: `/Users/wanghaoyu/Desktop/当前工作区/AIGC影视/structured_cases/chi_qingming/chi_qingming.annotated.dataset.json`
- Total edit shots: 163
- Passed: **yes**
## Metrics
- total_edit_shots: 163
- scene_coverage_rate: 1
- scene_alignment_accuracy: 1
- prompt_completeness_rate: 1
- asset_reference_integrity_rate: 1
- critical_visual_constraint_rate: 1
- passed_rate: 1
- nonvisible_character_filter_rate: 0.8098
- unsubstantiated_prop_filter_rate: 0.6994
- manual_review_rate: 0.0613
- timeline_gap_count: 0
- timeline_overlap_count: 0
## Failures
- None
## Prop Filtering
- Items with filtered unsubstantiated props: 114
## Repro
```bash
cd /Users/wanghaoyu/Desktop/当前工作区/AIGC影视/filmforge-workbench
npm run benchmark:chi-qingming:edit-shots-full
```
