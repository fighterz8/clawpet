# OpenClaw Expression System — Working Design

Status: draft / experiment plan

## Goal

Create a novel, low-cost expression layer where the OpenClaw instance occasionally drives the desktop avatar with context-aware personality, while the target runtime remains a lightweight display surface.

The runtime should display avatar state, bubbles, and assets. OpenClaw should decide when the avatar speaks, what it says, and which state/emote is appropriate.

## Core Principles

- Expression is user-controlled and starts as a simple `off` / `on` setting.
- Expression should be sparse, meaningful, and non-duplicative.
- System signal owns routine status: prompt received, tool running, done, idle.
- OpenClaw expression should add interpretation: friction, surprise, relief, momentum, concern, or personality.
- User-requested emits remain distinct from autonomous OpenClaw expression.
- The target/display machine should not need the source repo or manual behavior editing.
- OpenClaw-side skill/config is the control plane.

## Proposed Layers

### 1. Personality Profile

A small preset chosen during setup. Initial candidates:

- `quiet`: sparse, practical, low-chatter, mostly status-adjacent.
- `warm`: supportive, calm, human, occasional observations.
- `mischief`: clever/playful, more expressive, still bounded and useful.

Profile influences:

- wording style
- preferred avatar states/emotes
- speak frequency
- tolerance for humor/playfulness
- completion tone

### 2. Trigger Policy

User-configurable event and/or time-based rules.

Event-based trigger candidates:

- blocker / needs user input
- tool error or failed path
- recovery after error
- long task checkpoint
- successful verification/test/build
- meaningful completion
- manual user-requested moment

Time-based trigger candidates:

- at most every N minutes
- minimum cooldown between expression emits
- active hours / quiet hours
- optional long-running task check-ins

Initial default should be conservative:

- expression enabled but sparse
- no routine prompt-start expression
- no routine completion expression unless meaningful/contextual
- cooldown enabled
- quiet hours respected if configured

### 3. Context Pack

Keep context small and explicit. Candidate sources:

- current trigger type
- current/last system signal
- recent tool/result summary
- recent runtime event outcomes
- current user-facing task summary
- selected personality profile
- user expression preferences
- optional OpenClaw dreams/memory if enabled by user

Open question: experiment with context variants:

- no conversation context, only trigger + task summary
- last few user/assistant messages
- recent runtime events
- memory/dream-derived style hints
- project/task-specific context

## Output Contract

Expression generation should return a tiny structured object:

```json
{
  "emit": true,
  "state": "thinking|focused|happy|alert|idle|sleepy",
  "bubble": "short display text",
  "reason": "brief internal reason / trigger explanation"
}
```

Rules:

- `bubble` must be short enough for the avatar UI.
- no secrets, tokens, OAuth codes, or private data
- no pretending to have senses/body/life outside the system
- avoid duplicating system signal text
- if uncertain or low value, return `emit: false`

## Fast Experiment Plan

Start with the smallest useful system:

1. `expression.enabled`: boolean
2. `expression.personality`: `quiet | warm | mischief`
3. `expression.cooldownMinutes`: number
4. `expression.triggers`: list of enabled trigger types
5. optional quiet hours

Implement only 2–3 triggers first:

- blocker
- long task checkpoint
- meaningful completion / verification success

Then compare context packs:

- trigger-only
- trigger + recent tool summary
- trigger + recent conversation snippet
- trigger + OpenClaw dreams/memory style hints, if enabled

## OpenClaw Skill Setup Flow

The Clawpet/Clawpals skill should eventually guide the user through setup:

1. Choose expression on/off.
2. Pick a personality profile.
3. Choose event triggers.
4. Choose cooldown / quiet hours.
5. Optionally enable context sources such as dreams/memory.
6. Run a short calibration test with sample emits.
7. Save config on the OpenClaw host.

The setup should produce predictable config, not vague prompt-only behavior.

## Architecture Direction

- OpenClaw host owns personality/config/policy/generation.
- Desktop runtime owns display, local token auth, pairing, and asset persistence.
- Target installer should install/update runtime without requiring the user to manually work inside the repo.
- Skill package should be the canonical agent control plane:
  - `SKILL.md` instructions
  - `bin/` deterministic CLI/scripts
  - optional `references/` for deeper behavior docs
  - optional `assets/` for templates/examples

## Naming Note

Nick wants to rename the project from Clawpet to Clawpals because `clawpal` is taken.

The rename should update repo/package/docs/UI references carefully while preserving protocol compatibility where needed.
