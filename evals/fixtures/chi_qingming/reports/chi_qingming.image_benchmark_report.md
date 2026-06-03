# 《池清明》FilmForge Image Benchmark

- Run ID: `goal-real-20260529-210656`
- Dataset: `/Users/wanghaoyu/Desktop/当前工作区/AIGC影视/structured_cases/chi_qingming/chi_qingming.cleaned.dataset.json`
- Project ID: `project-池清明到底是谁-benchmark-image-mpqxrw23`
- Scope: 34 asset images + 10 storyboard images
- Rule passed: **yes**
- Overall passed: **no**
- Model judge: blocked (Set CHI_QINGMING_IMAGE_MODEL_JUDGE=true to enable multimodal judge.)
- Contact sheet: `/Users/wanghaoyu/Desktop/当前工作区/AIGC影视/structured_cases/chi_qingming/chi_qingming.image_contact_sheet.goal-real-20260529-210656.jpg`

## Metrics

- asset_reference_success_rate: 1
- storyboard_image_success_rate: 1
- storyboard_scene_coverage: 1
- storyboard_unique_scene_rate: 1
- prompt_completeness_rate: 1
- quality_gate_pass_rate: 1
- visual_judge_average: null
- image_duration_seconds: 2718.02

## Thresholds

- asset_reference_success_rate: passed (target 0.9)
- storyboard_image_success_rate: passed (target 0.9)
- storyboard_scene_coverage: passed (target 1)
- storyboard_unique_scene_rate: passed (target 1)
- prompt_completeness_rate: passed (target 0.95)
- quality_gate_pass_rate: passed (target 1)
- visual_judge_average: failed (target 80)

## Asset Success By Kind

- 角色: 8/8 (1)
- 场景: 10/10 (1)
- 道具: 16/16 (1)

## Failures

- None

## Repro

```bash
cd /Users/wanghaoyu/Desktop/当前工作区/AIGC影视/filmforge-workbench
npm run benchmark:chi-qingming
npm run benchmark:chi-qingming:image
```

## Fake Gateway Validation

```bash
cd /Users/wanghaoyu/Desktop/当前工作区/AIGC影视/filmforge-workbench
CHI_QINGMING_FAKE_IMAGE_GATEWAY=true npm run benchmark:chi-qingming:image
```

## Next Stage

Keep optimizing the image baseline before starting 163 edit-shot sampling.

