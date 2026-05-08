#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from PIL import Image
import json
import shutil
import sys
from typing import Any

BG_RULE = {"g_min": 200, "r_max": 80, "b_max": 150}
DEFAULT_CANVAS = 256

# Chroma-key tuning. The provider returns soft antialiased edges and sometimes a faint dark
# halo. A naive g>200/r<80/b<150 rule leaves dirty fringe pixels behind. Use chroma-distance
# alpha plus a green-spill suppressor so the keyed sprite reads clean against any background.
CHROMA_HARD_DIST = 70   # closer than this to the chroma key => fully transparent
CHROMA_SOFT_DIST = 140  # farther than this => fully opaque (plus despill)
DESPILL_DELTA = 18       # green excess over max(r,b) gets clipped to remove green tint

# Usage: build_avatar_bundle.py <spec.json>
# Spec shape includes legacy fields plus optional:
#   sourceImageContract: { background: "transparent-alpha" | "chroma-green", chromaKey?: "#00ff66" }
#   registration: { mode: "legacy-crop" | "preserve-canvas" | "anchor-locked", targetCanvasPx?: 256 }


def _parse_chroma(source_contract: dict[str, Any]) -> tuple[int, int, int]:
    raw = str(source_contract.get("chromaKey", "")).lstrip("#")
    if len(raw) == 6:
        try:
            return (int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16))
        except ValueError:
            pass
    # Default to the project chroma green if not specified.
    return (16, 234, 109)


