#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from PIL import Image

REQUIRED_STATES = ["idle", "thinking", "focused", "happy", "alert", "sleepy"]
ROOT = Path(__file__).resolve().parent.parent


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def resolve_path(value: str, base: Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = (base / path).resolve()
    return path


def alpha_bbox(im: Image.Image) -> tuple[int, int, int, int] | None:
    return im.convert("RGBA").getbbox()


def main(manifest_path: str, out_manifest_path: str | None = None) -> int:
    manifest_file = Path(manifest_path).expanduser().resolve()
    manifest_dir = manifest_file.parent
    job = load_json(manifest_file)
    job_id = job["id"]
    sheet_cfg: dict[str, Any] = job.get("spriteSheet", {})
    if not sheet_cfg:
        raise SystemExit("Job requires spriteSheet config for sheet slicing")
    sheet_path = resolve_path(sheet_cfg["path"], manifest_dir)
    rows = int(sheet_cfg.get("rows", 2))
    cols = int(sheet_cfg.get("cols", 3))
    if rows <= 0 or cols <= 0:
        raise SystemExit("spriteSheet rows/cols must be positive")
    state_order = sheet_cfg.get("stateOrder") or REQUIRED_STATES
    if len(state_order) > rows * cols:
        raise SystemExit("spriteSheet stateOrder has more entries than grid cells")

    stage_root_value = job.get("stageRoot")
    stage_root = resolve_path(stage_root_value, manifest_dir) if stage_root_value else ROOT / ".avatar-pipeline"
    out_dir = stage_root / job_id / "sliced-anchors"
    out_dir.mkdir(parents=True, exist_ok=True)

    sheet = Image.open(sheet_path).convert("RGBA")
    cell_w = sheet.width // cols
    cell_h = sheet.height // rows
    report: dict[str, Any] = {"ok": True, "sheet": str(sheet_path), "grid": {"rows": rows, "cols": cols, "cellSize": [cell_w, cell_h]}, "states": {}, "warnings": []}

    for idx, state in enumerate(state_order):
        row = idx // cols
        col = idx % cols
        x0, y0 = col * cell_w, row * cell_h
        cell = sheet.crop((x0, y0, x0 + cell_w, y0 + cell_h))
        bbox = alpha_bbox(cell)
        if bbox is None:
            report["ok"] = False
            report["warnings"].append(f"{state}: empty alpha cell")
        # Save full isolated cell, not cropped content, so registration remains stable.
        out = out_dir / f"{state}-00.png"
        cell.save(out)
        entry = job.setdefault("states", {}).setdefault(state, {})
        entry["anchorPath"] = str(out)
        entry["frames"] = [str(out)]
        entry["animationMode"] = "deterministic"
        entry.setdefault("fps", 4)
        report["states"][state] = {"anchorPath": str(out), "cell": [row, col], "bbox": list(bbox) if bbox else None}

    for state in REQUIRED_STATES:
        if state not in job.get("states", {}):
            report["ok"] = False
            report["warnings"].append(f"missing required state after slicing: {state}")

    out_path = Path(out_manifest_path).expanduser().resolve() if out_manifest_path else stage_root / job_id / "sliced-job.generated.json"
    report_path = stage_root / job_id / "sprite-sheet-report.generated.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(job, indent=2) + "\n")
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"ok": report["ok"], "slicedJob": str(out_path), "report": str(report_path), "anchorsDir": str(out_dir)}, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    if len(sys.argv) not in {2, 3}:
        print("Usage: slice_avatar_sheet.py <job.json> [out-job.json]", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None))
