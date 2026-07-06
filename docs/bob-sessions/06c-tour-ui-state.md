# Session 06C — Fix: tour entry/exit leaves stale UI

**Branch:** main  
**Date:** 2025  
**Prompt:** BOB_PROMPT_06C.md

## Summary

Fixed three related state bugs around tour start/exit in both `src/ui/app.ts` and `src/viewer/viewer-entry.ts`.

---

## Bug 1 — Tour button never returns after Exit Tour

**Root cause:** The Tour button was `.remove()`d on click, but `onExit` never re-mounted it. The desktop path in `viewer-entry.ts` only re-mounted on the touch branch.

**Fix:**
- `app.ts`: added `remountTourBtn(gallery)` helper; called in the desktop `onExit` callback inside the Tour button click handler.
- `viewer-entry.ts`: `onExit` now calls `mountTourButton()` unconditionally (both pointer-lock and touch branches collapse to the same call).

---

## Bug 2 — Paused overlay filter persists during tour

**Root cause:** The relock overlay's `dismiss` was not tracked outside `wireRelock`. When a tour started from the Paused state, the overlay was never dismissed (it only cleared when `lock` fired, which never happens during a tour).

**Fix:**
- Added `let activeRelockDismiss: (() => void) | null` in both `app.ts` and `viewer-entry.ts`.
- Both `wireRelock`/`wireRelockDemo` closures set `activeRelockDismiss = dismiss` when mounting the overlay, and clear it (`= null`) in the `onRelock` handler.
- The Tour button click handler and `mountTourStartOverlay` click handler both call `activeRelockDismiss()` and null it before starting the tour.
- The armed `onRelock` listener path remains harmless: it clears `activeRelockDismiss` before calling the (now already-dismissed) `dismiss()`, so idempotency is preserved.

---

## Bug 3 — Inspect info panel stays open during tour

**Root cause:** Nothing called `closePanel()` before a `GalleryTour` was constructed. The panel floated over the tour for its entire duration.

**Fix:**
- Added `public close(): void` to `ArtworkInteractions` (`src/viewer/interactions.ts`). It calls the existing private `closePanel()` when `inspecting || dollyActive`, and is a no-op otherwise.
- `closePanel()` now also resets `dollyActive = false` to correctly cancel mid-flight dollies.
- Both Tour button click handlers call `interactions?.close()` / `interactions.close()` before constructing `GalleryTour`.

---

## Files changed

| File | Change |
|------|--------|
| `src/viewer/interactions.ts` | Added `public close()`, added `dollyActive = false` to `closePanel()` |
| `src/ui/app.ts` | `activeRelockDismiss` tracking, `remountTourBtn` helper, Bug 2+3 calls in both tour-start handlers |
| `src/viewer/viewer-entry.ts` | `activeRelockDismiss` tracking in `wireRelock`, Bug 1+2+3 fixes in `startTour` |
| `src/viewer/interactions.test.ts` | New unit tests for `close()` (4 cases) |

---

## Verification

- `npm test`: **104/104 passed** (4 new tests in `interactions.test.ts`)
- `npx tsc --noEmit`: **no errors**
