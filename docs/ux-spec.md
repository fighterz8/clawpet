# Clawpet UX Spec

## Core experience

Clawpet should feel like a small companion presence, not a full app window. It should communicate what OpenClaw is doing at a glance.

## Primary states

| State | Meaning | Visual behavior |
|---|---|---|
| idle | OpenClaw is available / no urgent task | gentle breathing/bobbing |
| thinking | OpenClaw is working | glow/pulse, focused eyes |
| focused | longer work in progress | steady aura, low-motion concentration |
| happy | task completed / success | small bounce, sparkle |
| alert | user attention needed | shake or spark, brighter contrast |
| sleepy | quiet hours / low activity | dim, slow blink |

## Overlay behavior target

- Small transparent window.
- Always-on-top by default.
- Click-through by default once positioned.
- Draggable/unlocked mode for placement.
- Docking presets:
  - bottom right
  - bottom left
  - top right
  - top left
- Optional speech bubble that auto-dismisses.

## Speech/status bubble rules

- Keep messages short.
- Prefer status over chatter.
- Auto-dismiss non-critical messages.
- Alerts may persist until acknowledged.
- User can mute bubbles while keeping avatar state changes.

## Good example messages

- “Checking Gmail…”
- “Build passed.”
- “Waiting on OAuth.”
- “PocketPulse docs uploaded.”
- “Weekly usage is getting low.”

## Bad example messages

- Long explanations.
- Repetitive idle chatter.
- Fake emotional dependence.
- Anything implying the avatar has needs independent of the user.

## Web MVP UX

The Vercel app should:

- Explain the concept fast.
- Show an animated avatar preview.
- Let visitors switch states.
- Show sample local API payloads.
- Link to docs/specs.
- Make the project feel real even before desktop runtime exists.
