# Avatar Coherency QA

Generated Clawpals avatars should feel like **one character moving**, not several similar redraws.

## Contract

Every generated job has:
- a locked character identity
- one idle/character anchor
- one anchor per state
- motion frames derived from state anchors
- a coherency report before bundle build/push

## Required checks

The agent/reviewer should reject frames that drift on:

1. **Silhouette** — signature shape still reads the same at thumbnail size.
2. **Palette** — dominant colors stay locked; no surprise colors or outlines.
3. **Face/eyes** — expression may change, identity cannot.
4. **Proportions** — head/body/accessory scale stays consistent.
5. **Framing** — character stays centered and similarly sized.
6. **State expression** — frame still belongs to the intended state.

## Repair loop

When a frame fails:

1. keep all passing frames
2. regenerate only the failed frame
3. use the failed frame's state anchor as source image
4. include the exact failure reason in the repair prompt
5. repeat until the report passes or `maxRepairAttempts` is exhausted

Repair prompt shape:

```text
REPAIR MODE for <avatar> <state> frame <n>.
Previous frame drifted: <specific failure reasons>.
Use <state anchor> as the source image.
Apply only this micro-motion: <motion recipe>.
Keep silhouette, palette, face/eyes, proportions, and framing coherent.
If in doubt, do less.
```

## Current implementation

`scripts/run_avatar_pipeline.py coherency-report <job.json>` performs deterministic preflight checks for:
- frame count
- missing files
- transparent/green-screen silhouette presence
- bbox/proportion drift
- center/framing drift
- dominant palette drift

It writes:
- `.avatar-pipeline/<job-id>/prompt-plan.generated.json`
- `.avatar-pipeline/<job-id>/coherency-report.generated.json`

This deterministic report is not the whole QA system. It is the hard guardrail before a vision model/agent performs subjective checks for face identity, expression quality, and visual charm.
