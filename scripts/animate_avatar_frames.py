#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

REQUIRED_STATES = ["idle", "thinking", "focused", "happy", "alert", "sleepy"]
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FRAME_PLAN = [
    {"index": 0, "kind": "anchor", "operation": "copy_anchor"},
    {"index": 1, "kind": "deterministic", "operation": "translate_sprite_layer", "dx": 0, "dy": -1},
    {"index": 2, "kind": "deterministic", "operation": "copy_anchor"},
    {"index": 3, "kind": "deterministic", "operation": "translate_sprite_layer", "dx": 0, "dy": 1},
]


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def resolve_path(value: str, base: Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = (base / path).resolve()
    return path


def translate_sprite_layer(anchor: Image.Image, dx: int, dy: int) -> Image.Image:
    out = Image.new("RGBA", anchor.size, (0, 0, 0, 0))
    out.alpha_composite(anchor, (dx, dy))
    return out


def clean_alpha_speckles(anchor: Image.Image, min_alpha: int = 18) -> Image.Image:
    """Remove provider/edit leftovers that read as tiny circular artifacts.

    Keep this conservative: it only drops very low-alpha pixels outside the
    main sprite silhouette and never invents new art.
    """
    out = anchor.copy().convert("RGBA")
    bg = out.getpixel((0, 0))
    pixels = out.load()
    # Sprite sheets and external anchors may arrive with an opaque flat green
    # background. Treat the corner color as background only when it is obviously
    # not transparent and remove close matches before animation.
    if bg[3] > 240:
        br, bgc, bb, _ = bg
        for y in range(out.height):
            for x in range(out.width):
                pr, pg, pb, pa = pixels[x, y]
                if pa and abs(pr - br) + abs(pg - bgc) + abs(pb - bb) < 42:
                    pixels[x, y] = (pr, pg, pb, 0)
    r, g, b, a = out.split()
    a = a.point(lambda px: 0 if px < min_alpha else px)
    out.putalpha(a)
    return out


def body_bbox(anchor: Image.Image) -> tuple[int, int, int, int] | None:
    return clean_alpha_speckles(anchor).getbbox()


def alpha_cutout(base: Image.Image, box: tuple[int, int, int, int], feather: int = 2) -> Image.Image:
    """Clear a region with a lightly feathered edge so moved parts do not ghost."""
    out = base.copy().convert("RGBA")
    mask = Image.new("L", out.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle(box, fill=255)
    if feather:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))
    transparent = Image.new("RGBA", out.size, (0, 0, 0, 0))
    return Image.composite(transparent, out, mask)


def paste_transformed(
    base: Image.Image,
    source: Image.Image,
    box: tuple[int, int, int, int],
    *,
    dx: int = 0,
    dy: int = 0,
    angle: float = 0,
    scale_x: float = 1.0,
    scale_y: float = 1.0,
) -> Image.Image:
    crop = source.crop(box)
    nw = max(1, int(crop.width * scale_x))
    nh = max(1, int(crop.height * scale_y))
    if (nw, nh) != crop.size:
        crop = crop.resize((nw, nh), Image.Resampling.BICUBIC)
    if angle:
        crop = crop.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(0, 0, 0, 0))
    x = int((box[0] + box[2] - crop.width) / 2 + dx)
    y = int((box[1] + box[3] - crop.height) / 2 + dy)
    out = base.copy().convert("RGBA")
    out.alpha_composite(crop, (x, y))
    return out


