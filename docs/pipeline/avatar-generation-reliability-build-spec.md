# Clawpals Avatar Generation Reliability Build Spec and PR Plan

**Recommended repo path:** `docs/pipeline/avatar-generation-reliability-build-spec.md`  
**Status:** implementation spec  
**Primary goal:** make new Clawpals avatars feel like one coherent character across all six states and animation frames.  
**Secondary goal:** make the pipeline agent-friendly enough that OpenClaw can generate, QA, repair, build, push, and verify an avatar without manual desktop asset editing.

---

## 1. Executive summary

Clawpals already has the right downstream architecture: portable avatar bundles, a runtime push route, a renderer that prefers the runtime-served bundle, and a pipeline wrapper that can validate, build, push, and verify a finished bundle. The reliability gap is upstream: source image generation, frame coherence, and automated repair.

The highest-probability fix is not more prompting alone. The build should move to an **anchor-first, reference-driven, QA-gated pipeline**:

```text
user concept
-> canonical idle identity anchor
-> six state anchors derived from the identity anchor
-> deterministic or reference-edited motion frames
-> deterministic QA + vision QA
-> targeted repair loop
-> anchor-locked bundle build
-> post-build QA artifacts
-> push to runtime
-> verify selected avatar
```

The first implementation milestone should be a reliable baseline. The second milestone should make that baseline explicit inside the OpenClaw skill so the agent knows exactly what to do after the repo changes land:

```text
six generated state anchors
+ deterministic animation
+ fixed frame registration
+ contact sheet/GIF QA
```

Then add provider-backed image editing and repair.

---

## 2. Current-state read

### Working pieces

- Runtime bundle format and manifest validation exist.
- The runtime can accept a pushed bundle and persist it as the current avatar.
- The overlay prefers the runtime-served bundle and reloads when avatar id/version changes.
- The pipeline wrapper validates job manifests, emits prompt plans, runs deterministic coherency checks, builds, pushes, and verifies.
- Prompt guidance and coherency QA contracts already exist.

### Main gaps

- The wrapper does not yet call an image-generation provider directly.
- There is no fully automated generate -> review -> repair loop.
- Current deterministic QA cannot judge face identity, charm, expression quality, or subjective drift.
- The builder crops/scales/recenters each frame independently, which can introduce jitter or erase real motion.
- The docs currently mix two source image contracts: transparent PNG vs chroma green background.
- The sample job uses named palette colors, which are too loose for stable generation.

---

## 3. Non-negotiable design principles

1. **OpenClaw owns generation and control.** The desktop runtime displays the current pushed bundle.
2. **Do not treat every frame as a fresh generation.** Every downstream frame must derive from an image anchor or deterministic transform.
3. **Preserve identity before maximizing animation.** Boring consistent animation beats expressive drift.
4. **Post-build QA matters.** The built frames, not just raw source files, are what the overlay shows.
5. **Repair only failed frames.** Keep passing frames stable.
6. **Use exact palette locks.** Named colors are allowed in creative prose, not in the machine contract.
7. **Keep runtime schema stable initially.** Most work belongs in the job manifest, builder, and pipeline wrapper, not the runtime avatar schema.

---

## 4. Target pipeline

### Default reliable path

```text
Prompt/concept
-> generate canonical idle anchor
-> generate/edit state anchors from idle anchor
-> deterministic animation frames from each state anchor
-> build with preserve-canvas or anchor-locked registration
-> post-build coherency report
-> contact sheet + preview GIF
-> push + verify
```

### Advanced path

```text
Prompt/concept
-> idle anchor
-> state anchors by reference-editing idle anchor
-> frame deltas by reference-editing state anchors
-> deterministic QA
-> vision QA
-> targeted repair
-> build/push/verify
```

### Experimental path

```text
Prompt/concept
-> one-shot sprite sheet or state-anchor sheet
-> slice cells
-> QA
-> deterministic animation or reference-edit repair
-> build/push/verify
```

---

## 5. Job manifest additions

The runtime `avatar.json` can stay on schema `0.5.0`. These changes are for the **pipeline job manifest**, not necessarily the runtime bundle manifest.

### Add a pipeline job schema version

```json
{
  "pipelineJobSchemaVersion": "0.1.0"
}
```

### Add generation strategy and exact source contract

