# Bob Prompt 09 — AI voice narration for tour mode

Read AGENTS.md, docs/PRODUCT_PLAN.md, and docs/ROADMAP.md first. This task adds ONE feature: spoken narration during tour mode, using AI-written narration text and the browser's built-in Web Speech API (`speechSynthesis`). No other features, no refactors, no drive-by changes.

Why: tour autoplay is the demo centrepiece and the accessibility story. The AI already writes placard-tone wall labels; this adds a spoken-tone narration per artwork, read aloud at each tour stop. It must work in BOTH the main app and the exported bundle — `GalleryTour` (src/viewer/tour.ts) is shared by both, so implement narration inside it.

Hard constraints (from AGENTS.md — do not violate):

- The viewer bundle stays framework-free and zero-dependency. `speechSynthesis` is a browser built-in — no TTS library, no cloud TTS, no audio files in the zip, no new dependencies at all.
- All viewer UI uses inline styles. No emoji glyphs anywhere — icons are inline SVG (see svgPlay/svgPause in tour.ts).
- All LLM outputs validated with zod; retry-once-on-invalid already exists via generateValidated — do not weaken it.
- Do NOT touch: src/export/bundler.ts, worker/, controls.ts, collision.ts, room-builder.ts.

## 1. Schema: optional `narration` on Artwork

`src/schema/gallery.schema.ts` → `ArtworkSchema` (~line 46, next to `artistStatement` at ~57):

- Add `narration: z.string().max(600).optional()` — spoken-style text for the tour, distinct from the placard `label`.
- Backwards compatible: every existing gallery.json (including user exports made before this change) must keep validating. Optional field only; no other schema edits.

## 2. AI pipeline: labels round also writes narration

- `src/ai/prompts/labels.prompt.ts` → `buildLabelsPrompt`: extend the response format with `"narration": "<2–4 sentences, conversational docent voice, ~60 words max>"` per artwork. Add rules: narration is what a gallery guide would SAY while the visitor looks at the work — warmer than the label, no coordinates, no invented biography (same grounding rule as labels). Narration is required for each artwork in the response.
- `src/ai/gallery-assembler.ts` → `LabelEntrySchema` (~line 93): add `narration: z.string().optional()` (optional in the schema so a model omission degrades gracefully instead of burning a retry).
- `src/ai/provider.ts` (~lines 196–218): thread `narration` through `labelMap` onto the assembled artworks exactly like `artistStatement`.
- Token budget: labels batches are sized for ~400 output tokens (see labels.prompt.ts header comment). Narration roughly doubles that — reduce batch size from 3–4 to 2–3 works per call if needed to stay reliable; do not raise max tokens blindly.

## 3. Demo gallery: hand-written narration

`src/demo/sample-gallery.json`: add a `narration` field to all 8 artworks — 2–4 spoken sentences each, grounded in the same facts as the existing labels (these are documented Met CC0 works; factual statements consistent with `src/demo/SOURCES.md` are fine). Demo mode is what the video records; it must sound curated.

## 4. Viewer: speak at each tour stop

New file `src/viewer/narration.ts` (viewer bundle — inline styles, zero deps):

- A thin `TourNarrator` wrapper around `speechSynthesis`: `speak(text, onEnd)`, `cancel()`, `get isSupported()` (`'speechSynthesis' in window` and at least one voice or the voiceschanged event pending — treat "no voices yet" as supported and let the browser pick its default). Use default voice and rate; no voice-selection UI.
- Pure, unit-testable helper `pickNarrationText(wp, gallery): string` implementing the fallback chain: artist stop → `artist.statement ?? ''`; artwork stop → `narration ?? label ?? ''`; empty string means "skip speech for this stop". Mirror the lookup logic `showLabel()` uses (tour.ts ~479–491), including the `ARTIST_MESH_ID` case.

`src/viewer/tour.ts` integration:

- HUD: add a Voice toggle button in `createButtons` (~line 142) between Play and Prev. Inline-SVG speaker icon (on) / speaker-with-slash (off), with `aria-label` and `aria-pressed`. Voice defaults ON when supported. If `speechSynthesis` is unsupported, do not render the button — tour behaves exactly as today.
- Speak when a stop enters `viewing` (where `showLabel()` is called in `update()`, ~line 421): if voice is on and `pickNarrationText` is non-empty, speak it.
- Cancel speech in `startWaypoint()` (leaving a stop), `exit()`, `dispose()`, and when the user toggles voice off mid-utterance. Prev/Next therefore cut the current utterance and the new stop speaks on arrival — no overlapping voices, ever.
- Autoplay coordination: while voice is on and speaking, autoplay must not advance mid-sentence. Advance when BOTH the dwell (`computeDwellSeconds`) has elapsed AND the utterance has ended. Keep the decision logic a pure function (e.g. `canAutoAdvance(dwellElapsed, speaking): boolean`) and unit-test it. If speech never fires an end event (browser quirk), fall back to advancing at `2 × currentDwell` — never trap the visitor.
- Pausing autoplay (Play/Pause button) does NOT cancel the current utterance; it only stops auto-advancing. Exit always cancels.

## 5. Out of scope — do not build

Voice/rate/pitch/language selection UI, narration on the click-inspect panel, narration editing UI in the labels review screen, cloud TTS of any kind, audio files in the export zip, captions/karaoke highlighting. If any of these seems necessary, stop and flag it instead of building.

## Verification

- Unit tests alongside the code: `pickNarrationText` fallback chain (narration → label → empty; artist stop; unknown artworkId), `canAutoAdvance` matrix, narration threading in provider labels application (extend the existing provider.test.ts pattern at ~line 114), schema accepts/omits `narration`, labels-prompt output format mentions narration.
- `npm test` (all suites — including tests/export-chain.integration.test.ts and tests/export-viewer.smoke.test.ts, which boot the real exported bundle in Chromium), `npm run lint`, `npm run build` (runs tsc + both builds) all green. Run `npm run build:viewer` after touching tour.ts/narration.ts — the smoke suite tests the rebuilt bundle.
- Manual, in a real browser (`npm run dev`): demo mode → Tour → narration audible at each stop; toggle Voice off mid-sentence → immediate silence; Next during speech → old utterance cut, new one plays; autoplay full run → no mid-sentence advances, ends after last stop; Exit during speech → silence; narrow window (<768px) → bottom-sheet layout still correct with the extra button.
- Manual, exported bundle: generate demo export zip → unzip → serve locally (`npx serve`) → tour narration works there too, zero console errors.
- Log to `docs/bob-sessions/09-voice-tour.md`. Small conventional commits (schema/pipeline, demo narration, viewer feature is a fine split), commit without being asked. Do not push.
