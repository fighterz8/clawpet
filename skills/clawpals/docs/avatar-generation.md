# Avatar generation workflow

OpenClaw owns avatar creation on the OpenClaw host. The desktop runtime is only the display target.

## Reliable baseline

### Designed-to-animate gate

Before picking a species or generating art, constrain the avatar as a tiny rig, not a freeform illustration. See `docs/pipeline/avatar-designed-to-animate.md`.

Hard defaults:

- Forward-facing preferred; strict consistent 3/4 only when necessary.
- Single closed silhouette with one connected outline.
- Symmetric face and mirrored primary features.
- No more than seven visible shapes total.
- No arms/hands/fingers, necks, loose scarves/capes, dangling jewelry, long hair/fur/feathers, or independently moving limbs.
- Exactly one signature feature: oversized ears, glowing core, curled tail, antenna, embedded gem, or one floating orb/halo/flame.
- Reserve accessory zones above the head, beside the body, and in front of the face/body.
- Animate by channels only: `yOff`, `eyeOpen`, `eyeLook`, `mouth`, `earOrAntennaTilt`, `signatureNudge`, `accessory`, and `shadowScale`.

This gate matters more than the cleverness of the animation code. If the creature is not rig-safe, generated frames will drift or look static.

1. Confirm runtime readiness:

```bash
clawpals status
```

2. Create a user job under:

```text
~/.openclaw/clawpals/avatar-jobs/<job-id>.json
```

Use `skills/clawpals/templates/avatar-job-template.json` as the scaffold.

3. Lock the character contract before generating frames:

- exact `paletteHex`
- exact `outlineHex`
- stable species/silhouette/signature feature
- source image contract: transparent alpha or chroma green, not both
- registration mode, usually `preserve-canvas`

4. Generate or collect six state anchors: `idle`, `thinking`, `focused`, `happy`, `alert`, `sleepy`.

5. Animate deterministically by default:

```bash
clawpals avatar animate ~/.openclaw/clawpals/avatar-jobs/<job-id>.json
```

6. Build and review artifacts:

```bash
clawpals avatar build ~/.openclaw/clawpals/avatar-jobs/<job-id>.json
```

Important artifacts:

```text
.avatar-pipeline/<job-id>/animation-report.generated.json
.avatar-pipeline/<job-id>/coherency-report.generated.json
.avatar-pipeline/<job-id>/post-build-coherency-report.generated.json
.avatar-pipeline/<job-id>/contact-sheet.generated.png
```

7. Push only after QA passes or the user explicitly approves a borderline visual:

```bash
clawpals avatar push ~/.openclaw/clawpals/local-avatars/<job-id>/bundle
clawpals status
```

## Command wrappers

The skill CLI wraps repo pipeline actions when it can find `scripts/run_avatar_pipeline.py`. If needed, set:

```bash
export CLAWPALS_PIPELINE_ROOT=/path/to/clawpals
```

Available wrappers:

```bash
clawpals avatar validate <job.json>
clawpals avatar generate <job.json>
clawpals avatar slice-sheet <job.json>
clawpals avatar animate <job.json>
clawpals avatar repair <job.json>
clawpals avatar qa <job.json>
clawpals avatar build <job.json>
clawpals avatar vision-qa <job.json>
clawpals avatar review <job.json>
clawpals avatar run <job.json>
clawpals avatar push-job <job.json>
clawpals avatar verify <job.json>
```

Use `clawpals avatar push <bundle-dir>` for the low-level runtime upload.

## Provider unavailable behavior

If provider-backed generation is not configured, emit the job scaffold and prompt plan. Do not claim image generation happened.

Current provider states:

- `none`: manual/local anchors only; generation intentionally fails with a clear message.
- `mock`: deterministic offline provider for tests and CI; creates placeholder-valid six-state anchors without network access.
- real external providers: not implemented yet.

## Preferred future image providers

For real provider-backed testing and production, prioritize these providers first because they currently yield the best avatar-generation results:

- OpenAI `gpt-image-2`
- Gemini `gemini-3.1-flash-image-preview`

Keep the provider interface model-neutral so the pipeline can test both without changing job/build/repair contracts.



## Vision QA rubric

See `docs/pipeline/avatar-vision-qa-rubric.md` in the repo. Vision QA reviews the post-build contact sheet for identity consistency, expression readability, animation coherence, thumbnail charm/readability, and artifacts. It is provider-backed and optional until calibrated; deterministic QA remains the blocking baseline.


## Sprite sheet experiment

Sprite sheets are opt-in only. They are useful for experiments but should not replace the reliable anchor-first path. Use `clawpals avatar slice-sheet <job.json>` only when the job has a `spriteSheet` block with `path`, `rows`, `cols`, and `stateOrder`. The slicer saves full isolated cells as anchors so registration stays stable, then routes those anchors into deterministic animation. Watch for cell bleed, labels/text, and neighboring-pose contamination.