```json
{
  "generation": {
    "strategy": "anchors-plus-deterministic-motion",
    "provider": "none",
    "sourceImageContract": {
      "background": "transparent-alpha",
      "chromaKey": null,
      "logicalCanvas": "128x128",
      "exportSize": "512x512",
      "preserveCanvas": true,
      "singleCharacter": true,
      "noText": true,
      "noScene": true
    },
    "locked": {
      "species": "tiny slate pocket golem",
      "signatureFeature": "rounded stacked stones with central glowing core",
      "silhouette": "rounded stacked stones, stubby arms, central core, simple bright eyes",
      "poseFraming": "3/4 front, centered, thumbnail-readable",
      "outlineHex": "#0a0820",
      "paletteHex": ["#0a0820", "#263142", "#596575", "#9ca7aa", "#315c3b", "#9cff9d", "#fdfcff"],
      "forbiddenChanges": [
        "species",
        "signature silhouette",
        "palette",
        "outline color",
        "body proportions",
        "lighting direction",
        "camera angle"
      ]
    }
  }
}
```

### Add registration policy

```json
{
  "registration": {
    "mode": "preserve-canvas",
    "fallbackMode": "anchor-locked",
    "anchorState": "idle",
    "anchorFrameIndex": 0,
    "targetCanvasPx": 256,
    "applySameTransformTo": "all-frames",
    "legacyCropAllowed": false
  }
}
```

Valid modes:

- `preserve-canvas`: keep the full source canvas and nearest-neighbor resize to output size. Best when source images are already centered and canvas-aligned.
- `anchor-locked`: compute one transform from an anchor and apply it to every frame.
- `legacy-crop`: current behavior. Keep only for backwards compatibility.

### Make frame plans explicit

Do not compress multiple motions into one vague recipe. Make each frame one small delta.

```json
{
  "states": {
    "idle": {
      "fps": 4,
      "anchorPath": "generated/pocket-golem/idle-00.png",
      "animationMode": "deterministic",
      "framePlan": [
        { "index": 0, "kind": "anchor", "delta": "anchor" },
        { "index": 1, "kind": "deterministic", "delta": "sprite layer moves up 1 logical px; feet/base visually locked if possible" },
        { "index": 2, "kind": "deterministic", "delta": "return to anchor" },
        { "index": 3, "kind": "deterministic", "delta": "sprite layer settles down 1 logical px" }
      ],
      "frames": []
    }
  }
}
```

---

## 6. Source image contract decision

The pipeline should support both source modes, but each job must choose exactly one.

### Preferred contract

```json
"background": "transparent-alpha"
```

Use this when the provider reliably returns transparent PNGs.

### Fallback contract

```json
"background": "chroma-green",
"chromaKey": "#00ff66"
```

Use this when the provider cannot reliably return alpha. The builder removes the chroma key.

### Validation rules

- Reject jobs that request both transparent alpha and chroma green.
- Warn or fail when `paletteHex` is missing under new pipeline strategies.
- Fail if `exportSize`, `logicalCanvas`, or `preserveCanvas` are missing for provider-backed jobs.
- Fail if state definitions do not include all six required states: `idle`, `thinking`, `focused`, `happy`, `alert`, `sleepy`.

---

## 7. Builder changes

### Problem

The current builder crops to each frame bbox, scales that cropped image, and centers it on a 256x256 canvas. This can produce visible jitter because each frame gets a slightly different transform.

### Required behavior

Add a new processing path:

```text
load source frame
-> normalize alpha/chroma
-> preserve source canvas or apply canonical transform
-> resize with nearest neighbor
-> save assets/ and frames/
-> run post-build QA on the emitted PNGs
```

### Specific implementation requirements

- Keep old behavior available as `legacy-crop`.
- New jobs should default to `preserve-canvas`.
- If `preserve-canvas` fails validation, use `anchor-locked` only when explicitly allowed.
- All frames in a job should share one registration transform unless the job says `applySameTransformTo: "per-state"`.
- Accessory frames, such as sparks or Z cues, must not cause the character to shrink or recenter.
- QA must run after the final PNGs are emitted.

### Proposed files

- `scripts/build_avatar_bundle.py`
- `scripts/run_avatar_pipeline.py`
- `docs/pipeline/avatar-generation-pipeline.md`
- `docs/pipeline/avatar-coherency-qa.md`
- `jobs/pocket-golem-local.sample.json`

---

## 8. Deterministic animation baseline

Provider-generated frame deltas are the highest-drift part of the pipeline. The reliable baseline should generate only six state anchors, then create simple animation frames in code.

### Add script

```text
scripts/animate_avatar_frames.py
```

### Inputs

- Job manifest.
- Six state anchor PNGs.
- Frame plan per state.
- Optional palette cue overlays.

### Outputs

