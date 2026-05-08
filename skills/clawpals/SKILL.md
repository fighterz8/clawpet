---
name: clawpals
description: Control and configure a Clawpals desktop companion for OpenClaw. Use for pairing a desktop Clawpals runtime over Tailscale, starting the zero-token auto-reactivity daemon, tuning daemon voice/expression behavior, sending avatar states/bubbles, rotating tokens, and managing the OpenClaw-side source of truth for future avatar appearance/assets.
---

# Clawpals

Clawpals gives an OpenClaw instance a small desktop companion avatar. The pet window runs on the user's daily-driver machine; this skill runs on the **OpenClaw host** and controls the pet over loopback or Tailscale.

## Architecture rule: OpenClaw owns control

Treat the OpenClaw machine as the source of truth for Clawpals control:

- Config lives on the OpenClaw host: `~/.openclaw/clawpals/config.json`.
- Runtime token lives in that config after pairing; never paste or log it.
- Activity/behavior is changed from OpenClaw with `clawpals activity ...`, not by editing desktop files.
- Avatar appearance/assets should be generated and stored on the OpenClaw host first, then synced/pushed to the desktop runtime over the paired Tailscale connection.
- Do **not** tell users to manually edit avatar assets on their daily-driver machine except as a temporary developer workaround.

Current implemented control plane: pairing, state/bubble emits, daemon voice, expression on/off, heartbeat setting, token rotation, install hints, auto-reactivity daemon, and avatar bundle push from OpenClaw → paired runtime.

## Quickstart for agents

1. If the desktop runtime is not installed, show the target-machine installer:

```bash
clawpals install --os windows   # or --os unix
```

2. Pair over Tailscale using the 6-digit flow:

On the desktop/target machine:

```bash
clawpals pair-mode
```

On the OpenClaw host:

```bash
clawpals pair --code <6-digit-code> --host <target-tailnet-hostname>:8737
```

3. Start automatic reactivity:

```bash
clawpals daemon enable   # preferred on Linux/OpenClaw hosts
clawpals daemon status
```

If systemd user services are unavailable, use `clawpals daemon start` as a one-session fallback.

4. Verify:

```bash
clawpals ping
clawpals status
clawpals send happy "Clawpals is connected" --bubble "Connected" --quiet
```

## Expression setup and control

Expression is currently a simple OpenClaw-side gate:

```bash
clawpals expression-level off
clawpals expression-level on
```

When expression is `off`, OpenClaw should only send system signal/user-requested emits. When expression is `on`, OpenClaw may occasionally generate contextual avatar expressions according to the user's configured profile, triggers, cooldown, and context sources.

Use `docs/openclaw-expression-system.md` in the repo as the working design reference when implementing or refining expression behavior. The intended setup flow is:

1. Ask whether expression should be enabled.
2. Choose a personality profile, initially `quiet`, `warm`, or `mischief`.
3. Choose event triggers such as blocker, error recovery, long task, verification success, or meaningful completion.
4. Choose cooldown/quiet-hours behavior.
5. Ask whether optional context sources such as OpenClaw dreams/memory may be used if available.
6. Save the resulting config on the OpenClaw host.
7. Run a short calibration sequence so the user can approve the feel.

Do not let the desktop runtime invent personality or expression policy. It displays what the OpenClaw host decides.

## Daemon-first behavior

The daemon is the production path. It tails OpenClaw's structured session JSONL at `~/.openclaw/agents/main/sessions/*.jsonl` and mirrors real activity to the runtime with **zero LLM-token cost**.

```bash
clawpals daemon enable   # Linux/OpenClaw host: systemd user service + start now
clawpals daemon start    # background sidecar for this login/session
clawpals daemon status
clawpals daemon stop
clawpals daemon disable  # disable systemd user autostart
clawpals daemon run      # foreground debugging
```

Daemon voice controls system-signal density/presentation. Expression is a separate on/off gate for optional OpenClaw flavor emits:

```bash
clawpals daemon-voice lite
clawpals expression-level on
clawpals expression-level off
```

Legacy activity levels still exist for backward compatibility and daemon-density mapping:

| Level | Behavior |
| --- | --- |
| `off` | Silent. |
| `minimal` | Errors/blockers/completion only. |
| `balanced` | Adds long-running tool/work signals. |
| `expressive` | Adds user-message and common tool-start signals. |
| `maximum` | Reacts to nearly every tool event; useful for debugging. |

Set level:

```bash
clawpals activity balanced
clawpals activity expressive
clawpals activity off
```

Warn before increasing legacy activity to `expressive` or `maximum`: higher levels add extra visible system-signal reactions. Optional OpenClaw expression emits are controlled separately by `clawpals expression-level on|off`; the daemon itself is free.

## Manual state and flavor emits

Use manual emits only when they add meaning the daemon cannot infer.

```bash
clawpals send thinking "Reading the repo" --bubble "Reading…" --quiet
clawpals send focused "Running tests" --bubble "Testing…" --quiet
clawpals send alert "Need approval" --bubble "Approval needed" --quiet
clawpals send happy "Done" --bubble "Done" --quiet
```

Prefer semantic reactions when possible:

