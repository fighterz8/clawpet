#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from avatar_providers import get_provider

REQUIRED_STATES = ["idle", "thinking", "focused", "happy", "alert", "sleepy"]
ACTIVE_STATES = ["thinking", "focused", "happy", "alert", "sleepy"]
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CLAWPALS_CLI = Path.home() / ".openclaw/workspace/skills/clawpals/bin/clawpals.mjs"
DEFAULT_BUILD_SCRIPT = ROOT / "scripts/build_avatar_bundle.py"
DEFAULT_ANIMATE_SCRIPT = ROOT / "scripts/animate_avatar_frames.py"
DEFAULT_SLICE_SHEET_SCRIPT = ROOT / "scripts/slice_avatar_sheet.py"
DEFAULT_STAGE_ROOT = ROOT / ".avatar-pipeline"
BG_RULE = {"g_min": 200, "r_max": 80, "b_max": 150}


class PipelineError(RuntimeError):
    pass


@dataclass
class PipelinePaths:
    manifest_path: Path
    stage_dir: Path
    build_spec_path: Path
    prompt_plan_path: Path
    coherency_report_path: Path
    post_build_coherency_report_path: Path
    repair_queue_path: Path
    contact_sheet_path: Path
    vision_qa_report_path: Path
    qa_report_path: Path
    overlay_32_path: Path
    silhouette_32_path: Path
    state_delta_32_path: Path
    bundle_dir: Path
    preview_gif: Path


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise PipelineError(f"Manifest not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise PipelineError(f"Invalid JSON in {path}: {exc}") from exc


def resolve_path(value: str | None, *, base: Path) -> Path | None:
    if value is None:
        return None
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = (base / path).resolve()
    return path


def normalize_manifest(raw: dict[str, Any], manifest_path: Path) -> dict[str, Any]:
    manifest_dir = manifest_path.parent.resolve()
    job_id = raw.get("id")
    name = raw.get("name")
    version = raw.get("version")
    if not job_id or not isinstance(job_id, str):
        raise PipelineError("Manifest requires string field: id")
    if not name or not isinstance(name, str):
        raise PipelineError("Manifest requires string field: name")
    if not version or not isinstance(version, str):
        raise PipelineError("Manifest requires string field: version")

    mode = raw.get("mode", "local-only")
    if mode not in {"local-only", "repo"}:
        raise PipelineError("Manifest field mode must be 'local-only' or 'repo'")

    stage_root = resolve_path(raw.get("stageRoot"), base=manifest_dir) or DEFAULT_STAGE_ROOT
    output_root = resolve_path(raw.get("outputRoot"), base=manifest_dir)
    if output_root is None:
        output_root = (Path.home() / ".openclaw/workspace/local_avatars" / job_id / "bundle") if mode == "local-only" else (ROOT / "public/avatars" / job_id)

    preview_gif = resolve_path(raw.get("previewGif"), base=manifest_dir) or (output_root.parent / f"{job_id}-preview.gif")

    states_raw = raw.get("states")
    if not isinstance(states_raw, dict):
        raise PipelineError("Manifest requires object field: states")

    normalized_states: dict[str, dict[str, Any]] = {}
    missing = [state for state in REQUIRED_STATES if state not in states_raw]
    if missing:
        raise PipelineError(f"Manifest missing required states: {', '.join(missing)}")

    for state in REQUIRED_STATES:
        entry = states_raw[state]
        if not isinstance(entry, dict):
            raise PipelineError(f"State '{state}' must be an object")
        frames = entry.get("frames")
        fps = entry.get("fps")
        if not isinstance(frames, list) or not frames or not all(isinstance(item, str) for item in frames):
            raise PipelineError(f"State '{state}' requires non-empty string[] field: frames")
        if not isinstance(fps, int) or fps <= 0:
            raise PipelineError(f"State '{state}' requires positive integer field: fps")
        normalized_states[state] = {
            "frames": [str(resolve_path(item, base=manifest_dir)) for item in frames],
            "fps": fps,
            "motionRecipe": entry.get("motionRecipe", "subtle state-appropriate motion"),
            "anchorPath": str(resolve_path(entry["anchorPath"], base=manifest_dir)) if entry.get("anchorPath") else str(resolve_path(frames[0], base=manifest_dir)),
            "animationMode": entry.get("animationMode"),
            "framePlan": entry.get("framePlan"),
        }

    generation = raw.get("generation", {})
    if not isinstance(generation, dict):
        raise PipelineError("Manifest field generation must be an object when provided")
    pipeline_job_schema_version = raw.get("pipelineJobSchemaVersion")
    registration = raw.get("registration", {"mode": "legacy-crop", "targetCanvasPx": 256, "legacyCropAllowed": True})
    if not isinstance(registration, dict):
        raise PipelineError("Manifest field registration must be an object when provided")
    coherency = raw.get("coherency", {})
    if not isinstance(coherency, dict):
        raise PipelineError("Manifest field coherency must be an object when provided")

    defaults = {
        "minFramesPerState": 3,
        "maxRepairAttempts": 3,
        "bboxTolerancePct": 0.18,
        "centerTolerancePct": 0.12,
        "paletteTolerancePct": 0.35,
        "minUniqueFramesPerState": 3,
        "overlayReadabilityPx": 32,
        "minInternalDelta32Px": 4,
        "accessoryOnlyInternalRatio": 0.25,
        "maxWraparoundJumpRatio": 1.6,
        "stateThresholds": {
            "thinking": {"minInternalDelta32Px": 5, "accessoryOnlyFails": True},
            "focused": {"minInternalDelta32Px": 4, "requiresPositiveCue": True, "accessoryOnlyFails": True},
            "happy": {"minInternalDelta32Px": 7, "accessoryOnlyFails": True},
            "alert": {"minInternalDelta32Px": 6, "accessoryOnlyFails": True},
            "sleepy": {"minInternalDelta32Px": 5, "accessoryOnlyFails": True},
        },
        "requiredChecks": ["silhouette", "palette", "face", "proportions", "framing", "stateExpression"],
    }
    defaults.update(coherency)

    return {
        "id": job_id,
        "name": name,
        "version": version,
        "description": raw.get("description", ""),
        "mode": mode,
        "pushAfterBuild": bool(raw.get("pushAfterBuild", False)),
        "targetRuntime": raw.get("targetRuntime", "current-paired-runtime"),
        "stageRoot": str(stage_root),
        "outputRoot": str(output_root),
        "previewGif": str(preview_gif),
        "states": normalized_states,
        "pipelineJobSchemaVersion": pipeline_job_schema_version,
        "generation": generation,
        "registration": registration,
        "coherency": defaults,
        "manifestDir": str(manifest_dir),
    }


def compute_paths(manifest: dict[str, Any], manifest_path: Path) -> PipelinePaths:
    stage_dir = Path(manifest["stageRoot"]) / manifest["id"]
    return PipelinePaths(
        manifest_path=manifest_path.resolve(),
        stage_dir=stage_dir,
        build_spec_path=stage_dir / "build-spec.generated.json",
        prompt_plan_path=stage_dir / "prompt-plan.generated.json",
        coherency_report_path=stage_dir / "coherency-report.generated.json",
        post_build_coherency_report_path=stage_dir / "post-build-coherency-report.generated.json",
        repair_queue_path=stage_dir / "repair-queue.generated.json",
        contact_sheet_path=stage_dir / "contact-sheet.generated.png",
        vision_qa_report_path=stage_dir / "vision-qa-report.generated.json",
        qa_report_path=stage_dir / "qa-report.generated.json",
        overlay_32_path=stage_dir / "overlay-32.generated.png",
        silhouette_32_path=stage_dir / "silhouette-32.generated.png",
        state_delta_32_path=stage_dir / "state-delta-32.generated.png",
        bundle_dir=Path(manifest["outputRoot"]),
        preview_gif=Path(manifest["previewGif"]),
    )


def render_build_spec(manifest: dict[str, Any], paths: PipelinePaths) -> dict[str, Any]:
    return {
        "outputDir": str(paths.bundle_dir),
        "previewGif": str(paths.preview_gif),
        "name": manifest["name"],
        "version": manifest["version"],
        "description": manifest.get("description", ""),
        "states": {state: entry["frames"] for state, entry in manifest["states"].items()},
        "fps": {state: entry["fps"] for state, entry in manifest["states"].items()},
        "sourceImageContract": manifest.get("generation", {}).get("sourceImageContract", {}),
        "registration": manifest.get("registration", {"mode": "legacy-crop", "targetCanvasPx": 256}),
    }


def render_prompt_plan(manifest: dict[str, Any]) -> dict[str, Any]:
    gen = manifest.get("generation", {})
    locked = gen.get("locked", {})
    plan: dict[str, Any] = {
        "job": {k: manifest[k] for k in ["id", "name", "version", "mode", "targetRuntime"]},
        "coreConcept": gen.get("coreConcept", manifest.get("description", "")),
        "lockedCharacter": locked,
        "goldenAcceptanceProfile": {
            "profile": gen.get("acceptanceProfile", "golden-avatar-v0.6"),
            "goldens": ["dawn-v2-ember", "lantern-moth-v0", "glass-toad-v0"],
            "rules": [
                "Each state must be the same character performing a different emotion/state, not six similar stickers.",
                "State readability must be character-led through eyes, mouth, posture, body energy, or signature feature; floating symbols are support only.",
                "The silhouette needs one memorable identity hook that remains readable at desktop-overlay scale.",
                "Palette, outline weight, pixel density, lighting, camera angle, proportions, and framing stay locked.",
                "Reject designs that need arbitrary rectangular section-splitting to simulate motion.",
                "Reject pasted-on props, text, watermark, background leakage, neighboring sprite bleed, and stray edge pixels.",
            ],
        },
        "coherencyContract": manifest["coherency"],
        "states": {},
    }
    for state in REQUIRED_STATES:
        entry = manifest["states"][state]
        state_acting = gen.get("stateActing", {}).get(state, "") if isinstance(gen.get("stateActing"), dict) else ""
        prompts = []
        for i, frame in enumerate(entry["frames"]):
            if i == 0:
                acting_clause = f" Character-led acting requirement: {state_acting}." if state_acting else ""
                prompt = f"Create the {state} anchor for {manifest['name']}. Preserve the locked character identity and define this state's expression clearly.{acting_clause} Do not rely on floating symbols alone."
            else:
                prompt = (
                    f"Repair-safe frame delta for {manifest['name']} / {state} frame {i}. "
                    f"Use the state anchor as the source image. Apply only: {entry['motionRecipe']}. "
                    "Do not redesign the character, palette, eyes, silhouette, proportions, or framing. If in doubt, do less."
                )
            prompts.append({"index": i, "currentFramePath": frame, "prompt": prompt})
        plan["states"][state] = {"fps": entry["fps"], "motionRecipe": entry["motionRecipe"], "stateActing": state_acting, "frames": prompts}
    return plan


def remove_green_and_bbox(path: Path) -> tuple[Image.Image, tuple[int, int, int, int] | None]:
    im = Image.open(path).convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if g > BG_RULE["g_min"] and r < BG_RULE["r_max"] and b < BG_RULE["b_max"]:
                px[x, y] = (0, 0, 0, 0)
    return im, im.getbbox()


def frame_metrics(path: Path) -> dict[str, Any]:
    im, bbox = remove_green_and_bbox(path)
    if bbox is None:
        return {"path": str(path), "bbox": None, "center": None, "palette": [], "opaquePixels": 0}
    x0, y0, x1, y1 = bbox
    crop = im.crop(bbox)
    pixels = [p for p in crop.getdata() if p[3] > 0]
    quantized = Counter((r // 16 * 16, g // 16 * 16, b // 16 * 16) for r, g, b, _ in pixels)
    palette = [list(rgb) for rgb, _ in quantized.most_common(12)]
    return {
        "path": str(path),
        "bbox": [x0, y0, x1, y1],
        "size": [x1 - x0, y1 - y0],
        "center": [(x0 + x1) / 2 / im.width, (y0 + y1) / 2 / im.height],
        "palette": palette,
        "opaquePixels": len(pixels),
    }


def pct_diff(a: float, b: float) -> float:
    denom = max(abs(a), abs(b), 1.0)
    return abs(a - b) / denom


def palette_overlap(a: list[list[int]], b: list[list[int]]) -> float:
    if not a or not b:
        return 0.0
    aset = {tuple(x) for x in a}
    bset = {tuple(x) for x in b}
    return len(aset & bset) / max(len(aset | bset), 1)


def load_rgba(path: str | Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def alpha_mask(im: Image.Image, *, size: int | None = None, expand: int = 0) -> Image.Image:
    src = im.convert("RGBA")
    if size:
        src = src.resize((size, size), Image.Resampling.LANCZOS)
    mask = src.getchannel("A").point(lambda px: 255 if px > 24 else 0)
    if expand:
        mask = mask.filter(ImageFilter.MaxFilter(expand * 2 + 1))
    return mask


def changed_mask(a: Image.Image, b: Image.Image, *, size: int = 32, threshold: int = 24) -> Image.Image:
    aa = a.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    bb = b.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    diff = ImageChops.difference(aa, bb).convert("RGBA")
    out = Image.new("L", (size, size), 0)
    opx = out.load(); dpx = diff.load()
    for y in range(size):
        for x in range(size):
            r, g, bch, al = dpx[x, y]
            if max(r, g, bch, al) > threshold:
                opx[x, y] = 255
    return out


def count_mask(mask: Image.Image) -> int:
    return sum(1 for px in mask.getdata() if px > 0)


def mask_intersection_count(a: Image.Image, b: Image.Image) -> int:
    return sum(1 for apx, bpx in zip(a.getdata(), b.getdata()) if apx > 0 and bpx > 0)


def image_hash(im: Image.Image, *, size: int = 32) -> bytes:
    small = im.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    return small.tobytes()


def frame_diff_ratio(a: Image.Image, b: Image.Image, *, size: int = 64, threshold: int = 18) -> float:
    mask = changed_mask(a, b, size=size, threshold=threshold)
    return count_mask(mask) / float(size * size)


def bbox_from_mask(mask: Image.Image) -> tuple[int, int, int, int] | None:
    return mask.getbbox()


def silhouette_iou(a: Image.Image, b: Image.Image, *, size: int = 32) -> float:
    am = alpha_mask(a, size=size)
    bm = alpha_mask(b, size=size)
    inter = sum(1 for apx, bpx in zip(am.getdata(), bm.getdata()) if apx and bpx)
    union = sum(1 for apx, bpx in zip(am.getdata(), bm.getdata()) if apx or bpx)
    return inter / max(union, 1)


def write_qa_review_sheets(manifest: dict[str, Any], paths: PipelinePaths, *, size: int = 32) -> None:
    scale = 4
    tile = size * scale
    label_h = 16
    cols = max(len(entry["frames"]) for entry in manifest["states"].values())
    rows = len(REQUIRED_STATES)
    overlay = Image.new("RGBA", (cols * tile, rows * (tile + label_h)), (22, 24, 32, 255))
    silhouette = Image.new("RGBA", overlay.size, (22, 24, 32, 255))
    delta = Image.new("RGBA", overlay.size, (22, 24, 32, 255))
    idle = load_rgba(manifest["states"]["idle"]["frames"][0])
    for r, state in enumerate(REQUIRED_STATES):
        for c, frame in enumerate(manifest["states"][state]["frames"]):
            x = c * tile
            y = r * (tile + label_h) + label_h
            im = load_rgba(frame).resize((size, size), Image.Resampling.LANCZOS).resize((tile, tile), Image.Resampling.NEAREST)
            overlay.alpha_composite(im, (x, y))
            sm = alpha_mask(load_rgba(frame), size=size).resize((tile, tile), Image.Resampling.NEAREST)
            sil = Image.new("RGBA", (tile, tile), (0, 0, 0, 0))
            ImageDraw.Draw(sil).bitmap((0, 0), sm, fill=(255, 255, 255, 255))
            silhouette.alpha_composite(sil, (x, y))
            dm = changed_mask(idle, load_rgba(frame), size=size).resize((tile, tile), Image.Resampling.NEAREST)
            dimg = Image.new("RGBA", (tile, tile), (0, 0, 0, 0))
            ImageDraw.Draw(dimg).bitmap((0, 0), dm, fill=(255, 95, 80, 255))
            delta.alpha_composite(dimg, (x, y))
    overlay.save(paths.overlay_32_path)
    silhouette.save(paths.silhouette_32_path)
    delta.save(paths.state_delta_32_path)


def generate_coherency_report(manifest: dict[str, Any]) -> dict[str, Any]:
    cfg = manifest["coherency"]
    report: dict[str, Any] = {"ok": True, "job": manifest["id"], "states": {}, "repairQueue": []}
    for state in REQUIRED_STATES:
        frames = [Path(p) for p in manifest["states"][state]["frames"]]
        metrics = [frame_metrics(p) for p in frames]
        anchor = metrics[0]
        issues = []
        if len(frames) < int(cfg["minFramesPerState"]):
            issues.append({"frame": "state", "severity": "fail", "reason": f"only {len(frames)} frames; expected at least {cfg['minFramesPerState']}"})
        for i, metric in enumerate(metrics[1:], start=1):
            frame_issues = []
            if not anchor["bbox"] or not metric["bbox"]:
                frame_issues.append("missing opaque character silhouette")
            else:
                aw, ah = anchor["size"]
                mw, mh = metric["size"]
                if pct_diff(aw, mw) > float(cfg["bboxTolerancePct"]) or pct_diff(ah, mh) > float(cfg["bboxTolerancePct"]):
                    frame_issues.append("silhouette/proportion drift: bbox size changed too much")
                acx, acy = anchor["center"]
                mcx, mcy = metric["center"]
                if abs(acx - mcx) > float(cfg["centerTolerancePct"]) or abs(acy - mcy) > float(cfg["centerTolerancePct"]):
                    frame_issues.append("framing drift: character center moved too far")
                if 1 - palette_overlap(anchor["palette"], metric["palette"]) > float(cfg["paletteTolerancePct"]):
                    frame_issues.append("palette drift: dominant colors changed too much")
            if frame_issues:
                report["ok"] = False
                repair = {
                    "state": state,
                    "frameIndex": i,
                    "path": str(frames[i]),
                    "anchorPath": str(frames[0]),
                    "failures": frame_issues,
                    "repairPrompt": (
                        f"REPAIR MODE for {manifest['name']} {state} frame {i}. Previous frame drifted: "
                        + "; ".join(frame_issues)
                        + f". Use anchor {frames[0]} and apply only this state motion: {manifest['states'][state]['motionRecipe']}. Keep silhouette, palette, face/eyes, proportions, and framing coherent."
                    ),
                }
                report["repairQueue"].append(repair)
                issues.append(repair)
        report["states"][state] = {"anchor": anchor, "frames": metrics, "issues": issues}
    return report


def generate_qa_report(manifest: dict[str, Any], paths: PipelinePaths) -> dict[str, Any]:
    cfg = manifest["coherency"]
    size = int(cfg.get("overlayReadabilityPx", 32))
    state_thresholds = cfg.get("stateThresholds", {}) if isinstance(cfg.get("stateThresholds"), dict) else {}
    idle_anchor = load_rgba(manifest["states"]["idle"]["frames"][0])
    idle_body_mask = alpha_mask(idle_anchor, size=size, expand=1)
    report: dict[str, Any] = {
        "ok": True,
        "job": manifest["id"],
        "profile": manifest.get("generation", {}).get("acceptanceProfile"),
        "source": "source-frames",
        "artifacts": {
            "overlay32": str(paths.overlay_32_path),
            "silhouette32": str(paths.silhouette_32_path),
            "stateDelta32": str(paths.state_delta_32_path),
        },
        "states": {},
        "failures": [],
    }

    # Gate 1: materialized frames/anchors. Sprite-sheet experiments must be sliced
    # before QA; otherwise all states can point at the same sheet and still look valid.
    anchor_paths: dict[str, str] = {}
    for state in REQUIRED_STATES:
        anchor = Path(manifest["states"][state].get("anchorPath") or manifest["states"][state]["frames"][0])
        frames = [Path(p) for p in manifest["states"][state]["frames"]]
        if len(set(str(p) for p in frames)) == 1 and len(frames) > 1:
            report["failures"].append({"gate": "materialized-frames", "state": state, "reason": "state frames still point to the same source image"})
        anchor_paths[state] = str(anchor.resolve()) if anchor.exists() else str(anchor)
    duplicate_anchor_states = sorted({state for state, p in anchor_paths.items() if list(anchor_paths.values()).count(p) > 1})
    if duplicate_anchor_states:
        report["failures"].append({"gate": "materialized-anchors", "states": duplicate_anchor_states, "reason": "multiple state anchors are pixel-identical at 32px"})

    for state in REQUIRED_STATES:
        frames = [load_rgba(p) for p in manifest["states"][state]["frames"]]
        anchor = frames[0]
        state_issues: list[dict[str, Any]] = []
        metrics = frame_metrics(Path(manifest["states"][state]["frames"][0]))
        anchor_iou = silhouette_iou(idle_anchor, anchor, size=size) if state != "idle" else 1.0
        internal_changed = accessory_changed = changed_total = 0
        if state != "idle":
            diff = changed_mask(idle_anchor, anchor, size=size)
            changed_total = count_mask(diff)
            internal_changed = mask_intersection_count(diff, idle_body_mask)
            accessory_changed = max(0, changed_total - internal_changed)
            thresholds = state_thresholds.get(state, {}) if isinstance(state_thresholds.get(state), dict) else {}
            min_internal = int(thresholds.get("minInternalDelta32Px", cfg.get("minInternalDelta32Px", 4)))
            accessory_only_fails = bool(thresholds.get("accessoryOnlyFails", True))
            internal_ratio = internal_changed / max(changed_total, 1)
            if internal_changed < min_internal:
                state_issues.append({"gate": "intrinsic-acting", "reason": f"only {internal_changed} internal changed pixels at {size}px; expected >= {min_internal}"})
            if accessory_only_fails and changed_total > 0 and internal_ratio < float(cfg.get("accessoryOnlyInternalRatio", 0.35)):
                state_issues.append({"gate": "accessory-only-acting", "reason": f"internal delta ratio {internal_ratio:.2f}; emotion likely carried by external symbol/accessory"})
            if state == "focused" and internal_changed < max(min_internal, 4):
                state_issues.append({"gate": "focused-positive-cue", "reason": "focused is too close to idle internally"})
            min_iou = float(cfg.get("minSilhouetteIouVsIdle", 0.60))
            if anchor_iou < min_iou:
                state_issues.append({"gate": "cross-state-identity", "reason": f"silhouette IoU vs idle is {anchor_iou:.2f}; expected >= {min_iou:.2f}"})

        unique_frame_hashes = {image_hash(frame) for frame in frames}
        min_unique = min(int(cfg.get("minUniqueFramesPerState", 3)), len(frames))
        motion = [frame_diff_ratio(a, b) for a, b in zip(frames, frames[1:])]
        wrap = frame_diff_ratio(frames[-1], frames[0]) if len(frames) > 1 else 0.0
        avg_motion = sum(motion) / max(len(motion), 1)
        if len(frames) < int(cfg.get("minFramesPerState", 3)):
            state_issues.append({"gate": "loop-frame-count", "reason": f"only {len(frames)} frames"})
        if len(unique_frame_hashes) < min_unique:
            state_issues.append({"gate": "loop-unique-frames", "reason": f"only {len(unique_frame_hashes)} unique frame(s); expected >= {min_unique}"})
        if motion and avg_motion > 0 and wrap > avg_motion * float(cfg.get("maxWraparoundJumpRatio", 1.6)):
            state_issues.append({"gate": "loop-wraparound", "reason": f"wraparound jump {wrap:.3f} is too large versus avg motion {avg_motion:.3f}"})

        state_ok = not state_issues
        if not state_ok:
            report["failures"].extend({"state": state, **issue} for issue in state_issues)
        report["states"][state] = {
            "ok": state_ok,
            "anchorMetrics": metrics,
            "silhouetteIouVsIdle": anchor_iou,
            "stateDelta32": {"total": changed_total, "internal": internal_changed, "accessory": accessory_changed},
            "loopQuality": {"frames": len(frames), "uniqueFrames": len(unique_frame_hashes), "avgMotionPct": avg_motion, "wraparoundMotionPct": wrap},
            "issues": state_issues,
        }
    report["ok"] = not report["failures"]
    return report



def manifest_for_built_bundle(manifest: dict[str, Any], paths: PipelinePaths) -> dict[str, Any]:
    built = dict(manifest)
    built_states: dict[str, dict[str, Any]] = {}
    for state, entry in manifest["states"].items():
        frame_count = len(entry["frames"])
        built_states[state] = {
            **entry,
            "frames": [str(paths.bundle_dir / "frames" / f"{state}-{i:02d}.png") for i in range(frame_count)],
        }
    built["states"] = built_states
    return built


def write_contact_sheet(manifest: dict[str, Any], paths: PipelinePaths, *, source: str = "post-build") -> None:
    thumb = 96
    label_h = 18
    pad = 8
    max_frames = max(len(entry["frames"]) for entry in manifest["states"].values())
    width = pad + max_frames * (thumb + pad)
    height = pad + len(REQUIRED_STATES) * (thumb + label_h + pad)
    sheet = Image.new("RGBA", (width, height), (18, 20, 30, 255))
    for row, state in enumerate(REQUIRED_STATES):
        y = pad + row * (thumb + label_h + pad)
        for col, frame in enumerate(manifest["states"][state]["frames"]):
            x = pad + col * (thumb + pad)
            try:
                im = Image.open(frame).convert("RGBA")
                im.thumbnail((thumb, thumb), Image.Resampling.NEAREST)
                tile = Image.new("RGBA", (thumb, thumb), (36, 39, 52, 255))
                tile.alpha_composite(im, ((thumb - im.width) // 2, (thumb - im.height) // 2))
            except Exception:
                tile = Image.new("RGBA", (thumb, thumb), (120, 20, 35, 255))
            sheet.alpha_composite(tile, (x, y + label_h))
    paths.contact_sheet_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(paths.contact_sheet_path)


def write_post_build_artifacts(manifest: dict[str, Any], paths: PipelinePaths) -> dict[str, Any]:
    built_manifest = manifest_for_built_bundle(manifest, paths)
    report = generate_coherency_report(built_manifest)
    report["source"] = "post-build-bundle-frames"
    paths.post_build_coherency_report_path.write_text(json.dumps(report, indent=2) + "\n")
    paths.repair_queue_path.write_text(json.dumps({"ok": report["ok"], "source": "post-build-bundle-frames", "repairQueue": report["repairQueue"]}, indent=2) + "\n")
    write_contact_sheet(built_manifest, paths)
    return report

def validate_manifest(manifest: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    generation = manifest.get("generation", {})
    strategy = generation.get("strategy")
    source_contract = generation.get("sourceImageContract", {})
    locked = generation.get("locked", {})
    registration = manifest.get("registration", {})
    if strategy:
        if strategy not in {"anchors-plus-deterministic-motion", "manual-frames", "sprite-sheet-experiment", "reference-edit-motion"}:
            problems.append(f"Unknown generation.strategy: {strategy}")
        background = source_contract.get("background")
        chroma_key = source_contract.get("chromaKey")
        if background not in {"transparent-alpha", "chroma-green"}:
            problems.append("generation.sourceImageContract.background must be either 'transparent-alpha' or 'chroma-green'")
        if background == "transparent-alpha" and chroma_key:
            problems.append("transparent-alpha source contract must not also set chromaKey")
        if background == "chroma-green" and not chroma_key:
            problems.append("chroma-green source contract requires chromaKey, e.g. '#00ff66'")
        for required in ["logicalCanvas", "exportSize", "preserveCanvas"]:
            if required not in source_contract:
                problems.append(f"generation.sourceImageContract missing required field for strategy jobs: {required}")
        if not locked.get("paletteHex") or not all(isinstance(x, str) and x.startswith("#") for x in locked.get("paletteHex", [])):
            problems.append("generation.locked.paletteHex must contain exact hex colors for strategy jobs")
        if not isinstance(locked.get("outlineHex"), str) or not locked.get("outlineHex", "").startswith("#"):
            problems.append("generation.locked.outlineHex must be an exact hex color for strategy jobs")
        acceptance_profile = generation.get("acceptanceProfile")
        if acceptance_profile and acceptance_profile not in {"golden-avatar-v0.6"}:
            problems.append("generation.acceptanceProfile must be 'golden-avatar-v0.6' when provided")
        if acceptance_profile == "golden-avatar-v0.6":
            for required in ["signatureFeature", "silhouette", "poseFraming"]:
                if not isinstance(locked.get(required), str) or len(locked.get(required, "").strip()) < 12:
                    problems.append(f"generation.locked.{required} must describe a specific golden-profile identity constraint")
            forbidden = locked.get("forbiddenChanges", [])
            if not isinstance(forbidden, list) or len(forbidden) < 6:
                problems.append("generation.locked.forbiddenChanges should lock species, silhouette, palette, outline, proportions, camera, and framing")
            state_acting = generation.get("stateActing")
            if not isinstance(state_acting, dict):
                problems.append("generation.stateActing is required for golden-avatar-v0.6 jobs")
            else:
                missing_acting = [state for state in ACTIVE_STATES if not isinstance(state_acting.get(state), str) or len(state_acting.get(state, "").strip()) < 20]
                if missing_acting:
                    problems.append("generation.stateActing must describe character-led acting for: " + ", ".join(missing_acting))
                symbol_only = [state for state, desc in state_acting.items() if isinstance(desc, str) and any(word in desc.lower() for word in ["only", "just", "mostly"]) and any(sym in desc.lower() for sym in ["symbol", "icon", "question", "heart", "sparkle", "z"])]
                if symbol_only:
                    problems.append("generation.stateActing cannot rely mostly/only on floating symbols for: " + ", ".join(symbol_only))
    mode = registration.get("mode", "legacy-crop")
    if mode not in {"preserve-canvas", "anchor-locked", "legacy-crop"}:
        problems.append("registration.mode must be preserve-canvas, anchor-locked, or legacy-crop")
    if mode == "legacy-crop" and registration.get("legacyCropAllowed") is False:
        problems.append("registration.mode is legacy-crop but legacyCropAllowed=false")
    target_canvas = registration.get("targetCanvasPx", 256)
    if not isinstance(target_canvas, int) or target_canvas <= 0:
        problems.append("registration.targetCanvasPx must be a positive integer")
    for state in REQUIRED_STATES:
        entry = manifest["states"][state]
        if len(entry["frames"]) < 2:
            problems.append(f"State '{state}' only has {len(entry['frames'])} frame(s); animated bundles should usually have at least 2.")
        for frame in entry["frames"]:
            if not Path(frame).exists():
                problems.append(f"Missing frame file for state '{state}': {frame}")
    return problems


def write_stage_files(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    paths.stage_dir.mkdir(parents=True, exist_ok=True)
    paths.build_spec_path.write_text(json.dumps(render_build_spec(manifest, paths), indent=2) + "\n")
    paths.prompt_plan_path.write_text(json.dumps(render_prompt_plan(manifest), indent=2) + "\n")


def run_command(command: list[str], *, cwd: Path | None = None, capture: bool = False) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(command, cwd=str(cwd) if cwd else None, check=True, text=True, capture_output=capture)
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr or exc.stdout or str(exc)
        raise PipelineError(f"Command failed: {' '.join(command)}\n{detail.strip()}") from exc


def action_scaffold(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    write_stage_files(manifest, paths)
    print(f"Scaffolded build spec: {paths.build_spec_path}")
    print(f"Scaffolded prompt plan: {paths.prompt_plan_path}")
    print(f"Bundle output dir: {paths.bundle_dir}")
    print(f"Preview gif: {paths.preview_gif}")


def action_emit_prompts(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    write_stage_files(manifest, paths)
    print(json.dumps(render_prompt_plan(manifest), indent=2))


def action_coherency_report(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    write_stage_files(manifest, paths)
    problems = validate_manifest(manifest)
    if problems:
        raise PipelineError("Cannot run coherency report until basic validation passes:\n- " + "\n- ".join(problems))
    report = generate_coherency_report(manifest)
    paths.coherency_report_path.write_text(json.dumps(report, indent=2) + "\n")
    paths.repair_queue_path.write_text(json.dumps({"ok": report["ok"], "source": "source-frames", "repairQueue": report["repairQueue"]}, indent=2) + "\n")
    print(json.dumps({"ok": report["ok"], "repairCount": len(report["repairQueue"]), "report": str(paths.coherency_report_path), "repairQueue": str(paths.repair_queue_path)}, indent=2))


def action_qa(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    write_stage_files(manifest, paths)
    problems = validate_manifest(manifest)
    if problems:
        raise PipelineError("Cannot run QA until basic validation passes:\n- " + "\n- ".join(problems))
    paths.stage_dir.mkdir(parents=True, exist_ok=True)
    write_qa_review_sheets(manifest, paths, size=int(manifest["coherency"].get("overlayReadabilityPx", 32)))
    report = generate_qa_report(manifest, paths)
    paths.qa_report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"ok": report["ok"], "failureCount": len(report["failures"]), "report": str(paths.qa_report_path), "overlay32": str(paths.overlay_32_path), "silhouette32": str(paths.silhouette_32_path), "stateDelta32": str(paths.state_delta_32_path)}, indent=2))
    if not report["ok"]:
        raise PipelineError(f"QA failed with {len(report['failures'])} issue(s). See {paths.qa_report_path}")


def action_validate(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    write_stage_files(manifest, paths)
    problems = validate_manifest(manifest)
    if problems:
        raise PipelineError("Validation failed:\n- " + "\n- ".join(problems))
    print(f"Validation passed for {manifest['name']} ({manifest['id']})")
    print(f"Generated build spec: {paths.build_spec_path}")
    print(f"Generated prompt plan: {paths.prompt_plan_path}")


def action_slice_sheet(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    write_stage_files(manifest, paths)
    sliced_manifest = paths.stage_dir / "sliced-job.generated.json"
    run_command([sys.executable, str(DEFAULT_SLICE_SHEET_SCRIPT), str(paths.manifest_path), str(sliced_manifest)], cwd=ROOT)


def action_generate(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    provider_name = manifest.get("generation", {}).get("provider", "none")
    try:
        provider = get_provider(provider_name)
    except ValueError as exc:
        raise PipelineError(str(exc)) from exc
    anchors_dir = paths.stage_dir / "generated-anchors"
    anchors_dir.mkdir(parents=True, exist_ok=True)
    identity = provider.generate_identity_anchor(manifest, anchors_dir)
    generated: dict[str, Any] = {"ok": True, "provider": provider_name, "identityAnchor": str(identity.path), "states": {}}
    job = load_json(paths.manifest_path)
    manifest_dir = paths.manifest_path.parent.resolve()
    for state in REQUIRED_STATES:
        result = provider.generate_state_anchor(manifest, state, identity.path, anchors_dir)
        generated["states"][state] = {"anchorPath": str(result.path), "metadata": result.metadata}
        entry = job.setdefault("states", {}).setdefault(state, {})
        rel_or_abs = str(result.path)
        entry["anchorPath"] = rel_or_abs
        entry["frames"] = [rel_or_abs]
        entry["animationMode"] = "deterministic"
        entry.setdefault("fps", manifest["states"][state]["fps"])
    generated_job = paths.stage_dir / "generated-job.generated.json"
    generated_report = paths.stage_dir / "generation-report.generated.json"
    generated_job.write_text(json.dumps(job, indent=2) + "\n")
    generated_report.write_text(json.dumps(generated, indent=2) + "\n")
    print(json.dumps({"ok": True, "provider": provider_name, "generatedJob": str(generated_job), "report": str(generated_report), "anchorsDir": str(anchors_dir)}, indent=2))


def action_animate(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    write_stage_files(manifest, paths)
    animated_manifest = paths.stage_dir / "animated-job.generated.json"
    run_command([sys.executable, str(DEFAULT_ANIMATE_SCRIPT), str(paths.manifest_path), str(animated_manifest)], cwd=ROOT)


def action_build(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    action_validate(manifest, paths)
    action_coherency_report(manifest, paths)
    report = json.loads(paths.coherency_report_path.read_text())
    if not report["ok"]:
        raise PipelineError(f"Coherency failed with {len(report['repairQueue'])} frame(s) needing repair. See {paths.coherency_report_path}")
    if manifest.get("generation", {}).get("acceptanceProfile") == "golden-avatar-v0.6":
        action_qa(manifest, paths)
    run_command([sys.executable, str(DEFAULT_BUILD_SCRIPT), str(paths.build_spec_path)], cwd=ROOT)
    if not (paths.bundle_dir / "avatar.json").exists():
        raise PipelineError(f"Build completed but avatar.json is missing: {paths.bundle_dir / 'avatar.json'}")
    if not paths.preview_gif.exists():
        raise PipelineError(f"Build completed but preview gif is missing: {paths.preview_gif}")
    post_report = write_post_build_artifacts(manifest, paths)
    if not post_report["ok"]:
        raise PipelineError(f"Post-build coherency failed with {len(post_report['repairQueue'])} frame(s) needing repair. See {paths.post_build_coherency_report_path}")
    print(f"Built bundle: {paths.bundle_dir}")
    print(f"Preview gif: {paths.preview_gif}")
    print(f"Post-build report: {paths.post_build_coherency_report_path}")
    print(f"Contact sheet: {paths.contact_sheet_path}")


def action_repair(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    # Targeted repair: keep passing frames untouched and repair only queued failures.
    # provider=mock exercises the provider edit hook offline; provider=none uses a
    # conservative anchor-copy fallback. Future OpenAI/Gemini providers should plug
    # into AvatarImageProvider.edit_frame_delta without changing the queue contract.
    queue_doc = None
    for candidate in [paths.repair_queue_path, paths.post_build_coherency_report_path, paths.coherency_report_path]:
        if candidate.exists():
            queue_doc = json.loads(candidate.read_text())
            break
    if queue_doc is None:
        action_coherency_report(manifest, paths)
        queue_doc = json.loads(paths.repair_queue_path.read_text())
    repairs = queue_doc.get("repairQueue", [])
    if not repairs:
        print(json.dumps({"ok": True, "repairCount": 0, "message": "No queued repairs."}, indent=2))
        return

    source_manifest = load_json(paths.manifest_path)
    provider = None
    provider_name = manifest.get("generation", {}).get("provider", "none")
    if provider_name != "none":
        try:
            provider = get_provider(provider_name)
        except ValueError as exc:
            raise PipelineError(str(exc)) from exc
    repaired = 0
    repair_dir = paths.stage_dir / "repaired-frames"
    repair_dir.mkdir(parents=True, exist_ok=True)
    for item in repairs:
        state = item.get("state")
        frame_index = item.get("frameIndex")
        if state not in source_manifest.get("states", {}) or not isinstance(frame_index, int):
            continue
        state_entry = source_manifest["states"][state]
        frames = state_entry.get("frames", [])
        if frame_index < 0 or frame_index >= len(frames):
            continue
        # Prefer the source job anchor. Post-build reports may point at 256px emitted
        # bundle frames; mixing those back into 512px source jobs creates false drift.
        anchor_path = Path(state_entry.get("anchorPath") or frames[0]).expanduser()
        if not anchor_path.is_absolute():
            anchor_path = (paths.manifest_path.parent / anchor_path).resolve()
        if not anchor_path.exists():
            anchor_path = Path(item.get("anchorPath") or frames[0]).expanduser()
            if not anchor_path.is_absolute():
                anchor_path = (paths.manifest_path.parent / anchor_path).resolve()
        if provider is not None:
            result = provider.edit_frame_delta(source_manifest, state, {"index": frame_index, "failures": item.get("failures", []), "repairPrompt": item.get("repairPrompt")}, anchor_path, repair_dir)
            out = result.path
        else:
            out = repair_dir / f"{state}-{frame_index:02d}-repair.png"
            Image.open(anchor_path).convert("RGBA").save(out)
        frames[frame_index] = str(out)
        state_entry["frames"] = frames
        repaired += 1

    repaired_manifest = paths.stage_dir / "repaired-job.generated.json"
    repair_history = paths.stage_dir / "repair-history.generated.json"
    strategy = f"provider:{provider_name}" if provider is not None else "anchor-copy-baseline"
    source_manifest.setdefault("repair", {})["strategy"] = strategy
    repaired_manifest.write_text(json.dumps(source_manifest, indent=2) + "\n")
    repair_history.write_text(json.dumps({"ok": True, "strategy": strategy, "provider": provider_name, "repairCount": repaired, "sourceQueue": str(paths.repair_queue_path), "repairedManifest": str(repaired_manifest)}, indent=2) + "\n")
    print(json.dumps({"ok": True, "repairCount": repaired, "repairedManifest": str(repaired_manifest), "history": str(repair_history)}, indent=2))


def clawpals_cmd(*parts: str) -> list[str]:
    return ["node", str(DEFAULT_CLAWPALS_CLI), *parts]


def action_push(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    if not (paths.bundle_dir / "avatar.json").exists():
        action_build(manifest, paths)
    run_command(clawpals_cmd("avatar", "push", str(paths.bundle_dir)), cwd=ROOT)
    print(f"Pushed bundle to runtime target '{manifest['targetRuntime']}': {paths.bundle_dir}")


def parse_status_output(raw: str) -> dict[str, Any]:
    decoder = json.JSONDecoder(); index = 0; parsed: list[dict[str, Any]] = []
    while index < len(raw):
        while index < len(raw) and raw[index].isspace(): index += 1
        if index >= len(raw): break
        obj, next_index = decoder.raw_decode(raw, index)
        if isinstance(obj, dict): parsed.append(obj)
        index = next_index
    if not parsed: raise PipelineError("Unable to parse clawpals status output as JSON")
    return parsed[-1]


def action_verify(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    result = run_command(clawpals_cmd("status"), cwd=ROOT, capture=True)
    status = parse_status_output(result.stdout)
    avatar = status.get("avatar", {})
    if avatar.get("avatarId") != manifest["name"]:
        raise PipelineError(f"Runtime avatar mismatch: expected '{manifest['name']}', got '{avatar.get('avatarId')}'")
    if avatar.get("bundleVersion") != manifest["version"]:
        raise PipelineError(f"Runtime bundle version mismatch: expected '{manifest['version']}', got '{avatar.get('bundleVersion')}'")
    print(json.dumps({"ok": True, "avatarId": avatar.get("avatarId"), "bundleVersion": avatar.get("bundleVersion"), "runtimeId": status.get("runtimeId"), "connected": status.get("connected"), "openClawAuth": status.get("openClawAuth")}, indent=2))



def action_vision_qa(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    provider_name = manifest.get("generation", {}).get("visionProvider") or manifest.get("generation", {}).get("provider", "none")
    if provider_name == "none":
        raise PipelineError("vision QA requires generation.visionProvider or generation.provider; use provider 'mock' for offline tests")
    if not paths.contact_sheet_path.exists():
        # Build creates the post-build contact sheet. If no bundle exists, build first.
        if not (paths.bundle_dir / "avatar.json").exists():
            action_build(manifest, paths)
        else:
            built_manifest = manifest_for_built_bundle(manifest, paths)
            write_contact_sheet(built_manifest, paths)
    try:
        provider = get_provider(provider_name)
        review = provider.review_contact_sheet(manifest, paths.contact_sheet_path, {"rubric": "docs/pipeline/avatar-vision-qa-rubric.md"})
    except (ValueError, RuntimeError) as exc:
        raise PipelineError(str(exc)) from exc
    result = {
        "ok": review.ok,
        "score": review.score,
        "provider": provider_name,
        "reviewTarget": str(paths.contact_sheet_path),
        "failures": review.failures,
        "metadata": review.metadata,
        "repairQueue": [],
    }
    paths.vision_qa_report_path.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"ok": review.ok, "score": review.score, "provider": provider_name, "report": str(paths.vision_qa_report_path)}, indent=2))
    if not review.ok:
        raise PipelineError(f"Vision QA failed; see {paths.vision_qa_report_path}")


def action_run(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    action_build(manifest, paths)
    if manifest["pushAfterBuild"]:
        action_push(manifest, paths)
        action_verify(manifest, paths)
    else:
        print("Build finished. pushAfterBuild=false, so push/verify were skipped.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Clawpals avatar bundle pipeline from a JSON manifest.")
    parser.add_argument("action", choices=["scaffold", "emit-prompts", "coherency-report", "qa", "validate", "generate", "slice-sheet", "animate", "repair", "build", "vision-qa", "push", "verify", "run"])
    parser.add_argument("manifest", type=Path, help="Path to an avatar job manifest JSON file")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    raw = load_json(args.manifest.expanduser().resolve())
    manifest = normalize_manifest(raw, args.manifest.expanduser().resolve())
    paths = compute_paths(manifest, args.manifest.expanduser().resolve())
    actions = {"scaffold": action_scaffold, "emit-prompts": action_emit_prompts, "coherency-report": action_coherency_report, "qa": action_qa, "validate": action_validate, "generate": action_generate, "slice-sheet": action_slice_sheet, "animate": action_animate, "repair": action_repair, "build": action_build, "vision-qa": action_vision_qa, "push": action_push, "verify": action_verify, "run": action_run}
    actions[args.action](manifest, paths)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PipelineError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
