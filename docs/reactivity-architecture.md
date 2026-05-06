# Clawpet Reactivity Architecture

## Goal

Split Clawpet reactivity into **two separate systems** so the avatar feels alive without muddling cheap daemon mirroring with contextual/model-driven expression.

---

## 1) Daemon voice

### Purpose

Mirror what OpenClaw is doing **operationally**.

This is the ambient, low-cost system.

### Source

- structured OpenClaw session events
- tool calls
- user-message detection
- assistant completion detection
- other deterministic runtime/agent events

### Cost

- **zero LLM tokens**
- daemon/sidecar only

### Behavior

- chooses from a **preset phrase dictionary**
- phrases vary by tool/event/state
- no recent-context reading
- no inference about user intent beyond event classification
- should feel like a living status layer, not like the avatar is improvising thoughts

### Controls

Use a dedicated setting separate from contextual expression:

- `silent`
- `lite`
- `vivid`

#### Meanings

- `silent`
  - state changes allowed
  - no bubble text except optional critical alerts if desired
- `lite`
  - very short, low-noise preset bubbles
  - one compact phrase per event family
- `vivid`
  - richer preset phrase pool with more visible variety
  - still deterministic and preset only

### Examples

#### `read`
- `lite`: `Reading…`
- `vivid`:
  - `Reading files…`
  - `Digging through the repo…`
  - `Looking at the code…`

#### `exec`
- `lite`: `Running…`
- `vivid`:
  - `Running a command…`
  - `Checking the machine…`
  - `Trying this locally…`

#### `done`
- `lite`: `Done`
- `vivid`:
  - `Wrapped up.`
  - `Finished that pass.`
  - `That should do it.`

---

## 2) OpenClaw expression

### Purpose

Occasional **contextual personality**.

This is where the avatar notices the recent flow of work and says something short, grounded, and lightly witty.

### Source

- small recent context slice
- recent user message(s)
- recent assistant/tool activity summary
- current task mood / friction / progress signal

### Cost

- **uses LLM tokens**
- should be rate-limited and optional

### Behavior

- reads a small bounded recent context window
- emits a short contextual remark
- can select states like `happy`, `alert`, `focused`, `thinking`
- should feel like commentary, not status spam

### Controls

Use a second dedicated setting:

- `off`
- `low`
- `medium`
- `high`

#### Meanings

- `off`
  - never emits contextual commentary
- `low`
  - only notable transitions or strong opportunities
- `medium`
  - occasional relevant remarks during meaningful work
- `high`
  - frequent expressive commentary; mostly for experimentation/debugging/personality tuning

### Example remarks

- `This one’s being slippery.`
- `That landed cleaner than I expected.`
- `A lot of small cuts, but we’re moving.`
- `This feels annoyingly close.`
- `Okay, that actually helped.`

### State guidance

- `happy`
  - successful fix, good progress, pleasant surprise, clean finish
- `alert`
  - blocker, mismatch, risk, repeated failure, user attention needed
- `focused`
  - deliberate execution, tool-heavy work, longer build/test loop
- `thinking`
  - ambiguity, reading, planning, interpretation

---

## Why these must stay separate

Without separation, the system becomes confusing:

- daemon voice events look like model-driven personality
- model-driven commentary duplicates status messages
- users cannot tell what costs tokens
- `activity level` becomes overloaded and unclear

Clean split:

- **daemon voice** = what OpenClaw is doing
- **OpenClaw expression** = what the avatar thinks about what is happening

---

## Proposed settings model

### Existing setting to replace/refine

Current `activity` setting mixes density and tone too much.

### Proposed new config fields

```json
{
  "daemonVoice": "lite",
  "expressionLevel": "off",
  "heartbeatReactions": false
}
```

Optional later additions:

```json
{
  "expressionCooldownSeconds": 300,
  "expressionMaxPerHour": 8,
  "expressionContextMessages": 4
}
```

---

## Daemon dictionary structure

Suggested internal structure:

```js
const DAEMON_VOICE = {
  read: {
    state: "thinking",
    lite: ["Reading…"],
    vivid: [
      "Reading files…",
      "Digging through the repo…",
      "Looking at the code…"
    ]
  },
  exec: {
    state: "focused",
    lite: ["Running…"],
    vivid: [
      "Running a command…",
      "Checking the machine…",
      "Trying this locally…"
    ]
  },
  done: {
    state: "happy",
    lite: ["Done"],
    vivid: [
      "Wrapped up.",
      "Finished that pass.",
      "That should do it."
    ]
  }
}
```

