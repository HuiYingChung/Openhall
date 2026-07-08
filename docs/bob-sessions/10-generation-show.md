# Session 10 — Generation transparency (Bob, completed by Claude)

**Prompt:** `docs/bob-prompts/BOB_PROMPT_10.md`
**How this session ended:** Bob's tokens ran out mid-session — the implementation
was written (527 insertions across 8 files) but nothing was committed and no log
was produced. Claude reviewed the uncommitted tree, fixed three defects, and
completed the session. This log is written by Claude; authorship of the bulk of
the implementation is Bob's.

## What Bob built (verified against the prompt)

- `ComposeProgressEvent` type + `onProgress` emission in `composeGalleryFromPlan`
  (title / labels-batch-start with artwork IDs / labels-batch-done with the real
  validated entries / assembling), `generateValidated` refactored to an
  `llmFn(extraContext)` shape with an `onRetry` hook — a larger refactor than the
  prompt asked for, but all call sites updated and the shape is sound.
- Writing act in `generation-view.ts`: batch thumbnails highlight, real
  label/narration openings revealed with plaque/speaker inline SVGs, transient
  retry notice, `prefers-reduced-motion` respected, everything escaped
  (XSS test extended). ~100 lines of new view tests.
- Per-stage model attribution in `app.ts`, read from `WATSONX_VISION_MODEL` /
  `WATSONX_TEXT_MODEL` / the configured OpenAI-compatible model — never hardcoded.

## Defects found in acceptance (fixed by Claude)

1. **Retry count violated AGENTS.md rule 4.** `generateValidated` defaulted to
   2 retries and the compose call sites hardcoded `2` — the architecture rule is
   retry ONCE then fail loudly. Reverted to 1 (default + call sites).
2. **The exhibition title went through JSON validation.** Real models answer the
   title prompt with plain text; `JSON.parse` would reject every real reply,
   burn the retry, and crash past the mocks in tests (`.match` on undefined).
   Title is now a direct call with a try/catch fallback to "New Exhibition",
   and the retry event type narrowed to `step: 'labels'` — the one structured
   output in this path.
3. **Progress ran backwards.** The `assembling` event fires BEFORE the label
   batches (geometry is deterministic and built first), but app.ts mapped it to
   82% after setting batches at 65+. Remapped honestly: title 58% → assembling
   62% ("Composing rooms deterministically from the curator's plan…") →
   batches 65–82%. Also fixed batch percentage to start at its floor and a test
   fixture whose 3-char labels violated the schema's own min(10).

## Actual `npm test` output (tail)

```
 Test Files  20 passed (20)
      Tests  304 passed (304)
```

## Actual `npm run lint` output

```
> openhall@0.1.0 lint
> eslint .
```
*(no output = no errors; exit 0)*

## Actual `npm run build` output (tail)

```
dist-viewer/viewer.js  742.28 kB │ gzip: 167.53 kB
✓ built in 2.42s
```

## Follow-up: the happy path was too quiet (Huiying's real-key run)

Huiying watched a real generation and reported: nothing failed, so the show
felt thin — the design had put all its beats on the failure path. Claude added
four honest happy-path beats (all existing pipeline data, no theatre):
`title-done` reveals the actual chosen title ("The AI named your exhibition:
…"); every `labels-batch-done` now reports its validation outcome ("validated
on first try" / "after one retry") — quiet success is information too; a new
`assembled` event surfaces the real deterministic-assembly numbers (rooms,
dimensions, placements, tour stops); text snippets widened 60 → 120 chars.
311/311 after (7 new provider-event tests + 4 new view tests, XSS pattern
extended to the title reveal).

## Honest gaps

- The prompt's manual check — a real-key generation run watching the writing
  act live — has NOT been done yet (Bob had no key access; Claude verified the
  view logic via the jsdom suite instead). Huiying should watch one real
  generation (2–3 images) before merging: batches highlight in order, real
  text appears, model caption correct per stage, no backwards progress bar.
- Demo mode skips generation entirely and is covered by the existing suites
  (304/304 including the Chromium export smoke tests).
