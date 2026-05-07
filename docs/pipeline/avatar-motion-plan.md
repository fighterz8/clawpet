# Avatar motion plan contract

The reliable avatar pipeline should not jump directly from state anchors to generated frames with vague motion instructions. Each state needs an explicit frame plan before animation or provider frame editing.

```text
state anchor
-> state-specific motion plan
-> deterministic frame generation or provider reference-edit generation
-> QA/repair/build
```

## Required idea

First apply the designed-to-animate contract in `docs/pipeline/avatar-designed-to-animate.md`. A motion plan works best when the avatar is a constrained rig: locked silhouette, limited shapes, symmetric face, planted base/shadow, and only a few animation channels.

Each state should define small, readable deltas. The frame plan is both:

1. executable by deterministic operations when possible, and
2. promptable as reference-edit instructions for future OpenAI/Gemini frame generation.

## Example frame plan item

```json
{
  "index": 1,
  "operation": "wing_flutter",
  "motionDescription": "tiny upbeat wing lift; keep body, face, palette, and framing locked",
  "dx": 1,
  "dy": -2
}
```

## Default semantic motions

For moth/winged avatars:

- `idle`: tiny wing flutter + soft lantern/core glow pulse
- `thinking`: antenna twitch + small thought sparkle
- `focused`: mostly still, steady core/lantern pulse
- `happy`: upbeat wing bounce/flutter + brighter glow
- `alert`: quick jolt + spark cue
- `sleepy`: slow droop + Z cue + dimmer/softer motion

For non-winged avatars, map the same intent to species-appropriate motion:

- idle breath/bob
- thinking head tilt or thought cue
- focused stillness/core pulse
- happy bounce
- alert jolt/spark
- sleepy droop/Z cue

## Current deterministic operations

- `copy_anchor`
- `translate_sprite_layer`
- `squash_stretch`
- `overlay_spark`
- `overlay_z`
- `pulse_glow`
- `antenna_twitch`
- `wing_flutter`

Some operations are semantic placeholders today. For example, `wing_flutter` currently uses conservative micro-motion until masks or provider reference edits can target wings only. Keeping the operation name matters because it becomes the stable contract for future provider-backed frame generation.

## Why this matters

Without explicit motion plans, default deterministic animation can look static, especially for states like thinking/focused/idle. Motion plans preserve identity while giving each state a readable behavior before any frame generation happens.
