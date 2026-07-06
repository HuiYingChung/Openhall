# Bob Prompt 03E — Fix: viewer entry wiring (Click to Enter dead, scene discarded)

Live E2E now completes the whole AI pipeline ✅, but entering the gallery is broken. Root causes found by code inspection of `src/ui/app.ts`:

## Bug A — generated scene is thrown away

`bootApp` line ~103:

```ts
(_s, newControls) => { controls = newControls; setState('labels'); },
```

The built scene `_s` is ignored and `currentScene` (initialised to an empty placeholder) is never replaced. Even if pointer lock worked, the user would walk around an empty black scene.

Fix: `(s, newControls) => { currentScene = s; controls = newControls; setState('labels'); }` (make `currentScene` reassignment work with the render loop).

## Bug B — Click to Enter never locks the pointer

`renderLabels` click handler (~line 512): it mounts the hint overlay whose `onEnter` only calls `onEnterViewer()` (a state change), never `controls.lock()`; it also calls `onEnterViewer()` immediately and never dismisses the overlay. Net effect: clicking "Click to Enter" does nothing, overlay stays forever.

Fix properly:
- `onEnter` must call `controls.lock()` (pass a lock callback or the controls reference into `renderLabels`)
- Dismiss the overlay on the `pointerLock` `lock` event (like Week 1's main.ts did)
- Remove the stray immediate `onEnterViewer()` / `void dismissHint` hack

## Bug C — Esc lock-out is back (regression of Week 1 Bug 3)

The old `main.ts` relock wiring (`unlock` → `mountRelockOverlay` → re-lock) was lost when the entry point moved to `bootApp`. Re-add it in `bootApp` so Esc → click resumes control. `mountRelockOverlay` already exists in `overlay.ts`.

## Verification (required)

- Add a regression test where feasible (e.g. unit-test that the generating-onDone callback stores the scene — restructure into a testable function if needed)
- Manual check via demo mode: demo → labels → Enter Gallery → Click to Enter locks pointer, gallery visible (not black), WASD works, Esc → click resumes
- Tests/lint/tsc green. Log to `docs/bob-sessions/03e-viewer-entry-fix.md`. Keep services running afterwards.
