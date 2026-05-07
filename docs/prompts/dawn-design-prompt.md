# Dawn-Specific Clawpals Design Prompt

Use this instead of the generic creative prompt when generating **Dawn**. Dawn is an established character with a locked identity: a small dragon companion for the assistant Dawn. The goal is not to reinvent her species. The goal is to redesign her sprite so she is **easy to animate cleanly** and still unmistakably Dawn.

## Core intent

Dawn should feel:
- warm
- clever
- a little fierce
- protective, not aggressive
- cute enough to live on a desktop all day

## Locked identity

- Species: baby dragon / tiny familiar dragon
- Role: desktop companion avatar for Dawn
- Tone: ember-warm, thoughtful, alert, affectionate, quietly sharp
- Readability first: must look good at thumbnail size

## Hard technical requirements

- 128×128 logical pixel-art canvas
- Export at 512×512 PNG using nearest-neighbor upscale only
- Fully transparent background
- Single centered character, no ground line, no scene, no text
- Hard 1px outline in a darker hue variant, not pure black
- 8–12 total colors, including accessories
- Upper-left cel-shaded light
- Chibi proportions
- Same dragon across all 6 states: idle, thinking, focused, happy, alert, sleepy

## Dawn-specific visual rules

The redesign must optimize for animation consistency:

1. **Flat eye architecture**
   - Eye region must be built from clean, separable pixel blocks.
   - Closed-eye frames should be possible by swapping to a lid shape, not repainting surrounding face shading.
   - Avoid noisy gradients around the eyes.

2. **Accessory margin**
   - Leave a little clean transparent space above the head so alert sparks / sleepy Z / thinking bubbles can appear without colliding with horns or ears.

3. **Animatable features**
   - At least two of these should be clearly separable in silhouette and shading:
     - ear tips / horns
     - tail tip
     - wing accents
     - cheek frill / neck frill
     - ember glow detail
   - These should support 1–2 pixel micro-motions without breaking the sprite.

4. **Breathing-friendly torso**
   - The chest / neck / cheek area should have room for a 1px micro-expand / micro-contract motion.
   - Avoid shading patterns that require repainting half the body for a blink or breath.

5. **Silhouette signature**
   - Keep one memorable Dawn signature feature and lean on it.
   - Recommended: curled tail with ember tip, or oversized horn/ear silhouette, or a small cape-like wing shape.

## Palette direction

- Base palette: ember red / warm crimson / deep red-orange
- Accent palette: gold / pale ember / cream highlight
- Shadow palette: dark maroon / burnt umber
- Avoid muddy brown overload
- Avoid neon saturation
- Keep accessory colors inside the same locked palette

## Personality expression by state

- idle: calm, observant, companionable
- thinking: curious, processing, slightly head-tilted
- focused: narrowed eyes, intent, still
- happy: bright, soft triumph, not manic
- alert: sharp surprise spike, ears/horns/eyes active
- sleepy: warm, curled, droopy, cozy

## What to avoid

- Generic mascot dragon with noisy scales everywhere
- Over-detailed wing membranes that flicker between frames
- Face shading that makes blinking require repaint surgery
- Overly long limbs that break chibi readability
- Black outlines
- Background effects baked into the PNG

## Deliverable

A redesigned Dawn dragon base that is:
1. unmistakably Dawn
2. cleaner than the old default
3. intentionally built for frame-delta animation

The owner should recognize her immediately, and the animator should be able to create subtle motion without artifacts.
