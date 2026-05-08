# Avatar motion plan contract

The reliable avatar pipeline should not jump directly from state anchors to generated frames with vague motion instructions. Each state needs an explicit frame plan before animation or provider frame editing.

```text
idle anchor candidate
-> user approval gate (show only the first anchor; regenerate until approved)
-> remaining state anchors
-> state-specific motion plan
-> provider reference-edit frame generation for production avatars
-> QA/repair/build
```

## Required idea

First apply the designed-to-animate contract in `docs/pipeline/avatar-designed-to-animate.md`. A motion plan works best when the avatar is a constrained rig: locked silhouette, limited shapes, symmetric face, planted base/shadow, and only a few animation channels.

Each state should define small, readable deltas. The frame plan is both:

1. promptable as provider reference-edit instructions for OpenAI/Gemini frame generation, and
2. executable by deterministic operations only for mock/CI diagnostics, never final production art.

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

## Local deterministic operations are test-only

- `copy_anchor`
- `translate_sprite_layer`
- `squash_stretch`
- `overlay_spark`
- `overlay_z`
- `pulse_glow`
- `antenna_twitch`
- `wing_flutter`

Local operations are semantic placeholders for tests and diagnostics only. Production avatars generated with `gpt-image-2` must not use Pillow/local pixel edits for visual motion, glow, blink, squash/stretch, or expression changes. Those changes must be generated as provider reference edits from the locked anchor/state frame. Local code may clean chroma, package, inspect, and QA, but it must not invent visible art.

## Why this matters

Without explicit motion plans, generated animation can look static, especially for states like thinking/focused/idle. Motion plans preserve identity while giving each state a readable behavior before provider frame generation happens.
