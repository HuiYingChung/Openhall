# Bob Session 03E — Fix: viewer entry wiring (Click to Enter dead, scene discarded)
**Date:** 2026-07-05  
**Prompt:** BOB_PROMPT_03E.md  
**Status:** ✅ Complete — 62/62 tests pass, tsc clean, services running

---

## Root causes and fixes

### Bug A — generated scene discarded (render loop sees empty black scene)

**Before:** The `renderGenerating` `onDone` callback in `bootApp` was:
```ts
(_s, newControls) => { controls = newControls; setState('labels'); }
```
The `_s` prefix meant the built `THREE.Scene` was intentionally discarded and `currentScene` (initialised as an empty placeholder) was never replaced. The render loop kept rendering the empty scene forever.

**Fix:** Store the scene into `currentScene`:
```ts
(s, newControls) => {
  currentScene = s;    // ← was _s, discarded
  controls = newControls;
  wireRelock();
  setState('labels');
}
```

To make this testable, a small `applyGeneratingResult(sceneRef, controlsRef, scene, controls)` helper is exported from `app.ts` and called from `bootApp`. Three unit tests cover it.

---

### Bug B — "Click to Enter" never locked the pointer

**Before:** The `renderLabels` click handler was:
```ts
container.querySelector('#oh-enter-gallery')!.addEventListener('click', () => {
  const { dismiss: dismissHint } = mountHintOverlay(() => {
    if (data.gallery) { onEnterViewer(); }   // ← calls state change, not lock()
  });
  void dismissHint;    // ← never called, overlay stays forever
  onEnterViewer();     // ← immediate, fires before lock
});
```
Net result: clicking "Enter Gallery" transitioned state immediately (without pointer lock), the hint overlay was mounted but never dismissed and never called `lock()`.

**Fix:** `renderLabels` now takes a `getControls: () => FirstPersonControls | null` parameter. The click handler:
1. Mounts the hint overlay with `onEnter = () => c.lock()` — the button click triggers the lock request
2. Registers a `lock` listener that dismisses the overlay and calls `onEnterViewer()` only once the pointer lock actually succeeds
3. The `removeEventListener` pattern is used because Three.js `EventDispatcher` has no `{ once }` option

```ts
const { dismiss } = mountHintOverlay(() => { c.lock(); });
const onLock = () => {
  c.pointerLock.removeEventListener('lock', onLock);
  dismiss();
  onEnterViewer();
};
c.pointerLock.addEventListener('lock', onLock);
```

---

### Bug C — Esc lock-out regression (relock wiring lost)

**Before:** The `wireRelock` pattern from Week 1's `main.ts` was never wired in `bootApp`. Pressing Esc exited pointer lock permanently with no way back.

**Fix:** `wireRelock()` is called once in the `onDone` callback (right when controls are received) and re-registers itself after each Esc → click → relock cycle:
```ts
function wireRelock() {
  const onUnlock = () => {
    controls!.pointerLock.removeEventListener('unlock', onUnlock);
    const { dismiss } = mountRelockOverlay(() => controls!.lock());
    const onRelock = () => {
      controls!.pointerLock.removeEventListener('lock', onRelock);
      dismiss();
      wireRelock(); // re-arm for next Esc
    };
    controls!.pointerLock.addEventListener('lock', onRelock);
  };
  controls!.pointerLock.addEventListener('unlock', onUnlock);
}
wireRelock();
```

---

## Files changed

| File | Change |
|---|---|
| `src/ui/app.ts` | Bug A: export `applyGeneratingResult`, store scene in `currentScene`. Bug B: `renderLabels` takes `getControls`, fixed click handler. Bug C: `wireRelock()` wired from `onDone`. Added `mountRelockOverlay` import. |
| `src/ui/app.viewer-entry.test.ts` | New — 3 regression tests for Bug A via `applyGeneratingResult` |

---

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ Clean |
| `npm test` (vitest) | ✅ 62/62 pass (was 59) — 3 new regression tests |
| `GET http://localhost:5173` | ✅ HTTP 200 |
| `POST http://localhost:8787/token` | ✅ Token OK |

### Manual check (demo mode)

Demo mode path:
1. `http://localhost:5173` → Settings auto-filled → Save & Continue → click "demo mode"
2. Skip to labels screen — all label textareas populated
3. Click "Enter Gallery →" → hint overlay appears with "Click to Enter" button
4. Click button → pointer locks, hint overlay dismisses, gallery scene visible (not black), WASD moves
5. Press Esc → "Paused / Click anywhere to continue" overlay appears
6. Click → pointer re-locks, movement resumes

---

## Services running

- **Token worker:** `npm run worker:dev` → `http://localhost:8787`
- **Vite app:** `npm run dev` → `http://localhost:5173`
