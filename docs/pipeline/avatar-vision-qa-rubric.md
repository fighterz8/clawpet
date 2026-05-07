# Avatar vision QA rubric

Vision QA catches subjective issues deterministic metrics cannot reliably judge.

Default behavior:

- Deterministic QA remains the blocking baseline.
- Vision QA is provider-backed and optional until calibrated.
- Local/CI runs may use `provider: mock` or skip vision QA.
- Real future provider targets: OpenAI `gpt-image-2` and Gemini `gemini-3.1-flash-image-preview`.

Review input should usually be the post-build contact sheet, because that represents the frames the overlay actually displays.

## Scored dimensions

Each dimension should produce a score from `0.0` to `1.0` plus short failure reasons.

1. **Identity consistency**
   - Same character across all six states.
   - Same species, silhouette, palette, outline, proportions, camera angle.

2. **Expression readability**
   - Each state reads clearly: idle, thinking, focused, happy, alert, sleepy.
   - Expression changes should not redesign the character.

3. **Animation coherence**
   - Frames feel like motion, not camera shake.
   - Feet/anchor remain stable unless intentional.
   - Accessories/cues do not cause recentering or shrinking.

4. **Thumbnail charm/readability**
   - Character is recognizable at small overlay size.
   - Face/core/signature feature remain readable.

5. **Artifact absence**
   - No text, watermark, neighboring sprite bleed, extra characters, background leakage, or accidental scene objects.

## Suggested JSON result

```json
{
  "ok": true,
  "score": 0.92,
  "threshold": 0.82,
  "provider": "mock",
  "reviewTarget": ".avatar-pipeline/job/contact-sheet.generated.png",
  "dimensions": {
    "identityConsistency": { "score": 0.95, "failures": [] },
    "expressionReadability": { "score": 0.9, "failures": [] },
    "animationCoherence": { "score": 0.88, "failures": [] },
    "thumbnailReadability": { "score": 0.93, "failures": [] },
    "artifactAbsence": { "score": 0.96, "failures": [] }
  },
  "repairQueue": []
}
```

## Blocking policy

Initial policy:

- Deterministic QA failure blocks build/push.
- Vision QA failure creates repair queue and should block auto-push unless the user explicitly approves.
- Use `--skip-vision-qa` or `provider: mock` for deterministic local tests.
