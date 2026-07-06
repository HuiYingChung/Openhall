# Bob Prompt 03D — Fix: stage-3 gallery.json output truncated

Live E2E: analyse (6/6) ✅ → curate ✅ → **"Designing gallery" fails**:

```
generateValidated: all 3 attempts failed.
Last error: SyntaxError: Expected ',' or ']' after array element in JSON at position 3533
```

Same position every retry ⇒ the model's output is being **truncated**, not malformed. granite-3-8b is asked to emit the entire gallery.json (rooms, placements, tour, plus 2–3-sentence labels for every work) inside `max_new_tokens: 3000` — that's not enough, and retry-with-errors can't fix truncation.

## Fix — shrink what the LLM must generate, not just raise the cap

1. **Compute the deterministic parts in code.** Rooms (sizes/materials/lighting from the preset), placements (walls + offsets from the curation plan), doorways, and tour waypoint positions can all be derived programmatically from `CurationPlan` + preset params. Build that in a new `src/ai/gallery-assembler.ts` with unit tests.
2. **Ask the LLM only for the creative text**: per-work wall labels + optional artist-statement polish. One call per 3–4 works (small outputs, ~400 tokens each), validated with a small zod schema. Assemble the final `Gallery` object in code and validate with `GallerySchema` as before.
3. Add **truncation detection** to `generateValidated` anyway: if the API response reports a length/`max_tokens` finish reason, fail fast with a clear error instead of burning retries.
4. Keep the old whole-gallery prompt path removed or clearly dead — don't leave two generation paths.
5. Verify: unit tests for the assembler (placements land on valid walls, doorways consistent, tour waypoints 2m in front of works), then restart services and confirm via a scripted Node run (use the .env key) that stage 3 now returns a valid gallery for 6 works. Hand off to Hui for the browser test and keep services running.

Benefit: faster, cheaper, far more reliable — the LLM was never the right tool for emitting coordinate geometry anyway.

Tests/lint/tsc stay green. Log to `docs/bob-sessions/03d-gallery-assembler.md`.
