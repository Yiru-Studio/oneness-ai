# 《池清明》163 镜头 Prompt 审计与第二层抽样报告

- Run ID: `2026-05-30T02-48-21-341Z`
- Source: `/Users/wanghaoyu/Desktop/当前工作区/AIGC影视/structured_cases/chi_qingming/chi_qingming.edit_shots_full_report.json`
- Passed: **yes**

## Metrics

- total_edit_shots: 163
- audit_pass_rate: 1
- prompt_completeness_rate: 1
- high_risk_item_count: 24
- voice_only_character_in_subject: 0
- absent_character_in_subject: 0
- possible_prop_pollution: 0
- sample_size: 48
- sample_scene_coverage_rate: 1
- sample_scene_8_count: 16
- sample_low_confidence_count: 10

## Signal Counts

- nonvisible_characters_filtered: 132
- unsubstantiated_props_filtered: 114
- transition_scene: 22
- long_edit_shot: 19
- scene_8_transparent_film_arc: 16
- low_alignment_confidence: 10

## Second Layer Sample

- Size: 48
- Shots: 148, 149, 163, 1, 90, 96, 103, 104, 131, 139, 125, 89, 151, 159, 157, 156, 162, 153, 154, 155, 160, 158, 152, 161, 138, 150, 141, 140, 137, 142, 147, 144, 145, 146, 143, 110, 80, 44, 45, 32, 97, 98, 40, 15, 81, 28, 29, 35

## Top Risk Items

- Shot 148 / Scene 8 / Risk 86: low_alignment_confidence, long_edit_shot, nonvisible_characters_filtered, unsubstantiated_props_filtered, scene_8_transparent_film_arc
- Shot 149 / Scene 8 / Risk 86: low_alignment_confidence, long_edit_shot, nonvisible_characters_filtered, unsubstantiated_props_filtered, scene_8_transparent_film_arc
- Shot 163 / Scene 8 / Risk 86: low_alignment_confidence, long_edit_shot, nonvisible_characters_filtered, unsubstantiated_props_filtered, scene_8_transparent_film_arc
- Shot 1 / Scene 1 / Risk 68: low_alignment_confidence, long_edit_shot, nonvisible_characters_filtered, unsubstantiated_props_filtered
- Shot 90 / Scene 5 / Risk 68: low_alignment_confidence, long_edit_shot, nonvisible_characters_filtered, unsubstantiated_props_filtered
- Shot 96 / Scene 5 / Risk 68: low_alignment_confidence, long_edit_shot, nonvisible_characters_filtered, unsubstantiated_props_filtered
- Shot 103 / Scene 6 / Risk 68: low_alignment_confidence, long_edit_shot, nonvisible_characters_filtered, unsubstantiated_props_filtered
- Shot 104 / Scene 6 / Risk 68: low_alignment_confidence, long_edit_shot, nonvisible_characters_filtered, unsubstantiated_props_filtered
- Shot 131 / Scene 7A / Risk 64: low_alignment_confidence, long_edit_shot, transition_scene
- Shot 139 / Scene 7B / Risk 59.733000000000004: long_edit_shot, nonvisible_characters_filtered, unsubstantiated_props_filtered, transition_scene
- Shot 125 / Scene 7 / Risk 50: low_alignment_confidence, long_edit_shot
- Shot 102 / Scene 6 / Risk 45.766999999999996: long_edit_shot, nonvisible_characters_filtered, unsubstantiated_props_filtered
- Shot 100 / Scene 6 / Risk 45.6: long_edit_shot, nonvisible_characters_filtered, unsubstantiated_props_filtered
- Shot 93 / Scene 5 / Risk 45.033: long_edit_shot, nonvisible_characters_filtered, unsubstantiated_props_filtered
- Shot 89 / Scene 5 / Risk 44.667: long_edit_shot, nonvisible_characters_filtered, unsubstantiated_props_filtered

## Repro

```bash
cd /Users/wanghaoyu/Desktop/当前工作区/AIGC影视/filmforge-workbench
npm run benchmark:chi-qingming:edit-shot-audit
```

