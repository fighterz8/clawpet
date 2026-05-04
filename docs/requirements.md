# Clawpet Requirements

## MVP scope

The first public MVP is a Vercel-hosted web demo and documentation site that previews the avatar-bundle model and state-driven companion behavior.

The local desktop overlay is the next runtime target.

## Functional requirements — web MVP

- Display a Clawpet project landing page.
- Preview the Dawn avatar concept using lightweight CSS/SVG.
- Show selectable states: idle, thinking, happy, alert, sleepy, focused.
- Display sample OpenClaw event messages.
- Document the avatar bundle manifest format.
- Link to design docs and ADRs.

## Functional requirements — desktop runtime target

- Render a transparent always-on-top avatar window.
- Load an avatar bundle from a local folder.
- Support state changes using a local API.
- Support short optional speech/status bubbles.
- Provide tray/menu controls:
  - quit
  - hide/show
  - reload bundle
  - toggle click-through
  - dock to corner
- Support basic animation presets:
  - breathe
  - bob
  - pulse
  - bounce
  - shake
  - slow blink

## Non-functional requirements

- Localhost-only control API by default.
- No secrets in avatar manifests.
- Low CPU/RAM target.
- Graceful behavior when OpenClaw is offline.
- Cross-platform aspiration, with Linux-first acceptable for early local testing.
- Clear docs and setup path.

## Out of scope for MVP

- Full skeletal animation.
- Marketplace for avatar packs.
- Autonomous emotional simulation.
- Production-grade plugin system.
- Live trading, finance, or other high-stakes actions.

## Success criteria for phase 0

- Repo exists on GitHub.
- Vercel preview deploys successfully.
- Docs explain product, requirements, UX, bundle spec, and architecture decisions.
- Web demo communicates the idea clearly enough to post publicly.
