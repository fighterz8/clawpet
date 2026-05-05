# Avatar Generation Pipeline

Goal: let an agent generate Clawpet assets and land them in the app with minimal manual surgery.

## Pipeline

1. Generate opaque state images against chroma green (`#00ff66`) with a locked character prompt.
2. Generate extra motion frames per state as small deltas from each state's anchor.
3. Save the raw generator outputs under managed media or a temp staging folder.
4. Build a bundle from a simple JSON spec using:

```bash
python3 scripts/build_avatar_bundle.py path/to/spec.json
```

This script:
- removes chroma green to transparency
- crops and normalizes each frame to a 256x256 working canvas
- writes `assets/` and `frames/`
- writes `avatar.json`
- emits a preview GIF

5. Push to runtime:

```bash
node ~/.openclaw/workspace/skills/clawpet/bin/clawpet.mjs avatar push public/avatars/<bundle-name>
```

6. Verify:

```bash
node ~/.openclaw/workspace/skills/clawpet/bin/clawpet.mjs status
curl -fsS http://<runtime-host>:8737/avatar-bundle/current/avatar.json
```

## Important constraints

- Treat **OpenClaw as the source of truth**.
- Repo files alone are not enough; push the bundle to the paired runtime.
- If the visible avatar does not change but setup/status does, inspect overlay playback/runtime selection before regenerating more art.
- Use 128x128 logical-pixel assumptions for motion prompts; export larger only for crisp display.

## One-command wrapper (new)

There is now a manifest-driven wrapper around the existing bundle builder:

```bash
python3 scripts/run_avatar_pipeline.py run jobs/pocket-golem-local.sample.json
```

Supported actions:

```bash
python3 scripts/run_avatar_pipeline.py scaffold <job.json>
python3 scripts/run_avatar_pipeline.py validate <job.json>
python3 scripts/run_avatar_pipeline.py build <job.json>
python3 scripts/run_avatar_pipeline.py push <job.json>
python3 scripts/run_avatar_pipeline.py verify <job.json>
python3 scripts/run_avatar_pipeline.py run <job.json>
```

What the wrapper does:
- validates that all 6 required states exist
- checks that referenced frame files exist
- emits a generated build spec under `.avatar-pipeline/<job-id>/`
- calls `scripts/build_avatar_bundle.py`
- optionally pushes the bundle through the existing Clawpet pairing
- verifies runtime avatar id + bundle version after push

Sample job manifest:
- `jobs/pocket-golem-local.sample.json`

Prompt-pack scaffold:
- `docs/prompts/avatar-job-template.md`
- `docs/prompts/clawpet-creative-prompt.md`
- `docs/prompts/clawpet-frame-delta-prompt.md`

## Current limitation

This wrapper productizes **build/push/verify orchestration** and the manifest shape.
It does **not** yet call the image-generation provider directly on its own.
The current generation flow is still:
1. generate source frames with the image tool / agent
2. place those frame paths in the job manifest
3. run the wrapper to validate/build/push/verify

That means the remaining automation gap is specifically the provider-backed frame generation stage.

## Future improvement targets

- provider-backed frame generation inside the wrapper
- bundle validation screenshots/contact sheets
- richer prompt-pack storage with per-character locked specs
- download/package link refresh as part of release prep
