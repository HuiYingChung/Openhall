# Bob Prompt 05 — Fix: export chain broken (3 critical bugs) + mobile entry + review items

Read WEEK3_TEST_REPORT.md first — this prompt fixes its findings. Context: all 79 unit tests pass, but the export path was never exercised for real (everything fetch-related is mocked), and code review shows **no path currently produces a working export zip**. Export is a "never cut" feature. The repo is now on GitHub; deploy steps from last session stay on hold until this prompt is done.

## 1. Critical — exported viewer shows color blocks instead of images

`room-builder.ts` (~line 475) only loads a texture when `imagePath` starts with `blob:` / `data:` / `http`; the bundler rewrites paths to relative `images/aw-01.jpg`, so every artwork in an exported gallery renders as a placeholder color rectangle. Also, `Artwork` schema has no aspect ratio, and `viewer-entry.ts` calls `buildScene(gallery)` with no aspect map → everything falls back to 0.75 in exports.

Fix:
- Add optional `aspectRatio` to the `Artwork` zod schema; bundler writes each work's real ratio into the exported gallery.json; `viewer-entry.ts` builds the aspect map from it and passes it to `buildScene`
- Make relative `images/...` paths load as textures in the export context (simplest: viewer-entry resolves each `imagePath` against `document.baseURI` before building, so room-builder's `http` branch handles it; or room-builder treats any non-empty path that isn't a known placeholder as a texture URL — pick one, delete ambiguity)
- Keep the color-block branch only for demo placeholders, explicitly (e.g. `placeholder:` prefix), not as a silent default

## 2. Critical — `./assets/viewer.js` doesn't exist in the production build

`npm run build` outputs only hashed app chunks; nothing copies `dist-viewer/viewer.js` into `dist/assets/`; deploy.yml never runs `build:viewer`. Worse: Vercel's SPA rewrite turns the 404 into `index.html` (HTTP 200), so the bundler would silently zip **HTML as viewer.js**.

Fix:
- Chain the builds: `build:viewer` first, copy `dist-viewer/viewer.js` to `public/assets/viewer.js` (gitignore it), then `vite build` — so the file exists identically in dev (`/assets/viewer.js` served from public/) and prod (copied into dist). Update `package.json` scripts and deploy.yml accordingly
- In the bundler, after fetching viewer.js, **fail loudly** if the response looks like HTML (content-type or leading `<`) or isn't OK — never zip a bad bundle

## 3. Critical — dev-mode export embeds a Vite dev module

`app.ts` (~line 155) uses `viewerScriptUrl = '/src/viewer/viewer-entry.ts'` in dev; the dev server returns a transformed module whose imports point at `/node_modules/.vite/deps/...` — all dead inside a static zip. The code comment also references `/dist-viewer/viewer.es.js`, which matches neither the filename nor the path — evidence this was never run.

Fix: with fix 2 in place, dev and prod both fetch `/assets/viewer.js` (the pre-built file from public/). Delete the dev-only branch and the stale comment entirely. Document in README dev notes: run `npm run build:viewer` once before testing export locally.

## 4. Mobile is hard-stuck at "Click to Enter"

iOS Safari has no pointer lock. The main app only reaches `setState('viewer')` via the pointer-lock `lock` event, and the Tour button is only mounted in viewer state — so on touch devices the tour fallback is unreachable and the user is trapped (both main app and, by luck only, not the export viewer). Fix in both `app.ts` and `viewer-entry.ts`:

- Detect pointer-lock support (`'pointerLockElement' in document` + touch heuristic)
- Without it: entry overlay's button becomes "Start Tour" → starts `GalleryTour` directly (no lock), dismisses overlay, enters viewer state; Tour exit on touch returns to tour (or re-shows the Start Tour control), never to a lock attempt
- Tour HUD buttons must be reachable above any overlay by design, not by z-index accident

## 5. Raycast picks artworks through walls

`interactions.ts` raycasts only against artwork meshes with unlimited distance — you can highlight and click a work in the next room and dolly through the wall. Include wall meshes in the raycast set and ignore the hit when the nearest object isn't the artwork; cap distance at ~12 m.

## 6. Inspect close flow

While pointer-locked there is no cursor, so the panel's ✕ Close is unclickable and Esc detours through the relock overlay. Fix: on dolly start call `unlock()` (suppress the relock overlay for this deliberate unlock — add a flag the unlock handler checks); panel then closes via visible ✕ click or Esc keydown; on close, re-`lock()`. Applies to app.ts wiring and viewer-entry.

## 7. Demo mode has real artworks

Replace the color blocks: source 6–8 genuinely public-domain images (e.g. Met Museum Open Access CC0, Wikimedia PD-Art), downscale to ≤1024 px longest edge and ≤200 KB each, commit to `src/demo/images/`, update `sample-gallery.json` with real titles/artists/years, correct aspect ratios, and honest labels (no invented facts). Demo stays zero AI calls. Record each image's source URL + license in `src/demo/SOURCES.md`. If you can't download images from your environment, stop and ask Hui rather than substituting generated placeholders.

## 8. Small items (separate commits)

- `vite.config.ts`: set `base: './'` so GitHub Pages project-site subpaths work
- `vercel.json`: drop the COOP/COEP headers (nothing needs them; they only risk blocking cross-origin resources)
- Shared `escapeHtml` helper; apply to all LLM/user text injected via innerHTML (inspect panel, tour label box, upload card `value="${...}"` fields)
- Bundler: remove the silent catch that maps failed image fetches to nonexistent paths — fail loudly with which artwork failed; delete the always-zero `estimateImageBytes`/`coreBytes` or implement it for real

## Verification — must exercise the real chain, not mocks

Write `scripts/verify-export.mjs` (Node 20, no new deps beyond existing JSZip):

1. Run both builds; assert `dist/assets/viewer.js` exists and starts with JS, not `<`
2. Serve `dist/` on a local port; call `buildExportBundle` (Node has fetch/Blob) with the demo gallery + demo images against that server
3. Unzip the result to a temp dir; assert: `assets/viewer.js` is JS; every `gallery.json` `imagePath` exists as a zip entry; every artwork has `aspectRatio`; `index.html` references only files present in the zip
4. Serve the unzipped folder; fetch `index.html`, `assets/viewer.js`, `gallery.json`, one image — all 200 with sane content-types

Run it and paste the output in the session log. Then hand off to Hui for the manual pass (browser export → Netlify Drop, mobile tour) — list her exact steps at the end.

## Definition of done

`npm test`, `npx eslint .`, `npx tsc --noEmit`, both builds, and `node scripts/verify-export.mjs` all green. New/updated unit tests: aspectRatio round-trip through bundler, texture-branch decision for relative paths, bundler fails loudly on HTML response and on failed image fetch. Session log to `docs/bob-sessions/05-export-fixes.md`. Small conventional commits, one fix per commit; no drive-by refactors.
