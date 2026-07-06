# Bob Prompt 02 — Week 1 bug fixes (from test report)

Read `WEEK1_TEST_REPORT.md` in this folder first. Testing found 4 bugs that must be fixed before starting Week 2, plus minor cleanups. Note that Bug 1 means the original Prompt 01 definition of done ("pass through the doorway") was not actually met.

Scope: fixes only. No Week 2 features.

## Bug 1 (critical) — Doorway between rooms is impassable

room-a declares a doorway on its east wall, but room-b's west wall (same world position) is built solid — both the collision AABBs and the visual wall panels block the opening. Verified by simulation and manual testing: player is stopped at x≈11.4.

Fix: in `buildScene`, before building each room, collect all doorways from *other* rooms whose `targetRoomId` points to it, translate them onto the correct wall of the target room (opposite wall, mirrored offset), and include those cuts in both `buildWallAABBs` and `buildWallPanels`. Also decide how to handle the two overlapping wall planes at shared walls (z-fighting risk) — either offset them slightly or build shared walls once.

Add an integration test: build the sample gallery's walls, simulate a player stepping east from inside room-a through the doorway, assert final x is inside room-b. (See report for the simulation approach.)

## Bug 2 (medium) — WASD uses `e.key`, breaks with CapsLock/Shift/IME

`controls.ts` matches lowercase `e.key`. With CapsLock on, Shift held, or a CJK input method active, movement stops working entirely.

Fix: switch to `e.code` (`KeyW`, `KeyA`, `KeyS`, `KeyD`, `ArrowUp`, …), which is layout- and IME-independent.

## Bug 3 (medium) — Esc permanently locks the user out

After the overlay is dismissed, the `unlock` handler is empty and nothing on screen re-locks the pointer. One Esc press forces a page reload.

Fix: on `unlock`, show a minimal "Click to continue" overlay (reuse `overlay.ts`); clicking it calls `controls.lock()` again.

## Bug 4 (medium) — Global lights added once per room

`buildRoom` adds an AmbientLight + HemisphereLight per room, but these are scene-global — a 2-room gallery is twice as bright as a 1-room one.

Fix: add ambient + hemisphere once in `buildScene` (average the rooms' `ambientIntensity`); keep only point/spot lights per room.

## Minor cleanups (do in the same session)

- `main.ts`: the start-position ternary `firstLayout.originX + firstLayout.wallAABBs.length > 0 ? …` has an operator-precedence bug (always true). Rewrite it to place the camera 3m inside the first room, intentionally.
- `eslint.config.js`: add browser globals so `HTMLButtonElement` in `overlay.ts` doesn't error; `npx eslint .` must exit clean.
- `overlay.ts`: the localStorage "seen" check is commented out but `dismiss()` still writes the key. Remove the localStorage logic entirely (Bug 3's re-lock overlay makes it unnecessary).
- Either implement per-artwork spotlights (schema field `artworkSpotlights` currently does nothing) or add a `// TODO(week3)` comment acknowledging it — don't leave the misleading comment in `buildRoom`.
- Delete `smoke-test.html` from the repo root (test artifact, not source).

## Definition of done

`npm test` passes including the new doorway integration test. `npx eslint .` and `npx tsc --noEmit` are clean. In `npm run dev`: I can walk from room-a into room-b through the doorway; movement works with CapsLock on; pressing Esc then clicking resumes control; scene brightness looks the same as before in room-a. Small conventional commits. Save the session log to `docs/bob-sessions/02-week1-fixes.md` and commit it.
