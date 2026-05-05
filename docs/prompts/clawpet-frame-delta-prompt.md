# Clawpet Frame-Delta Prompt Template

This is the prompt the agent uses **per frame**, after the character's species,
palette, silhouette, and pose framing have been locked.

## Core principle

> Motion in pixel art is subtractive, not additive.

Ask for the smallest possible change that reads as life.

---

## Per-frame prompt template

```
FRAME GENERATION — STRICT CONSISTENCY MODE

You are generating frame <N> of <M> for the <state> state of the Clawpet
named <pet_name>. Frame 0 for this state already exists. Produce frame <N>
as a micro-variation of that state anchor, not a redraw.

THE ANCHOR
  Species: <locked species>
  Silhouette tag: <locked signature feature>
  Palette: <locked hex list>
  Outline color: <locked dark hue>
  Pose framing: <locked front-facing or 3/4 front>
  Head position: same as anchor
  Body proportions: same as anchor

All of the above are frozen.

STATE CONTEXT
  Character anchor: idle/reference state defines the overall character.
  Motion anchor: this state's frame 0 defines this loop.

APPLY ONLY THIS DELTA
  <DELTA SPEC>

Everything else should remain byte-identical in spirit to the anchor.
```

---

## Scale calibration

All motion instructions are in **128×128 logical pixels** before 4× export.

- blink: 1–2 px
- breath: 1–2 px internal silhouette change
- bounce: 2–4 px vertical move
- glance: 1 px pupil move
- accessory drift: 2–4 px

If it feels almost too subtle in the still frame, that's usually right.

Accessory colors must already exist in the locked palette.

---

## Don't list

Do NOT:
- redraw from scratch
- move the character unless the delta says to
- change framing, palette, outline, lighting, or side orientation
- add new colors
- "improve" the sprite
- combine multiple motion ideas into one frame

---

## Motion catalog

### IDLE

```
Frame 0: anchor

Frame 1:
- feet/base stay locked
- chest / cheek / neck / wing-accent region expands by 1 px where the design allows
- eyes unchanged

Frame 2:
- return to anchor or settle 1 px softer than frame 1
- eyes unchanged

Frame 3:
- identical to anchor

Frame 4:
- upper lids descend 1 px using predesigned lid geometry
- no repainting of surrounding face shading

Frame 5:
- eyes closed using anchor-compatible lid shape only

Frame 6:
- identical to anchor
```

### THINKING

```
Frame 0: contemplative state anchor

Frame 1:
- body identical
- small palette-locked bubble appears above head OR paw-to-chin accent shifts 1 px
- pupils shift 1 px toward the thought cue

Frame 2:
- bubble grows slightly / trail appears OR paw settles back
- body identical

Frame 3:
- return close to anchor
```

### FOCUSED

```
Frame 0: narrowed eyes, slight forward lean

Frame 1:
- one ear / horn / tail-tip / signature feature shifts 1 px

Frame 2:
- anchor

Frame 3:
- opposite side feature shifts 1 px
```

### HAPPY

```
Frame 0: happy anchor

Frame 1:
- subtle squash: top of body moves down 1 px
- smile widens 1 px each side
- optional tiny palette-locked heart only if accessory margin exists

Frame 2:
- whole body moves up 2–3 px
- very slight stretch if needed

Frame 3:
- descend toward anchor
- remove optional hearts
```

### ALERT

```
Frame 0: alert anchor, no spark yet

Frame 1:
- body identical or 1 px upward jolt if the design supports it
- add 4-point spark above head using locked palette
```

### SLEEPY

```
Frame 0: sleepy anchor, no Z yet

Frame 1:
- body softens / settles internally by 1 px
- small palette-locked Z appears above head

Frame 2:
- Z rises 2–4 px and dims using an existing lighter/darker palette tone
- body returns toward anchor

Frame 3:
- Z removed or nearly gone
- body anchor
```

---

## Repair mode addendum

```
REPAIR MODE

A previous attempt drifted from the anchor in this way:
<specific failure>

Regenerate with extra emphasis on:
- pixel-perfect match to anchor palette, pose, and lighting
- apply only the listed delta
- if in doubt, do less
```