- Generated frame PNGs under `.avatar-pipeline/<job-id>/generated-frames/`.
- Updated generated build spec.
- Animation report.

### Initial deterministic operations

- `copy_anchor`
- `translate_sprite_layer(dx, dy)`
- `squash_stretch(sx, sy, anchor_baseline)`
- `overlay_spark(position, paletteColor)`
- `overlay_z(position, paletteColor)`
- `opacity_step(region_or_layer, amount)` if alpha-safe

Avoid auto-blink in the first deterministic PR unless masks exist. Eye edits are semantic and can make avatars creepy or broken if guessed.

### State defaults

- `idle`: tiny bob or breath-like layer movement.
- `thinking`: small thought cue overlay or tiny head/upper-layer nudge if mask exists.
- `focused`: mostly still, tiny signature feature nudge.
- `happy`: squash/stretch + 1-2 px bounce.
- `alert`: tiny jolt + spark cue.
- `sleepy`: droop-like shift + Z cue.

---

## 9. QA gates and artifacts

### Deterministic QA

Keep and strengthen current checks:

- frame count
- file existence
- PNG validity
- transparent/chroma silhouette presence
- bbox/proportion drift
- center/framing drift
- dominant palette drift

Add checks:

- source contract compliance
- exact palette distance against `paletteHex`
- alpha corner check for transparent jobs
- post-build frame comparison
- duplicate-frame detection with tolerance
- excessive-motion detection
- accessory-caused recenter detection

### Subjective/vision QA

Add as a later PR:

- same character identity
- face/eye consistency
- expression readability
- charm/readability at thumbnail size
- state is semantically correct
- no text, watermark, neighboring sprite bleed, or extra character

### Required artifacts

Every run should produce:

```text
.avatar-pipeline/<job-id>/prompt-plan.generated.json
.avatar-pipeline/<job-id>/coherency-report.generated.json
.avatar-pipeline/<job-id>/post-build-coherency-report.generated.json
.avatar-pipeline/<job-id>/repair-queue.generated.json
.avatar-pipeline/<job-id>/contact-sheet.generated.png
.avatar-pipeline/<job-id>/preview.generated.gif
```

Acceptance rule: a pipeline run that fails QA should leave useful artifacts behind.

---

## 10. Provider-backed generation spec

Add a provider abstraction before integrating any real provider.

### Proposed interface

```python
class AvatarImageProvider:
    def generate_identity_anchor(self, job: dict) -> ImageResult: ...
    def generate_state_anchor(self, job: dict, state: str, identity_anchor: Path) -> ImageResult: ...
    def edit_frame_delta(self, job: dict, state: str, frame_plan: dict, source_image: Path, mask: Path | None = None) -> ImageResult: ...
    def review_contact_sheet(self, job: dict, contact_sheet: Path, rubric: dict) -> ReviewResult: ...
```

### Initial providers

- `none`: current local-only/manual flow.
- `mock`: deterministic fixture images for tests.
- `external`: real provider integration behind config/env.

### New pipeline actions

```bash
npm run avatar:pipeline -- generate jobs/<job>.json
npm run avatar:pipeline -- animate jobs/<job>.json
npm run avatar:pipeline -- qa jobs/<job>.json
npm run avatar:pipeline -- repair jobs/<job>.json
npm run avatar:pipeline -- run jobs/<job>.json
```

`run` should eventually mean:

```text
generate -> animate/edit -> QA -> repair -> build -> post-build QA -> push -> verify
```

For backwards compatibility, support:

```bash
npm run avatar:pipeline -- build jobs/<job>.json
```

when all frame paths already exist.

---

## 11. Repair loop

### Rules

1. Keep passing frames.
2. Regenerate only failed frames.
3. Use the state anchor or failed frame source as image input.
4. Include exact failure reasons in the repair prompt.
5. Stop after `maxRepairAttempts`.
6. Never repair by re-running the entire avatar unless identity anchor fails.

### Repair queue shape

```json
{
  "state": "happy",
  "frameIndex": 2,
  "path": "generated-frames/happy-02.png",
  "anchorPath": "generated-anchors/happy-00.png",
  "failures": [
    "palette drift: introduced non-palette blue",
    "face drift: eye spacing changed"
  ],
  "allowedRegions": ["mouth", "body-y-offset", "heart-spark"],
  "repairPrompt": "REPAIR MODE..."
}
```

---


## 12. OpenClaw skill integration and agent runbook

This reliability work should land as an OpenClaw-skill workflow, not just as repo scripts. The skill already owns pairing, state control, daemon behavior, and `clawpals avatar push`. After these changes, it should also teach the agent exactly how to create, QA, repair, push, and verify avatars.

