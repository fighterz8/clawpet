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

## Future improvement targets

- one command that wraps generation + bundling + push
- bundle validation screenshots/contact sheets
- agent prompt templates stored with per-character specs
- download/package link refresh as part of release prep
