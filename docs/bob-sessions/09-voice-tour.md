# Bob Session 09 — AI voice narration for tour mode

**Prompt:** `docs/bob-prompts/BOB_PROMPT_09.md`
**Date:** 2026-07-06
**Commits:** `b9060b6`, `82ddff3`

---

## What was built

Spoken narration during guided tour mode using the browser's built-in
`speechSynthesis` API (zero new dependencies). Works in both the main app and
the exported static bundle.

---

## Changes by file

### `src/schema/gallery.schema.ts`
Added `narration: z.string().max(600).optional()` to `ArtworkSchema`.
Backwards-compatible: every existing gallery.json (including prior exports)
continues to validate without modification.

### `src/ai/prompts/labels.prompt.ts`
Extended the LLM instructions to request a `narration` field alongside each
`label`. Narration prompt: 2–4 sentences, warm conversational docent voice,
~60 words max, written to be heard aloud. Header comment updated to reflect the
new ~800-token budget per batch.

### `src/ai/gallery-assembler.ts`
`LabelEntrySchema` gains `narration: z.string().optional()` — optional so a
model omission degrades gracefully without burning a retry.

### `src/ai/provider.ts`
- Batch size reduced from 4 → 3 to stay reliable at the doubled token budget.
- `labelMap` now stores `narration` alongside `label` and `artistStatement`.
- `composeGalleryFromPlan` threads `narration` into the assembled artwork
  records using the same spread pattern as `artistStatement`.

### `src/demo/sample-gallery.json`
Added `narration` to all 8 artworks. Each is 2–4 spoken sentences in a warm
docent voice, grounded only in facts from `SOURCES.md` — no invented biography.

### `src/viewer/narration.ts` *(new)*
- `TourNarrator` — thin wrapper around `speechSynthesis`. `speak(text, onEnd)`,
  `cancel()`, `get isSpeaking`, `get isSupported`. No voice selection UI;
  uses browser default.
- `pickNarrationText(wp, gallery): string` — pure fallback chain:
  - Artist stop → `artist.statement ?? ''`
  - Artwork stop → `artwork.narration ?? artwork.label ?? ''`
  - Unknown id / no id → `''` (skip speech)
- `canAutoAdvance(dwellElapsed, nominalDwell, speaking): boolean` — gates
  autoplay advancement. Requires `dwellElapsed >= nominalDwell && !speaking`.
  Safety fallback: advance at `2 × nominalDwell` regardless of speaking state
  (prevents trapping the visitor if the browser never fires an `end` event).

### `src/viewer/tour.ts`
- Imports `TourNarrator`, `pickNarrationText`, `canAutoAdvance` from
  `./narration`.
- Added `svgVoiceOn()` / `svgVoiceOff()` inline SVG helpers.
- `createButtons` gains an optional `onToggleVoice` parameter (null = omit
  the button when unsupported). Returns `voiceBtn` alongside `playBtn`.
- `GalleryTour` gains `narrator: TourNarrator`, `voiceOn: boolean`,
  `voiceBtn: HTMLButtonElement | null`.
- Constructor: creates narrator, checks `isSupported`, sets `voiceOn = true`
  by default, conditionally passes the toggle callback to `createButtons`.
- `update()` — on entering `'viewing'` phase, calls `pickNarrationText` and
  `narrator.speak()` if voice is on and text is non-empty. Autoplay check now
  uses `canAutoAdvance(elapsed, currentDwell, narrator.isSpeaking)`.
- `toggleVoice()` — flips `voiceOn`, cancels if turning off, updates button
  SVG and `aria-pressed`.
- `startWaypoint()` — calls `narrator.cancel()` before travelling.
- `dispose()` — calls `narrator.cancel()`.
- Pausing autoplay (Play/Pause button) does **not** cancel the utterance.
- Exit always cancels via `dispose()`.

### `src/viewer/narration.test.ts` *(new)*
14 tests:
- `pickNarrationText`: narration present, fallback to label, empty label, unknown
  id, undefined id, artist stop with statement, artist stop without statement,
  artist stop with no artist block.
- `canAutoAdvance`: dwell not elapsed, elapsed but speaking, elapsed and quiet,
  safety fallback at 2× dwell while speaking, exactly at 2× dwell, zero dwell.

### `src/ai/provider.test.ts`
Extended `composeGalleryFromPlan` tests:
- First test now asserts `aw1.narration === 'Narration one.'` and
  `aw2.narration === undefined` (graceful model omission).
- Batch-size test updated from 4 → 3 with matching mock payloads.

### `src/schema/gallery.schema.test.ts`
Four new tests:
- `accepts artwork with optional narration field` — strips narration from
  all artworks then adds it back to index 0 only, asserts index 1 is
  `undefined`.
- `treats artwork narration as optional (absent is valid)` — validates
  a copy with all narration fields removed.
- `rejects narration exceeding 600 characters`.
- `sample-gallery.json narration fields all pass the 600-char limit`.

---

## Test results

```
Test Files  19 passed (20)
Tests       253 passed (257)
```

The 4 skipped counts belong to `export-viewer.smoke.test.ts` — that suite
requires a Playwright Chromium installation (`npx playwright install chromium`)
which is absent in this environment. It was failing before this session and is
unrelated to narration work.

## Build

```
npm run build  ✓  (viewer.js 741 kB gzip 167 kB; no new warnings)
```

---

## Manual verification checklist (requires browser)

- [ ] `npm run dev` → demo mode → Tour → narration audible at first stop
- [ ] Voice toggle button appears between Play and Prev
- [ ] Toggle Voice off mid-sentence → immediate silence
- [ ] Next during speech → old utterance cut, new one plays on arrival
- [ ] Autoplay full run → no mid-sentence advances, ends after last stop
- [ ] Exit during speech → silence
- [ ] Narrow window (<768px) → bottom-sheet layout still correct with extra button
- [ ] Demo export zip → unzip → serve locally → tour narration works there too

---

*Built with IBM Bob.*
