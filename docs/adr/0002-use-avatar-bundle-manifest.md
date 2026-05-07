# ADR 0002: Use an avatar bundle manifest

## Status

Accepted

## Context

Clawpals should allow OpenClaw and users to create or modify avatars without changing runtime code. The runtime needs a predictable way to load assets, states, and animation presets.

## Decision

Represent avatars as local bundles: a folder containing assets and an `avatar.json` manifest.

The manifest defines character metadata, default state, state assets, and animation presets.

## Alternatives considered

- Hardcode the avatar into the runtime.
- Use a full plugin system immediately.
- Use only one spritesheet with implicit state names.

## Consequences

Positive:

- Easy to version and share avatar packs.
- OpenClaw can generate/update bundles as files.
- Runtime stays simpler and safer.
- Supports future marketplace/community packs.

Negative:

- Manifest validation is required.
- More documentation needed upfront.
