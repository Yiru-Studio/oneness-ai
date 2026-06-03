#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


EXPECTED_SCENES = ["1", "2", "3", "4", "5", "6", "7", "7A", "7B", "8"]


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def ratio(numerator: int, denominator: int) -> float:
    return 1.0 if denominator == 0 else numerator / denominator


def hard_checks(data: dict[str, Any]) -> list[str]:
    errors = []
    scenes = [scene["scene_number"] for scene in data.get("script_scenes", [])]
    if scenes != EXPECTED_SCENES:
        errors.append(f"scene_numbers expected {EXPECTED_SCENES}, got {scenes}")
    shots = data.get("edit_shots", [])
    if not shots:
        errors.append("edit_shots is empty")
        return errors
    if abs(float(shots[0]["start"])) > 0.01:
        errors.append("first shot does not start at 0")
    video_duration = float(data["metadata"]["video"]["format"]["duration"])
    if abs(float(shots[-1]["end"]) - video_duration) > 0.1:
        errors.append("last shot does not end near video duration")
    for left, right in zip(shots, shots[1:]):
        if abs(float(left["end"]) - float(right["start"])) > 0.02:
            errors.append(f"timeline gap/overlap between {left['id']} and {right['id']}")
            break
    asset_names = {asset["name"] for asset in data.get("assets", [])}
    for shot in shots:
        for name in shot.get("characters", []) + shot.get("props", []):
            if name not in asset_names:
                errors.append(f"{shot['id']} references missing asset {name}")
    missing_keyframes = [
        shot["shot_number"] for shot in shots
        if not Path(shot.get("keyframe_path", "")).exists()
    ]
    if missing_keyframes:
        errors.append(f"missing keyframes: {missing_keyframes[:20]}")
    return errors


def score_dataset(data: dict[str, Any]) -> dict[str, Any]:
    assets = data.get("assets", [])
    shots = data.get("edit_shots", [])
    scene_numbers = {scene["scene_number"] for scene in data.get("script_scenes", [])}
    asset_names = {asset["name"] for asset in assets}
    core_assets = [asset for asset in assets if asset.get("asset_tier") == "core"]
    statuses = Counter(shot.get("alignment_status") for shot in shots)
    confidence = Counter(shot.get("confidence") for shot in shots)

    character_assets = [asset for asset in assets if asset.get("group") == "角色"]
    scene_assets = [asset for asset in assets if asset.get("group") == "场景"]
    prop_assets = [asset for asset in assets if asset.get("group") == "道具"]

    referenced_assets = set()
    for shot in shots:
        referenced_assets.update(shot.get("characters", []))
        referenced_assets.update(shot.get("props", []))

    image_prompt_ready = [
        asset for asset in assets
        if len(str(asset.get("generation_reference_prompt", ""))) >= 20
    ]
    keyframe_ready = [
        shot for shot in shots
        if Path(shot.get("keyframe_path", "")).exists()
    ]
    high_or_medium_confidence = [
        shot for shot in shots
        if shot.get("confidence") in {"high", "medium"}
    ]
    aligned_without_manual = [
        shot for shot in shots
        if shot.get("alignment_status") in {"auto_aligned_cleaned", "auto_aligned_short_shot"}
    ]

    metrics = {
        "scene_breakdown_coverage": ratio(len(scene_numbers.intersection(EXPECTED_SCENES)), len(EXPECTED_SCENES)),
        "asset_reference_integrity": ratio(len([name for name in referenced_assets if name in asset_names]), len(referenced_assets)),
        "character_asset_presence": ratio(len(character_assets), 9),
        "scene_asset_presence": ratio(len(scene_assets), 10),
        "prop_asset_presence": ratio(len(prop_assets), 12),
        "core_asset_prompt_completeness": ratio(len([asset for asset in core_assets if len(str(asset.get("generation_reference_prompt", ""))) >= 20]), len(core_assets)),
        "image_prompt_completeness": ratio(len(image_prompt_ready), len(assets)),
        "keyframe_coverage": ratio(len(keyframe_ready), len(shots)),
        "shot_alignment_clean_rate": ratio(len(aligned_without_manual), len(shots)),
        "shot_confidence_medium_plus": ratio(len(high_or_medium_confidence), len(shots)),
    }
    weights = {
        "scene_breakdown_coverage": 14,
        "asset_reference_integrity": 12,
        "character_asset_presence": 8,
        "scene_asset_presence": 8,
        "prop_asset_presence": 8,
        "core_asset_prompt_completeness": 10,
        "image_prompt_completeness": 10,
        "keyframe_coverage": 10,
        "shot_alignment_clean_rate": 10,
        "shot_confidence_medium_plus": 10,
    }
    overall = sum(metrics[name] * weight for name, weight in weights.items())
    return {
        "overall_score": round(overall, 2),
        "metrics": {name: round(value, 4) for name, value in metrics.items()},
        "counts": {
            "assets": len(assets),
            "characters": len(character_assets),
            "scenes": len(scene_assets),
            "props": len(prop_assets),
            "core_assets": len(core_assets),
            "edit_shots": len(shots),
            "alignment_status": dict(statuses),
            "confidence": dict(confidence),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()

    data = load(Path(args.dataset))
    errors = hard_checks(data)
    score = score_dataset(data)
    policy = data.get("benchmark_policy", {})
    threshold = float(policy.get("thresholds", {}).get("overall_score", 90))
    result = {
        "dataset": args.dataset,
        "ok": not errors and score["overall_score"] >= threshold,
        "threshold": threshold,
        "hard_check_errors": errors,
        **score,
    }
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    print(text)
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
