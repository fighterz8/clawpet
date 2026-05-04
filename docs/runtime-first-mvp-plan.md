# Runtime-First MVP Plan

## Product priority

Clawpet is not primarily a hosted dashboard. The core product is a desktop avatar runtime that can connect to an OpenClaw instance, including an OpenClaw host running on another machine.

Priority order:

1. Desktop avatar exists on the user's active machine.
2. Avatar connects to OpenClaw in local and remote-host setups.
3. OpenClaw skill can install, configure, pair, test, and control Clawpet.
4. Tests verify connection, security, latency, runtime behavior, and skill behavior.
5. Local dashboard/admin console supports validation and manual adjustments.
6. Avatar visual design and fine-grained customization improve after the runtime is reliable.

## Runtime components

```txt
OpenClaw host
  └─ clawpet skill
      ├─ install/check Clawpet
      ├─ pair desktop client
      ├─ send state/message events
      └─ validate connection

Clawpet desktop app
  ├─ transparent avatar overlay
  ├─ local dashboard/admin console
  ├─ avatar bundle loader
  ├─ local control API
  └─ remote pairing client

Optional relay/direct tunnel
  └─ connects remote OpenClaw host ↔ desktop avatar
```

## Desktop runtime MVP

The first real runtime should support:

- transparent always-on-top avatar window
- basic avatar states: idle, thinking, focused, happy, alert, sleepy
- avatar bundle loading from local files
- local state-change API
- local admin dashboard
- diagnostic status page
- basic pairing model stub
- logs for recent avatar events

## Local dashboard role

The dashboard is local by default and is mainly a validation/admin surface, not the core product.

Default local URL target:

```txt
http://127.0.0.1:8737
```

Dashboard functions:

- show runtime status
- show paired OpenClaw host
- show connection mode: local, remote relay, direct tunnel
- send test avatar states
- view recent events
- load/change avatar bundle
- adjust size/position
- run diagnostics
- show latency measurements

## Hosted Vercel role

The hosted Vercel app is for:

- public landing page
- project docs/demo preview
- build-in-public proof
- eventual download/setup links

It should not become the main production dashboard for normal use.

## OpenClaw self-install goal

Long term, OpenClaw should be able to install or guide installation of Clawpet onto a compatible machine and then project its avatar there.

Future OpenClaw skill capabilities:

- detect whether Clawpet is installed
- install or update Clawpet where supported
- launch Clawpet
- pair with a desktop client
- send test event
- report status/latency/security diagnostics
- load or generate avatar bundles
- recover from broken pairing

This enables the user experience:

> “OpenClaw, put your avatar on this machine.”

## MVP phases

### Phase 0 — public concept and docs

Status: started.

- Vercel concept preview
- GitHub repo
- product docs
- avatar bundle spec
- remote-host ADR

### Phase 1 — event contract and validator

- define avatar event schema
- define runtime status schema
- define pairing concepts
- add TypeScript validation tests

### Phase 2 — local desktop runtime skeleton

- choose Tauri/Rust runtime stack
- transparent overlay window
- local admin server
- local state API
- avatar state rendering

### Phase 3 — OpenClaw skill skeleton

- `clawpet status`
- `clawpet send-test`
- `clawpet pair`
- `clawpet diagnose`
- install/update plan documented before automation

### Phase 4 — remote connection MVP

- pairing token model
- relay/direct tunnel abstraction
- reconnect behavior
- latency logging
- invalid-token rejection

### Phase 5 — avatar generation/design loop

- improved Dawn avatar bundle
- emotion variants
- fine detail controls
- OpenClaw-assisted asset generation workflow

## Testing priorities

### Connection tests

- local API accepts valid state events
- local API rejects malformed events
- remote paired event reaches desktop client
- reconnect after runtime restart
- stale token rejected

### Security tests

- no unauthenticated remote control
- localhost API scoped appropriately
- avatar manifest cannot execute code
- payload size limits
- pairing reset/revocation

### Latency tests

Initial targets:

- local event to visible update: under 250ms
- remote event to visible update: under 1000ms

### Skill tests

- status command identifies runtime availability
- send-test command changes avatar state
- pair command handles success/failure
- diagnose command reports clear action items

### Runtime tests

- valid avatar bundle loads
- invalid manifest fails safely
- missing asset uses fallback state
- overlay starts/stops cleanly
- dashboard reports current state
