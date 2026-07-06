# Bob Prompt 08 — Polish round 2: Esc discoverability, Settings cancel, Labels back button

Three small UX items from manual E2E. Scope is exactly these three — no refactors, no drive-by changes. All main app only (`src/ui/`); do NOT touch the export bundle / `viewer-entry.ts`.

## 1. Entry overlay must tell the user Esc pauses/exits

The first-entry hint overlay (WASD screen) never mentions Esc, so users don't know how to leave the walk view. (The artwork inspect panel already says "Press Esc to close" — leave that alone.)

- `src/ui/overlay.ts`, `OVERLAY_HTML`: the secondary hint line currently reads "Arrow keys also work for movement" (~line 66–68). Extend this area so it also says: Press **Esc** anytime to pause or exit. Either one combined line or a second line in the same style (0.85rem, #888). Wrap Esc in `<strong>` or a `<kbd>` styled like the inspect panel's.
- Desktop overlay only. Do NOT add it to `mountHintOverlayTouchFallback` (touch has no keyboard).

## 2. Settings screen: Cancel button

`src/ui/app.ts` → `renderSettings` (~line 558). Today the only way out is "Save & Continue" — if the user opens Settings from the upload screen just to look, they're trapped.

- Add an optional `onCancel?: () => void` parameter. When provided, render a **Cancel** button next to "Save & Continue" in the existing flex row (~line 609). Cancel discards any edits (simply don't save) and calls `onCancel`.
- Style: secondary — `background:none;border:1px solid #444;color:#aaa;` (match the "Settings" button on the upload screen), `flex:0 0 auto`, Save keeps `flex:1`.
- Caller: in `setState`, `case 'settings'` (~line 387): compute `const hasKey = !!(loadWatsonxSettings()?.apiKey || loadOpenAISettings()?.apiKey);` and pass `hasKey ? () => setState('upload') : undefined`. First-run (no key yet) shows no Cancel — there is nowhere to go back to.
- Demo-mode line at the bottom stays as is.

## 3. Review Wall Labels: back button to continue editing

`src/ui/app.ts` → `renderLabels` (~line 921). Today the only button is "Enter Gallery →" — no way back to tweak uploads/titles before entering.

- Add an `onBack: () => void` parameter. Render a secondary "&larr; Back to edit" button beside "Enter Gallery →" (flex row: Back `flex:0 0 auto` secondary style as in item 2; Enter Gallery keeps `flex:1` primary).
- Under the buttons add one small caption line (0.75rem, #666): "Back keeps your uploads and details, but you'll need to generate again."
- Caller: `case 'labels'` (~line 544): pass the existing **`exitToMenu`** function as `onBack`. Do NOT write a new teardown — `exitToMenu` already disposes scene/controls/interactions correctly and returns to upload (key exists at this point since generation just ran). Its HUD-button removals are harmless no-ops in the labels state. `data.artworks` / `userBrief` / `preset` live in `data` and survive, so the upload screen re-renders with everything intact.
- Label edits made on this screen before clicking Back are allowed to be lost (they'd be regenerated anyway) — no need to warn beyond the caption.

## Verification

- Manual: (a) demo → walk → confirm entry overlay shows the Esc hint; (b) upload screen → Settings → Cancel → back at upload, stored settings unchanged; fresh browser profile (or cleared localStorage) → Settings shows NO Cancel; (c) full generate flow → labels screen → Back to edit → upload screen still has images/brief/preset → Generate again → labels → Enter Gallery works, no black scene, no console errors.
- All existing tests, lint, tsc, build, verify-export stay green. No new dependencies.
- Log to `docs/bob-sessions/08-polish-esc-cancel-back.md`. Small conventional commits (one per item is fine), commit without being asked. Do not push.
