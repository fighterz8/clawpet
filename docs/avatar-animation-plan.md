# Avatar generation + animation plan

## Goal

Create a new Dawn avatar that is attractive as a static Clawpet now and can become an animated v0.5 bundle next.

## Current reality

The shipped runtime currently supports the v0.1 manifest shape:

```json
{
  "schemaVersion": "0.1.0",
  "states": {
    "idle": { "asset": "assets/idle.png", "animation": "breathe" }
  }
}
```

Each state resolves to one image asset plus a CSS animation preset. This is good for v0.4 but not enough for real frame animation.

## Target v0.5 shape

Support animated frame lists while keeping v0.1 single-asset bundles working:

```json
{
  "schemaVersion": "0.5.0",
  "name": "Dawn",
  "slug": "dawn",
  "species": "baby dragon",
  "seed": "sha256:...",
  "palette": ["#0a0820", "#8b6cf2"],
  "defaultState": "idle",
  "states": {
    "idle": {
      "frames": ["frames/idle-0.png", "frames/idle-1.png"],
      "fps": 4,
      "loop": true,
      "fallbackAsset": "assets/idle.png"
    }
  }
}
```

Backward compatibility rule: if a state has `asset`, load it as a one-frame loop. If a state has `frames`, animate those frames.

## Generation approach

Claude's rough spec is directionally good, but the production workflow should avoid eleven totally independent text-to-image calls. That is the fastest way to get eleven different dragons.

Preferred workflow:

1. Generate one high-quality Dawn v1 concept sheet/reference.
2. Pick/approve the visual direction.
3. Generate or edit the final state frames using the approved reference image as identity anchor.
4. Validate each frame: PNG, 512x512, transparent corners, centered subject, same palette/proportions.
5. Write both:
   - `assets/<state>.png` static fallback for v0.1 runtime
   - `frames/<state>-<n>.png` for v0.5 runtime
6. Push the static fallback bundle now; enable animated frames after runtime support lands.

## Standard animation tier

Default to the standard tier when we want a balanced animated bundle. These frame counts are recommendations, not schema requirements; simple/held states can use one frame, more expressive states can use more, and lightweight bundles can ship fewer total frames.

| State | Frames | FPS | Motion |
| --- | ---: | ---: | --- |
| idle | 2 | 4 | eyes open / blink |
| sleepy | 2 | 2 | breath in / breath out |
| thinking | 2 | 4 | head/eyes left-right or thought sparkle pulse |
| focused | 1 | 1 | locked pose |
| happy | 2 | 6 | squash / bounce up |
| alert | 2 | 8 | spark off / spark on |

Example total: 11 frames.

## Runtime implementation tasks

1. Extend `src/avatars/bundle.ts` manifest types and validator to accept v0.5 frame states.
2. Add `resolveFrames(state)` while keeping `resolveAsset(state)` for v0.1 callers.
3. Update overlay `BundleAvatar` to cycle frames by state FPS.
4. Update runtime upload validation/serving to accept `frames/*.png` in addition to `assets/*.png`.
5. Update `clawpet avatar push` to upload frame paths from the manifest.
6. Add tests for v0.1 compatibility and v0.5 animated bundles.

## Dawn v1 direction

Use standard Dawn as the brand/default: baby dragon, violet/indigo body, gold horns, cyan spark accents, amber eyes, warm helpful expression. New designs should feel cooler and more polished, but never grotesque, corporate-flat, or over-rendered.
