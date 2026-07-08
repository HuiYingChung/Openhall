# Bob Prompt 09B — Voice tour fixes: speech-aware dwell + replay

Manual testing of session 09's voice narration (demo mode, real browser) found two bugs. Scope is exactly these two fixes — no refactors, no drive-by changes, no new features.

Process requirements (non-negotiable):

- Work on a NEW branch named `voice-tour-fixes`, branched from `voice-tour` (or from `main` if the voice-tour PR has already been merged — check with `git log --oneline -3 main` for the narration commits). Never commit to `main` directly.
- Commit ALL your changes — `git status` must be clean when you finish. Do not push.
- The session log must include the ACTUAL pasted output (last lines) of `npm test`, `npm run lint`, and `npm run build` — not a claim that they passed.

## Bug 1 — Autoplay advances mid-sentence (dwell ignores speech length)

Symptom: with voice on, autoplay cuts some narrations off and jumps to the next artwork.

Root cause: in `src/viewer/tour.ts` (~line 450), `currentDwell = computeDwellSeconds(artwork?.label ?? wp.label ?? '')` is computed from the PLACARD LABEL length and capped at 12 s. `canAutoAdvance`'s 2× safety fallback then fires at 10–24 s — but a 60-word narration takes ~20–25 s to speak, so the "trap protection" fallback triggers during perfectly normal speech.

Fix — make the dwell speech-aware:

- `src/viewer/narration.ts`: add two pure exports.
  - `estimateSpeechSeconds(text: string): number` — English speech ≈ 150 wpm ≈ 12 chars/sec: `text.length / 12`, clamped to [5, 30].
  - `computeStopDwell(labelText: string, spokenText: string): number` — `spokenText` is `''` when voice is off or the stop has nothing to speak; returns `computeDwellSeconds(labelText)` in that case, otherwise `Math.max(computeDwellSeconds(labelText), estimateSpeechSeconds(spokenText))`. Import `computeDwellSeconds` from tour.ts — if that creates an import cycle, move `computeDwellSeconds` into narration.ts and re-export it from tour.ts so existing imports keep working.
- `src/viewer/tour.ts` (viewing-phase setup, ~line 445–460): compute the narration text ONCE before the dwell — `const spoken = this.voiceOn ? pickNarrationText(wp, this.gallery) : '';` — then `this.currentDwell = computeStopDwell(labelText, spoken);` and speak `spoken` if non-empty. The existing `canAutoAdvance(elapsed, currentDwell, isSpeaking)` call stays as is; with a speech-aware dwell its 2× fallback goes back to being genuine API-failure protection.

## Bug 2 — Play at the end of the tour doesn't replay

Symptom: after autoplay finishes (it turns itself off on the last stop), pressing Play again does nothing useful — it waits out the dwell on the final stop and switches itself off again. The only way to re-watch is Exit + re-enter.

Fix: in `setAutoplay` (`src/viewer/tour.ts` ~line 438), when turning autoplay ON while already at the last waypoint in the `viewing` phase, treat it as a replay — set the autoplay state/button as today, then `startWaypoint(0)`. Turning autoplay on anywhere else keeps the current behaviour (continue from here). The auto-off at tour end (the `setAutoplay(false)` call in `update()`) must not trigger the replay path — only the user turning it ON does.

## Applies everywhere by construction — prove it

`GalleryTour` is shared by the main app, demo mode, and the exported viewer, so these fixes reach all three. Prove it: run `npm run build:viewer` after the changes, then the full `npm test` — `tests/export-viewer.smoke.test.ts` boots the real rebuilt export bundle in Chromium and must stay green.

## Out of scope — do not build

Per-stop progress bars, dwell/speed settings UI, actual utterance-duration measurement via events (the estimate is enough), looping autoplay forever, any schema change.

## Verification

- Unit tests alongside the code: `estimateSpeechSeconds` clamps ([5, 30], monotonic in length), `computeStopDwell` matrix (voice off → label dwell; short label + long narration → speech wins; long label + short narration → label wins), replay behaviour (extend `src/viewer/tour.test.ts` following its existing setup patterns: autoplay finishing at the last stop turns itself off WITHOUT jumping to stop 0; a user `setAutoplay(true)` at the last stop restarts from stop 0 with autoplay still on).
- `npm test`, `npm run lint`, `npm run build` all green — paste the actual tail output of each into the session log.
- Manual, real browser (`npm run dev`, demo mode): full autoplay run with voice on — every narration finishes before advancing; at the end press Play → tour restarts from the first stop; toggle voice off mid-run → dwell falls back to label-length timing (no 25 s waits on silent stops).
- Log to `docs/bob-sessions/09b-voice-tour-fixes.md`. Small conventional commits (one per bug is fine). Do not push.
