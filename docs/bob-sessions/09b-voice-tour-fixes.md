# Bob Session 09B — Voice tour fixes: speech-aware dwell + replay

**Prompt:** `docs/bob-prompts/BOB_PROMPT_09B.md`
**Branch:** `voice-tour-fixes` (branched from `voice-tour`)
**Date:** 2026-07-06
**Commits:** `32a24a6`, `0a075b4`

---

## Bugs fixed

### Bug 1 — Autoplay advances mid-sentence (dwell ignores speech length)

**Root cause:** `currentDwell = computeDwellSeconds(label)` was capped at 12 s.
The 2× safety fallback in `canAutoAdvance` fired at 10–24 s — well within a
normal 60-word narration (~20–25 s). Autoplay was cutting narrations short.

**Fix:**
- `computeDwellSeconds` moved from `tour.ts` into `narration.ts`; re-exported
  from `tour.ts` so all existing imports keep working without change.
- New `estimateSpeechSeconds(text: string): number` — `clamp(text.length / 12, 5, 30)`.
- New `computeStopDwell(labelText, spokenText): number` — returns
  `max(computeDwellSeconds(labelText), estimateSpeechSeconds(spokenText))` when
  `spokenText` is non-empty; falls back to label-only dwell when `spokenText`
  is `''` (voice off or nothing to speak), so silent stops are never
  stretched to 25+ seconds.
- `tour.ts` pausing→viewing: computes `spoken` once from `pickNarrationText`,
  calls `computeStopDwell(labelText, spoken)` for `currentDwell`, then speaks
  `spoken` if non-empty. The `canAutoAdvance` 2× safety is now genuine
  API-failure protection.

### Bug 2 — Play at end of tour does nothing useful

**Root cause:** `setAutoplay(on)` reset the dwell clock and updated the button,
but at the last waypoint that just meant the tour waited the dwell again then
auto-stopped again. No way to replay without Exit + re-enter.

**Fix:** In `setAutoplay(on: boolean)`, when turning autoplay ON while already
in `'viewing'` phase at the last waypoint (and `waypoints.length > 1`), call
`startWaypoint(0)` and return. The tour travels back to stop 0 with autoplay
still active. The internal `setAutoplay(false)` call in `update()` passes
`on = false`, so it never hits this branch — no accidental replay on auto-stop.

---

## Changes by file

### `src/viewer/narration.ts`
- Added module-level constants `AUTOPLAY_DWELL_MIN = 5`, `AUTOPLAY_DWELL_MAX = 12`.
- Moved `computeDwellSeconds` here (was in `tour.ts`). Exported.
- Added `estimateSpeechSeconds(text): number`. Exported.
- Added `computeStopDwell(labelText, spokenText): number`. Exported.

### `src/viewer/tour.ts`
- Import list: added `computeStopDwell`; added `export { computeDwellSeconds } from './narration'` re-export.
- Removed local `computeDwellSeconds` function and its `AUTOPLAY_DWELL_MIN` / `AUTOPLAY_DWELL_MAX` constants.
- Field `currentDwell` initializer changed from `AUTOPLAY_DWELL_MIN` (now gone) to literal `5`.
- Pausing→viewing block: computes `spoken` and `labelText` once, calls `computeStopDwell`; speaks `spoken` directly.
- `setAutoplay`: replay path when turning ON at last waypoint.

### `src/viewer/narration.test.ts`
- Import extended with `estimateSpeechSeconds`, `computeStopDwell`, `computeDwellSeconds`.
- 4 new tests for `estimateSpeechSeconds`: floor, monotonicity, ceiling, 60-word estimate.
- 4 new tests for `computeStopDwell`: voice off, speech wins, label wins, comparable.

### `src/viewer/tour.test.ts`
- Existing "stops (not loops)" test: added second `camera.position.x` assertion (no change to logic, documents intent).
- New test: `'user pressing Play at the last waypoint replays from stop 0'`.
- New test: `'setAutoplay(false) from internal auto-stop does not replay'`.

---

## Actual test output

```
> openhall@0.1.0 test
> vitest run --run

 ✓ src/viewer/decor.test.ts (33 tests) 25ms
 ✓ src/ui/placement-sanity.test.ts (14 tests) 23ms
 ✓ src/ai/gallery-assembler.test.ts (21 tests) 22ms
 ✓ src/ai/provider.test.ts (12 tests) 25ms
 ✓ src/viewer/collision.test.ts (12 tests) 8ms
 ✓ src/schema/gallery.schema.test.ts (14 tests) 28ms
 ✓ src/ui/app.viewer-entry.test.ts (3 tests) 15ms
 ✓ tests/export-chain.integration.test.ts (7 tests) 528ms
 ✓ src/viewer/narration.test.ts (22 tests) 22ms
 ✓ src/ui/feedback.test.ts (15 tests) 99ms
 ✓ src/ui/overlay.test.ts (10 tests) 8ms
 ✓ src/export/bundler.test.ts (34 tests) 291ms
 ✓ src/ui/generation-view.test.ts (12 tests) 211ms
 ✓ src/ui/app.links.test.ts (6 tests) 8ms
 ✓ src/ui/app.cache-key.test.ts (6 tests) 8ms
 ✓ src/viewer/room-builder.test.ts (9 tests) 228ms
 ✓ src/schema/analysis.schema.test.ts (5 tests) 11ms
 ✓ src/viewer/interactions.test.ts (9 tests) 321ms
 ✓ src/viewer/tour.test.ts (19 tests) 576ms
 ❯ tests/export-viewer.smoke.test.ts (4 tests) 336ms  ← pre-existing Chromium absent

 Test Files  1 failed | 19 passed (20)
       Tests  263 passed (267)
```

The smoke test failure is pre-existing (Playwright Chromium binary not installed in this environment). All 263 unit tests pass.

## Actual lint output

```
> openhall@0.1.0 lint
> eslint .
```
*(no output = no errors)*

## Actual build output

```
> openhall@0.1.0 build
> npm run build:viewer && tsc && vite build

> openhall@0.1.0 build:viewer
> tsc && vite build --config vite.viewer.config.ts && node scripts/copy-viewer.mjs

vite v5.4.21 building for production...
transforming...
✓ 23 modules transformed.
rendering chunks...
computing gzip size...
dist-viewer/viewer.js  742.28 kB │ gzip: 167.53 kB
✓ built in 1.78s
Copied viewer.js → public/assets/viewer.js
Wrote public/assets/viewer.meta.json

vite v5.4.21 building for production...
transforming...
✓ 47 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                          1.07 kB │ gzip:   0.61 kB
dist/assets/index-yl5KbEAA.css          8.41 kB │ gzip:   2.36 kB
dist/assets/sample-gallery-Bjq5TFw_.js  9.08 kB │ gzip:   3.50 kB
dist/assets/bundler-D7A7IqMB.js       103.28 kB │ gzip:  32.95 kB
dist/assets/index--_9d3sE9.js         658.90 kB │ gzip: 172.20 kB
✓ built in 2.45s

(!) Some chunks are larger than 500 kB after minification.
```

Large-chunk warning is pre-existing (Three.js + provider code in one chunk). No new warnings.

---

## Manual verification checklist (requires browser)

- [ ] `npm run dev` → demo mode → Tour → autoplay with voice on → every narration finishes before advancing
- [ ] At tour end, press Play → restarts from stop 0
- [ ] Toggle voice off mid-run → dwell falls back to label-length timing (no 25 s waits)
- [ ] Demo export zip → unzip → serve locally → same behaviour

---

*Built with IBM Bob.*
