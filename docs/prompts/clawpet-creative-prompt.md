# Clawpet Asset Generation Prompt — Creative Mode

For use inside the `clawpet-generate` skill (§7). This version gives the agent
real creative latitude on character design while locking the technical
parameters that the runtime needs.

The split is deliberate:
- **HARD REQUIREMENTS** are non-negotiable. Wrong format = broken bundle.
- **CREATIVE BRIEF** is yours to interpret. Surprise the user.

---

## The Prompt

```
You are designing a unique Clawpet — a personalized pixel-art companion that
will live on the user's desktop and react to their AI assistant working.

This pet must feel like THIS user's pet. Not a stock mascot, not a default
fox. A small creature that someone could plausibly fall in love with after
seeing it once. Read their SOUL.md and agent name carefully — the pet is a
visual translation of who their AI is becoming.

═══════════════════════════════════════════════════════════════
HARD REQUIREMENTS — these define a valid Clawpet, no exceptions
═══════════════════════════════════════════════════════════════

FORMAT
  • 128×128 pixel-art canvas, exported at 512×512 PNG (4× nearest-neighbor)
  • Fully transparent background — alpha 0 outside silhouette
  • Single character, centered, no scene, no ground line, no text
  • Hard 1-pixel outline (4px after upscale) in a darker variant of the
    body's dominant hue — never pure black unless the pet IS black
  • 8–12 unique colors total, palette locked across all 6 states, including accessories
  • Cel-shaded with directional light from the upper-left — no smooth
    gradients, no anti-aliasing, no soft brushes
  • Chibi proportions: head dominates roughly 40% of vertical space
  • Choose and lock pose framing up front (front-facing or 3/4 front) and keep it consistent

SIX STATES, ALL REQUIRED — same character throughout
  idle      — neutral, alive, watching
  thinking  — contemplative, processing
  focused   — locked-in, working
  happy     — celebratory, warm
  alert     — surprised, attention-spike
  sleepy    — drowsy, low-energy

═══════════════════════════════════════════════════════════════
CREATIVE BRIEF — your job, do it well
═══════════════════════════════════════════════════════════════

SPECIES — invent it.
  Don't default to "small fox" or "baby dragon" because those are easy.
  If you are generating an established character with a locked identity, do not use this prompt as-is; use a character-specific prompt instead.
  The species should feel like an answer to the question "what creature
  would naturally embody this soul?" Real animals are fine. Imagined
  hybrids are better when justified.

PALETTE — earn the colors.
  Pull a dominant emotional hue from the SOUL.md and build outward.
  Avoid default orange-fox / cyan-slime combos already in use by Dawn and Pip.
  Memorable Clawpets have one describable accent.

SILHOUETTE — make it readable at thumbnail size.
  The pet will be seen at 1/4 size on a desktop. If you can't recognize
  it as a black silhouette, redesign. Pick ONE signature feature and lean on it.

PERSONALITY EXPRESSION — let it show.
  Across the six states, this creature should read as an individual.

ACCESSORIES (use sparingly, only where listed)
  • alert: a single 4-pointed star OR exclamation spark above the head
  • happy: small heart sparkle near the body (one or two, never more)
  • sleepy: one small blue "Z" drifting upward from above the head
  • thinking: small thought bubble OR paw-to-chin gesture (pick one, not both)
  • other states: no accessories

  Important: accessory colors must come from the same locked palette.
  Do not invent extra colors later during motion generation.

═══════════════════════════════════════════════════════════════
WHAT TO AVOID
═══════════════════════════════════════════════════════════════

  ✗ Generic blob mascots
  ✗ Pure black outlines on non-black pets
  ✗ Backgrounds, ground lines, shadow circles baked into the PNG
  ✗ Inconsistent palette between frames
  ✗ Anti-aliased edges or smooth gradients
  ✗ Text, symbols, signatures
  ✗ Anything resembling Dawn or Pip unless explicitly requested
  ✗ Realistic proportions
  ✗ Detail noise that hurts readability

═══════════════════════════════════════════════════════════════
PROCESS
═══════════════════════════════════════════════════════════════

1. Read SOUL.md and the agent name. Identify dominant tone and 2–3 traits.
2. Decide species, signature silhouette feature, palette, and pose framing before generating.
3. Generate idle FIRST. This is the **character anchor**.
4. Generate the remaining states to match the character anchor.
5. For animation, each state's frame 0 becomes that state's **motion anchor**.
6. If a frame drifts, regenerate only that frame.

═══════════════════════════════════════════════════════════════
DELIVERABLE
═══════════════════════════════════════════════════════════════

A creature whose owner will recognize themselves in it.

Show me you understood the soul, not just the requirements.
```

---

## How to use this prompt

1. Inject `SOUL.md` as `SOUL.md INPUT:`.
2. Inject the agent name as `AGENT NAME:`.
3. Inject the chosen frame plan as `FRAME PLAN:`.
4. After deciding species/palette/silhouette/framing, lock them into a base prompt string stored in `avatar.json.seed`.
5. For subsequent frame calls, append only state delta and frame delta — never re-roll species or palette.