### Files that should become part of the implementation plan

- `skills/clawpals/SKILL.md` - agent-facing behavioral instructions and decision tree.
- `skills/clawpals/bin/clawpals.mjs` - CLI command surface and help text.
- `skills/clawpals/docs/avatar-generation.md` - detailed runbook for installed-skill usage, if we do not want `SKILL.md` to become too long.
- `skills/clawpals/templates/avatar-job-template.json` - minimal reliable job scaffold for agents.
- `docs/pipeline/avatar-generation-pipeline.md` - developer-facing pipeline docs.
- `docs/prompts/avatar-job-template.md` - prompt/job contract updates.
- `README.md` - honest status of reliable baseline vs experimental provider-backed generation.

### Skill behavior when the user asks for a new avatar

When the user says something like "make me a tiny amethyst dragon" or "change my Clawpal into a cozy wizard moth," the OpenClaw agent should follow this order:

1. **Check runtime readiness.** Run `clawpals status` or `clawpals ping`. If not paired, pair first. Do not start asset generation before the runtime target is known unless the user explicitly wants offline drafting.
2. **Create a job manifest on the OpenClaw host.** Use `~/.openclaw/clawpals/avatar-jobs/<job-id>.json` for user-specific jobs. Use repo `jobs/` only for fixtures, tests, and examples.
3. **Default to the reliable strategy.** Use `anchors-plus-deterministic-motion` unless the user explicitly asks for experimental/advanced animation.
4. **Lock the character contract before frame generation.** The job must include exact `paletteHex`, `outlineHex`, `poseFraming`, `signatureFeature`, and `forbiddenChanges` before generating frames.
5. **Generate or collect the six state anchors.** Provider-backed generation should create the anchors. If provider credentials are unavailable, emit the prompt plan and stop with a clear missing-provider message instead of pretending generation happened.
6. **Animate deterministically by default.** Generate frame loops from state anchors using code. Use provider-edited motion frames only in advanced mode.
7. **Run QA before build and after build.** Do not push frames that fail identity, palette, registration, or artifact checks.
8. **Repair only failed frames.** Never regenerate the entire avatar unless the identity anchor itself failed.
9. **Show review artifacts.** Produce a contact sheet and preview GIF. If QA is borderline or vision QA is unavailable, present artifacts and ask for approval before pushing.
10. **Push and verify.** Use `clawpals avatar push <bundle-dir>`, then verify `clawpals status` and the runtime-served `avatar.json`.
11. **Do not send the user to the desktop filesystem.** The desktop runtime is the display target. OpenClaw owns generation and bundle push.

### Skill decision tree

```text
User asks for avatar creation/change
-> Is Clawpals paired?
   -> no: run pairing flow first, unless offline draft requested
   -> yes: continue
-> Is provider configured?
   -> no: emit prompt plan/job scaffold and explain missing provider
   -> yes: generate anchors
-> Which strategy?
   -> default: anchors-plus-deterministic-motion
   -> advanced: reference-edit frames + repair loop
   -> experimental: sprite sheet mode
-> Run QA
   -> pass: build, post-build QA, contact sheet, push, verify
   -> fail: repair failed frames, rerun QA
   -> repair exhausted: show artifacts and stop; do not push as default
```

### Proposed future CLI commands

Keep the existing low-level `clawpals avatar push <bundle-dir>`. Add a higher-level skill-facing surface so agents do not have to remember script internals.

```bash
clawpals avatar scaffold "tiny amethyst dragon with cozy wizard energy" --name dawn-amethyst-v3
clawpals avatar generate ~/.openclaw/clawpals/avatar-jobs/dawn-amethyst-v3.json
clawpals avatar qa ~/.openclaw/clawpals/avatar-jobs/dawn-amethyst-v3.json
clawpals avatar repair ~/.openclaw/clawpals/avatar-jobs/dawn-amethyst-v3.json
clawpals avatar build ~/.openclaw/clawpals/avatar-jobs/dawn-amethyst-v3.json
clawpals avatar review ~/.openclaw/clawpals/avatar-jobs/dawn-amethyst-v3.json
clawpals avatar push ~/.openclaw/clawpals/local-avatars/dawn-amethyst-v3/bundle
clawpals avatar verify ~/.openclaw/clawpals/avatar-jobs/dawn-amethyst-v3.json
```

`clawpals avatar generate ... --push` can exist later as a convenience command, but the implementation should keep the internal phases separate so failures leave useful artifacts.

