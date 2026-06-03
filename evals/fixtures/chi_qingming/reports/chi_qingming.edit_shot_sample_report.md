# 《池清明》163 镜头抽样评测报告

- Run ID: `2026-05-31T09-44-57-488Z`
- Dataset: `/Users/wanghaoyu/Desktop/当前工作区/AIGC影视/structured_cases/chi_qingming/chi_qingming.annotated.dataset.json`
- Sample size: 38 / 163
- Passed: **yes**

## Metrics

- sample_size: 38
- scene_coverage_rate: 1
- scene_alignment_accuracy: 1
- prompt_completeness_rate: 1
- asset_reference_integrity_rate: 1
- critical_visual_constraint_rate: 1
- manual_review_rate: 0.2632
- passed_rate: 1

## Thresholds

- scene_coverage_rate: passed (target 1)
- scene_alignment_accuracy: passed (target 0.85)
- prompt_completeness_rate: passed (target 0.95)
- asset_reference_integrity_rate: passed (target 0.9)
- critical_visual_constraint_rate: passed (target 1)

## Scene Coverage

- Covered: 1、2、3、4、5、6、7、7A、7B、8
- Missing: None

## Failures

- None

## Repro

```bash
cd /Users/wanghaoyu/Desktop/当前工作区/AIGC影视/filmforge-workbench
npm run benchmark:chi-qingming:edit-shot-sample
```

## Next Stage

Edit-shot sample rule layer passed; visual sample generation can be enabled for optimization-blocking items.

