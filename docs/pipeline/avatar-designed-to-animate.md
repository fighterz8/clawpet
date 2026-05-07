# Designed-to-animate avatar contract

The strongest Clawpals animations come from avatars that are designed like tiny parameterized rigs, not detailed illustrations. The pipeline should constrain character design before frame generation so animation can be expressed as small channel changes.

## Core rule

Do not animate a freshly redrawn sprite or a complex illustration chopped into regions. Animate one locked geometric description with a few parameters nudged.

```text
rig-safe avatar design
-> locked idle identity anchor
-> state anchors/edit plans
-> frame channel deltas
-> QA/repair/build
```

If the only way to create motion is to split the character into arbitrary image sections, the avatar design has failed the OpenClaw animation contract. Redesign the character simpler instead of adding more slicing hacks.

## Hard design requirements

A production-bound generated avatar should satisfy these before animation:

- Forward-facing, or strict 3/4 with the same orientation across all states.
- Single closed silhouette: one connected outlined character shape.
- Symmetric face: eyes, ears, antennae, and markings mirror across the vertical axis unless explicitly excluded.
- No more than seven distinct visible shapes total.
- Head sits directly on body; no separate neck.
- Paws/feet/base remain planted or move as one rigid unit.
- Distinct accessory zones:
  - above-head: spark, Z, question/thought cue
  - beside-body: hearts, alert sparkle, small orbiting accent
  - in-front: focus dot, thought bubble, attention line
- One signature feature only. Examples: oversized ears, glowing core/marking, curled tail, antenna, embedded crystal/gem, single floating orb/halo/flame.

## Forbidden by default

Avoid designs that require complex choreography or invite redraw drift:

- Arms with hands or fingers.
- Long independent limbs such as tentacles, spider legs, or butterfly wings, unless frozen in a single fixed pose and treated as a locked silhouette.
- Loose accessories: scarves, dangling jewelry, brimmed hats, flowing capes.
- Asymmetric identity hooks that must remain exactly placed, such as one earring or one off-center horn.
- Hair, fur, feathers, tassels, or wisps longer than 2-3 logical pixels.
- Flowing edges that can flap differently from frame to frame.
- More than one character or any background scene.

## Animation channels

Default generated avatars should expose only these channels:

| Channel | Meaning | Safe magnitude at 64x64 logical scale |
| --- | --- | --- |
| `yOff` | whole body up/down | idle 1-2 px, happy up to 5 px |
| `eyeOpen` | eye height/open amount | 0.05-1.3x |
| `eyeLook` | pupil/highlight shift | 1 px |
| `mouth` | categorical expression | flat, smile, open, small, sleep |
| `earTilt` / `antennaTilt` | apex/control point offset | 1-3 px |
| `tailWag` / `signatureNudge` | signature feature phase | 1-2 px |
| `accessory` | overlay on/off/phase | fixed accessory zones only |
| `shadowScale` | grounding shadow width/alpha | inverse of yOff |

Everything else is frozen: body shading, head proportions, palette, outline thickness, camera, and canvas registration.

## Magnitude discipline

Pixel art motion should look small in still frames and come alive in sequence.

- Idle/breath: 1-2 logical px.
- Alert jolt: 1-3 logical px.
- Happy bounce: maximum 5 logical px.
- Blinks: change eye channel only; do not redraw the face.
- Accessory overlays carry state readability so the body can stay stable.

## Shadow grounding

Each rig-safe avatar should include or allow a simple ground shadow. The shadow sells motion:

- body goes up -> shadow shrinks/fades slightly
- body squashes/down -> shadow widens/darkens slightly
- sleepy droop -> shadow remains stable but body settles lower

## State defaults

- `idle`: tiny yOff/breath, optional blink, signature feature almost still.
- `thinking`: small head/antenna/ear tilt plus above-head thought cue.
- `focused`: forward lean, centered pupil highlight, faint focus accent. Focus must have a positive cue; stillness alone is not enough.
- `happy`: largest allowed bounce, smile, accessory heart/spark optional.
- `alert`: quick jolt, eyes open, above-head/side spark.
- `sleepy`: lower yOff/slump, eyeOpen low, small Z cue.

## Generation prompt rule

Before species selection, include a hard filter:

> Design a rig-safe Clawpals avatar for animation. Use one closed, symmetric, forward-facing silhouette with no arms, no neck, no loose accessories, no long hair/fur/feathers, no independently moving limbs, no more than seven visible shapes total, and exactly one signature feature. The character must be animatable by changing only yOff, eyeOpen, eyeLook, mouth, ear/antenna tilt, one signature feature nudge, accessory overlays, and shadow scale.

## Why this supersedes broad creature design

A cool illustration can fail as an avatar if its parts are hard to track. A simpler creature with a locked silhouette, a planted base, one signature feature, and accessory zones will animate more reliably than a detailed creature with wings, capes, arms, or asymmetric decorations.