### Low-level script sequence the skill can wrap

```bash
npm run avatar:pipeline -- validate <job.json>
npm run avatar:pipeline -- generate <job.json>
npm run avatar:pipeline -- animate <job.json>
npm run avatar:pipeline -- qa <job.json>
npm run avatar:pipeline -- repair <job.json>
npm run avatar:pipeline -- build <job.json>
npm run avatar:pipeline -- push <job.json>
npm run avatar:pipeline -- verify <job.json>
```

The installed skill should either expose these as `clawpals avatar <action>` wrappers or document exactly where the pipeline root lives. Do not require the agent to guess whether it is operating from the repo root, skill install folder, or user home.

### `SKILL.md` section to add

Add a concise section titled **Avatar generation workflow** to `skills/clawpals/SKILL.md`:

```md
## Avatar generation workflow

When the user asks to create or change a Clawpals avatar, OpenClaw should create the avatar on the OpenClaw host, build the bundle, push it to the paired runtime, and verify it. Do not instruct the user to manually edit desktop-machine assets.

Default strategy: generate six state anchors, animate deterministic frame loops, run QA, build, push, verify. Use provider-edited frame deltas only when advanced generation is explicitly configured.

Required flow:
1. `clawpals status` or `clawpals ping` to confirm runtime readiness.
2. Scaffold a job manifest under `~/.openclaw/clawpals/avatar-jobs/`.
3. Lock exact palette hex values, outline, pose framing, signature silhouette, and source image contract.
4. Generate or collect state anchors.
5. Run deterministic animation and QA.
6. Repair failed frames only.
7. Build bundle and create contact sheet/GIF.
8. Push with `clawpals avatar push <bundle-dir>`.
9. Verify with `clawpals status` and the runtime-served manifest.

If the provider is not configured, emit the prompt plan/job scaffold and say provider-backed image generation is unavailable. Do not claim that an avatar was generated.
```

### Agent UX rules

- If the user gives a clear concept, do not over-interview. Pick a strong first design, generate review artifacts, and let the user react visually.
- If the user requests an existing copyrighted character or a real person, steer toward an original inspired companion rather than a direct copy.
- If QA fails, report the failing state/frame and repair attempt count. Do not blame the user or ask them to edit images manually.
- If the runtime verification fails after a successful build, diagnose pairing/runtime persistence before regenerating art.
- Never include runtime tokens, pair codes, API keys, or private paths in avatar bubbles.


## 13. PR plan

### PR 0 - Land build spec

**Branch:** `docs/avatar-reliability-build-spec`  
**Purpose:** Add this spec to the repo so future implementation PRs have a source of truth.

**Files:**

- `docs/pipeline/avatar-generation-reliability-build-spec.md`

**Acceptance criteria:**

- Spec is committed.
- PR plan is visible in docs.
- No runtime or pipeline behavior changes.

---

### PR 1 - Pipeline job contract and manifest validation

**Branch:** `avatar/job-contract-v0`  
**Purpose:** Make the pipeline job manifest explicit enough to support reliable generation.

**Files likely changed:**

- `scripts/run_avatar_pipeline.py`
- `jobs/pocket-golem-local.sample.json`
- `docs/prompts/avatar-job-template.md`
- `docs/pipeline/avatar-generation-pipeline.md`
- `docs/clawpals-style-guide.md`

**Build items:**

- Add `pipelineJobSchemaVersion`.
- Add `generation.strategy`.
- Add `generation.sourceImageContract`.
- Add `generation.locked.paletteHex` and `outlineHex`.
- Add `registration` config.
- Validate exact source contract.
- Warn or fail on named-only palettes for new strategies.
- Keep old manifests working through compatibility defaults.

**Acceptance criteria:**

- Existing sample job validates or is updated to validate.
- New sample job uses exact hex palette.
- Invalid jobs fail with actionable errors.
- `npm run avatar:pipeline -- validate jobs/pocket-golem-local.sample.json` passes.

---

### PR 2 - Anchor-locked/preserve-canvas builder

**Branch:** `avatar/builder-registration`  
**Purpose:** Stop the builder from introducing animation inconsistency.

**Files likely changed:**

- `scripts/build_avatar_bundle.py`
- `scripts/run_avatar_pipeline.py`
- `docs/pipeline/avatar-generation-pipeline.md`
- `docs/pipeline/avatar-coherency-qa.md`

**Build items:**

- Implement `preserve-canvas` mode.
- Implement `anchor-locked` mode.
- Keep `legacy-crop` for compatibility.
- Support transparent-alpha and chroma-green source modes.
- Ensure accessory frames do not change registration.
- Emit registration metadata into the build report.

