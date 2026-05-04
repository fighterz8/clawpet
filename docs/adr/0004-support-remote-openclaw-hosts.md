# ADR 0004: Support remote OpenClaw hosts

## Status

Accepted

## Context

Many OpenClaw users run their OpenClaw instance on a separate machine from the desktop they actively use. Examples include a Linux server, home lab box, VPS, Mac node, or always-on host.

Clawpet's value is highest when the avatar exists on the user's primary desktop, even if OpenClaw is running somewhere else.

A same-machine-only localhost API would be useful for early testing, but it would not satisfy the real target use case.

## Decision

Design Clawpet around a connection abstraction that supports both local and remote control modes.

Initial modes:

1. **Local mode**
   - OpenClaw and Clawpet run on the same machine.
   - OpenClaw sends events to a localhost API exposed by Clawpet.

2. **Remote mode**
   - Clawpet runs on the user's active desktop.
   - OpenClaw runs on another machine.
   - Clawpet receives state updates through a paired remote connection.

Remote mode should not require users to open inbound firewall ports on their desktop. The desktop client should prefer outbound connections.

## Preferred remote architecture

```txt
OpenClaw host  <── outbound HTTPS/WebSocket ──>  Clawpet relay  <── outbound WebSocket ──>  Clawpet desktop client
```

The relay passes small avatar events such as:

```json
{
  "state": "thinking",
  "message": "Working on the repo...",
  "ttlMs": 8000
}
```

## Pairing model

Clawpet desktop client should support a pairing flow:

- generate pairing code or QR code
- identify device name, e.g. `nick-main-pc`
- create/store device token
- let OpenClaw send a test event
- allow user to revoke/reset pairing

## Alternatives considered

### Same-machine localhost only

Simple, but does not match how many OpenClaw users actually run their systems.

### LAN/Tailscale direct connection

Good for power users and local-first deployments, but less reliable for normal users due to networking/firewall setup.

### OpenClaw-native node integration only

Potentially elegant later, but too dependent on OpenClaw internals for the early open-source MVP.

## Consequences

Positive:

- Matches real OpenClaw usage patterns.
- Makes Clawpet useful on the user's main desktop.
- Creates a stronger public systems-design story.
- Allows local mode and remote mode to share the same event contract.

Negative:

- Adds pairing/security complexity.
- Requires either a hosted relay or a direct-network mode.
- Requires careful token handling and revocation.

## Security requirements

- Do not expose a public unauthenticated control API.
- Use per-device tokens.
- Keep messages small and scoped to avatar state/status.
- Support pairing reset/revocation.
- Prefer outbound desktop connections over inbound ports.
- Treat avatar events as untrusted UI input; never execute code from remote messages.
