#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
SOURCE_PATH = ROOT / "chi_qingming.dataset.json"
CLEANED_PATH = ROOT / "chi_qingming.cleaned.dataset.json"
REPORT_PATH = ROOT / "chi_qingming.cleaning_report.md"

EXPECTED_SCENES = ["1", "2", "3", "4", "5", "6", "7", "7A", "7B", "8"]
LONG_SHOT_SECONDS = 12.0
VERY_SHORT_SHOT_SECONDS = 0.75

SCENE_CAMERA_DEFAULTS = {
    "1": "办公室对话场景，建议复核为中景/近景/反应镜头组合",
    "2": "电脑屏幕与人物反应交替，建议复核为屏幕特写/人物近景",
    "3": "电话亭通话场景，建议复核为全景、近景和电话本/听筒特写",
    "4": "篮球场回忆，建议复核为运动全景、中景、投篮跟随和梦魇反应镜头",
    "5": "教室/走廊群像压迫，建议复核为主观推进、近景质问和群体凝视镜头",
    "6": "图书馆解释规则，建议复核为双人对话、借阅记录特写和天台望向镜头",
    "7": "校园奔跑阻拦，建议复核为手持跟拍、拉扯近景和奔跑远景",
    "7A": "主楼大厅道德阻拦，建议复核为碰撞全景、受伤近景和逃离镜头",
    "7B": "楼梯间拥堵突破，建议复核为拥堵全景、广播反应和爬越动作镜头",
    "8": "天台终局，建议复核为对峙中近景、异常空间远景和跃入透明薄膜镜头",
}


def load_dataset() -> dict[str, Any]:
    return json.loads(SOURCE_PATH.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def compact(value: str, limit: int = 160) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit]


def segment_label(shot: dict[str, Any]) -> str:
    return f"{shot['start_timecode']} - {shot['end_timecode']}"


