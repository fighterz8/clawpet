# Clawpet

A pixel-art desktop companion for [OpenClaw](https://openclaw.ai). Your assistant gets a face — a tiny dragon, slime, or generated Clawpet — and reacts while OpenClaw reads, thinks, runs tools, finishes, or needs attention.

> **Status:** v0.5-in-progress. The desktop app now owns setup/runtime, with Tailscale-friendly pairing, reconnect, tray controls, and live OpenClaw status.

![Clawpet demo](docs/demo/clawpet-demo.gif)

## The important boundary

OpenClaw can manage almost everything **after the desktop app exists and is running**.

**The human/display machine must do:**

1. install/download the local Clawpet desktop files, and
2. start the Clawpet app/setup window.

**OpenClaw can do the rest:**

- claim the 6-digit pair code
- save/reuse the auth token
- verify connection/auth readiness
- send test states and status bubbles
- start/stop/check the live daemon
- push/select avatar bundles
- rotate tokens or re-pair if needed
- drive day-to-day pet reactions automatically

So the intended install story is: **user starts the local app once → OpenClaw takes over setup and ongoing control.**

## Normal flow

1. Open Clawpet on the display machine.
2. If already paired, just start chatting with OpenClaw.
3. If first-time setup or reconnect is broken, click **Show pair code**.
4. Give that code/host to OpenClaw.
5. OpenClaw pairs, verifies auth, starts the daemon, and sends a test ping.
6. Setup shows **Connected — setup complete**. Close setup; the pet stays in the tray.

## Connection light

- 🟢 **Green** — OpenClaw is authenticated and ready.
- 🟡 **Yellow** — runtime is online, but OpenClaw is not authenticated/receiving yet. Try chatting first if you paired before; otherwise pair again.
- 🔴 **Red** — runtime/offline problem.

## Returning users

Usually you do **not** need a new pair code.

The desktop runtime persists its token locally at `~/.openclaw/clawpet/runtime-token`, and OpenClaw stores the matching token in `~/.openclaw/clawpet/config.json`. Reopen Clawpet, then chat with OpenClaw. It should reconnect automatically.

Use a new code only if this is first-time setup, the dot stays yellow and the pet does not respond, tokens were rotated, app data/config was cleared, or a dev rebuild reset the runtime.

## Downloads

Clawpet is moving to a simple download-first install flow from the Vercel app:

- **Windows:** `.exe` setup installer
- **macOS:** packaged macOS app/archive
- **Linux:** packaged Linux build

The current GitHub Actions build already produces Windows, macOS, and Linux artifacts. The Vercel app should surface those packages as the primary download path so users do not have to dig through GitHub Actions.

Source installs remain useful for development, but normal users should start with the downloadable package for their OS, open Clawpet once, then let OpenClaw handle pairing and ongoing control.

## Current dev quickstart

Packaged downloads are the target/default user path. For development, run from source on the display machine.

Requirements:

- Node.js ≥ 20
- git
- Rust + platform build tools for Tauri
- Tailscale for cross-machine display/OpenClaw setups

Install:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/fighterz8/clawpet/main/scripts/install-unix.sh | bash
```

```powershell
# Windows PowerShell
irm https://raw.githubusercontent.com/fighterz8/clawpet/main/scripts/install-windows.ps1 | iex
```

Start the desktop app:

```bash
cd ~/clawpet
npm run desktop:dev
```

In current v0.5 dev builds, the Tauri app starts the native local runtime. The older Node runtime remains available for testing with `CLAWPET_USE_NODE_RUNTIME=1`.

## Pair from OpenClaw

Setup displays a command like:

```bash
clawpet wizard openclaw --code 472091 --host <desktop-host>.<tailnet>.ts.net:8737
```

Manual equivalent on the OpenClaw host:

```bash
clawpet pair --code 472091 --host <desktop-host>.<tailnet>.ts.net:8737
clawpet activity balanced
clawpet heartbeat-reactions off
clawpet daemon enable   # Linux/OpenClaw host: install + start systemd user service
# or: clawpet daemon start   # one-session fallback
```

Verify from OpenClaw:

```bash
clawpet status
clawpet send happy "It works" --bubble "Hello! 🐲"
```

Setup also labels the runtime owner and live avatar diagnostics:

- `desktop app runtime` — expected packaged/native path.
- `external dev runtime` — a Node dev runtime is occupying port 8737; okay for development, but quit stale dev processes if setup behaves strangely.
- Avatar state, bubble, and last event age — useful for deciding whether to re-pair or just close setup and chat.
- Best-effort detected display host in the OpenClaw command, so users do not have to replace `<this-display-machine>` when the app can infer it.
- Overlay dot semantics: green means runtime/status connection is healthy; yellow is reserved for reachable-but-not-ready states; red means runtime offline.

`clawpet status` reports `openClawAuth` when possible:

- `ready` — stored token works.
- `invalid-token` — runtime is reachable, but OpenClaw needs to pair again.

## Tray controls

Closing setup hides it; it does not quit Clawpet.

Tray menu:

- **Show / Hide Pet**
- **Show Setup**
- **Quit Clawpet**

## How OpenClaw drives the pet

The daemon tails OpenClaw session JSONL and mirrors real activity with zero LLM/token cost:

```bash
clawpet daemon enable   # survive OpenClaw/gateway restarts on Linux systemd hosts
clawpet daemon status
clawpet daemon stop     # stop this run
clawpet daemon disable  # remove autostart
```

Examples:

- prompt received → `thinking`, “Reading your prompt…”
- file reads → `thinking`, “Inspecting the repo…”
- commands/tools → `focused`, “Running command…”
- completion → `happy`, “Done”
- blocker/error → `alert`

LLM-triggered flavor emits are still available via `clawpet react <event>` and `clawpet send <state>`, but the daemon handles the practical real-time behavior.

## Avatar bundles

Standard Dawn (`dawn-v0`) is the default avatar.

Avatar redesigns are intentionally **OpenClaw-led**:

- The user asks their OpenClaw assistant for a new look.
- OpenClaw generates or selects a bundle on the **OpenClaw host**.
- The bundle stays as source-of-truth on the OpenClaw machine.
- OpenClaw pushes/selects that bundle on the paired desktop runtime.
- The user can ask to swap back, try another design, or iterate without manually editing files on the display machine.

This keeps personalization conversational and reversible: “make Dawn a cooler baby dragon,” “go back to standard Dawn,” or “try the folder-desk version” should be OpenClaw-side actions, not user filesystem chores.

Bundles live under `public/avatars/<name>-v<n>/` for built-in defaults and under `~/.openclaw/clawpet/bundles/<name>/` for OpenClaw-managed custom designs:

```text
public/avatars/
├── dawn-v0/
│   ├── avatar.json
│   └── assets/{idle,thinking,focused,happy,alert,sleepy}.png
└── pip-v0/
    ├── avatar.json
    └── assets/{idle,thinking,focused,happy,alert,sleepy}.png
```

OpenClaw pushes bundles to the paired runtime over the authenticated connection:

```bash
clawpet avatar push ~/.openclaw/clawpet/bundles/dawn-v1
```

## Architecture

```text
OpenClaw host                         Display machine
─────────────                         ───────────────
session JSONL ── daemon/CLI ──HTTP──▶ Tauri app/runtime
                                      setup + overlay
                                      tray + token store
```

Auth summary:

- public: `/health`, `/pair-mode`, active `/pair/claim`
- authenticated: state changes, avatar pushes, token rotation, auth check
- token persists on both sides after pair

## Status & next work

**Working:** native setup surface, native runtime, transparent overlay, tray controls, green/yellow/red indicator, 6-digit pairing, persisted reconnect token, authenticated readiness checks, daemon reactions, Tailscale-first cross-machine setup, avatar bundle push/select.

**Next:** packaged `.exe` / `.dmg` artifacts, smoke tests on target OSes, cleaner reset/rotate-token UX, Dependabot vulnerability fix, better animated avatar schema, Dawn-v1 animated bundle.

**Will not:** ambient cloud spend without a setting; surveillance-y always-on capture; closed paid avatar packs.

## Documentation

- [`docs/v0.5-brief.md`](docs/v0.5-brief.md)
- [`docs/clawpet-style-guide.md`](docs/clawpet-style-guide.md)
- [`docs/avatar-bundle-spec.md`](docs/avatar-bundle-spec.md)
- [`docs/avatar-event-contract.md`](docs/avatar-event-contract.md)
- [`docs/roadmap.md`](docs/roadmap.md)
- [`docs/adr/`](docs/adr/)

## License

Source: MIT. Avatar art bundles: see each `avatar.json`.
