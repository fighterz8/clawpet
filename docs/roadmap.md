# Clawpet Roadmap

Where we are after v0.3 and where this is heading. Items are grouped by horizon. The unifying thesis: **Clawpets should feel alive, not animated stills.**

## Current state (v0.3)

- Pixel-art avatars rendered from versioned bundles (`public/avatars/<name>-v<n>/`).
- Tauri desktop overlay: transparent, draggable, system tray, fixed-size.
- Local Hono runtime API with bearer-token auth, loopback trust, and server-side state decay (active → idle → sleepy).
- OpenClaw `clawpet` skill with semantic reactions, user-controlled activity levels, optional heartbeat reactions, and one-line install scripts for Windows/macOS/Linux.
- Tailscale-native cross-machine projection. No port forwarding required.
- Locked style guide (v1) for consistent multi-avatar generation.

## Near-term (v0.4 – v0.6)

These are the next obvious wins; mostly incremental on what we have.

### ✅ Automatic tool/turn reactions via session-JSONL daemon (shipped 2026-05-04)
Dawn now reacts in real time to whatever OpenClaw is doing, with **zero LLM-token cost**, via a sidecar daemon that tails the active session JSONL at `~/.openclaw/agents/main/sessions/*.jsonl`. The daemon classifies events as they're appended and dispatches `clawpet react`/`clawpet send` accordingly. Activity-level dial-down (`off`/`minimal`/`balanced`/`expressive`/`maximum`) controls reaction density.

```
clawpet daemon enable | disable | start | stop | status | run
```

This turned out to be much simpler than the OpenClaw extension/hook path because OpenClaw already writes a clean structured event stream to disk. The daemon is ~250 lines of Node, no extension API needed, works on any model.

**Future polish on this path:**
- Linux OpenClaw hosts can now use `clawpet daemon enable` to install a restartable systemd user service, so reactions survive gateway/process restarts.
- Add equivalent Windows service / launchd plist support.
- Bubble-copy variation that pulls tool args (e.g., "Reading SKILL.md…" instead of just "Reading…").
- Map approval events (`AgentApprovalEventData`) to `react blocker` once we wire those into the JSONL stream.

### Multi-avatar selection
- Runtime accepts `CLAWPET_AVATAR_BUNDLE` (default `dawn-v0`) and reports it in `/status`.
- Desktop overlay reads that and loads the matching bundle automatically.
- Skill: `clawpet avatar list | use <name>`.

### Per-state bubble defaults
- Avatar bundles can declare default bubble copy per state (`"idleBubble": "..."`), so emits without explicit `--bubble` get something on-brand instead of falling back to `message`.

### Bundle distribution
- Publish well-formed Clawpet bundles to ClawHub: `clawpet avatar install dawn-v0` pulls a verified bundle and drops it in.
- Style-guide compliance check runs on bundle install (palette + state set + transparency).

### Signed binary release
- Tauri build pipeline producing signed installers per OS so users don't need Rust + npm to run Clawpet.
- Release flow on GitHub with auto-update channel.

### Token rotation cadence + revocation
- `clawpet rotate-token --schedule weekly` writes a tiny cron/Task Scheduler entry.
- Revoke specific paired clients (instance ID) without rotating everyone.

## Mid-term (v0.7 – v1.0)

Where Clawpet stops being a toy and starts being a real desktop companion.

### Native idle animation, not just state transitions
- Each state ships a small frame loop (idle blink, breathing chest, tail flick) baked into the bundle as a sprite sheet or spine-style rig.
- Runtime stays the source of truth for *state*; the renderer owns *motion*.
- This is the single biggest "feels alive" jump.

### Speech bubble queue + pacing
- Multiple emits in quick succession queue into a chat-bubble feed instead of clobbering each other.
- Bubble fade in/out with proper timing curves.

### Audio cues (opt-in, off by default)
- Tiny chirp on `happy`, soft hum on `focused`, etc. Volume-capped and respectful of OS focus state.
- Strict opt-in — silence is a feature.

### Multi-OpenClaw pairing
- One Clawpet runtime can be paired with multiple OpenClaw instances (work / personal). Each shows a different identity tag in the bubble.

### Window management
- Snap to screen edges (with a tolerance, not Windows-style full-snap).
- Multi-monitor placement memory.
- Auto-hide on fullscreen apps / presentations.

## Speculative (v1.0+) — the "alive" track

This is the scoping you asked for. None of these are committed; they're directions worth holding open.

### Environmental awareness
- **Active app sensing.** Clawpet reads which app has focus (via OS APIs already exposed to Tauri) and adjusts mood: dimmed/quiet during meetings, perky in a code editor.
- **Time-of-day persona.** Not just sleepy after 5min idle — Dawn is genuinely groggier in the morning, more focused mid-afternoon, cozier at night. Pure presentation, no LLM cost.
- **Notification mirror.** Clawpet bubbles up a single "you have N unread" condensation instead of letting the OS spam you. Dismissable.

### Visual perception (screen seeing)
- **Opt-in screen capture** of a small region (e.g., the active window's title bar, or a user-defined region).
- Pipe captures on demand to OpenClaw's vision model so Dawn can react to *what's on screen*: notice an error dialog, a long-running test, a calendar reminder.
- Hard limits: explicit user opt-in, on-demand only (not continuous), captures redacted of obvious secret patterns before transmission, throttle to N captures/hour.
- This is high-leverage but high-risk; needs careful UX so it never feels surveillance-y.

### Voice / TTS
- Short spoken nudges via local TTS (or `sag` if available) for `alert` only, with a strict per-hour rate limit.
- Lip-flap animation tied to TTS when used.

### Personality persistence across machines
- Clawpet "memory" — small long-running mood/energy state synced to OpenClaw memory so Dawn on the laptop and Dawn on the desktop feel like the same Dawn.
- Survives restarts; ages naturally over a session ("getting tired", "second wind after lunch").

### Companion behaviors
- Pomodoro: Clawpet visibly works alongside you, then nudges you to break.
- Co-walking the cursor: subtle eye tracking toward where you're typing.
- Reactive to OS volume / music: dances slightly faster on louder rhythms (privacy-respecting; just amplitude, not audio content).

### Multi-character world
- More than one Clawpet active at once (Dawn + a familiar + a tray-only character). Group emits and "conversations" between them.
- Dawn becomes a project lead and assigns tasks to lesser Clawpets.

### Non-cosmetic interactions
- Drag a file onto Clawpet → triggers a skill ("summarize this", "rename to date-prefix").
- Right-click Clawpet → quick contextual actions surfaced from OpenClaw (today's calendar, last commit).

## Anti-roadmap (things we will NOT do soon)

- Always-on mic listening.
- Cloud-hosted runtime exposed without a token.
- Closed-source paid avatar packs as the primary distribution model.
- Anything that turns Clawpet into a productivity surveillance tool.

## Design constraint (carries forward across all of this)

Two non-negotiables:
1. **User-controlled cost.** Every new feature ships with an off switch and is metered honestly. No ambient API spend without a setting.
2. **Style coherence.** The locked pixel-art style guide v1 governs every new Clawpet, no matter who generates it. Drift = reject.