def scene_map(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {scene["scene_number"]: scene for scene in data["script_scenes"]}


def assets_by_name(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {asset["name"]: asset for asset in data["assets"]}


def scene_beat(scene: dict[str, Any], shot_index_in_scene: int, scene_shot_count: int) -> str:
    if scene_shot_count <= 1:
        position = "完整场景段落"
    else:
        ratio = shot_index_in_scene / max(1, scene_shot_count - 1)
        if ratio < 0.2:
            position = "场景开端/空间建立"
        elif ratio < 0.45:
            position = "信息推进"
        elif ratio < 0.75:
            position = "冲突升级"
        else:
            position = "场景收束/转场"
    return position


def evidence_for_position(scene: dict[str, Any], shot_index_in_scene: int, scene_shot_count: int) -> str:
    paragraphs = scene.get("raw_paragraphs", [])
    if not paragraphs:
        return ""
    if scene_shot_count <= 1:
        selected = paragraphs[:4]
    else:
        start = int(len(paragraphs) * shot_index_in_scene / scene_shot_count)
        selected = paragraphs[max(0, start - 1): start + 3]
    return "\n".join(item["text"] for item in selected)[:420]


def enrich_visual_summary(shot: dict[str, Any], scene: dict[str, Any], shot_index_in_scene: int, scene_shot_count: int) -> str:
    beat = scene_beat(scene, shot_index_in_scene, scene_shot_count)
    chars = "、".join(shot.get("characters") or []) or "未明确角色"
    props = "、".join(shot.get("props") or []) or "无核心道具"
    dramatic = scene.get("dramatic_function") or "推进当前场景叙事。"
    return (
        f"{segment_label(shot)}，对齐剧本第{scene['scene_number']}场「{scene['location']}」，"
        f"属于{beat}。涉及角色：{chars}；关键道具/线索：{props}。"
        f"剧情功能：{dramatic}"
    )


def alignment_status_for(shot: dict[str, Any]) -> tuple[str, str, list[str]]:
    notes = []
    duration = float(shot["duration"])
    supplemental = shot.get("supplemental_keyframes") or []
    keyframe_exists = Path(shot["keyframe_path"]).exists()
    if not keyframe_exists:
      notes.append("关键帧文件缺失，需重新抽帧后复核。")
      return "needs_manual_review", "low", notes
    if duration > LONG_SHOT_SECONDS:
        notes.append(f"片段时长 {duration:.2f}s 超过 {LONG_SHOT_SECONDS:.0f}s，已保留补充关键帧，建议人工确认是否需要继续拆分。")
        if supplemental:
            notes.append(f"补充关键帧数量：{len(supplemental)}。")
        return "needs_manual_review", "medium", notes
    if duration < VERY_SHORT_SHOT_SECONDS:
        notes.append(f"片段时长 {duration:.2f}s 较短，可能是闪切、转场或误检切点。")
        return "auto_aligned_short_shot", "medium", notes
    return "auto_aligned_cleaned", "high", notes


def clean_edit_shots(data: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    scenes = scene_map(data)
    shots_by_scene: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for shot in data["edit_shots"]:
        shots_by_scene[shot["script_scene_number"]].append(shot)

    cleaned = []
    changed_fields = Counter()
    for shot in data["edit_shots"]:
        next_shot = dict(shot)
        scene = scenes[shot["script_scene_number"]]
        scene_shots = shots_by_scene[shot["script_scene_number"]]
        shot_index_in_scene = scene_shots.index(shot)
        scene_shot_count = len(scene_shots)

        next_summary = enrich_visual_summary(shot, scene, shot_index_in_scene, scene_shot_count)
        if next_shot.get("visual_summary") != next_summary:
            changed_fields["visual_summary"] += 1
            next_shot["visual_summary"] = next_summary

        next_camera = SCENE_CAMERA_DEFAULTS.get(shot["script_scene_number"], "镜头语言需结合关键帧复核")
        if next_shot.get("camera") != next_camera:
            changed_fields["camera"] += 1
            next_shot["camera"] = next_camera

        next_evidence = evidence_for_position(scene, shot_index_in_scene, scene_shot_count)
        if next_evidence and next_shot.get("script_evidence") != next_evidence:
            changed_fields["script_evidence"] += 1
            next_shot["script_evidence"] = next_evidence

        status, confidence, notes = alignment_status_for(shot)
        if next_shot.get("alignment_status") != status:
            changed_fields["alignment_status"] += 1
            next_shot["alignment_status"] = status
        if next_shot.get("confidence") != confidence:
            changed_fields["confidence"] += 1
            next_shot["confidence"] = confidence

        previous_notes = [
            note for note in next_shot.get("quality_notes", [])
            if "likely contains internal action or missed cuts" not in note
        ]
        next_notes = previous_notes + notes
        if next_shot.get("quality_notes") != next_notes:
            changed_fields["quality_notes"] += 1
            next_shot["quality_notes"] = next_notes

        next_shot["cleaning"] = {
            "status": status,
            "method": "script_scene_timeline_keyframe_rules",
            "cleaned_at": datetime.now().isoformat(timespec="seconds"),
            "requires_human_review": status == "needs_manual_review",
        }
        cleaned.append(next_shot)

    stats = {
        "changed_fields": dict(changed_fields),
        "status_counts": dict(Counter(shot["alignment_status"] for shot in cleaned)),
        "confidence_counts": dict(Counter(shot["confidence"] for shot in cleaned)),
        "needs_review_shots": [
            shot["shot_number"] for shot in cleaned
            if shot["alignment_status"] == "needs_manual_review"
        ],
    }
    return cleaned, stats


def refresh_filmforge_mapping(data: dict[str, Any]) -> None:
    mapped_shots = []
    timeline = []
    for shot in data["edit_shots"]:
        mapped_shots.append({
            "id": shot["shot_number"],
            "unitType": "key_image",
            "title": f"镜头 {shot['shot_number']:04d}",
            "duration": f"{shot['duration']:.1f}s",
            "durationSeconds": shot["duration"],
            "description": shot["visual_summary"],
            "sceneNumber": shot["script_scene_number"],
            "sceneHeading": shot["script_scene_heading"],
            "sourceText": shot["script_evidence"],
            "interiorExterior": "UNKNOWN",
            "timeOfDay": "",
            "scene": shot["scene"],
            "characters": shot["characters"],
            "props": shot["props"],
            "image": shot["keyframe_path"],
            "imageStatus": "succeeded",
            "videoStatus": "succeeded",
            "videoUrl": data["metadata"]["source_files"]["final_cut_video"],
            "videoAttempts": 1,
            "reviewStatus": "pending",
        })
        timeline.append({
            "id": f"timeline_{shot['shot_number']:04d}",
            "shotId": shot["shot_number"],
            "label": f"镜头 {shot['shot_number']:04d}",
            "start": shot["start"],
            "end": shot["end"],
            "duration": shot["duration"],
        })
    data["filmforge_mapping"]["shots"] = mapped_shots
    data["filmforge_mapping"]["timeline"] = timeline


def validate_cleaned(data: dict[str, Any]) -> list[str]:
    errors = []
    scene_numbers = [scene["scene_number"] for scene in data["script_scenes"]]
    if scene_numbers != EXPECTED_SCENES:
        errors.append(f"场景编号不匹配：{scene_numbers}")
    shots = data["edit_shots"]
    if abs(shots[0]["start"]) > 0.01:
        errors.append("第一条镜头未从 0s 开始。")
    video_duration = float(data["metadata"]["video"]["format"]["duration"])
    if abs(shots[-1]["end"] - video_duration) > 0.1:
        errors.append("最后一条镜头未贴近视频总时长。")
    for left, right in zip(shots, shots[1:]):
        if abs(left["end"] - right["start"]) > 0.02:
            errors.append(f"镜头时间线断档或重叠：{left['id']} -> {right['id']}")
            break
    names = assets_by_name(data)
    for shot in shots:
        for name in shot.get("characters", []) + shot.get("props", []):
            if name not in names:
                errors.append(f"{shot['id']} 引用了不存在的资产：{name}")
    missing_keyframes = [
        shot["shot_number"] for shot in shots
        if not Path(shot["keyframe_path"]).exists()
    ]
    if missing_keyframes:
        errors.append(f"关键帧缺失：{missing_keyframes[:20]}")
    return errors


def build_benchmark_policy(data: dict[str, Any]) -> dict[str, Any]:
    core_assets = [asset for asset in data["assets"] if asset.get("asset_tier") == "core"]
    return {
        "version": "0.1.0",
        "stop_condition": "score >= 90 and all hard_checks passed",
        "thresholds": {
            "overall_score": 90,
            "character_recall": 0.90,
            "scene_recall": 1.0,
            "core_prop_recall": 0.90,
            "scene_breakdown_coverage": 1.0,
            "shot_scene_alignment": 0.85,
            "image_prompt_completeness": 0.95,
            "reference_image_success": 0.90,
            "storyboard_image_consistency": 0.90,
        },
        "gold_counts": {
            "script_scenes": len(data["script_scenes"]),
            "assets": len(data["assets"]),
            "core_assets": len(core_assets),
            "edit_shots": len(data["edit_shots"]),
        },
        "required_scene_numbers": EXPECTED_SCENES,
        "required_asset_names": [asset["name"] for asset in data["assets"]],
        "core_asset_names": [asset["name"] for asset in core_assets],
        "repro_commands": {
            "clean_dataset": "python3 structured_cases/chi_qingming/clean_chi_qingming_dataset.py",
            "score_cleaned_dataset": "python3 structured_cases/chi_qingming/score_chi_qingming_benchmark.py --dataset structured_cases/chi_qingming/chi_qingming.cleaned.dataset.json",
            "run_semantic_baseline": "cd filmforge-workbench && npm run backend:iterate-standard-assets",
        },
    }


def write_report(data: dict[str, Any], stats: dict[str, Any], errors: list[str]) -> None:
    scene_counts = Counter(shot["script_scene_number"] for shot in data["edit_shots"])
    lines = [
        "# 《池清明到底是谁》数据清洗报告",
        "",
        f"- 生成时间：{datetime.now().isoformat(timespec='seconds')}",
        f"- 源数据：`{SOURCE_PATH}`",
        f"- 清洗数据：`{CLEANED_PATH}`",
        f"- 镜头总数：{len(data['edit_shots'])}",
        f"- 资产总数：{len(data['assets'])}",
        f"- 场景总数：{len(data['script_scenes'])}",
        "",
        "## 清洗规则",
        "",
        "- 保留原始数据集不覆盖，所有修改写入 cleaned dataset。",
        "- 根据剧本场景、镜头时间线、关键帧文件存在性和片段时长清洗镜头字段。",
        "- 长于 12 秒的片段保留 `needs_manual_review`，并记录补充关键帧数量。",
        "- 0.75 秒以下片段标记为短闪切候选，不强行删除。",
        "- 未做语音识别和像素级画面理解；不确定信息不伪造成确定标签。",
        "",
        "## 修改统计",
        "",
        f"- 字段修改：`{json.dumps(stats['changed_fields'], ensure_ascii=False)}`",
        f"- 对齐状态：`{json.dumps(stats['status_counts'], ensure_ascii=False)}`",
        f"- 置信度：`{json.dumps(stats['confidence_counts'], ensure_ascii=False)}`",
        "",
        "## 仍需人工复核的镜头",
        "",
        ", ".join(map(str, stats["needs_review_shots"])) or "无",
        "",
        "## 每场镜头数量",
        "",
    ]
    for scene_number in EXPECTED_SCENES:
        scene = next(scene for scene in data["script_scenes"] if scene["scene_number"] == scene_number)
        lines.append(f"- 第 {scene_number} 场 `{scene['location']}`：{scene_counts[scene_number]} 条镜头")
    lines.extend([
        "",
        "## 校验结果",
        "",
        "通过" if not errors else "需关注",
    ])
    for error in errors:
        lines.append(f"- {error}")
    lines.extend([
        "",
        "## 下一步 Goal 用法",
        "",
        "1. 先运行 benchmark 评分器，确认 cleaned dataset 自身通过硬校验。",
        "2. 用当前 FilmForge 流程跑《池清明》剧本，生成 baseline 输出。",
        "3. 将 baseline 输出与 cleaned dataset 对比，按评分低项优化语义链路和图像链路。",
        "4. 每轮保存报告；总分达到 90 且硬校验通过后停止。",
        "",
    ])
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    data = load_dataset()
    cleaned_shots, stats = clean_edit_shots(data)
    data["edit_shots"] = cleaned_shots
    data["metadata"]["schema_version"] = "0.2.0-cleaned"
    data["metadata"]["cleaning"] = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "source_dataset": str(SOURCE_PATH),
        "method": "script_scene_timeline_keyframe_rules",
        "autonomous_cleaning": True,
        "human_review_required": len(stats["needs_review_shots"]) > 0,
    }
    data["benchmark_policy"] = build_benchmark_policy(data)
    refresh_filmforge_mapping(data)
    errors = validate_cleaned(data)
    data["quality_notes"] = [
        {
            "type": "validation",
            "status": "passed" if not errors else "needs_attention",
            "messages": errors,
        },
        {
            "type": "cleaning",
            "status": "completed_with_review_flags" if stats["needs_review_shots"] else "completed",
            "messages": [
                f"Autonomous cleaning updated {sum(stats['changed_fields'].values())} field values.",
                f"{len(stats['needs_review_shots'])} long or uncertain shots remain flagged for human review.",
            ],
        },
    ]
    write_json(CLEANED_PATH, data)
    write_report(data, stats, errors)
    print(json.dumps({
        "cleaned_dataset": str(CLEANED_PATH),
        "report": str(REPORT_PATH),
        "edit_shots": len(data["edit_shots"]),
        "needs_review_shots": stats["needs_review_shots"],
        "validation_errors": errors,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
