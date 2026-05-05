#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REQUIRED_STATES = ["idle", "thinking", "focused", "happy", "alert", "sleepy"]
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CLAWPET_CLI = Path.home() / ".openclaw/workspace/skills/clawpet/bin/clawpet.mjs"
DEFAULT_BUILD_SCRIPT = ROOT / "scripts/build_avatar_bundle.py"
DEFAULT_STAGE_ROOT = ROOT / ".avatar-pipeline"


class PipelineError(RuntimeError):
    pass


@dataclass
class PipelinePaths:
    manifest_path: Path
    stage_dir: Path
    build_spec_path: Path
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
    if mode == "local-only":
        output_root = resolve_path(raw.get("outputRoot"), base=manifest_dir) or (Path.home() / ".openclaw/workspace/local_avatars" / job_id)
    else:
        output_root = resolve_path(raw.get("outputRoot"), base=manifest_dir) or (ROOT / "public/avatars" / job_id)

    preview_gif = resolve_path(raw.get("previewGif"), base=manifest_dir)
    if preview_gif is None:
        preview_gif = output_root / f"{job_id}-preview.gif"

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
            "motionRecipe": entry.get("motionRecipe"),
        }

    prompt_pack = raw.get("promptPack", {})
    if not isinstance(prompt_pack, dict):
        raise PipelineError("Manifest field promptPack must be an object when provided")

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
        "promptPack": prompt_pack,
        "manifestDir": str(manifest_dir),
    }


def compute_paths(manifest: dict[str, Any], manifest_path: Path) -> PipelinePaths:
    stage_dir = Path(manifest["stageRoot"]) / manifest["id"]
    return PipelinePaths(
        manifest_path=manifest_path.resolve(),
        stage_dir=stage_dir,
        build_spec_path=stage_dir / "build-spec.generated.json",
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
    }


def validate_manifest(manifest: dict[str, Any]) -> list[str]:
    problems: list[str] = []
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


def run_command(command: list[str], *, cwd: Path | None = None, capture: bool = False) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            check=True,
            text=True,
            capture_output=capture,
        )
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr or exc.stdout or str(exc)
        raise PipelineError(f"Command failed: {' '.join(command)}\n{detail.strip()}") from exc


def action_scaffold(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    write_stage_files(manifest, paths)
    print(f"Scaffolded build spec: {paths.build_spec_path}")
    print(f"Bundle output dir: {paths.bundle_dir}")
    print(f"Preview gif: {paths.preview_gif}")


def action_validate(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    write_stage_files(manifest, paths)
    problems = validate_manifest(manifest)
    if problems:
        raise PipelineError("Validation failed:\n- " + "\n- ".join(problems))
    print(f"Validation passed for {manifest['name']} ({manifest['id']})")
    print(f"Generated build spec: {paths.build_spec_path}")


def action_build(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    action_validate(manifest, paths)
    run_command([sys.executable, str(DEFAULT_BUILD_SCRIPT), str(paths.build_spec_path)], cwd=ROOT)
    avatar_json = paths.bundle_dir / "avatar.json"
    if not avatar_json.exists():
        raise PipelineError(f"Build completed but avatar.json is missing: {avatar_json}")
    if not paths.preview_gif.exists():
        raise PipelineError(f"Build completed but preview gif is missing: {paths.preview_gif}")
    print(f"Built bundle: {paths.bundle_dir}")
    print(f"Preview gif: {paths.preview_gif}")


def clawpet_cmd(*parts: str) -> list[str]:
    return ["node", str(DEFAULT_CLAWPET_CLI), *parts]


def action_push(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    if not (paths.bundle_dir / "avatar.json").exists():
        action_build(manifest, paths)
    run_command(clawpet_cmd("avatar", "push", str(paths.bundle_dir)), cwd=ROOT)
    print(f"Pushed bundle to runtime target '{manifest['targetRuntime']}': {paths.bundle_dir}")


def parse_status_output(raw: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    index = 0
    parsed: list[dict[str, Any]] = []
    while index < len(raw):
        while index < len(raw) and raw[index].isspace():
            index += 1
        if index >= len(raw):
            break
        obj, next_index = decoder.raw_decode(raw, index)
        if isinstance(obj, dict):
            parsed.append(obj)
        index = next_index
    if not parsed:
        raise PipelineError("Unable to parse clawpet status output as JSON")
    return parsed[-1]


def action_verify(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    result = run_command(clawpet_cmd("status"), cwd=ROOT, capture=True)
    status = parse_status_output(result.stdout)
    avatar = status.get("avatar", {})
    current_name = avatar.get("avatarId")
    current_version = avatar.get("bundleVersion")
    if current_name != manifest["name"]:
        raise PipelineError(f"Runtime avatar mismatch: expected '{manifest['name']}', got '{current_name}'")
    if current_version != manifest["version"]:
        raise PipelineError(f"Runtime bundle version mismatch: expected '{manifest['version']}', got '{current_version}'")
    print(json.dumps({
        "ok": True,
        "avatarId": current_name,
        "bundleVersion": current_version,
        "runtimeId": status.get("runtimeId"),
        "connected": status.get("connected"),
        "openClawAuth": status.get("openClawAuth"),
    }, indent=2))


def action_run(manifest: dict[str, Any], paths: PipelinePaths) -> None:
    action_build(manifest, paths)
    if manifest["pushAfterBuild"]:
        action_push(manifest, paths)
        action_verify(manifest, paths)
    else:
        print("Build finished. pushAfterBuild=false, so push/verify were skipped.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Clawpet avatar bundle pipeline from a JSON manifest.")
    parser.add_argument("action", choices=["scaffold", "validate", "build", "push", "verify", "run"])
    parser.add_argument("manifest", type=Path, help="Path to an avatar job manifest JSON file")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    raw = load_json(args.manifest.expanduser().resolve())
    manifest = normalize_manifest(raw, args.manifest.expanduser().resolve())
    paths = compute_paths(manifest, args.manifest.expanduser().resolve())

    actions = {
        "scaffold": action_scaffold,
        "validate": action_validate,
        "build": action_build,
        "push": action_push,
        "verify": action_verify,
        "run": action_run,
    }
    actions[args.action](manifest, paths)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PipelineError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