**Acceptance criteria:**

- Same input canvas produces same output registration across all frames.
- Existing legacy jobs can still build.
- New jobs default to preserve-canvas.
- Preview GIF shows no artificial shrink/recenter jitter from the builder.

---

### PR 3 - Post-build QA and contact sheets

**Branch:** `avatar/post-build-qa-artifacts`  
**Purpose:** Make failures visible and reviewable.

**Files likely changed:**

- `scripts/run_avatar_pipeline.py`
- `scripts/build_avatar_bundle.py`
- new `scripts/avatar_contact_sheet.py` or equivalent helper
- `docs/pipeline/avatar-coherency-qa.md`

**Build items:**

- Run coherency checks on emitted bundle frames.
- Emit `post-build-coherency-report.generated.json`.
- Emit contact sheet PNG.
- Emit per-state strips or a single full contact sheet.
- Highlight failed frames in the contact sheet if feasible.
- Preserve artifacts on failure.

**Acceptance criteria:**

- Every pipeline run leaves review artifacts.
- Failed QA leaves enough detail to repair without guessing.
- Contact sheet includes all six states and frame indexes.

---

### PR 4 - Deterministic animation generator

**Branch:** `avatar/deterministic-animation`  
**Purpose:** Create a reliable default mode that does not depend on generated frame deltas.

**Files likely changed:**

- new `scripts/animate_avatar_frames.py`
- `scripts/run_avatar_pipeline.py`
- `jobs/pocket-golem-local.sample.json`
- `docs/prompts/clawpals-frame-delta-prompt.md`
- `docs/pipeline/avatar-generation-pipeline.md`

**Build items:**

- Add `animate` pipeline action.
- Generate frames from six anchors and `framePlan`.
- Implement copy, translate, squash/stretch, spark, and Z cue operations.
- Update build spec generation to use deterministic output frames.
- Treat semantic edits like blink as optional until masks/reference editing exist.

**Acceptance criteria:**

- A six-anchor job can produce a complete animated bundle without generated frame deltas.
- Generated frames pass post-build QA under default thresholds.
- Output GIF feels stable even if animation is subtle.

---


### PR 5 - OpenClaw skill agent contract and command surface

**Branch:** `avatar/openclaw-skill-runbook`  
**Purpose:** Make the improved pipeline usable by OpenClaw agents, not just by developers who know the repo internals.

**Files likely changed:**

- `skills/clawpals/SKILL.md`
- `skills/clawpals/bin/clawpals.mjs`
- new `skills/clawpals/docs/avatar-generation.md`
- new `skills/clawpals/templates/avatar-job-template.json`
- `docs/pipeline/avatar-generation-pipeline.md`
- `README.md`

**Build items:**

- Add an explicit avatar-generation workflow to `SKILL.md`.
- Add skill-facing command help for `clawpals avatar scaffold|generate|qa|repair|build|review|push|verify`.
- Make the CLI resolve the correct pipeline root instead of assuming the agent is in the repo directory.
- Store user avatar jobs under `~/.openclaw/clawpals/avatar-jobs/` by default.
- Store generated local bundles under `~/.openclaw/clawpals/local-avatars/<job-id>/bundle` by default.
- Add a clear missing-provider path: emit prompt plan and job scaffold, but do not claim generation succeeded.
- Document when the agent should auto-push versus stop for human visual review.

**Acceptance criteria:**

- An OpenClaw agent can follow `skills/clawpals/SKILL.md` and create/push a reliable-baseline avatar without reading the full developer spec.
- `clawpals --help` or `clawpals avatar --help` shows the new avatar workflow.
- The skill never instructs the user to manually edit desktop-machine avatar files.
- Failed QA produces contact sheet/GIF/report paths and repair instructions.
- Runtime verification is required after push.


### PR 6 - Provider abstraction and mock provider

**Branch:** `avatar/provider-interface`  
**Purpose:** Add provider-backed generation structure without coupling the pipeline to one model immediately.

**Files likely changed:**

- new `scripts/avatar_providers/base.py`
- new `scripts/avatar_providers/mock.py`
- `scripts/run_avatar_pipeline.py`
- `docs/pipeline/avatar-generation-pipeline.md`

**Build items:**

- Add provider registry.
- Add `generate` action.
- Add mock provider for deterministic CI/dev behavior.
- Write generated anchors to `.avatar-pipeline/<job-id>/generated-anchors/`.
- Do not require real provider credentials for tests.

