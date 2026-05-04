# ADR 0003: Start with runtime animation presets

## Status

Accepted

## Context

The long-term vision may include rich animation, layered SVGs, spritesheets, or rigged characters. For the MVP, the project needs to stay lightweight and easy to ship.

## Decision

Start with static SVG/PNG/WebP assets plus runtime-defined animation presets such as breathe, bob, pulse, bounce, shake, and slowBlink.

## Alternatives considered

- Full skeletal animation.
- Lottie-first animation.
- Frame-by-frame spritesheets only.

## Consequences

Positive:

- Lightweight.
- Easy to render in web and desktop runtimes.
- Easy for OpenClaw to generate assets quickly.
- Keeps MVP approachable.

Negative:

- Less expressive than full animation.
- Some character-specific motion, like tail movement, will be approximate until layered assets exist.
