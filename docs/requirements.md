# Clawpet Requirements

## MVP scope

The first public MVP is a Vercel-hosted web demo and documentation site that previews the avatar-bundle model and state-driven companion behavior.

The real product MVP is runtime-first: a desktop avatar overlay that can connect to OpenClaw locally or remotely. The dashboard is local/admin-focused and secondary to getting the avatar connected, validated, secure, and responsive.

## Functional requirements — web MVP

- Display a Clawpet project landing page.
- Preview the Dawn avatar concept using lightweight CSS/SVG.
- Show selectable states: idle, thinking, happy, alert, sleepy, focused.
- Display sample OpenClaw event messages.
- Document the avatar bundle manifest format.
- Document the avatar event contract.
- Link to design docs and ADRs.

## Functional requirements — desktop runtime target

- Render a transparent always-on-top avatar window.
- Load an avatar bundle from a local folder.
- Support state changes using a local API for same-machine mode.
- Support remote pairing so OpenClaw can run on a different machine from the desktop avatar.
- Prefer outbound remote connections from the desktop client; do not require normal users to open inbound firewall ports.
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

- Localhost-only control API by default for local mode.
- Authenticated pairing/token model for remote mode.
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
- Remote OpenClaw host support is captured as a first-class architecture requirement.
- Web demo communicates the idea clearly enough to post publicly.
