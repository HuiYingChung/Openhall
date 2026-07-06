# Bob Session 04 — Week 3: Interaction, Export, Polish

**Date:** 2026-07-05  
**Branch:** main  
**Prompt:** BOB_PROMPT_04.md

---

## Summary

Week 3 feature-complete MVP. All items in BOB_PROMPT_04 done. 79 tests pass, `tsc --noEmit` clean, `eslint .` clean.

---

## Carry-over fixes (from Week 2 report)

### Fix 0a — `placement-sanity.ts` inbound doorway offset conversion
`getAllDoorwaysOnWall()` was pushing inbound doorways with the *source* room's `offsetFromCenter` unchanged — but that value is relative to the source room's wall centre, not the target room's. When the two rooms have different depth the doorway appeared up to several metres off position, causing artworks to be wrongly pushed near imaginary door positions.

**Fix:** extracted `convertInboundOffset(doorway, srcRoom, srcOrigin, tgtRoom, tgtOrigin)` which mirrors room-builder's existing world-offset conversion. `buildRoomOrigins(gallery)` is also exported to share the linear layout calculation.

**New tests:** `src/ui/placement-sanity.test.ts` — 4 new cases in `describe('convertInboundOffset')`: same-depth zero, different-depth (room-a→room-b), two equal-depth rooms, and a full sanitize pass that verifies an artwork on the west wall is pushed away from the corrected doorway zone.

### Fix 0b — ESLint `dist/` ignore
Added `{ ignores: ['dist/', 'dist-viewer/', '.wrangler/'] }` as the first entry in the flat config. Also added `Blob`, `Response`, `Request`, `TouchEvent`, `navigator`, `HTMLAnchorElement` to `browserGlobals` and `URL` to `cfWorkerGlobals`.

### Fix 0c — API key via `input.value`
`renderSettings` no longer embeds key values inside the innerHTML template string (which could break with special characters). Values are set via `.value` DOM assignment immediately after `innerHTML` is set.

---

## Feature 1 — Artwork interaction (`src/viewer/interactions.ts`)

New file. `ArtworkInteractions` class:
- **Hover highlight:** each frame, raycasts from screen-centre NDC (0,0). The hovered artwork mesh gets `emissive = #888888 / intensity 0.18`. A 6px white dot crosshair div is shown while pointer-locked.
- **Click-to-inspect:** clicking while a mesh is hovered triggers a smooth 0.6 s ease-out cubic dolly to 2 m in front of the artwork. Movement (`controls.update`) is suppressed during dolly and while the panel is open.
- **Info panel:** shows title / medium / year / wall label / artist statement. Close button + Esc key both close the panel and re-enable movement.
- **`isInspecting` getter:** consumed by the animate loop in `bootApp` to gate `controls.update`.

Wired into `app.ts`: interactions created alongside `FirstPersonControls` in the `onDone` callback of `renderGenerating`, and also in the demo mode path.

---

## Feature 2 — Tour mode (`src/viewer/tour.ts`)

New file. `GalleryTour` class:
- **Waypoint travel:** smooth ease-out cubic lerp + slerp over `TRAVEL_DURATION = 1.4 s` per waypoint.
- **Pause phase:** 0.8 s hold after arrival before showing the label HUD.
- **Viewing phase:** label shown with title / medium / year / wall label / counter (e.g. "2 / 6").
- **Controls:** Next / Prev / Exit buttons in a fixed bottom HUD. Prev wraps around.
- **Touch fallback:** `TouchLook` inner class (single-finger drag-to-look) attached when `navigator.maxTouchPoints > 0` or `ontouchstart` in window.
- **Tour button:** `🎯 Tour` button added top-right in viewer state. Clicking unlocks the pointer and starts the tour. Exiting the tour returns the camera position to free walk and re-locks.

**Tests:** `src/viewer/tour.test.ts` (6 tests, jsdom environment): index 0 start, next() advances, prev() wraps, exit() callback, empty waypoints no crash, HUD removed on dispose.

---

## Feature 3 — Export (`src/export/bundler.ts`)

New file. `buildExportBundle(opts)`:
- Fetches the viewer JS from `viewerScriptUrl` → `assets/viewer.js`
- Fetches each artwork blob URL → `images/${artworkId}.{png|jpg|webp}` (non-fatal on fetch failure)
- Patches `gallery.json` artwork `imagePath` fields to relative `images/` paths
- Writes `index.html` (standalone viewer, relative `./assets/viewer.js` script tag)
- Returns a JSZip blob

`downloadZip(blob, filename)` triggers a browser download.

**Viewer-only build:** `vite.viewer.config.ts` + `npm run build:viewer` → `dist-viewer/viewer.es.js`.  
**Export button:** `⬇ Export` shown top-left in viewer state. Dynamically imports the bundler (tree-shaken from main bundle).

