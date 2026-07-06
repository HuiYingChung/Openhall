# Session 06D — Fix: keyboard-activated Tour button triggers orphan dolly

**Branch:** main  
**Prompt:** BOB_PROMPT_06D.md

## Root cause

`ArtworkInteractions` listens for `click` on `document`. Pressing Enter on the
focused Tour button fires a synthetic click that bubbles to the document listener.
Because `controls.pointerLock.unlock()` is async, `getIsLocked()` was still `true`
when the document handler ran — so `onClick` saw a locked context and a hovered mesh
and called `startDolly()`. The dolly was then frozen while the tour ran (render loop
skips `interactions.update()` during a tour) and resumed the instant the tour exited,
flying the camera to a stale artwork and opening its info panel.

## Fix — `src/viewer/interactions.ts` `onClick`

Two guards added at the top of `onClick`, before any existing checks:

1. **`if (e.detail === 0) return`** — keyboard-activated clicks (Enter/Space on a
   focused element) always have `detail === 0`; real mouse clicks have `detail >= 1`.

2. **UI chrome target guard** — if the click target is or is inside a `<button>`,
   `#oh-ui`, `#oh-info-panel`, or `#oh-tour-hud`, return early. Belt-and-braces for
   any future chrome that bubbles to the document listener.

The method signature changed from `onClick(): void` to `onClick(e: MouseEvent): void`
and `boundClick` was typed to match.

## Files changed

| File | Change |
|------|--------|
| `src/viewer/interactions.ts` | Two guards at top of `onClick`, updated signature + field type |
| `src/viewer/interactions.test.ts` | 4 new tests in `ArtworkInteractions onClick guards` describe block |

## Verification

- `npm test`: **108/108 passed**
- `npx tsc --noEmit`: no errors
