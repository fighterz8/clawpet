# Avatar Job Template

Use this as the structured design brief for a new Clawpals pipeline job.

## Locked character brief

- **job id:** `<kebab-case-id>`
- **display name:** `<Display Name>`
- **mode:** `local-only` or `repo`
- **target runtime:** `<gladriel | current-paired-runtime | explicit host label>`
- **core concept:** `<one-sentence character identity>`
- **signature silhouette feature:** `<single most readable shape cue>`
- **palette:** `<dominant colors / accents>`
- **pose framing:** `<front-facing | 3/4 front>`
- **logical canvas assumption:** `128x128`
- **background for generator output:** `#00ff66`
- **motion intensity:** `subtle`

## State anchors to generate

Generate these six base states first:
- idle
- thinking
- focused
- happy
- alert
- sleepy

Each state should stay locked to the same character identity, palette, outline behavior, and framing.

## Motion recipes

Use tiny, state-specific deltas.

- **idle:** blink + tiny bob + light breathing/glow pulse
- **thinking:** eye shift + small tilt + core/accent brighten
- **focused:** firmer posture + slight lean + contained tension
- **happy:** buoyant lift + brighter accent/core + small squash/stretch
- **alert:** perk/jolt + widened attention cue + small spark if the palette allows
- **sleepy:** droop + dim glow + drifting sleepy cue if the palette allows

## Deliverables

For each state, prepare:
- **frame 0** = anchor/base state
- **frame A** = first micro-delta
- **frame B** = second micro-delta
- **optional blink/accent frame** when it helps the loop

## Output routing

- **local-only jobs:** stage under `~/.../local_avatars/<job-id>/`
- **repo jobs:** stage under `public/avatars/<job-id>/` and `public/previews/`
- Build with `scripts/run_avatar_pipeline.py`
- Push with the existing paired Clawpals runtime connection
