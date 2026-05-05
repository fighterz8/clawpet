---
name: clawpet
description: Control and configure a Clawpet desktop companion for OpenClaw. Use for pairing a desktop Clawpet runtime over Tailscale, starting the zero-token auto-reactivity daemon, changing avatar activity/behavior, sending avatar states/bubbles, rotating tokens, and managing the OpenClaw-side source of truth for future avatar appearance/assets.
---

# Clawpet

Clawpet gives an OpenClaw instance a small desktop companion avatar. The pet window runs on the user's daily-driver machine; this skill runs on the **OpenClaw host** and controls the pet over loopback or Tailscale.

## Architecture rule: OpenClaw owns control

Treat the OpenClaw machine as the source of truth for Clawpet control:

- Config lives on the OpenClaw host: `~/.openclaw/clawpet/config.json`.
- Runtime token lives in that config after pairing; never paste or log it.
- Activity/behavior is changed from OpenClaw with `clawpet activity ...`, not by editing desktop files.
- Avatar appearance/assets should be generated and stored on the OpenClaw host first, then synced/pushed to the desktop runtime over the paired Tailscale connection.
- Do **not** tell users to manually edit avatar assets on their daily-driver machine except as a temporary developer workaround.

Current implemented control plane: pairing, state/bubble emits, activity settings, heartbeat setting, token rotation, install hints, auto-reactivity daemon, and avatar bundle push from OpenClaw → paired runtime.

## Quickstart for agents

1. If the desktop runtime is not installed, show the target-machine installer:

```bash
clawpet install --os windows   # or --os unix
```

2. Pair over Tailscale using the 6-digit flow:

On the desktop/target machine:

```bash
clawpet pair-mode
```

On the OpenClaw host:

```bash
clawpet pair --code <6-digit-code> --host <target-tailnet-hostname>:8737
```

3. Start automatic reactivity:

```bash
clawpet daemon enable   # preferred on Linux/OpenClaw hosts
clawpet daemon status
```

If systemd user services are unavailable, use `clawpet daemon start` as a one-session fallback.

4. Verify:

```bash
clawpet ping
clawpet status
clawpet send happy "Clawpet is connected" --bubble "Connected" --quiet
```

## Daemon-first behavior

The daemon is the production path. It tails OpenClaw's structured session JSONL at `~/.openclaw/agents/main/sessions/*.jsonl` and mirrors real activity to the runtime with **zero LLM-token cost**.

```bash
clawpet daemon enable   # Linux/OpenClaw host: systemd user service + start now
clawpet daemon start    # background sidecar for this login/session
clawpet daemon status
clawpet daemon stop
clawpet daemon disable  # disable systemd user autostart
clawpet daemon run      # foreground debugging
```

Activity levels control daemon density:

| Level | Behavior |
| --- | --- |
| `off` | Silent. |
| `minimal` | Errors/blockers/completion only. |
| `balanced` | Adds long-running tool/work signals. |
| `expressive` | Adds user-message and common tool-start signals. |
| `maximum` | Reacts to nearly every tool event; useful for debugging. |

Set level:

```bash
clawpet activity balanced
clawpet activity expressive
clawpet activity off
```

Warn before increasing to `expressive` or `maximum`: higher levels add extra visible reactions and may add token cost if the model also performs optional flavor emits. The daemon itself is free.

## Manual state and flavor emits

Use manual emits only when they add meaning the daemon cannot infer.

```bash
clawpet send thinking "Reading the repo" --bubble "Reading…" --quiet
clawpet send focused "Running tests" --bubble "Testing…" --quiet
clawpet send alert "Need approval" --bubble "Approval needed" --quiet
clawpet send happy "Done" --bubble "Done" --quiet
```

Prefer semantic reactions when possible:

```bash
clawpet react blocker --bubble "Need input" --quiet
clawpet react done --bubble "Done" --quiet
```

Never include secrets, OAuth codes, bearer tokens, or API keys in messages/bubbles.

## Pairing and auth

Runtime default: `http://127.0.0.1:8737`.

For cross-machine setups, use Tailscale. The runtime should listen on `0.0.0.0:8737` on the target machine, and OpenClaw should pair to the target's tailnet hostname.

Commands:

```bash
clawpet pair --code 472091 --host <desktop-host>.<tailnet>.ts.net:8737
clawpet pair --url http://host:8737 --token <token>   # legacy/manual fallback
clawpet rotate-token
clawpet config
```

Security properties of magic pair: short-lived window, 6-digit code, attempt limit, rate limit, token rotates on success, public pair endpoints do not reveal the token or code.

## Bubble/state semantics

- Active states (`thinking`, `focused`, `alert`) persist until a new event replaces them.
- Terminal `happy` lingers briefly, then runtime returns to `idle`.
- When `happy` decays to `idle`, the previous completion bubble becomes `idle` instead of staying stale.
- Runtime may drift from idle to sleepy after quiet time.

## Avatar assets and behavior changes

Users should ask OpenClaw to change Clawpet appearance/behavior. Store generated or edited bundle files on the OpenClaw host first, then push them to the paired runtime:

```bash
clawpet avatar push ~/.openclaw/clawpet/bundles/dawn-v1
```

Bundle folder shape:

```text
<bundle>/
  avatar.json
  assets/idle.png
  assets/thinking.png
  assets/focused.png
  assets/happy.png
  assets/alert.png
  assets/sleepy.png
```

`clawpet avatar push` sends `avatar.json` + PNG assets over the authenticated runtime connection (Tailscale for cross-machine setups). The runtime persists them under its local `~/.openclaw/clawpet/runtime-bundles/current/`, updates `/status`, and serves the selected bundle to the overlay from `/avatar-bundle/current/...`.

The desktop machine is a display/runtime target, not the place the user has to manually edit files.

## ClawHub packaging note

This skill is the OpenClaw-side control package. The desktop runtime/overlay remains installed from the Clawpet GitHub repo/Vercel docs. ClawHub users install this skill, then run `clawpet install` to get the target-machine installer command.
