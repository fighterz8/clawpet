#!/usr/bin/env python3
"""Repair already-keyed avatar PNGs by removing chroma-green fringe.

Per-image dynamic chroma detection: samples a ring of border pixels and any green-dominant
pixels in the image to estimate the actual background green for THIS frame, then keys
against that estimate. Handles model drift where the returned green is not exactly
#10EA6D. Falls back to project default if no green is detected.
"""
from __future__ import annotations
import sys
from pathlib import Path
from PIL import Image
import numpy as np

DEFAULT_CHROMA = (16, 234, 109)
HARD_DIST = 90       # closer than this to detected chroma => fully transparent
SOFT_DIST = 200      # farther than this => fully opaque
DESPILL_DELTA = 18   # green excess over max(r,b)
DARK_HALO_LUMA = 60


def detect_chroma(arr: np.ndarray) -> tuple[int, int, int]:
    h, w = arr.shape[:2]
    # Pixels considered "obviously green-background-ish": g dominates r and b.
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    green_mask = (g > r + 30) & (g > b + 30) & (g > 120)
    if green_mask.sum() < 200:
        return DEFAULT_CHROMA
    rs = r[green_mask]
    gs = g[green_mask]
    bs = b[green_mask]
    return (int(np.median(rs)), int(np.median(gs)), int(np.median(bs)))


def repair(path: Path) -> bool:
    im = Image.open(path).convert("RGBA")
    arr = np.array(im, dtype=np.int32)
    r0, g0, b0, a0 = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    cr, cg, cb = detect_chroma(arr)

    # Key against the original colors first. Do not despill before distance
    # matching; doing so changes the very green pixels we are trying to detect.
    dist = np.sqrt((r0 - cr) ** 2 + (g0 - cg) ** 2 + (b0 - cb) ** 2)
    green_dom = (g0 > r0 + 22) & (g0 > b0 + 22) & (g0 > 95)

    a = a0.copy()
    a = np.where((dist <= HARD_DIST) | green_dom, 0, a)
    band = (dist > HARD_DIST) & (dist < SOFT_DIST) & (g0 > r0 + 8) & (g0 > b0 + 8)
    band_scale = ((dist - HARD_DIST) * 255 / max(1, SOFT_DIST - HARD_DIST)).astype(np.int32)
    a = np.where(band, np.minimum(a, band_scale), a)

    # Despill remaining visible foreground pixels only.
    r, g, b = r0.copy(), g0.copy(), b0.copy()
    rb_max = np.maximum(r, b)
    spill = (a > 0) & (g > rb_max + DESPILL_DELTA)
    g = np.where(spill, np.minimum(g, rb_max + DESPILL_DELTA), g)

    luma = (r * 30 + g * 59 + b * 11) // 100
    fringe = (a > 0) & (a < 220) & (((g > r + 8) & (g > b + 8)) | (luma < DARK_HALO_LUMA))
    a = np.where(fringe, 0, a)

    out = np.stack([
        np.clip(r, 0, 255), np.clip(g, 0, 255), np.clip(b, 0, 255), np.clip(a, 0, 255),
    ], axis=-1).astype(np.uint8)
    Image.fromarray(out, mode="RGBA").save(path, format="PNG", optimize=True)
    return True


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: despill_existing_avatars.py <png_or_dir...>", file=sys.stderr)
        return 1
    paths: list[Path] = []
    for a in argv:
        p = Path(a)
        if p.is_dir():
            paths.extend(sorted(p.rglob("*.png")))
        elif p.is_file():
            paths.append(p)
    for p in paths:
        repair(p)
    print(f"repaired {len(paths)} png(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
