# Clawpet

A pixel-art desktop companion for [OpenClaw](https://openclaw.ai). Your AI assistant gets a face: a small dragon (Dawn), slime (Pip), or any Clawpet you generate. It reacts to what OpenClaw is doing — reading, thinking, running commands, done — then quietly idles.

> **Status:** v0.5-in-progress. The desktop app now owns the runtime/setup experience, with Tailscale-friendly pairing, automatic reconnect, tray controls, and live OpenClaw status.

![Dawn — six states](docs/screenshots/dawn-pip-comparison.png)

## The product flow

Clawpet is moving toward the normal-user experience Nick wanted:

1. Download/open the desktop app (`.exe` / `.dmg` target).
2. The app starts its local runtime.
3. Setup shows whether the runtime is online.
4. First-time users open a 6-digit pair code.
5. OpenClaw claims the code once.
6. After that, just start chatting — Clawpet should reconnect automatically.

The setup window is not meant to stay open forever. Once paired, it prompts you to close setup; the pet keeps running from the system tray.

## What it actually is

Three pieces working together:

1. **Desktop app / overlay** — Tauri 2 + React + Vite. Opens setup and the transparent always-on-top pet window.
2. **Local runtime** — native Rust runtime in the Tauri app for packaged builds; Node/Hono runtime remains available for dev/testing.
3. **OpenClaw skill + daemon** — `clawpet` tails OpenClaw's real session stream and sends state updates to the runtime.

The avatar lives on **your display machine**. OpenClaw can run on the same machine, a Linux box, a home server, or anywhere on your tailnet.

## Connection indicator

The overlay has a small status dot:

- 🟢 **Green** — authenticated OpenClaw event received; ready.
- 🟡 **Yellow** — runtime is online, but OpenClaw has not authenticated yet. If you paired before, try chatting first; otherwise open setup and pair.
- 🔴 **Red** — runtime/offline problem.

This avoids the confusing “public `/status` says connected, but commands are actually unauthorized” state.

## Returning users: do you need a pair code?

Usually **no**.

If you paired before, the desktop runtime persists its token locally and OpenClaw stores the matching token in `~/.openclaw/clawpet/config.json`. Reopen Clawpet, then start chatting with OpenClaw. The pet should reconnect without another code.

Use a new pair code only if:

- this is the first connection,
- the dot stays yellow and the pet does not respond,
- the token was rotated,
- local app data/config was cleared,
- or you rebuilt/reset the dev runtime during development.

## Quickstart: current dev path

Until signed installers are published, run from source on the display machine.

Requirements on the display machine:

- Node.js ≥ 20
- git
- Rust + platform build tools for Tauri
- Tailscale for cross-machine OpenClaw/display setups

Install:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/fighterz8/clawpet/main/scripts/install-unix.sh | bash
```

```powershell
# Windows PowerShell
irm https://raw.githubusercontent.com/fighterz8/clawpet/main/scripts/install-windows.ps1 | iex
```

Run the app:

```bash
cd ~/clawpet
npm run desktop:dev
```

The Tauri app opens setup and the pet overlay. In current v0.5 dev builds, the native runtime is built into the app; the older Node runtime can still be used with `CLAWPET_USE_NODE_RUNTIME=1` when needed.

## First-time pairing

On the display machine, open setup and click **Show pair code**.

Send the command it shows to your OpenClaw assistant / host:

```bash
clawpet wizard openclaw --code 472091 --host <desktop-host>.<tailnet>.ts.net:8737
```

Manual equivalent on the OpenClaw host:

```bash
clawpet pair --code 472091 --host <desktop-host>.<tailnet>.ts.net:8737
clawpet activity balanced
clawpet heartbeat-reactions off
clawpet daemon start
```

After pairing, setup should show **Connected — setup complete**. Close setup; the pet stays available from the tray.

## Tray controls

The tray menu includes:

- **Show / Hide Pet**
- **Show Setup**
- **Quit Clawpet**

Closing setup hides it; it does not quit the app. Use the tray to reopen setup or quit.

## Verify connection

From the OpenClaw host:

```bash
clawpet status
clawpet send happy "It works" --bubble "Hello! 🐲"
```

`clawpet status` includes `openClawAuth` when possible:

- `ready` — stored token works.
- `invalid-token` — runtime is reachable, but OpenClaw needs to pair again.

## Live reactivity daemon

Start the daemon on the OpenClaw host:

```bash
clawpet daemon start
clawpet daemon status
clawpet daemon stop
```

The daemon watches OpenClaw session JSONL and maps real activity to avatar state with zero LLM/token cost:

- user prompt → thinking / “Reading your prompt…”
- file reads → thinking / “Inspecting the repo…”
- commands → focused / “Running command…”
- completion → happy / “Done”

Bubble text is intentionally statusful rather than random-cute.

## Decay rules

The runtime computes effective state on read:

- `happy` lingers briefly, then returns to `idle`.
- active states (`thinking`, `focused`, `alert`) safety-decay to `idle` after quiet time so missed `done` events do not leave the pet stuck.
- `idle` can drift to `sleepy` after prolonged quiet.

## Multi-avatar

Bundles live under `public/avatars/<name>-v<n>/`:

```text
public/avatars/
├── dawn-v0/
│   ├── avatar.json
│   └── assets/{idle,thinking,focused,happy,alert,sleepy}.png
└── pip-v0/
    ├── avatar.json
    └── assets/{idle,thinking,focused,happy,alert,sleepy}.png
```

OpenClaw is the intended source of truth for avatar assets/config. It can push bundles to the paired runtime over the authenticated connection.

## Architecture

```text
┌──────────────────────┐                 ┌──────────────────────────┐
│  OpenClaw host       │   CLI/daemon    │  clawpet skill           │
│  session JSONL       ├────────────────▶│  pair/send/react/status  │
└──────────────────────┘                 └─────────────┬────────────┘
                                                       │ HTTP + Bearer
                                                       ▼
┌────────────────────────────────────────────────────────────────────┐
│  Display machine                                                    │
│                                                                    │
│  ┌─────────────────────┐      /status       ┌───────────────────┐  │
│  │ Tauri desktop app   │◀──────────────────▶│ native runtime    │  │
│  │ setup + overlay     │                    │ auth/state/bundle │  │
│  │ tray controls       │                    │ pair-code flow    │  │
│  └─────────────────────┘                    └───────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

## Auth model

- `GET /health`, `GET /pair-mode`, and active `POST /pair/claim` are public enough for setup/pairing.
- state-changing runtime calls require bearer auth.
- runtime token persists at `~/.openclaw/clawpet/runtime-token` on the display machine.
- OpenClaw stores its matching token in `~/.openclaw/clawpet/config.json`.
- rotate/re-pair if auth breaks.

## Status & next work

**Working:** native setup surface, native runtime, transparent draggable overlay, tray controls, connection indicator, 6-digit pairing, persisted reconnect token, authenticated readiness checks, daemon-driven real-time reactions, active-state idle safety decay, Tailscale-first cross-machine setup, multi-avatar bundles.

**Next:**

- produce and smoke-test packaged `.exe` / `.dmg` artifacts
- harden setup/doctor flows further
- fix the GitHub Dependabot moderate vulnerability
- README marketing pass + hero GIF
- frame-based animated avatar schema
- Dawn-v1 animated bundle

**Will not:** ambient cloud spend without a setting; surveillance-y always-on capture; closed paid avatar packs.

## Documentation

- [`docs/v0.5-brief.md`](docs/v0.5-brief.md) — current v0.5 direction.
- [`docs/clawpet-style-guide.md`](docs/clawpet-style-guide.md) — locked visual style for all Clawpets.
- [`docs/avatar-bundle-spec.md`](docs/avatar-bundle-spec.md) — bundle manifest schema.
- [`docs/avatar-event-contract.md`](docs/avatar-event-contract.md) — runtime event format.
- [`docs/roadmap.md`](docs/roadmap.md) — near-term, mid-term, and speculative directions.
- [`docs/adr/`](docs/adr/) — architecture decision records.

## License

Source: MIT. Avatar art bundles: see each `avatar.json`.
