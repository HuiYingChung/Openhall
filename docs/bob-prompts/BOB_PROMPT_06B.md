# Bob Prompt 06B — Fix: Esc pause is dead after first artwork inspect (relock listener never re-arms)

Found in manual E2E (demo mode): walk → click an artwork (info panel works) → close panel → later press Esc → cursor appears but **no "Paused" overlay**, and clicking does nothing — the user is permanently stuck out of pointer lock. Only F5 recovers.

## Root cause

All three relock wirings (`wireRelockDemo` and `wireRelock` in `src/ui/app.ts`, `wireRelock` in `src/viewer/viewer-entry.ts`) share the same pattern:

```ts
const onUnlock = () => {
  controls!.pointerLock.removeEventListener('unlock', onUnlock); // ← removed FIRST
  if (suppressNextRelock) { suppressNextRelock = false; return; } // ← returns WITHOUT re-arming
  if (interactions?.isInspecting) return;                          // ← same problem
  // ...mount overlay; re-arm happens only in onRelock
};
```

The first artwork inspect deliberately unlocks (suppressNextRelock=true) → the unlock listener fires, removes itself, and returns early — **nothing ever re-arms it**. Every later Esc finds no listener → no Paused overlay → stuck. The `isInspecting` early-return and viewer-entry's `if (tour) return` have the identical flaw.

## Fix

In all three wirings, only remove the listener when the overlay is actually mounted — keep it armed on every early-return path:

```ts
const onUnlock = () => {
  if (tour) return;                                             // viewer-entry & app.ts: stay armed
  if (suppressNextRelock) { suppressNextRelock = false; return; } // stay armed
  if (interactions?.isInspecting) return;                        // stay armed
  controls!.pointerLock.removeEventListener('unlock', onUnlock); // remove only here
  const { dismiss } = mountRelockOverlay(() => controls!.lock());
  const onRelock = () => { /* unchanged: dismiss + re-arm */ };
  controls!.pointerLock.addEventListener('lock', onRelock);
};
```

## Related bug — fix in the same pass

`app.ts` Tour button (and `mountTourStartOverlay` is fine, but the desktop Tour button): it calls `controls?.pointerLock.unlock()` with no suppression, and app.ts's `onUnlock` has **no `if (tour) return` check** — so starting a tour while locked mounts the Paused overlay on top of the running tour (currently masked by this very bug killing the listener first). Add the `tour` check to both app.ts wirings as shown above. Note: `tour` must be readable from the handler (it is — same closure scope).

## Also: soften the pointer-lock cooldown (minor UX, same pass)

Browsers enforce a ~1–2 s cooldown after Esc exits pointer lock; clicking the Paused overlay too soon makes `requestPointerLock()` fail silently, so the first click "does nothing" (confirmed in E2E). Mitigate in `mountRelockOverlay` wiring or `FirstPersonControls`: listen for `pointerlockerror` (or the rejected request) and automatically retry `lock()` once after ~1.5 s; optionally add "(if nothing happens, click again)" as a small hint line on the Paused overlay. Keep it simple — no loops, one retry + hint is enough.

## Verification (manual, in demo mode — the bug is not unit-testable through real pointer lock)

1. Enter → walk → Esc → **Paused appears** → click → walking again (repeat ×3: Esc/resume must work every time)
2. Click artwork → panel → ✕ Close → walking → **Esc → Paused appears** (this exact sequence was broken)
3. Click artwork → panel → Esc closes panel → re-locks → Esc again → Paused appears
4. Start Tour while walking → **no Paused overlay over the tour** → Exit Tour → walking → Esc → Paused appears
5. Same sequence 1–3 in the exported bundle (rebuild `npm run build:viewer` first, re-export, open locally)

If you can cheaply extract the onUnlock decision logic into a pure function (given {tour, suppress, inspecting} → 'ignore-stay-armed' | 'mount-overlay') with unit tests, do it; don't over-engineer if it fights the closures.

Tests/lint/tsc/build/verify-export all green. Log to `docs/bob-sessions/06b-relock-rearm-fix.md`. Small conventional commits. Do not push.
