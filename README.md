# Clawpet

A pixel-art desktop companion for [OpenClaw](https://openclaw.ai). Your AI assistant gets a face: a small dragon (Dawn), slime (Pip), or any Clawpet you generate. Reacts to what OpenClaw is doing — thinking, working, alert, done — and quietly idles the rest of the time.

> **Status:** v0.3, working end-to-end on Windows + macOS + Linux over local network or Tailscale. Bring your own OpenClaw.

![Dawn — six states](docs/screenshots/dawn-pip-comparison.png)

## What it actually is

Three pieces working together:

1. **A tiny local HTTP runtime** (`Hono` on Node, default `127.0.0.1:8737`) that holds the avatar's state.
2. **A transparent always-on-top desktop overlay** (Tauri 2 + React + Vite) that polls the runtime and animates a pixel-art sprite for each state.
3. **An OpenClaw skill** (`clawpet`) that lets the assistant emit semantic events (`react user-message`, `react done`, `react blocker`…) to the runtime over loopback or Tailscale, with bearer-token auth and user-controlled activity levels.

The avatar lives on **your desktop**. OpenClaw can run on the same machine, on your home server, or anywhere on your tailnet — whichever is convenient.

## Quickstart (≈3 minutes)

You need: **Node.js ≥ 20**, **git**, and (for the desktop window) **Rust + a C++ build toolchain**.

### 1. On the machine that should display the avatar (the "target")

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/fighterz8/clawpet/main/scripts/install-unix.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/fighterz8/clawpet/main/scripts/install-windows.ps1 | iex
```

The installer clones the repo into `~/clawpet`, installs deps, ensures Rust + (on Windows) MSVC C++ Build Tools, generates a per-machine auth token, auto-detects your Tailscale hostname if you have one, and prints the exact `clawpet pair --url … --token …` command for the OpenClaw side.

Then start the runtime and the overlay (two terminals):

```bash
# terminal 1 — runtime (loopback only is fine for same-machine OpenClaw)
cd ~/clawpet
npm run runtime:dev

# terminal 2 — desktop overlay
npm run desktop:dev
```

Cross-machine? Bind the runtime to your network interface and let Tailscale do the transport:

```bash
CLAWPET_RUNTIME_HOST=0.0.0.0 CLAWPET_RUNTIME_PORT=8737 npm run runtime:dev
```

> When the runtime is **not** on `127.0.0.1`, it requires a bearer token. The token is auto-generated on first boot and stored at `~/.openclaw/clawpet/runtime-token` (mode `0600`).

### 2. On the OpenClaw side

Install the skill (one-time):

```bash
git clone https://github.com/fighterz8/clawpet ~/clawpet 2>/dev/null || true
mkdir -p ~/.openclaw/skills
ln -sf ~/clawpet/skills/clawpet ~/.openclaw/skills/clawpet 2>/dev/null \
  || ln -sf ~/clawpet/skills/clawpet ~/.openclaw/workspace/skills/clawpet
```

Pair with the target's runtime (the installer printed this exact line):

```bash
clawpet pair --url http://<target-tailnet-hostname>:8737 --token <hex-token>
```

Verify:

```bash
clawpet ping     # public, just confirms the runtime is alive
clawpet status   # auth-required, returns paired source + current state
clawpet send happy "It works" --bubble "Hello! 🐲" --quiet
```

The avatar should pop into `happy` and decay back to `idle` on its own a few seconds later.

## How OpenClaw drives the avatar

The skill exposes two emit verbs:

| Command | Use it for |
| ------- | ---------- |
| `clawpet react <event>` | Semantic, user-gated. Preferred. |
| `clawpet send <state>`  | Direct state push. Manual cases. |

Reaction events:

| Event | Maps to | Fires at activity ≥ |
| ----- | ------- | ------------------- |
| `tool-error` / `blocker` / `done` | `alert` / `alert` / `happy` | `minimal` |
| `long-task` / `thinking`          | `focused` / `thinking`      | `balanced` |
| `user-message` / `tool-start`     | `thinking` / `focused`      | `expressive` |
| `heartbeat`                       | `thinking`                  | separate flag |

Activity is set by the **user**, not the LLM:

```bash
clawpet activity off          # silent
clawpet activity minimal      # errors + completion only
clawpet activity balanced     # default
clawpet activity expressive   # also reacts to your messages and tool starts
clawpet activity maximum      # reserved for richer per-tool reactions

clawpet heartbeat-reactions on   # default off; opt-in flash during heartbeat polls
```

The CLI itself enforces the gate. If the LLM tries to emit something your level forbids, the call returns `{ ok: true, suppressed: true }` and nothing fires.

## Cost discipline

Emits are tiny HTTP POSTs — the only cost is the LLM tool call that issues them. With `--quiet`, expect:

| Activity      | Typical extra tokens / active turn |
| ------------- | ---------------------------------- |
| `off`         | 0                                  |
| `minimal`     | 0–80                               |
| `balanced`    | 0–200                              |
| `expressive`  | 100–400                            |
| `maximum`     | 200–600                            |

The runtime auto-decays state on its own (active → idle after 8s, idle → sleepy after 5min). That animation is **free** — pure local computation, no LLM involvement, no token cost.

## Multi-avatar

Bundles live under `public/avatars/<name>-v<n>/`:

```
public/avatars/
├── dawn-v0/         # baby dragon
│   ├── avatar.json
│   └── assets/{idle,thinking,focused,happy,alert,sleepy}.png
└── pip-v0/          # cyan slime — proves the multi-avatar pipeline
    ├── avatar.json
    └── assets/{idle,thinking,focused,happy,alert,sleepy}.png
```

Switch which avatar the runtime serves:

```bash
CLAWPET_AVATAR_BUNDLE=pip-v0 npm run runtime:dev
```

The desktop overlay reads the matching bundle automatically. Build-time override:

```bash
VITE_CLAWPET_AVATAR_BUNDLE=pip-v0 npm run desktop:dev
```

### Generating a new Clawpet

Every new sprite must follow [`docs/clawpet-style-guide.md`](docs/clawpet-style-guide.md) v1: pixel-art, 128×128 logical / 512×512 export, transparent background, limited palette, hard 1-px outline, cel shading, six required states (idle / thinking / focused / happy / alert / sleepy). The locked image-gen prompt template is in §7 of the style guide and **must** be used verbatim — only the subject, palette, and state get filled in. Pip's bundle was generated this way as a reference.

## Architecture

```
┌──────────────────────┐                 ┌──────────────────────────┐
│  OpenClaw session    │   tool call     │  ~/clawpet/skills/       │
│  (any machine)       ├────────────────▶│  clawpet/bin/clawpet.mjs │
└──────────────────────┘                 └─────────────┬────────────┘
                                                       │ HTTP POST + Bearer
                                                       ▼
┌────────────────────────────────────────────────────────────────────┐
│  Target machine                                                    │
│                                                                    │
│  ┌─────────────────────┐   in-mem state    ┌────────────────────┐  │
│  │  Hono runtime       │◀──────────────────│  state store       │  │
│  │  /health /status    │                   │  + decay-on-read   │  │
│  │  /avatar/state      │                   └────────────────────┘  │
│  │  /admin/rotate-token│              ▲                            │
│  └─────────────────────┘              │ /status (poll, loopback)   │
│                                       │                            │
│                                ┌──────┴───────────┐                │
│                                │  Tauri overlay   │                │
│                                │  React + Vite    │                │
│                                │  PNG bundle      │                │
│                                └──────────────────┘                │
└────────────────────────────────────────────────────────────────────┘
```

**Auth model:**

- `127.0.0.1` (loopback): trusted, no token needed. Local desktop overlay always works.
- Anything else (LAN / Tailscale / `0.0.0.0`): token required on every request except `GET /health`.
- Token lives at `~/.openclaw/clawpet/runtime-token` and can be rotated in-place with `clawpet rotate-token`.

## Documentation

- [`docs/clawpet-style-guide.md`](docs/clawpet-style-guide.md) — locked visual style for all Clawpets (v1).
- [`docs/avatar-bundle-spec.md`](docs/avatar-bundle-spec.md) — bundle manifest schema.
- [`docs/avatar-event-contract.md`](docs/avatar-event-contract.md) — runtime event format.
- [`docs/runtime-first-mvp-plan.md`](docs/runtime-first-mvp-plan.md) — the runtime-first pivot rationale.
- [`docs/roadmap.md`](docs/roadmap.md) — near-term, mid-term, and speculative directions.
- [`docs/adr/`](docs/adr/) — architecture decision records.

## Status & non-goals

**Working:** transparent draggable overlay, system tray, six-state pixel sprites, runtime auth, decay, semantic reactions, activity gating, heartbeat opt-in, Tailscale-native cross-machine projection, multi-avatar bundles.

**Not yet:**
- Signed binary releases (currently install via `git + npm + tauri`).
- OpenClaw-hosted relay for users without Tailscale.
- Native idle animation (frame loops within a state) — bigger "feels alive" jump.
- Environment / screen awareness — see [roadmap](docs/roadmap.md).

**Will not:** ambient cloud spend without a setting; surveillance-y always-on capture; closed paid avatar packs.

## License

Source: MIT. Avatar art bundles: see each `avatar.json` (Dawn and Pip are CC-BY-NC-4.0).
