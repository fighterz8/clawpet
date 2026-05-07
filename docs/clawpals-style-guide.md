# Clawpals Style Guide (v1)

**Status:** locked. Every Clawpals asset and every prompt template OpenClaw uses to generate a new Clawpals must comply with this guide.

## 1. Visual identity

Clawpals are **pixel-art platformer-style characters** in the spirit of Terraria / Stardew Valley / modern indie roguelikes — but at a **slightly higher resolution** than classic 16-bit so they read clearly on a modern desktop.

### Allowed subjects
- **Creatures** (e.g. small dragons like Dawn, slimes, owls, foxes, robots, elementals).
- **People / humanoids** (e.g. mage, ranger, knight, scholar).
- **Hybrids** (e.g. a small dragon-rider, a person with a familiar).

### Forbidden
- Photorealistic / 3D rendered styles.
- Vector flat-illustration / cartoon-app styles.
- Anime cel-shading, watercolor, oil paint, sketch.
- Mixed art styles inside a single Clawpals.

## 2. Canvas and resolution

| Property            | Value                                                              |
| ------------------- | ------------------------------------------------------------------ |
| Logical canvas      | **128×128 px** (sprite is drawn pixel-by-pixel at this size)       |
| Final exported size | **512×512 px** (4× nearest-neighbor upscale of the 128×128 sprite) |
| Background          | **Fully transparent (alpha 0)**                                    |
| File format         | **PNG** (with alpha channel)                                       |
| Image rendering     | Browser uses `image-rendering: pixelated` to keep crisp edges      |
| Subject footprint   | Centered, fits within ~96×112 of the 128 canvas (8–16 px margin)   |

**Rule:** the asset must remain readable when displayed at 220×220 px in the overlay, and still look correct if scaled up to 512 or down to 96.

## 3. Color palette

A **limited palette** is mandatory. Each Clawpals picks a primary palette of **6–10 colors** and never uses outside it (anti-aliasing colors do not count, but should be in-palette).

Recommended global anchors so all Clawpals feel like the same family:
- Outline / shadow: `#0a0820` (near-black indigo)
- Highlight white: `#fdfcff`
- Allowed accent hues: violet/indigo, cyan/teal, gold/amber, rose. Pick **one or two accents** per Clawpals.

Dawn's locked palette (reference):
- Body main: `#8b6cf2` (violet)
- Body highlight: `#d8c8ff`
- Body shadow: `#3b2a8a`
- Belly / chest: `#fdfcff`
- Eye / outline: `#0a0820`
- Accent A: `#8ee7ff` (cyan spark)
- Accent B: `#fff5ae` (gold horns)

## 4. Linework and shading

- **Hard 1-pixel outlines** in the outline color, no soft/feathered edges.
- **Cel-shaded** with at most 3 tones per material (highlight / midtone / shadow).
- **No gradients, no blur, no glow effects baked into the sprite.** Glows/shadows are added by the runtime (CSS), not the asset.
- Anti-aliasing only at the boundary, max 1 px, using palette colors.

## 5. Pose and framing

- **Front-facing 3/4 view**, character looking slightly forward.
- Idle pose: standing/floating, arms/legs/wings/tail visible, no overlap that hides body parts.
- All limbs and accessories drawn **in proper z-order** so nothing visually overlaps the body badly (no tail crossing the chest, no eyebrow above the head outline).
- Centered horizontally; vertical baseline near the lower-middle of the canvas.

## 6. State variants

Every Clawpals bundle must include these 6 sprites (filename = state):

- `idle.png`   — neutral, breathing
- `thinking.png` — looking up / hand to chin / thoughtful eyes
- `focused.png`  — eyes narrowed, slight forward lean, working
- `happy.png`    — smile, raised pose, sparkle
- `alert.png`    — eyes wide, surprised mouth, leaning back / on guard
- `sleepy.png`   — half-closed eyes, drooping pose

State variants must be **the same character** with **only the expression/pose changed**. Same palette, same proportions, same outline.

## 7. Mandatory image-generation prompt template

When OpenClaw (or any tool) generates a new Clawpals, it must use this template. The OpenClaw `clawpals` skill must include this verbatim and refuse to generate without it.

```txt
Pixel-art character sprite, 128x128 logical resolution, exported at 512x512 with hard nearest-neighbor upscale, fully transparent background (alpha 0). Style: modern indie pixel-art platformer / roguelike (Terraria / Stardew Valley feel) but slightly higher detail — clean 1-pixel outlines, cel-shaded with 2–3 tones per material, no gradients, no blur, no glow, no anti-aliased soft edges.

Subject: {SUBJECT_DESCRIPTION}
Palette: limited 6–10 color palette using {PALETTE_LIST}, with near-black indigo outline.
Pose: front-facing 3/4 view, centered, full body visible, all limbs/accessories in correct z-order so nothing overlaps the body awkwardly.
State: {STATE} — express only through facial expression and small pose changes; do not change body proportions, palette, or outfit between states.

Hard rules:
- Transparent PNG, no scene, no background elements, no ground shadow.
- Single character only, no text, no logos, no UI.
- Same character identity across all 6 state variants (idle, thinking, focused, happy, alert, sleepy).
- Pixel grid must be visible; no soft photorealism, no vector flat illustration, no anime shading.
```

## 8. OpenClaw skill enforcement

The future `clawpals` OpenClaw skill must:
1. Refuse to generate Clawpals assets that do not declare a palette and a state set.
2. Use the prompt template in §7 verbatim, only filling in `{SUBJECT_DESCRIPTION}`, `{PALETTE_LIST}`, `{STATE}`.
3. Run a post-generation check: image is PNG, has alpha, is 512×512, has transparent corners, primary subject is roughly centered.
4. Reject and regenerate any state that breaks identity (different proportions / palette drift) compared to `idle`.
5. Always export the bundle in the `avatar.json` schema already shipped (`docs/avatar-bundle-spec.md`).

## 9. Versioning

This guide is **v1**. Future tweaks (e.g. raising resolution, adding more states like `celebrating` or `error`) bump it to v2 and are recorded in an ADR before any asset regeneration.