```bash
clawpals react blocker --bubble "Need input" --quiet
clawpals react done --bubble "Done" --quiet
```

Never include secrets, OAuth codes, bearer tokens, or API keys in messages/bubbles.

## Pairing and auth

Runtime default: `http://127.0.0.1:8737`.

For cross-machine setups, use Tailscale. The runtime should listen on `0.0.0.0:8737` on the target machine, and OpenClaw should pair to the target's tailnet hostname.

Commands:

```bash
clawpals pair --code 472091 --host <desktop-host>.<tailnet>.ts.net:8737
clawpals pair --url http://host:8737 --token <token>   # legacy/manual fallback
clawpals rotate-token
clawpals config
```

Security properties of magic pair: short-lived window, 6-digit code, attempt limit, rate limit, token rotates on success, public pair endpoints do not reveal the token or code.

## Bubble/state semantics

- Active states (`thinking`, `focused`, `alert`) persist until a new event replaces them.
- Terminal `happy` lingers briefly, then runtime returns to `idle`.
- When `happy` decays to `idle`, the previous completion bubble becomes `idle` instead of staying stale.
- Runtime may drift from idle to sleepy after quiet time.

## Avatar assets and behavior changes

Users should ask OpenClaw to change Clawpals appearance/behavior. Store generated or edited bundle files on the OpenClaw host first, then push them to the paired runtime:

```bash
clawpals avatar push ~/.openclaw/clawpals/bundles/cobalt-golem-v0
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
  frames/idle-0.png        # optional v0.5 animated frames
  frames/idle-1.png
```

`clawpals avatar push` sends `avatar.json` + PNG assets/frames over the authenticated runtime connection (Tailscale for cross-machine setups). The runtime persists them under its local `~/.openclaw/clawpals/runtime-bundles/current/`, updates `/status`, and serves the selected bundle to the overlay from `/avatar-bundle/current/...`.

**Default-avatar rule:** when OpenClaw generates or approves a new avatar, do not stop at writing files into the repo. Push the generated bundle with `clawpals avatar push <bundle-dir>` so the desktop runtime records it as the current/default bundle. After pushing, verify both:

```bash
clawpals status                  # avatar.avatarId / bundleVersion should match the generated avatar
curl -fsS "$RUNTIME_URL/avatar-bundle/current/avatar.json"  # should return the generated manifest
```

The current v0.6.0 showcase/default demo avatar is Cobalt Golem (`cobalt-golem-v0`). Dawn Ember (`dawn-v2-ember`) and Lantern Moth (`lantern-moth-v0`) remain built-in defaults. If the desktop app still starts with the deprecated old blue Dawn (`dawn-v0`) after restart, the runtime is probably an older build or an environment override (`CLAWPALS_AVATAR_BUNDLE=dawn-v0`) is still active. Update/restart the desktop runtime before moving on to generated multi-frame work.

The desktop machine is a display/runtime target, not the place the user has to manually edit files.

## Avatar generation workflow

When the user asks to create or change a Clawpals avatar, OpenClaw should create the avatar on the OpenClaw host, build the bundle, push it to the paired runtime, and verify it. Do not instruct the user to manually edit desktop-machine assets.

Default strategy: generate six state anchors, animate deterministic frame loops, run QA, build, push, verify. Use provider-edited frame deltas only when advanced generation is explicitly configured.

Required flow:

1. Run `clawpals status` or `clawpals ping` to confirm runtime readiness.
2. Scaffold a job manifest under `~/.openclaw/clawpals/avatar-jobs/` for user-specific jobs; use repo `jobs/` only for fixtures/tests/examples.
3. Lock exact palette hex values, outline, pose framing, signature silhouette, and source image contract before frame generation.
4. Generate or collect six state anchors: `idle`, `thinking`, `focused`, `happy`, `alert`, and `sleepy`.
5. Run deterministic animation and QA. Repair failed frames only; do not regenerate the whole avatar unless the identity anchor failed.
6. Build the bundle and create review artifacts such as a contact sheet and preview GIF.
7. Push with `clawpals avatar push <bundle-dir>`.
8. Verify with `clawpals status` and the runtime-served manifest.

If the provider is not configured, emit the prompt plan/job scaffold and say provider-backed image generation is unavailable. Do not claim that an avatar was generated.

Detailed runbook: `docs/avatar-generation.md`. Minimal job scaffold: `templates/avatar-job-template.json`.

Skill-facing wrappers are available for the repo pipeline when `scripts/run_avatar_pipeline.py` is discoverable, or when `CLAWPALS_PIPELINE_ROOT` points at the Clawpals repo:

```bash
clawpals avatar validate <job.json>
clawpals avatar animate <job.json>
clawpals avatar qa <job.json>
clawpals avatar build <job.json>
clawpals avatar review <job.json>
clawpals avatar run <job.json>
clawpals avatar push-job <job.json>
clawpals avatar verify <job.json>
```

Low-level runtime upload remains `clawpals avatar push <bundle-dir>`.

## ClawHub packaging note

This skill is the OpenClaw-side control package. The desktop runtime/overlay remains installed from the Clawpals GitHub repo/Vercel docs. ClawHub users install this skill, then run `clawpals install` to get the target-machine installer command.
