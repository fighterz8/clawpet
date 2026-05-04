# ADR 0001: Start with a Vercel web demo before desktop runtime

## Status

Accepted

## Context

Clawpet's eventual target is a local desktop overlay controlled by OpenClaw. However, the project also needs to be easy to share publicly on GitHub, LinkedIn, and X before the local runtime is ready.

Nick's main machine does not directly access the OpenClaw workspace, so GitHub/Vercel-hosted files are preferable for early review.

## Decision

Start with a Vercel-hosted web demo and docs site. Use it to communicate the product thesis, preview avatar states, and document the avatar bundle/runtime design.

Build the local desktop overlay after the product/design foundation is visible and shareable.

## Alternatives considered

- Start directly with Rust/Tauri desktop app.
- Build only docs first with no interactive preview.
- Build a browser extension instead of local desktop runtime.

## Consequences

Positive:

- Fast public progress.
- Easy sharing from GitHub/Vercel.
- Clear design pipeline before low-level runtime work.
- Lower setup friction for Nick to review.

Negative:

- The first deploy is not the final local runtime.
- Some desktop-specific decisions are deferred.
