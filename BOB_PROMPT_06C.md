# Bob Prompt 06C — Fix: tour entry/exit leaves stale UI (button gone, Paused filter over tour, orphan info panel)

Manual E2E found three related state bugs around tour start/exit. All exist in BOTH `src/ui/app.ts` and `src/viewer/viewer-entry.ts` (export viewer) unless noted.

## Bug 1 — Tour button never returns after Exit Tour

The Tour button is `.remove()`d when clicked, but tour `onExit` never re-mounts it (app.ts desktop path; viewer-entry desktop path only re-mounts on the touch branch). After one tour, the feature is unreachable until F5.

Fix: in every tour `onExit`, re-mount the tour button (desktop and touch). In app.ts reuse the existing button-mount logic (extract if needed); in viewer-entry call `mountTourButton()` unconditionally on exit.

## Bug 2 — Starting a tour from the Paused overlay leaves the dark filter over the whole tour

Repro: walk → Esc (Paused overlay mounts) → click the Tour button (it floats above the overlay). The overlay's dismiss only fires on the `lock` event, and a tour never locks — so the dim layer + "Paused" text sit on top of the entire tour; artworks are barely visible. It only clears at Exit Tour when `lock()` fires.

Fix: track the currently-mounted relock overlay's `dismiss` in the enclosing scope (e.g. `let activeRelockDismiss: (() => void) | null`), set it when mounting, clear on dismiss. The Tour button handler (and `mountTourStartOverlay`'s) calls it before starting the tour. Don't reach into the DOM by id — use the tracked closure.

Note: the armed `onRelock` listener from that overlay will fire at Exit Tour when `lock()` succeeds — make sure that path stays harmless (dismiss() is idempotent; it should dismiss-if-mounted, then re-arm wireRelock as it already does).

## Bug 3 — Inspect info panel stays open on top of a running tour

If the info panel is open (or dolly mid-flight) when a tour starts, nothing closes it; the panel floats over the tour until manually closed after exit.

Fix: give `ArtworkInteractions` a public `close(): void` that closes the panel / cancels the pending dolly state safely (reuse the private `closePanel`, guard dolly flags), and call it in every tour-start handler before creating `GalleryTour`.

## Verification (manual, demo mode; repeat key ones in the exported bundle)

1. Walk → Esc → Paused → click Tour → **no dark filter during tour**, label cards fully readable → Exit Tour → walking, **Tour button is back** → start tour again (must work repeatedly)
2. Walk (locked) → Tab+Enter on Tour button → tour clean → Exit → button back → Esc → Paused → click → resume (relock wiring intact)
3. Click artwork → info panel open → start tour (Esc then click Tour) → **panel is closed** during tour → Exit → walking normal
4. Touch fallback unaffected: tour exit still re-shows Start Tour
5. `npm test` (add unit tests where the logic is pure — e.g. interactions.close() resets state flags), eslint, tsc, build, verify-export all green

Log to `docs/bob-sessions/06c-tour-ui-state.md`. Small conventional commits. Do not push.