def constrain_to_anchor_bbox(frame: Image.Image, anchor: Image.Image, margin: int = 4) -> Image.Image:
    """Keep semantic motion inside the original character envelope for QA/runtime stability."""
    bbox = body_bbox(anchor)
    if not bbox:
        return clean_alpha_speckles(frame)
    x0, y0, x1, y1 = bbox
    keep = (
        max(0, x0 - margin),
        max(0, y0 - margin),
        min(anchor.width, x1 + margin),
        min(anchor.height, y1 + margin),
    )
    out = clean_alpha_speckles(frame)
    mask = Image.new("L", out.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle(keep, fill=255)
    transparent = Image.new("RGBA", out.size, (0, 0, 0, 0))
    return Image.composite(out, transparent, mask)


def squash_stretch(anchor: Image.Image, sx: float, sy: float, baseline: float = 0.88) -> Image.Image:
    bbox = body_bbox(anchor)
    if not bbox:
        return anchor.copy()
    x0, y0, x1, y1 = bbox
    crop = anchor.crop(bbox)
    nw = max(1, int(crop.width * sx))
    nh = max(1, int(crop.height * sy))
    resized = crop.resize((nw, nh), Image.Resampling.NEAREST)
    base_y = int(y0 + crop.height * baseline)
    nx = int((x0 + x1 - nw) / 2)
    ny = int(base_y - nh * baseline)
    out = Image.new("RGBA", anchor.size, (0, 0, 0, 0))
    out.alpha_composite(resized, (nx, ny))
    return out


def overlay_spark(anchor: Image.Image, color: str = "#9cff9d", position: str = "upper-right") -> Image.Image:
    out = anchor.copy()
    draw = ImageDraw.Draw(out)
    w, h = out.size
    positions = {
        "upper-right": (int(w * 0.68), int(h * 0.26)),
        "upper-left": (int(w * 0.28), int(h * 0.26)),
        "core": (int(w * 0.52), int(h * 0.52)),
    }
    x, y = positions.get(position, positions["upper-right"])
    draw.line([(x - 5, y), (x + 5, y)], fill=color, width=2)
    draw.line([(x, y - 5), (x, y + 5)], fill=color, width=2)
    draw.line([(x - 3, y - 3), (x + 3, y + 3)], fill=color, width=1)
    draw.line([(x - 3, y + 3), (x + 3, y - 3)], fill=color, width=1)
    return out


def pulse_glow(anchor: Image.Image, color: str = "#ffd37a", radius: int = 18, opacity: int = 120) -> Image.Image:
    # Brighten existing central pixels only. Do not draw a new circle; visible
    # synthetic blobs read as artifacts in the overlay.
    out = clean_alpha_speckles(anchor)
    bbox = body_bbox(anchor)
    if not bbox:
        return out
    x0, y0, x1, y1 = bbox
    cx, cy = int((x0 + x1) / 2), int(y0 + (y1 - y0) * 0.62)
    r = max(10, radius)
    crop_box = (max(0, cx - r), max(0, cy - r), min(anchor.width, cx + r), min(anchor.height, cy + r))
    crop = out.crop(crop_box).convert("RGBA")
    enhanced = ImageEnhance.Brightness(crop).enhance(1.10 + min(opacity, 180) / 900)
    # Existing alpha is the mask, so transparent background stays transparent;
    # this deliberately does not draw a synthetic circular halo.
    out.alpha_composite(enhanced, crop_box[:2])
    return out


def signature_pulse(anchor: Image.Image, intensity: float = 1.0, color_shift: bool = False) -> Image.Image:
    """Visible signature/core pulse without changing the character silhouette."""
    out = clean_alpha_speckles(anchor)
    bbox = body_bbox(anchor)
    if not bbox:
        return out
    x0, y0, x1, y1 = bbox
    cx, cy = int((x0 + x1) / 2), int(y0 + (y1 - y0) * 0.62)
    r = max(10, int(min(x1 - x0, y1 - y0) * 0.16))
    crop_box = (max(0, cx - r), max(0, cy - r), min(anchor.width, cx + r), min(anchor.height, cy + r))
    crop = out.crop(crop_box).convert("RGBA")
    factor = 1.22 + max(0.0, min(float(intensity), 2.0)) * 0.28
    crop = ImageEnhance.Brightness(crop).enhance(factor)
    if color_shift:
        tint = Image.new("RGBA", crop.size, (255, 175, 80, int(38 * min(float(intensity), 2.0))))
        crop = Image.alpha_composite(crop, tint)
        crop.putalpha(out.crop(crop_box).getchannel("A"))
    out.alpha_composite(crop, crop_box[:2])
    return out


def breathing_expand(anchor: Image.Image, phase: float = 0.0, amplitude: float = 0.025) -> Image.Image:
    scale = 1.0 + max(0.0, min(float(amplitude), 0.06)) * math.sin(float(phase) * math.pi * 2)
    return squash_stretch(clean_alpha_speckles(anchor), scale, 1.0 / scale, baseline=0.72)


def eye_blink(anchor: Image.Image, closedness: float = 1.0) -> Image.Image:
    """Draw simple dark blink lines over the eye band; keeps silhouette stable."""
    out = clean_alpha_speckles(anchor)
    bbox = body_bbox(out)
    if not bbox:
        return out
    x0, y0, x1, y1 = bbox
    w, h = x1 - x0, y1 - y0
    draw = ImageDraw.Draw(out, "RGBA")
    eye_y = y0 + int(h * 0.36)
    left = (x0 + int(w * 0.28), eye_y, x0 + int(w * 0.45), eye_y)
    right = (x1 - int(w * 0.45), eye_y, x1 - int(w * 0.28), eye_y)
    width = max(2, int(h * (0.018 + 0.012 * max(0.0, min(float(closedness), 1.0)))))
    color = (15, 14, 20, 230)
    draw.line(left, fill=color, width=width)
    draw.line(right, fill=color, width=width)
    return out


def micro_squash_anticipation(anchor: Image.Image, state: str = "idle", amount: float = 1.06) -> Image.Image:
    amount = max(1.0, min(float(amount), 1.12))
    if state in {"happy", "alert"}:
        return squash_stretch(clean_alpha_speckles(anchor), amount, 1.0 / amount, baseline=0.9)
    return clean_alpha_speckles(anchor)


def antenna_twitch(anchor: Image.Image, color: str = "#0a0820") -> Image.Image:
    out = clean_alpha_speckles(anchor)
    draw = ImageDraw.Draw(out)
    bbox = body_bbox(anchor)
    if bbox:
        x0, y0, x1, _ = bbox
        cx = int((x0 + x1) / 2)
        y = y0 + 16
    else:
        cx, y = anchor.width // 2, int(anchor.height * 0.25)
    # Tiny redraw over existing antenna region. Keep it subtle.
    draw.line((cx - 18, y + 10, cx - 31, y - 7), fill=color, width=2)
    draw.line((cx + 18, y + 10, cx + 31, y - 7), fill=color, width=2)
    return out


def wing_flutter(anchor: Image.Image, dx: int = 3, dy: int = -2) -> Image.Image:
    # Region-aware semantic approximation: clear side wing regions, then paste
    # them back slightly transformed while keeping the body/core anchored. This
    # is still deterministic, but avoids the old ghost-copy shimmer.
    anchor = clean_alpha_speckles(anchor)
    bbox = body_bbox(anchor)
    if not bbox:
        return anchor.copy()
    x0, y0, x1, y1 = bbox
    w = x1 - x0
    h = y1 - y0
    left_box = (x0, y0 + int(h * 0.18), x0 + int(w * 0.42), y0 + int(h * 0.86))
    right_box = (x1 - int(w * 0.42), y0 + int(h * 0.18), x1, y0 + int(h * 0.86))
    out = alpha_cutout(anchor, left_box)
    out = alpha_cutout(out, right_box)
    lift = dy < 0
    left_angle = -4 if lift else 3
    right_angle = 4 if lift else -3
    out = paste_transformed(out, anchor, left_box, dx=-abs(dx), dy=dy, angle=left_angle, scale_x=1.02, scale_y=0.98 if lift else 1.02)
    out = paste_transformed(out, anchor, right_box, dx=abs(dx), dy=dy, angle=right_angle, scale_x=1.02, scale_y=0.98 if lift else 1.02)
    return out


def body_bob(anchor: Image.Image, dy: int = -1) -> Image.Image:
    return translate_sprite_layer(clean_alpha_speckles(anchor), 0, dy)


def sleepy_droop(anchor: Image.Image, dy: int = 2) -> Image.Image:
    out = clean_alpha_speckles(anchor)
    return translate_sprite_layer(out, 0, dy)

def overlay_z(anchor: Image.Image, color: str = "#fdfcff") -> Image.Image:
    out = anchor.copy()
    draw = ImageDraw.Draw(out)
    w, h = out.size
    x, y = int(w * 0.66), int(h * 0.18)
    for step, size in enumerate([10, 8, 6]):
        ox, oy = x + step * 12, y - step * 10
        draw.line([(ox, oy), (ox + size, oy), (ox, oy + size), (ox + size, oy + size)], fill=color, width=2)
    return out


def apply_operation(anchor: Image.Image, plan: dict[str, Any], state: str) -> Image.Image:
    if "operations" in plan:
        frame = anchor.copy()
        for subplan in plan["operations"]:
            frame = apply_operation(frame, subplan, state)
        return frame
    op = plan.get("operation") or plan.get("kind") or "copy_anchor"
    if op in {"anchor", "copy_anchor"}:
        return clean_alpha_speckles(anchor)
    if op == "translate_sprite_layer":
        return translate_sprite_layer(anchor, int(plan.get("dx", 0)), int(plan.get("dy", 0)))
    if op == "squash_stretch":
        return squash_stretch(anchor, float(plan.get("sx", 1.0)), float(plan.get("sy", 1.0)), float(plan.get("anchorBaseline", 0.88)))
    if op == "overlay_spark":
        return overlay_spark(anchor, str(plan.get("paletteColor", "#9cff9d")), str(plan.get("position", "upper-right")))
    if op == "overlay_z":
        return overlay_z(anchor, str(plan.get("paletteColor", "#fdfcff")))
    if op == "pulse_glow":
        return pulse_glow(anchor, str(plan.get("paletteColor", "#ffd37a")), int(plan.get("radius", 18)), int(plan.get("opacity", 120)))
    if op == "signature_pulse":
        return signature_pulse(anchor, float(plan.get("intensity", 1.0)), bool(plan.get("colorShift", plan.get("color_shift", False))))
    if op == "breathing_expand":
        return breathing_expand(anchor, float(plan.get("phase", 0.0)), float(plan.get("amplitude", 0.025)))
    if op == "eye_blink":
        return eye_blink(anchor, float(plan.get("closedness", 1.0)))
    if op == "micro_squash_anticipation":
        return micro_squash_anticipation(anchor, state, float(plan.get("amount", 1.06)))
    if op == "antenna_twitch":
        return antenna_twitch(anchor, str(plan.get("paletteColor", "#0a0820")))
    if op == "wing_flutter":
        return wing_flutter(anchor, int(plan.get("dx", 2)), int(plan.get("dy", -1)))
    if op == "body_bob":
        return body_bob(anchor, int(plan.get("dy", -1)))
    if op == "sleepy_droop":
        return sleepy_droop(anchor, int(plan.get("dy", 2)))
    # Conservative fallback: unknown animation operation should not corrupt identity.
    return anchor.copy()


def default_plan_for_state(state: str) -> list[dict[str, Any]]:
    if state == "happy":
        return [
            {"index": 0, "operation": "copy_anchor", "motionDescription": "happy anchor, clean transparent background"},
            {"index": 1, "operations": [{"operation": "wing_flutter", "dx": 5, "dy": -5}, {"operation": "pulse_glow", "radius": 20, "opacity": 130}], "motionDescription": "upbeat wing lift with brighter lantern"},
            {"index": 2, "operations": [{"operation": "body_bob", "dy": -1}, {"operation": "wing_flutter", "dx": 3, "dy": -2}], "motionDescription": "small happy bounce, wings settling"},
            {"index": 3, "operation": "wing_flutter", "dx": 2, "dy": 2, "motionDescription": "wings relax back down"},
        ]
    if state == "alert":
        return [
            {"index": 0, "operation": "copy_anchor", "motionDescription": "alert anchor"},
            {"index": 1, "operations": [{"operation": "wing_flutter", "dx": 6, "dy": -4}, {"operation": "body_bob", "dy": -1}], "motionDescription": "wings snap outward/up for alert"},
            {"index": 2, "operation": "overlay_spark", "position": "upper-right", "motionDescription": "small alert spark cue"},
            {"index": 3, "operation": "copy_anchor", "motionDescription": "snap back to anchor"},
        ]
    if state == "sleepy":
        return [
            {"index": 0, "operation": "copy_anchor", "motionDescription": "sleepy anchor"},
            {"index": 1, "operations": [{"operation": "sleepy_droop", "dy": 2}, {"operation": "wing_flutter", "dx": 1, "dy": 3}], "motionDescription": "slow droop, wings sag"},
            {"index": 2, "operations": [{"operation": "sleepy_droop", "dy": 1}, {"operation": "overlay_z"}], "motionDescription": "dim sleepy hold with Z cue"},
            {"index": 3, "operation": "copy_anchor", "motionDescription": "return to sleepy anchor"},
        ]
    if state == "focused":
        return [
            {"index": 0, "operation": "copy_anchor", "motionDescription": "focused anchor"},
            {"index": 1, "operation": "pulse_glow", "paletteColor": "#ffd37a", "radius": 12, "opacity": 110, "motionDescription": "steady lantern focus pulse"},
            {"index": 2, "operation": "copy_anchor", "motionDescription": "hold still"},
            {"index": 3, "operation": "pulse_glow", "paletteColor": "#ffd37a", "radius": 16, "opacity": 90, "motionDescription": "subtle focus glow"},
        ]
    if state == "thinking":
        return [
            {"index": 0, "operation": "copy_anchor", "motionDescription": "thinking anchor"},
            {"index": 1, "operations": [{"operation": "antenna_twitch"}, {"operation": "wing_flutter", "dx": 2, "dy": -1}], "motionDescription": "antenna twitch with tiny wing response"},
            {"index": 2, "operations": [{"operation": "pulse_glow", "radius": 14, "opacity": 80}, {"operation": "overlay_spark", "position": "upper-right"}], "motionDescription": "thought sparkle cue and lantern thought pulse"},
            {"index": 3, "operation": "copy_anchor", "motionDescription": "return to anchor"},
        ]
    if state == "idle":
        return [
            {"index": 0, "operation": "copy_anchor", "motionDescription": "idle anchor"},
            {"index": 1, "operations": [{"operation": "wing_flutter", "dx": 4, "dy": -4}, {"operation": "pulse_glow", "radius": 14, "opacity": 80}], "motionDescription": "visible but gentle wing lift and soft lantern pulse"},
            {"index": 2, "operation": "wing_flutter", "dx": 2, "dy": 1, "motionDescription": "wings settle downward"},
            {"index": 3, "operation": "pulse_glow", "paletteColor": "#ffd37a", "radius": 16, "opacity": 95, "motionDescription": "lantern returns to warm idle glow"},
        ]
    return DEFAULT_FRAME_PLAN


def main(manifest_path: str, out_manifest_path: str | None = None) -> int:
    manifest_file = Path(manifest_path).expanduser().resolve()
    manifest_dir = manifest_file.parent
    manifest = load_json(manifest_file)
    job_id = manifest["id"]
    stage_root_value = manifest.get("stageRoot")
    stage_root = resolve_path(stage_root_value, manifest_dir) if stage_root_value else ROOT / ".avatar-pipeline"
    generated_dir = stage_root / job_id / "generated-frames"
    generated_dir.mkdir(parents=True, exist_ok=True)

    report: dict[str, Any] = {"ok": True, "job": job_id, "generatedDir": str(generated_dir), "states": {}}
    for state in REQUIRED_STATES:
        entry = manifest["states"][state]
        anchor_value = entry.get("anchorPath") or (entry.get("frames") or [None])[0]
        if not anchor_value:
            raise SystemExit(f"State {state} requires anchorPath or at least one frame")
        anchor_path = resolve_path(anchor_value, manifest_dir)
        anchor = Image.open(anchor_path).convert("RGBA")
        frame_plan = entry.get("framePlan") or default_plan_for_state(state)
        new_frames: list[str] = []
        for i, plan in enumerate(frame_plan):
            frame = apply_operation(anchor, plan, state)
            frame = constrain_to_anchor_bbox(frame, anchor, int(plan.get("bboxMargin", 4)))
            out = generated_dir / f"{state}-{i:02d}.png"
            frame.save(out)
            new_frames.append(str(out))
        entry["frames"] = new_frames
        entry["animationMode"] = "deterministic"
        report["states"][state] = {"anchorPath": str(anchor_path), "frameCount": len(new_frames)}

    out_path = Path(out_manifest_path).expanduser().resolve() if out_manifest_path else stage_root / job_id / "animated-job.generated.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(manifest, indent=2) + "\n")
    report_path = stage_root / job_id / "animation-report.generated.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"ok": True, "animatedManifest": str(out_path), "report": str(report_path), "generatedDir": str(generated_dir)}, indent=2))
    return 0


if __name__ == "__main__":
    if len(sys.argv) not in {2, 3}:
        print("Usage: animate_avatar_frames.py <job.json> [out-job.json]", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None))
