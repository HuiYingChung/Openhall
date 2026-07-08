# Bob Prompt 10 — Show the writing room: honest generation transparency

The AI pipeline grew (labels + spoken narration per batch, deterministic assembly) but the generating screen still hides its richest act behind one "Designing gallery…" line. This task makes the real process visible. HARD RULE: everything shown must be REAL pipeline data as it happens — no fake steps, no theatrical delays, no invented text. The generation-view header comment ("never theatre") is the contract.

Read AGENTS.md, docs/PRODUCT_PLAN.md, docs/ROADMAP.md first.

Process requirements (non-negotiable):

- Work on the EXISTING branch `generation-show` (`git switch generation-show` — this prompt is committed on it). Never commit to `main`.
- Commit ALL changes; `git status` clean at the end. Do not push.
- Session log must paste the ACTUAL tail output of `npm test`, `npm run lint`, `npm run build`. If anything fails in your environment (e.g. Chromium smoke tests without a browser), say so explicitly in BOTH the log and your summary — never summarize a red run as green.

## 1. Pipeline events: `composeGalleryFromPlan` reports what it's doing

`src/ai/provider.ts` → `composeGalleryFromPlan` (~line 180): add an optional `onProgress?: (evt: ComposeProgressEvent) => void` parameter (last, defaulted — every existing caller keeps working). Export the event type:

```ts
export type ComposeProgressEvent =
  | { type: 'title' }
  | { type: 'labels-batch-start'; batch: number; totalBatches: number; artworkIds: string[] }
  | { type: 'labels-batch-done'; batch: number; totalBatches: number; entries: LabelsResponse }
  | { type: 'assembling' }
  | { type: 'retry'; step: 'title' | 'labels' };
```

Emit them at the natural points: before the title call, around each labels batch (with the REAL validated entries in `labels-batch-done`), and before `assembleGallery`. For `retry`: `generateValidated` (~line 98) gains an optional `onRetry?: () => void` last parameter, called exactly when the retry-on-invalid path triggers; `composeGalleryFromPlan` wires it to emit the retry event. Do NOT touch the analyze/curate call sites in the providers — scope is compose only.

## 2. Generation view: the writing act

`src/ui/generation-view.ts` + `src/ui/app.ts` (~line 1526, the "Designing gallery…" stage): between curation and the floor plan, show the writing work as it happens, following the existing view conventions (`.oh-gen-*` classes in ui.css, method-based API like `showCuration`, everything escaped with `escapeHtml` — the XSS test at generation-view.test.ts ~line 162 is the pattern to extend).

- `labels-batch-start`: highlight the thumbnails of that batch's artworks (reuse the existing thumb treatment from Act 1).
- `labels-batch-done`: under each artwork in the batch, reveal the REAL opening of both texts (first ~60 chars + ellipsis): one line marked as the wall label, one as the spoken narration. Distinguish them with two small inline SVG icons (a plaque rectangle / the speaker glyph like tour.ts's svgVoiceOn) — NO emoji (site rule).
- `assembling`: progress line reads "Composing rooms deterministically from the curator's plan…" — the geometry is computed, not AI-generated; say so honestly.
- `retry`: show one subdued transient line: "The model's output didn't validate — retrying once." It must not block or alarm; it disappears when the next event arrives. Honest failure is part of the show.
- Respect `prefers-reduced-motion`: any reveal animation becomes an instant show (see `prefersReducedMotion` exported from src/ui/overlay.ts).

## 3. Model attribution

During generation, one small caption line under the progress text names who is actually working, per stage: the vision model during Act 1 analysis, the text model during curation/writing. Sources of truth: `WATSONX_VISION_MODEL` / `WATSONX_TEXT_MODEL` exports in src/ai/watsonx.ts for the watsonx route; the user-configured model string for the OpenAI-compatible route. Format like `watsonx · ibm/granite-3-8b-instruct`. Never hardcode a model name in the UI — import or read the configured value, so the caption can never lie.

## 4. Out of scope — do not build

Token-level streaming, editing text from the generation screen, changes to the viewer bundle / export / schema, progress events for analyze/curate internals, sound effects, retry-count settings. App chrome only.

## Verification

- Unit tests: `composeGalleryFromPlan` event sequence with a mocked `generate` (title → batch-start/done pairs with correct batch numbering and real entries → assembling; a mock that fails validation once emits exactly one retry); `generateValidated` calls `onRetry` on the retry path only; generation-view writing act renders real text escaped (extend the XSS pattern); model caption shows the configured string.
- `npm test`, `npm run lint`, `npm run build` — paste actual tail output into the session log.
- Manual, real browser (`npm run dev`, real key, 2–3 images): watch a full generation — batches highlight in order, real label/narration openings appear, model caption correct for each stage, floor plan still renders, review screen unaffected. Demo mode (no key) must be unaffected — it skips generation entirely.
- Log to `docs/bob-sessions/10-generation-show.md`. Small conventional commits (pipeline events / view act / attribution is a fine split). Do not push.
