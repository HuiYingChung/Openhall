# Bob Prompt 09C — Voice tour UX: default off, true pause, instant toggle, docent-framed artist intro

Four UX changes to the voice tour, from Huiying's manual testing and design decisions. Scope is exactly these four — no refactors, no drive-by changes, no new features beyond this list.

Process requirements (non-negotiable):

- Work on a NEW branch named `voice-tour-ux`, branched from `voice-tour-fixes` (or from `main` if that PR chain has already been merged — check `git log --oneline -3 main` for the 09B commits). Never commit to `main` directly.
- Commit ALL changes — `git status` must be clean when you finish. Do not push.
- The session log must include the ACTUAL pasted tail output of `npm test`, `npm run lint`, and `npm run build` — not a claim. If anything fails in your environment (e.g. the Chromium smoke tests when no browser is installed), say so explicitly in BOTH the log and your summary; never summarize a red run as green.

## 1. Voice defaults OFF

Design decision: unexpected audio is hostile on someone else's website; audio guides are opt-in (like museums). In `src/viewer/tour.ts` (~line 322): `this.voiceOn = false` regardless of support. The Voice button still renders whenever speechSynthesis is supported, in its OFF visual state (slash icon, `aria-pressed="false"`, aria-label "Turn voice narration on"). Nothing speaks until the user turns it on. Keep hiding the button entirely when speechSynthesis is unsupported.

## 2. Turning Voice ON speaks the current stop immediately

Bug found in testing: with voice on and speech playing, toggling voice off then immediately on again stays silent until the next artwork — the ON state only takes effect at the next `startWaypoint`.

Fix in `toggleVoice()` (`src/viewer/tour.ts` ~line 471), when the tour is in the `viewing` phase:

- Turning ON: compute this stop's label text and spoken text (same lookups `update()` uses — extract a small private helper like `currentStopTexts(): { labelText: string; spoken: string }` so the logic isn't duplicated); if spoken is non-empty, `narrator.speak(spoken)`, recompute `this.currentDwell = computeStopDwell(labelText, spoken)`, and reset `this.elapsed = 0` so autoplay never cuts the fresh narration.
- Turning OFF: keep the existing `narrator.cancel()`, and also recompute `this.currentDwell = computeStopDwell(labelText, '')` with `this.elapsed = 0` — a silenced stop must fall back to reading-time dwell, not sit out a 25 s speech estimate.
- Outside the `viewing` phase (travelling/pausing): state flag and button update only, exactly as today — `startWaypoint`'s normal flow handles the rest.

## 3. Pause pauses EVERYTHING; Play resumes

Design decision: the user's mental model is Pause = freeze the guided tour (movement AND voice), Play = continue from the freeze point. Voice remains a separate modality switch (sound on/off for the whole tour). After this change the two buttons are orthogonal: Play/Pause = time control, Voice = sound on/off.

- `src/viewer/narration.ts` → `TourNarrator`: add `pause()` and `resume()` wrapping `speechSynthesis.pause()` / `speechSynthesis.resume()`, plus a `get isPaused` backed by an internal flag (set by pause(), cleared by resume(), cancel(), and speak()). All guarded by `isSupported`.
- `src/viewer/tour.ts` → `setAutoplay(on)`:
  - `on === false` (user pressed Pause, or the internal end-of-tour auto-stop): if the narrator is speaking, `narrator.pause()` — the sentence freezes mid-word instead of playing out.
  - `on === true`: if `narrator.isPaused`, `narrator.resume()` before the existing dwell-clock reset. The replay-from-last-stop branch already calls `startWaypoint(0)`, which cancels speech — make sure cancel clears the paused flag so replay starts clean.
- Manual `next()`/`prev()`/`exit()`/`dispose()` keep cancelling outright (cancel also clears the paused flag) — navigating away from a stop never leaves a paused utterance behind.
- Known platform limitation: `speechSynthesis.resume()` is unreliable on some mobile browsers. Do NOT build detection/workarounds; the user can recover by toggling Voice off/on (which now re-speaks, per item 2). Note the limitation in a code comment.

## 4. Artist stop: docent framing instead of reading the card

Bug in feel: the artist intro stop reads `artist.statement` verbatim — the same text shown on screen — which sounds like TTS reading the card. Do not add any schema field or user input. Instead, in `pickNarrationText` (`src/viewer/narration.ts` ~line 71), for the `ARTIST_MESH_ID` case compose a docent framing from existing data:

- With a statement: `Welcome to {gallery.title}, an exhibition by {artist.name}. In the artist's own words: {statement}`
- Without a statement: `Welcome to {gallery.title}, an exhibition by {artist.name}.`
- Missing name: fall back to `Welcome to {gallery.title}.` (with the statement clause if present); no artist at all → `''` as today.

Plain string composition, no HTML. Update the function's doc comment fallback-chain description to match.

## Out of scope — do not build

Persisting the voice preference (localStorage or otherwise — a fresh tour starts off), resume-failure detection or mobile workarounds, per-utterance progress UI, changes to the Voice/Play button layout or icons beyond the default state, any schema change.

## Verification

- Unit tests alongside the code: default-off initial state; `pickNarrationText` artist-framing matrix (statement present/absent, name missing, no artist); toggle-ON-mid-stop speaks current narration and resets dwell via `computeStopDwell`; toggle-OFF recomputes label-only dwell; `TourNarrator.isPaused` lifecycle (pause sets, resume/cancel/speak clear). Follow the existing stubbing patterns in `src/viewer/narration.test.ts` and `src/viewer/tour.test.ts`.
- `npm test`, `npm run lint`, `npm run build` — paste actual tail output of each into the session log.
- Manual, real browser (`npm run dev`, demo mode): enter tour → silent, Voice button shows OFF; turn Voice on mid-stop → current stop speaks from the beginning; off then quickly on → speaks again (the reported bug); Pause mid-sentence → voice freezes → Play → continues mid-sentence (desktop Chrome/Edge); Next while paused → clean state, no ghost audio; artist stop → framed welcome, not a raw statement read; full autoplay run with voice on → still no mid-sentence advances.
- Log to `docs/bob-sessions/09c-voice-ux.md`. Small conventional commits (one per numbered item is fine). Do not push.