def normalize_alpha(im: Image.Image, source_contract: dict[str, Any]) -> Image.Image:
    im = im.convert("RGBA")
    background = source_contract.get("background")
    if background == "transparent-alpha":
        return im

    try:
        import numpy as np  # local import to keep legacy paths cheap
    except ImportError:
        # Fallback to the legacy hard rule if numpy is unavailable.
        px = im.load()
        w, h = im.size
        for y in range(h):
            for x in range(w):
                r, g, b, _ = px[x, y]
                if g > BG_RULE["g_min"] and r < BG_RULE["r_max"] and b < BG_RULE["b_max"]:
                    px[x, y] = (0, 0, 0, 0)
        return im

    cr, cg, cb = _parse_chroma(source_contract)
    arr = np.array(im, dtype=np.int16)
    r = arr[:, :, 0]
    g = arr[:, :, 1]
    b = arr[:, :, 2]

    # Chroma distance (Manhattan) to the chroma key per pixel.
    dist = np.abs(r - cr) + np.abs(g - cg) + np.abs(b - cb)

    # Soft alpha ramp: <hard => 0, >soft => 255, otherwise linear.
    alpha = np.where(
        dist <= CHROMA_HARD_DIST,
        0,
        np.where(
            dist >= CHROMA_SOFT_DIST,
            255,
            ((dist - CHROMA_HARD_DIST) * 255 // max(1, (CHROMA_SOFT_DIST - CHROMA_HARD_DIST))).astype(np.int16),
        ),
    ).astype(np.uint8)

    # Despill: clamp green so it never exceeds max(r,b) by more than DESPILL_DELTA.
    rb_max = np.maximum(r, b)
    spill_cap = rb_max + DESPILL_DELTA
    g_clipped = np.minimum(g, spill_cap)
    g_clipped = np.clip(g_clipped, 0, 255)

    out = np.empty_like(arr, dtype=np.uint8)
    out[:, :, 0] = np.clip(r, 0, 255)
    out[:, :, 1] = g_clipped
    out[:, :, 2] = np.clip(b, 0, 255)
    out[:, :, 3] = alpha

    return Image.fromarray(out, mode="RGBA")


def legacy_crop(path: Path, source_contract: dict[str, Any], target_canvas: int) -> Image.Image:
    im = normalize_alpha(Image.open(path), source_contract)
    bbox = im.getbbox()
    im = im.crop(bbox) if bbox else im
    scale = min(target_canvas / im.size[0], target_canvas / im.size[1])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    im = im.resize((nw, nh), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (target_canvas, target_canvas), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((target_canvas - nw) // 2, (target_canvas - nh) // 2))
    return canvas


def preserve_canvas(path: Path, source_contract: dict[str, Any], target_canvas: int) -> Image.Image:
    im = normalize_alpha(Image.open(path), source_contract)
    if im.size != (target_canvas, target_canvas):
        im = im.resize((target_canvas, target_canvas), Image.Resampling.NEAREST)
    return im


def compute_anchor_transform(path: Path, source_contract: dict[str, Any], target_canvas: int) -> dict[str, Any]:
    im = normalize_alpha(Image.open(path), source_contract)
    bbox = im.getbbox()
    if not bbox:
        return {"scale": 1.0, "offset": [0, 0], "sourceSize": list(im.size), "anchorBbox": None}
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0, y1 - y0
    scale = min(target_canvas / bw, target_canvas / bh)
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    sx0, sy0, sx1, sy1 = int(x0 * scale), int(y0 * scale), int(x1 * scale), int(y1 * scale)
    offset = [int((target_canvas - (sx1 - sx0)) / 2 - sx0), int((target_canvas - (sy1 - sy0)) / 2 - sy0)]
    return {"scale": scale, "offset": offset, "sourceSize": list(im.size), "anchorBbox": [x0, y0, x1, y1], "scaledSize": [nw, nh]}


def apply_anchor_transform(path: Path, source_contract: dict[str, Any], target_canvas: int, transform: dict[str, Any]) -> Image.Image:
    im = normalize_alpha(Image.open(path), source_contract)
    scale = float(transform["scale"])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    resized = im.resize((nw, nh), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (target_canvas, target_canvas), (0, 0, 0, 0))
    canvas.alpha_composite(resized, tuple(transform["offset"]))
    return canvas


def process_frame(path: Path, source_contract: dict[str, Any], registration: dict[str, Any], target_canvas: int, transform: dict[str, Any] | None) -> Image.Image:
    mode = registration.get("mode", "legacy-crop")
    if mode == "preserve-canvas":
        return preserve_canvas(path, source_contract, target_canvas)
    if mode == "anchor-locked":
        if transform is None:
            raise ValueError("anchor-locked registration requires a transform")
        return apply_anchor_transform(path, source_contract, target_canvas, transform)
    return legacy_crop(path, source_contract, target_canvas)


def main(spec_path: str) -> int:
    spec = json.loads(Path(spec_path).read_text())
    out = Path(spec["outputDir"])
    preview = Path(spec["previewGif"])
    source_contract = spec.get("sourceImageContract", {})
    registration = spec.get("registration", {"mode": "legacy-crop", "targetCanvasPx": DEFAULT_CANVAS})
    target_canvas = int(registration.get("targetCanvasPx", DEFAULT_CANVAS))

    shutil.rmtree(out, ignore_errors=True)
    (out / "assets").mkdir(parents=True)
    (out / "frames").mkdir(parents=True)

    transform: dict[str, Any] | None = None
    if registration.get("mode") == "anchor-locked":
        anchor_state = registration.get("anchorState", "idle")
        anchor_index = int(registration.get("anchorFrameIndex", 0))
        anchor_path = Path(spec["states"][anchor_state][anchor_index])
        transform = compute_anchor_transform(anchor_path, source_contract, target_canvas)

    processed: dict[str, Image.Image] = {}
    for state, frames in spec["states"].items():
        for i, img in enumerate(frames):
            key = f"{state}-{i:02d}"
            processed[key] = process_frame(Path(img), source_contract, registration, target_canvas, transform)
        processed[f"{state}-00"].save(out / "assets" / f"{state}.png")
        for i in range(len(frames)):
            processed[f"{state}-{i:02d}"].save(out / "frames" / f"{state}-{i:02d}.png")

    manifest = {
        "schemaVersion": "0.5.0",
        "name": spec["name"],
        "version": spec["version"],
        "description": spec.get("description", ""),
        "defaultState": "idle",
        "states": {},
        "build": {
            "registration": registration,
            "sourceImageContract": source_contract,
            "registrationTransform": transform,
        },
    }
    for state, frames in spec["states"].items():
        manifest["states"][state] = {
            "frames": [f"frames/{state}-{i:02d}.png" for i in range(len(frames))],
            "fps": spec["fps"][state],
            "loop": True,
            "fallbackAsset": f"assets/{state}.png",
        }
    (out / "avatar.json").write_text(json.dumps(manifest, indent=2) + "\n")

    seq = []
    for state, frames in spec["states"].items():
        for i in range(len(frames)):
            fr = Image.new("RGBA", (target_canvas + 64, target_canvas + 64), (12, 14, 22, 255))
            fr.alpha_composite(processed[f"{state}-{i:02d}"].resize((target_canvas, target_canvas), Image.Resampling.NEAREST), (32, 32))
            seq.append(fr.convert("P", palette=Image.Palette.ADAPTIVE))
    preview.parent.mkdir(parents=True, exist_ok=True)
    seq[0].save(preview, save_all=True, append_images=seq[1:], duration=160, loop=0, disposal=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