**Tests:** `src/export/bundler.test.ts` (7 tests, jsdom environment): index.html present, gallery.json present and valid, viewer JS present with correct content, every placement artworkId has relative imagePath in gallery.json, artworkPaths are relative, index.html uses relative path, downloadZip creates/clicks anchor.

---

## Feature 4 — Demo mode

`loadDemoMode` removed and replaced with `loadDemoGallery(data)` which just loads and returns the gallery. Demo mode in `renderSettings` now calls an inline `onDemo` lambda (passed from `bootApp`) that:
1. Calls `loadDemoGallery`
2. Builds the scene immediately with `buildScene`
3. Creates `FirstPersonControls` and `ArtworkInteractions`
4. Wires the Esc→relock chain
5. Shows `mountHintOverlay` then transitions to `setState('viewer')`

Zero network calls to AI, zero keys required. The tour button appears if the sample gallery has waypoints (it does — all 6 artworks are covered).

---

## Feature 5 — Visual polish

**Per-artwork spotlights:** Added in `buildScene` after placing each artwork mesh. If `room.lighting.artworkSpotlights === true` (the default), a `THREE.SpotLight` (intensity 1.2, distance 6 m, angle π/7, penumbra 0.3) is positioned at ceiling height directly above the artwork, targeting the hanging position.

**Dispose on rebuild:** `disposeScene(scene)` exported from `room-builder.ts`. Traverses all `Mesh` nodes, disposes geometry and all texture maps on `MeshStandardMaterial`, then clears all children. Called in `bootApp`'s `onDone` callback before the new scene is assigned, preventing geometry/texture accumulation on regeneration.

---

## Feature 6 — Deploy config

- **`wrangler.toml`:** updated with production comments and `[vars] ALLOWED_ORIGINS = ""`. Deploy steps documented.
- **`vercel.json`:** SPA rewrite + COOP/COEP headers (needed for SharedArrayBuffer / PointerLock in some browsers).
- **`.github/workflows/deploy.yml`:** GitHub Pages workflow (push to `main` triggers `npm run build` + deploy).

⚠️ **Deploying requires Hui's accounts. Stop here and ask Hui to:**
1. Push the repo to GitHub (public), enable Pages in repo settings.
2. `npx wrangler login` → `npx wrangler deploy` → copy the worker URL.
3. In Vercel (or GitHub Pages), trigger a deploy and note the app URL.
4. Update `ALLOWED_ORIGINS` in `wrangler.toml` with the app origin, redeploy worker.
5. Test the live app with a real key and the deployed worker URL.

---

## Test results

```
Test Files  10 passed (10)
Tests       79 passed (79)
```

### New tests added this session
| File | Tests |
|---|---|
| `src/ui/placement-sanity.test.ts` | +4 (convertInboundOffset) |
| `src/viewer/tour.test.ts` | 6 (new) |
| `src/export/bundler.test.ts` | 7 (new) |

### `tsc --noEmit`
Clean.

### `npx eslint .`
Clean.

---

## Files changed / created

```
Modified:
  eslint.config.js                   — ignores + browser globals
  package.json                       — build:viewer script
  src/ui/app.ts                      — interactions/tour/export wiring, demo mode, disposeScene
  src/ui/placement-sanity.ts         — offset conversion fix + exports
  src/ui/placement-sanity.test.ts    — 4 new convertInboundOffset tests
  src/viewer/room-builder.ts         — disposeScene, per-artwork spotlights
  vitest.config.ts                   — preserveSymlinks for Dropbox path
  vite.config.ts                     — comment pointing to viewer config
  wrangler.toml                      — production deploy config

Created:
  src/viewer/interactions.ts         — ArtworkInteractions class
  src/viewer/tour.ts                 — GalleryTour class
  src/viewer/tour.test.ts            — tour waypoint tests
  src/viewer/viewer-entry.ts         — standalone viewer entry (export bundle)
  src/export/bundler.ts              — JSZip export bundler
  src/export/bundler.test.ts         — bundler completeness tests
  vite.viewer.config.ts              — viewer-only Vite build target
  vercel.json                        — Vercel SPA config
  .github/workflows/deploy.yml       — GitHub Pages CI/CD
  docs/bob-sessions/04-week3-interaction-export.md
```

---

## Commit plan

```
fix: doorway inbound offset conversion in placement-sanity; add depth-diff tests
fix: eslint dist ignore and browser globals (Blob, TouchEvent, navigator, URL)
fix: settings form sets API key via input.value, not innerHTML template
feat: artwork hover highlight, crosshair, click-to-inspect dolly panel (interactions.ts)
feat: guided tour mode with waypoints, touch fallback, Next/Prev/Exit (tour.ts)
feat: export zip bundler, viewer-only build target, Export button (bundler.ts)
feat: demo mode builds and enters scene immediately with no key
feat: per-artwork spotlights, disposeScene on rebuild
feat: deploy config (wrangler.toml, vercel.json, GitHub Pages workflow)
test: tour waypoint sequencing, exporter completeness
docs: session log 04-week3-interaction-export
```