**Acceptance criteria:**

- `provider: mock` can generate placeholder-valid anchors.
- `provider: none` preserves existing manual flow.
- Tests do not need network access or external credentials.

---

### PR 7 - Reference-edit frame generation and targeted repair

**Branch:** `avatar/reference-edit-repair-loop`  
**Purpose:** Move from text-only generation to anchor/reference-driven generation and repair.

**Files likely changed:**

- `scripts/avatar_providers/base.py`
- provider implementation module
- `scripts/run_avatar_pipeline.py`
- `docs/pipeline/avatar-coherency-qa.md`
- `docs/prompts/clawpals-frame-delta-prompt.md`

**Build items:**

- Generate state anchors from the idle identity anchor.
- Generate frame deltas from state anchors.
- Use failed frame reasons in repair prompts.
- Keep passing frames untouched.
- Respect `maxRepairAttempts`.
- Write repair attempt history.

**Acceptance criteria:**

- Repair queue can be consumed automatically.
- Failed generated frames are replaced without regenerating the entire avatar.
- Final build blocks if repair attempts are exhausted and QA still fails.

---

### PR 8 - Vision QA gate

**Branch:** `avatar/vision-qa-review`  
**Purpose:** Add subjective checks deterministic metrics cannot catch.

**Files likely changed:**

- `scripts/run_avatar_pipeline.py`
- `scripts/avatar_providers/base.py`
- new `docs/pipeline/avatar-vision-qa-rubric.md`
- `docs/pipeline/avatar-coherency-qa.md`

**Build items:**

- Add vision review rubric.
- Review contact sheet or per-state strips.
- Score identity, expression, charm, readability, and artifact absence.
- Add failure reasons to repair queue.
- Allow `--skip-vision-qa` for local deterministic testing.

**Acceptance criteria:**

- Vision QA produces structured JSON.
- Low-scoring frames enter repair queue.
- Deterministic-only CI path remains available.

---

### PR 9 - Sprite sheet experiment

**Branch:** `avatar/sprite-sheet-experiment`  
**Purpose:** Test whether one-shot sheets improve consistency.

**Files likely changed:**

- new `scripts/slice_avatar_sheet.py`
- `scripts/run_avatar_pipeline.py`
- new `docs/pipeline/avatar-sprite-sheet-experiment.md`

**Build items:**

- Support state-anchor sheet generation.
- Slice fixed grid cells.
- Detect cell bleed and labels/text.
- Route sliced anchors into deterministic animation.

**Acceptance criteria:**

- Sheet pipeline is opt-in.
- Failures do not affect default generation path.
- Results can be compared against reference-edit path.

---

### PR 10 - Release polish and docs cleanup

**Branch:** `avatar/reliability-docs-polish`  
**Purpose:** Make the new pipeline understandable and safe to use.

**Files likely changed:**

- `README.md`
- `docs/pipeline/avatar-generation-pipeline.md`
- `docs/pipeline/avatar-coherency-qa.md`
- `docs/clawpals-style-guide.md`
- `docs/prompts/*`
- sample jobs

**Build items:**

- Remove transparent-vs-chroma ambiguity.
- Document default strategy.
- Add troubleshooting guide.
- Add examples for manual, deterministic, provider-backed, and repair flows.
- Add final command examples.

**Acceptance criteria:**

- A new contributor can run the reliable baseline from docs.
- Old manual local-only flow is still documented as fallback.
- Product README accurately describes what is working vs experimental.

---

## 14. Dependency order

```text
PR 0 docs
  -> PR 1 job contract
      -> PR 2 builder registration
          -> PR 3 post-build QA/contact sheets
              -> PR 4 deterministic animation
                  -> PR 5 OpenClaw skill runbook/command surface
                      -> PR 6 provider abstraction
                          -> PR 7 reference-edit repair
                              -> PR 8 vision QA
                                  -> PR 10 docs polish

PR 9 sprite sheet experiment can branch after PR 3 or PR 4.
```

Do not start provider repair work before PR 2 and PR 3. Otherwise, you may mistake builder-induced jitter for model drift.

---

## 15. Test and verification plan

### Static checks

```bash
npm run check
npm run test
```

### Pipeline checks

```bash
npm run avatar:pipeline -- validate jobs/pocket-golem-local.sample.json
npm run avatar:pipeline -- scaffold jobs/pocket-golem-local.sample.json
npm run avatar:pipeline -- coherency-report jobs/pocket-golem-local.sample.json
npm run avatar:pipeline -- build jobs/pocket-golem-local.sample.json
```

