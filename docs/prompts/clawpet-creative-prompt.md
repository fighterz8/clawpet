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
  • 8–12 unique colors total, palette locked across all 6 states
  • Cel-shaded with directional light from the upper-left — no smooth
    gradients, no anti-aliasing, no soft brushes
  • Chibi proportions: head dominates roughly 40% of vertical space

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
  The species should feel like an answer to the question "what creature
  would naturally embody this soul?" Real animals are fine. Imagined
  hybrids are better when justified. A few directions worth exploring:

    • familiar mammals reimagined (otter that looks like a sage,
      raccoon that looks like a tinkerer, fennec with oversized ears)
    • tiny mythological creatures (kodama, tiny golem, baby phoenix,
      domesticated wisp)
    • soft invertebrates (axolotl, cuttlefish, tardigrade, snail with
      a glowing shell)
    • plant-creature hybrids (mushroom sprite, moss-back lizard,
      acorn-headed forest spirit)
    • impossible-but-believable (cloud cat, paper-lantern moth, ink
      blob with eyes, gem-cored slime)

  Pick whatever the soul actually suggests. If the soul reads like a
  careful researcher, don't draw a hyperactive puppy. If it reads scrappy
  and chaotic, don't draw a stoic owl.

PALETTE — earn the colors.
  Pull a dominant emotional hue from the SOUL.md (warm/cool/saturated/
  muted) and build outward. Avoid the obvious orange-fox / cyan-slime
  combos already in use by Dawn and Pip. Memorable Clawpets have
  unexpected accent colors — a sage-green creature with hot-pink ear
  interiors; a deep-purple shadow pet with one bright gold eye; a cream
  creature with deep teal markings. The accent should be the thing
  someone describes when they tell a friend about it.

SILHOUETTE — make it readable at thumbnail size.
  The pet will be seen at 1/4 size on a desktop. If you can't recognize
  it as a black silhouette, redesign. One memorable shape feature is
  worth ten subtle ones. Big ears, a curled tail, a tall hat, a trailing
  ribbon, a glowing core — pick ONE signature element and lean on it.

PERSONALITY EXPRESSION — let it show.
  Across the six states, this creature should read as an individual.
  Examples of personality choices worth making:

    • Does it sit upright or hunch? (alert vs. relaxed pets feel different)
    • What does it do with its hands/paws/tendrils when thinking?
    • Does it show teeth when happy, or close its eyes in a soft smile?
    • What's its "alert" tell? Wide eyes, raised hackles, glow flare,
      ear-spike, mouth-open?
    • In sleepy mode, does it slump, curl, lean, or float lower?

  Pick distinctive answers. Boring choices = forgettable pet.

ACCESSORIES (use sparingly, only where listed)
  • alert: a single 4-pointed star OR exclamation spark above the head
  • happy: small heart sparkle near the body (one or two, never more)
  • sleepy: one small blue "Z" drifting upward from above the head
  • thinking: small thought bubble OR paw-to-chin gesture (pick one,
    not both)
  Other states: no accessories. Cleaner is better.

═══════════════════════════════════════════════════════════════
WHAT TO AVOID
═══════════════════════════════════════════════════════════════

  ✗ Generic "kawaii blob with two dots for eyes" — be specific
  ✗ Pure black outline on a non-black pet — use a dark hue variant
  ✗ Backgrounds, ground lines, shadow circles in the PNG — keep alpha clean
  ✗ Inconsistent palette between frames — lock 8–12 colors and stick to them
  ✗ Anti-aliased edges or smooth gradients — pixel art is HARD edges
  ✗ Text, symbols, watermarks, signatures
  ✗ Anything resembling Dawn (small orange dragon) or Pip (cyan slime)
    unless the user explicitly asks for that aesthetic
  ✗ Realistic proportions — chibi only
  ✗ Asymmetric "weird for weird's sake" designs that fight readability

═══════════════════════════════════════════════════════════════
PROCESS
═══════════════════════════════════════════════════════════════

1. Read SOUL.md and the agent name. Identify dominant tone and 2–3 traits.
2. Decide the species and the ONE signature silhouette feature. Write
   them down internally before generating anything — this anchors
   consistency across frames.
3. Build the palette. Lock it. Same hex codes across all six states.
4. Generate idle FIRST. This is the reference frame. Every other state
   must match its proportions, palette, and lighting.
5. Generate the remaining states using idle as the visual anchor — same
   pose framing, same palette, only the expression and posture change.
6. If a frame drifts off-model from idle, regenerate that single frame.
   Don't drag the whole bundle off-style chasing a fix.

═══════════════════════════════════════════════════════════════
DELIVERABLE
═══════════════════════════════════════════════════════════════

A creature whose owner will recognize themselves in it. Someone seeing
this on their desktop should feel "yeah, that's mine" within the first
five seconds.

Show me you understood the soul, not just the requirements.
```

---

## How to use this prompt

In the skill's prompt-assembly step (§7 of `clawpet-generate-SKILL.md`):

1. Inject the user's `SOUL.md` content as a single fenced block right after
   the prompt, labeled `SOUL.md INPUT:`.
2. Inject the agent name as `AGENT NAME:`.
3. Inject the chosen tier (A/B/C) frame plan as `FRAME PLAN:`.
4. After the agent decides species/palette/silhouette, **lock those choices
   into a base prompt string** that's stored in `avatar.json.seed`.
5. For each subsequent frame call, append only the state delta and frame
   delta (§5 motion specifics) — never re-roll the species or palette.

This is what makes the pet personalized AND stable: the creative decisions
happen ONCE per pet, and after that every frame is a tight consistency play
against the locked base.
