# Bob Prompt 07 — Polish bundle: exit-to-menu funnel + accumulated E2E findings

Five small items from manual E2E. All are UX/polish; no new features beyond what's listed.

## 1. Exit to menu — "Create your own gallery" funnel (the important one)

There is currently NO way to leave the viewer (demo or generated) except F5. The demo is the marketing funnel: a visitor finishes walking it and should land one click away from uploading their own works.

- Add a "Create your own gallery →" button to the **Paused (relock) overlay** — prominent, below "Click anywhere to continue"
- Add a small persistent "← Menu" button to the viewer HUD (top bar, alongside ⬇ Export / 🎯 Tour)
- Both do the same thing: fully tear down the viewer session — `disposeScene(currentScene)`, `interactions?.dispose()`, tour dispose if running, remove HUD buttons/crosshair, reset relevant state — then `setState('upload')` (or 'settings' if no key stored, same logic as boot). No leaks: regenerating/demoing again after exiting must work repeatedly
- Main app only (`src/ui/app.ts`). The exported bundle has no menu to return to — do NOT add it there

## 2. Export staleness guard (footgun found in E2E)

Exporting from dev packages `public/assets/viewer.js` as-is; after editing viewer source without re-running `npm run build:viewer`, the export silently ships a stale engine (this bit us). Fix: `scripts/copy-viewer.mjs` already runs at build time — additionally write a tiny `public/assets/viewer.meta.json` (`{ builtAt: <ISO timestamp> }`). Dev-only check in the Export handler (`import.meta.env.DEV` guard): fetch the meta file and if `builtAt` is older than 24h, `confirm()` the user: "viewer.js was built <time> ago — source may have changed. Export anyway? (run npm run build:viewer to refresh)". Production builds always rebuild in the chain, so prod is exempt.

## 3. Paused overlay copy

Add the hint line "(if nothing happens, click again)" only if 06B didn't already; also make the overlay text explain where the user is: title "Paused", subtitle "Click anywhere to continue walking".

## 4. Demo label fix (honesty)

`src/demo/sample-gallery.json`, Cypresses (aw-08): the label quotes Van Gogh's letter with wording that isn't an exact translation. Rephrase as indirect speech (e.g. "Van Gogh wrote to his brother Theo that the cypresses were constantly on his mind…") — no quotation marks around non-verbatim text.

## 5. Mobile note in README dev docs (one line, wherever dev notes live)

Free walk is desktop-only by design (pointer lock); touch devices navigate via guided tour. (For the future: virtual joystick is out of MVP scope.)

## 6. Replace ALL emoji in the UI with inline SVG icons (or plain text)

Hui's direction: no emoji anywhere in the UI (inconsistent rendering across OS, unpolished); small inline SVG icons are fine. Rules:

- NO icon library / new dependency — hand-written inline SVG strings only (16px, `stroke="currentColor"`, `fill="none"`, stroke-width 1.5–2, vertically centred next to the label with a small gap)
- Buttons: Tour / Start Tour (e.g. a simple route/pin glyph), Export (download-arrow glyph), Settings (gear glyph), the new ← Menu from item 1 (left arrow), ✕ Close can stay as a text "×" or use an SVG cross
- Sweep the whole UI for remaining emoji (⚙️ in settings/upload headers, ⬇, 🎯, any others) — plain text where an icon adds nothing
- Both `app.ts` HUD and `viewer-entry.ts` (export bundle) must match

## Verification

Manual: demo → walk → Esc → Paused shows the new button → click it → back at upload/settings → enter demo again → walk again (repeat ×2, no black scene, no leaks/console errors); same via ← Menu button; generate flow unaffected. Unit-test what's pure (e.g. staleness threshold decision). Tests/lint/tsc/build/verify-export green. Log to `docs/bob-sessions/07-polish-exit-funnel.md`. Small conventional commits, commit without being asked. Do not push.
