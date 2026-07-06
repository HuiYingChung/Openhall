# Bob Prompt 06D — Fix: keyboard-activated Tour button also triggers artwork click (orphan dolly fires after tour)

Manual E2E repro: while walking (pointer locked), Tab → Enter on the Tour button → tour runs fine → Exit Tour → an inspect info panel appears out of nowhere (needs Esc to close).

## Root cause

`ArtworkInteractions` listens for `click` on `document`. Pressing Enter on the focused Tour button fires a click event that bubbles to document. Ordering: the button's own handler runs first (unlock is async, so `getIsLocked()` is still true when the document listener runs) → `onClick` sees locked + a hovered artwork (whatever the crosshair was aiming at) → `startDolly()` begins **after** the tour handler already called `interactions.close()`. The dolly is then frozen (render loop skips `interactions.update()` during tour) and resumes the moment the tour exits — camera flies to a stale artwork and opens its panel.

## Fix (in `src/viewer/interactions.ts` `onClick`)

1. Accept the event parameter and ignore keyboard-activated clicks: `if (e.detail === 0) return;` (mouse clicks have detail ≥ 1; Enter/Space activation has detail 0)
2. Belt-and-braces: ignore clicks whose target is UI chrome: `if (e.target instanceof HTMLElement && e.target.closest('button, #oh-ui, #oh-info-panel, #oh-tour-hud')) return;`

Both guards go at the top of `onClick`, before the existing checks. No other behavioural change.

If feasible, unit-test the guard logic (dispatch synthetic clicks with detail 0 vs 1 against a stubbed instance in jsdom); keep it simple.

## Verification (manual, demo mode)

1. Walk → aim crosshair at an artwork → Tab → Enter on Tour → full tour → Exit Tour → **no info panel appears**, walking resumes clean
2. Normal mouse click on an aimed artwork still dollies + opens the panel (guard must not kill the real feature)
3. Repeat sequence 1 in the exported bundle

Tests/lint/tsc/build/verify-export green. Log to `docs/bob-sessions/06d-keyboard-click-guard.md`. Conventional commits, commit this time without being asked. Do not push.
