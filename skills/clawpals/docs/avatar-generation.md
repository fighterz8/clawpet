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

### Golden acceptance gate

For v0.6.0-quality generated avatars, set:

```json
"generation": {
  "acceptanceProfile": "golden-avatar-v0.6",
  "stateActing": {
    "thinking": "character-led acting description...",
    "focused": "character-led acting description...",
    "happy": "character-led acting description...",
    "alert": "character-led acting description...",
    "sleepy": "character-led acting description..."
  }
}
```

The default style goldens are `dawn-v2-ember` and `lantern-moth-v0` (Lantern Ember Moth). `glass-toad-v0` is useful for coherency calibration, but is chunkier than the desired default/preset house style. New default avatars should match Dawn Ember and Lantern Ember Moth stylistically: warm ember/lantern glow, crisp dark outline, compact magical familiar silhouette, flat cel-shaded forms, restrained warm palette with one accent glow, and thumbnail-readable charm. They should also match the functional quality of the goldens: same character across all states, expressive body/face/signature-feature acting, distinctive silhouette, stable art direction, and readable thumbnail state changes. Floating symbols can support a state but cannot be the main difference.

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
- default/preset style: explicitly anchor the prompt to “same house style as Dawn Ember and Lantern Ember Moth: warm ember glow, crisp dark outline, compact magical familiar, flat cel-shaded, thumbnail-readable.”

4. Generate the first `idle` anchor only, show only that anchor to the user, and wait for explicit approve/disapprove. Do not dump every generated state/frame into chat. If the user disapproves, regenerate the idle anchor and repeat until approved.

   The idle anchor must hit the standardized sprite size (golden-aligned with `dawn-v2-ember` and `lantern-moth-v0`):
   - Longest axis fills **92–100%** of the 256-canvas (≈944–1024 px on a 1024 export).
   - Short axis fills **78–94%** (anything ≥95% on both axes reads chunky like `glass-toad-v0` and is rejected).
   - Avoid sub-90% on the longest axis (mooncap was 41%, too small).
   - Configured in `generation.spriteSize`; QA fails the idle anchor if it falls outside.
   - Always include in the generation prompt: "the character must fill ~95% of the longest dimension of the export with ~5% transparent margin".

5. After approval, generate or collect the remaining five state anchors: `thinking`, `focused`, `happy`, `alert`, `sleepy`.

6. Generate animation frames with the image provider for production avatars. For `gpt-image-2` avatars, never use local Pillow/deterministic operations to create visible art changes such as glow, blinks, squash/stretch, expression changes, or motion. Local animation commands are for mock/CI diagnostics only. Production frames must be provider reference-edits from the locked state anchor.

6. Run pipeline QA for golden-profile jobs, then build and review artifacts:

```bash
npm run avatar:pipeline -- qa ~/.openclaw/clawpals/avatar-jobs/<job-id>.json
clawpals avatar build ~/.openclaw/clawpals/avatar-jobs/<job-id>.json
```

Important artifacts:

```text
.avatar-pipeline/<job-id>/animation-report.generated.json
.avatar-pipeline/<job-id>/coherency-report.generated.json
.avatar-pipeline/<job-id>/qa-report.generated.json
.avatar-pipeline/<job-id>/overlay-32.generated.png
.avatar-pipeline/<job-id>/silhouette-32.generated.png
.avatar-pipeline/<job-id>/state-delta-32.generated.png
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

See `docs/pipeline/avatar-vision-qa-rubric.md` in the repo. Vision QA reviews the post-build contact sheet for identity consistency, expression readability, character-led state acting, animation coherence, thumbnail charm/readability, silhouette distinctiveness, and artifacts. It is provider-backed and optional until calibrated; deterministic QA remains the blocking baseline.


## Sprite sheet experiment

Sprite sheets are opt-in only. They are useful for experiments but should not replace the reliable anchor-first path. Use `clawpals avatar slice-sheet <job.json>` only when the job has a `spriteSheet` block with `path`, `rows`, `cols`, and `stateOrder`. The slicer saves full isolated cells as anchors so registration stays stable. For production, sliced anchors must still be animated with provider reference-edited frames, not local deterministic visual edits. Watch for cell bleed, labels/text, and neighboring-pose contamination.