### Post-build manual review

Review:

```text
.avatar-pipeline/<job-id>/contact-sheet.generated.png
.avatar-pipeline/<job-id>/preview.generated.gif
.avatar-pipeline/<job-id>/post-build-coherency-report.generated.json
```

### Runtime verification

```bash
npm run avatar:pipeline -- push jobs/<job>.json
npm run avatar:pipeline -- verify jobs/<job>.json
```

Expected result:

- Runtime selected avatar id matches the job name.
- Runtime bundle version matches the job version.
- Overlay loads runtime-served bundle.
- State changes display correct state frames.

---

## 16. Definition of done for the reliability project

The project should be considered successful when this is true:

1. A user can provide a one-sentence avatar concept.
2. The pipeline can create a complete six-state animated bundle.
3. The character remains coherent across states and frames.
4. The preview/contact sheet makes QA fast.
5. Failed frames are repaired individually.
6. The final bundle is pushed to the paired runtime.
7. The overlay displays the new avatar without manual desktop asset editing.
8. The boring baseline is reliable even when advanced provider-backed generation is unavailable.

---

## 17. Key risks and mitigations

### Risk: builder fixes break old jobs

Mitigation: keep `legacy-crop` and compatibility defaults.

### Risk: deterministic animation looks too boring

Mitigation: accept boring as the reliable baseline; use provider-backed reference edits as advanced mode.

### Risk: exact hex palette makes creative generation less flexible

Mitigation: allow creative palette exploration before lock-in, but require exact hex once the job enters production generation.

### Risk: provider integration becomes too model-specific

Mitigation: use a provider interface and mock provider first.

### Risk: vision QA becomes slow or flaky

Mitigation: keep deterministic QA as the blocking baseline and make vision QA configurable.

### Risk: sprite sheet generation creates cell bleed or labels

Mitigation: keep sprite sheets experimental and opt-in.

---

## 18. Open decisions

1. Should new generated source images prefer transparent alpha or chroma green by default?
2. Should output bundle frames remain 256x256, or should the runtime move toward 512x512 assets?
3. Should deterministic animation be the default for all custom avatars, with generated frame deltas behind an `advanced` flag?
4. Which provider should be implemented first after the mock provider?
5. Should subjective vision QA block builds by default or only create warnings until calibrated?

---

## 19. Suggested first commit

Add this file:

```text
docs/pipeline/avatar-generation-reliability-build-spec.md
```

Then open PR 0 with no behavior changes. This gives the implementation sequence a reviewable source of truth before touching the pipeline.

---

## 20. Source basis

This spec was based on the uploaded Clawpals Avatar Generation Framework context brief, the public Clawpals repository, and the public Clawpet landing page.

Relevant repo files reviewed:

- `README.md`
- `docs/pipeline/avatar-generation-pipeline.md`
- `docs/pipeline/avatar-coherency-qa.md`
- `docs/prompts/avatar-job-template.md`
- `docs/prompts/clawpals-creative-prompt.md`
- `docs/prompts/clawpals-frame-delta-prompt.md`
- `docs/clawpals-style-guide.md`
- `jobs/pocket-golem-local.sample.json`
- `scripts/run_avatar_pipeline.py`
- `scripts/build_avatar_bundle.py`
- `src/avatars/bundle.ts`
- `src/runtime/avatarBundleStore.ts`
- `src/runtime/app.ts`
- `src/overlay.tsx`
- `skills/clawpals/SKILL.md`
- `skills/clawpals/bin/clawpals.mjs`
## Release/versioning note for avatar reliability work

Before regenerating Pocket Golem or creating new avatars, finish the planned avatar reliability PR sequence. Track user-visible changes with explicit versioning and release notes:

- Existing Pocket Golem is visible and broadly promising, but still has green-background artifacts and cross-state anchor drift.
- Treat current golem as a validation fixture, not the final regenerated avatar.
- Regenerate Pocket Golem only after the reliability pipeline is complete enough to enforce source contracts, post-build QA artifacts, deterministic animation, and repair loops.
- When landing PRs, document which parts are stable baseline vs experimental provider-backed generation.
- For generated avatar bundles, bump bundle versions intentionally and include release notes describing pipeline changes, source-contract changes, QA gates, and visual differences.

## Preferred future image providers

For real provider-backed testing and production, prioritize these providers first because they currently yield the best avatar-generation results:

- OpenAI `gpt-image-2`
- Gemini `gemini-3.1-flash-image-preview`

Keep the provider interface model-neutral so the pipeline can test both without changing job/build/repair contracts.