Also support event families such as:

- `user-message`
- `tool-read`
- `tool-write`
- `tool-edit`
- `tool-process`
- `tool-web`
- `tool-image`
- `tool-plan`
- `delegate`
- `done`
- `error`
- `blocker`

---

## Deterministic variation rules

Daemon phrase selection should feel varied without becoming chaotic.

### Requirements

- no real randomness required for correctness
- same-ish event stream should not always pick the exact same phrase consecutively
- selection should be cheap and reproducible

### Suggested rule

Select from the phrase pool using a deterministic hash of:

- tool/event name
- current state
- current minute bucket or event id tail
- optional recent selection memory to avoid immediate repeats

Pseudo-rule:

```js
index = hash(`${eventType}:${state}:${eventId}`) % phrases.length
```

Then avoid direct repeats when possible:

```js
if (phrases[index] === lastPhraseForEventType && phrases.length > 1) {
  index = (index + 1) % phrases.length
}
```

This gives variety without making the system feel noisy or unpredictable.

---

## OpenClaw expression firing rules

Expression should **not** fire on every event.

### Allowed triggers

- user sends a substantial message
- notable progress transition
- repeated friction / repeated failed attempt
- task completion after a longer run
- surprising or funny context moment
- important warning or blocker worth surfacing with personality

### Suppress when

- daemon just emitted recently
- expression fired too recently
- recent context is too thin
- work is too repetitive/low-signal
- the expression would just paraphrase the daemon bubble
- user is in a rapid-fire command loop where commentary would annoy

### Initial cooldown recommendation

- minimum **3-5 minutes** between contextual expressions
- plus event-based throttling
- plus per-hour cap

---

## OpenClaw expression prompt shape

Keep it small and bounded.

### Inputs

- latest user message
- very small summary of recent tool activity
- current task label if known
- maybe previous avatar state

### Output contract

- 1 short line only
- max ~10 words preferred, hard cap ~18
- no secrets
- no fabricated certainty
- no repetitive catchphrases
- optional state choice from allowed set

### Example output schema

```json
{
  "state": "happy",
  "bubble": "Okay, that landed nicely."
}
```

---

## UI proposal

### Reactivity section becomes two separate controls

#### Daemon voice
Help text:
> Preset ambient reactions driven from live OpenClaw activity. No token cost.

Values:
- Silent
- Lite
- Vivid

#### OpenClaw expression
Help text:
> Occasional contextual remarks based on recent task flow. Uses some tokens.

Values:
- Off
- Low
- Medium
- High

#### Heartbeat reactions
Keep as separate toggle.

---

## Activity log labeling proposal

Show source clearly:

- `daemon voice` — JSONL/tool/session mirror from the sidecar daemon
- `OpenClaw expression` — optional autonomous/contextual expression layer
- `user-requested` — explicit one-off/manual/routine emits requested by the user
- `runtime` — local runtime/demo/internal events

Optional future detail:

- `daemon voice · read`
- `daemon voice · exec`
- `OpenClaw expression · progress`
- `OpenClaw expression · blocker`
- `user-requested · celebration routine`

That will make cost/source much easier to understand.

---

## Recommended build order

### Phase 1
- finish source-label cleanup
- replace current daemon phrase pools with explicit `silent/lite/vivid` dictionary structure
- ensure daemon never overlaps conceptually with expression system

### Phase 2
- add config storage + runtime mirror for `daemonVoice` and `expressionLevel`
- update dashboard UI to show both controls distinctly

### Phase 3
- add OpenClaw expression engine with strict cooldown and token guardrails
- start with short preset-aware prompt and low default frequency

### Phase 4
- tune phrase dictionaries and expression behavior from real use

---

## Recommended defaults

```json
{
  "daemonVoice": "lite",
  "expressionLevel": "off",
  "heartbeatReactions": false
}
```

For testing:

```json
{
  "daemonVoice": "vivid",
  "expressionLevel": "low"
}
```

---

## Summary

The right distinction is:

- **daemon**: `what OpenClaw is doing`
- **expression**: `what the avatar thinks about what is happening`

If we preserve that line, Clawpet can feel alive without becoming noisy, confusing, or accidentally expensive.
