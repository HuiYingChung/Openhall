# Bob Session 06B — Fix: Esc pause dead after first artwork inspect

**Date:** 2026-07-06  
**Prompt file:** BOB_PROMPT_06B.md

## Summary

Fixed a bug where pressing Esc after inspecting an artwork showed no "Paused" overlay and left the user permanently unable to re-enter pointer lock without a page reload. Two commits.

---

## Root cause

All three `wireRelock` / `wireRelockDemo` sites shared this pattern:

```ts
const onUnlock = () => {
  controls.pointerLock.removeEventListener('unlock', onUnlock); // ← REMOVED FIRST
  if (suppressNextRelock) { suppressNextRelock = false; return; } // ← listener gone
  if (interactions?.isInspecting) return;                          // ← listener gone
  // ...mount overlay
};
```

When artwork inspect fired (suppressing relock), the listener removed itself then returned early. Every subsequent Esc found no listener registered → no Paused overlay → stuck. The `isInspecting` guard and viewer-entry's `if (tour) return` had the identical flaw.

---

## Fix (Commit 1 — `fix:`)

Move `removeEventListener` to just *before* `mountRelockOverlay` in all three sites:

```ts
const onUnlock = () => {
  if (tour) return;                                              // stay armed
  if (suppressNextRelock) { suppressNextRelock = false; return; } // stay armed
  if (interactions?.isInspecting) return;                        // stay armed
  controls.pointerLock.removeEventListener('unlock', onUnlock);  // remove only here
  // ...mount overlay
};
```

Also added `suppressNextRelock = true` in the Tour button handler in `app.ts` before calling `controls?.pointerLock.unlock()`, preventing a spurious Paused overlay when starting a tour while locked.

Files changed: [`src/ui/app.ts`](src/ui/app.ts), [`src/viewer/viewer-entry.ts`](src/viewer/viewer-entry.ts)

---

## Related improvements (Commit 2 — `feat:`)

### Pure decision function

Extracted the three-guard decision into [`shouldShowRelockOverlay`](src/ui/overlay.ts):

```ts
shouldShowRelockOverlay({ tourActive, suppress, inspecting })
  → 'stay-armed' | 'clear-suppress' | 'show-overlay'
```

Used by all three wire sites. Priority: tourActive > suppress > inspecting.  
7 unit tests in [`src/ui/overlay.test.ts`](src/ui/overlay.test.ts) cover all paths.

### Pointer-lock cooldown retry

Browsers enforce a ~1–2 s cooldown after Esc exits pointer lock. `mountRelockOverlay` now:
- Listens for `pointerlockerror` on `document`
- Auto-retries `lock()` once after 1.5 s if the first click fails silently
- Adds a hint line to the Paused overlay: "(if nothing happens, click once more)"
- Cleans up the listener and any pending timer on `dismiss()`

### ESLint

Added `clearTimeout` to `browserGlobals` in `eslint.config.js` (needed by the retry timer).

---

## Commits

1. `fix: rearm unlock listener on every early-return path (Esc stuck after inspect)`
2. `feat: extract shouldShowRelockOverlay pure fn + pointer-lock retry`

---

## Validation

- `npm test` — 100/100 passed (11 test files)
- `npx tsc --noEmit` — clean
- `npx eslint .` — clean
- `npm run build` — clean
- `node scripts/verify-export.mjs` — all 33 checks PASSED

---

## Manual verification checklist (for Hui)

1. Enter → walk → Esc → **Paused appears** → click → walking again (×3)
2. Click artwork → panel → ✕ Close → walking → **Esc → Paused appears** ← *was broken*
3. Click artwork → panel → Esc closes panel → re-locks → Esc → Paused appears
4. Start Tour while walking → **no Paused overlay over the tour** → Exit Tour → walking → Esc → Paused
5. Same sequence 1–3 in the exported bundle (rebuild `npm run build:viewer` first, re-export, open locally)
