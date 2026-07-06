# Bob Session 05 — Export Chain Fixes + Polish

**Date:** 2026-07-06  
**Commit base:** 6dced63 (Week 3 / Prompt 04 code)  
**Branch:** main  

---

## Summary

Fixed all 3 critical export-chain bugs, mobile entry, raycast occlusion, inspect close flow, and 4 small items from the WEEK3_TEST_REPORT. All tests green (92 tests, +13 new), both builds clean, `node scripts/verify-export.mjs` 32/32 PASS.

---

## What was done

### Fix 1 — Export viewer shows images, not color blocks (critical)

**Files:** `src/schema/gallery.schema.ts`, `src/export/bundler.ts`, `src/viewer/room-builder.ts`, `src/viewer/viewer-entry.ts`

- Added optional `aspectRatio: z.number().positive().optional()` to `ArtworkSchema`
- Bundler now writes `aspectRatio` from the `aspectRatios` map (new `BundleOptions.aspectRatios`) into `gallery.json`; preserves existing value if no map provided
- `viewer-entry.ts` reads `aspectRatio` from each artwork and builds the aspect map before calling `buildScene`
- `room-builder.ts`: texture-branch condition changed from `startsWith('blob:') || startsWith('data:') || startsWith('http')` to `imagePath && !imagePath.startsWith('placeholder:')` — any real path (including `images/aw-01.jpg`) now loads as a texture
- `sample-gallery.json`: placeholder paths changed to `placeholder:red` etc. (explicit prefix); added `aspectRatio` to all 6 demo artworks

### Fix 2 — `./assets/viewer.js` exists in production build (critical)

**Files:** `package.json`, `scripts/copy-viewer.mjs`, `vite.config.ts`, `.github/workflows/deploy.yml`

- `build:viewer` script now runs `tsc && vite build:viewer && node scripts/copy-viewer.mjs` — copies `dist-viewer/viewer.js` to `public/assets/viewer.js`
- `build` script now chains: `npm run build:viewer && tsc && vite build`
- `vite.config.ts`: added `base: './'` (GitHub Pages subpath support); used `resolve(__dirname, ...)` to fix Vite/symlink path issue on Windows; also added `public/assets/` to eslint ignores
- `deploy.yml` unchanged — `npm run build` already chains everything

### Fix 2b — Bundler fails loudly on HTML viewer response

- Bundler checks `content-type` header and body prefix for `<` after fetching viewer.js
- Throws: `"viewer.js response looks like HTML, not JavaScript. Run 'npm run build:viewer' first."`
- Changed image fetch to use `arrayBuffer()` instead of `blob()` for broader compatibility (also fixed jsdom test environment)

### Fix 3 — Dev export no longer zips a Vite dev module (critical)

**Files:** `src/ui/app.ts`

- Removed the `import.meta.env.DEV ? '/src/viewer/viewer-entry.ts' : './assets/viewer.js'` branch
- Both dev and prod now use `viewerScriptUrl = '/assets/viewer.js'` (the pre-built file from `public/`)
- Added README dev note to viewer-entry.ts: run `npm run build:viewer` once before testing export locally

### Fix 4 — Mobile/iOS pointer-lock fallback

**Files:** `src/ui/overlay.ts`, `src/viewer/viewer-entry.ts`, `src/ui/app.ts`

- Added `mountHintOverlayTouchFallback()` to `overlay.ts` — shows "Start Tour" instead of "Click to Enter"
- `supportsPointerLock()` helper (`'pointerLockElement' in document`) in both `viewer-entry.ts` and `bootApp()`
- On touch devices: entry overlay shows "Start Tour" → starts `GalleryTour` directly, no pointer lock
- Tour exit on touch re-shows "Start Tour" via `mountTourStartOverlay()` (app.ts) / `mountTourButton()` (viewer-entry.ts)
- `renderLabels` "Enter Gallery" → touch devices skip the pointer-lock flow and enter viewer directly

### Fix 5 — Raycast occlusion (artworks through walls)

**Files:** `src/viewer/interactions.ts`

- Added `MAX_RAYCAST_DISTANCE = 12` metres, sets `raycaster.far` each frame
- Collects all meshes in scene (not just artwork meshes) for occlusion testing
- Only highlights/picks an artwork if the *nearest* hit is an artwork mesh; wall hits block selection

### Fix 6 — Inspect close flow

**Files:** `src/viewer/viewer-entry.ts`, `src/ui/app.ts`

- `onInspectOpen` now calls `controls.pointerLock.unlock()` and sets `suppressNextRelock = true`
- `wireRelock` handler checks `suppressNextRelock` — deliberate unlocks don't show the "Paused" overlay
- `wireRelock` also checks `interactions.isInspecting` — Esc while panel open doesn't show relock overlay
- `onInspectClose` calls `controls.lock()` (re-arms pointer lock after panel closes)

### Fix 8a — vite.config.ts base

`base: './'` set for GitHub Pages project-site subpath compatibility. Required using absolute `resolve(__dirname, ...)` paths to work around a Vite+Windows symlink bug.

### Fix 8b — vercel.json COOP/COEP headers removed

Dropped `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` — nothing in the app needs them.

### Fix 8c — Shared escapeHtml + applied everywhere

- New `src/ui/escape-html.ts` — shared helper extracted to avoid pulling bundler into the main chunk
- Applied to: `interactions.ts` (info panel), `tour.ts` (label box), `app.ts` (`renderLabels`, `addThumbnail` value attributes), `bundler.ts` (index.html title)

### Fix 8d — Bundler image fetch failures + dead code

- Image fetch failures now throw: `"Failed to fetch image for artwork '${id}': HTTP ${status} from ${url}"`
- Removed `estimateImageBytes()` (always returned 0) and `coreBytes` from `BundleResult`; renamed to `totalBytes`

---

## New test coverage (+13 tests, total 92)

| Test | What it verifies |
|------|-----------------|
| aspectRatio written by bundler | Round-trip: map → gallery.json |
| aspectRatio preserved from gallery | No-override case |
| viewer.js HTML response throws | SPA 200 fallback detection |
| viewer.js `<` body throws | Content-type bypass detection |
| image fetch failure throws | Fail-loudly on 404 |
| totalBytes > 0 | BundleResult shape |
| escapeHtml escapes special chars | `& < > " '` |
| escapeHtml leaves safe strings | No false escaping |
| buildIndexHtml viewer.js reference | `./assets/viewer.js` in output |
| buildIndexHtml escapes title | XSS via gallery title |
| buildScene: meshes for all artworks | All artworks placed |
| buildScene: aspectRatio from map | Custom ratio applied |
| buildScene: fallback 0.75 | Default when no map |

---

## Fix 7 — Demo mode real CC0 images

**Status: NOT DONE — needs Hui to supply images.**

The prompt asks for 6–8 CC0 images from Met Museum Open Access or Wikimedia. The environment doesn't have outbound network access for downloading images. The current demo uses explicit `placeholder:` prefix paths which correctly render as color blocks (no silent fallback).

**Action needed from Hui:**
1. Download 6–8 CC0 images (e.g. from https://www.metmuseum.org/art/collection — filter by "Open Access")
2. Downscale to ≤1024px longest edge, ≤200KB each; save as JPEG
3. Copy to `src/demo/images/`
4. Update `src/demo/sample-gallery.json`: set `imagePath` to `"images/filename.jpg"`, update `title`/`medium`/`year`/`label` with real metadata
5. Create `src/demo/SOURCES.md` listing each image URL, artist, date, and license
6. Run `npm test` to confirm schema still validates; run `npm run build:viewer` to rebuild

---

## verify-export.mjs output

```
=== Step 1: dist/assets/viewer.js ===
  PASS: dist/assets/viewer.js exists
  PASS: dist/assets/viewer.js does not start with < (not HTML)
  PASS: dist/assets/viewer.js is substantial (689068 bytes)

=== Step 2: Serving dist/ on port 15001 ===
  dist/ server started on :15001

=== Step 3: Building export bundle ===
  PASS: sample-gallery.json exists
  PASS: viewer.js content is not HTML before zipping
  Built zip: 155667 bytes
  PASS: zip is non-trivial in size

=== Step 4: Asserting zip contents ===
  PASS: zip contains assets/viewer.js
  PASS: unzipped viewer.js is not HTML
  PASS: zip contains gallery.json
  PASS: gallery.json has version 1.0
  PASS: artwork aw-01 has valid aspectRatio (1.33)
  PASS: artwork aw-02 has valid aspectRatio (1.5)
  PASS: artwork aw-03 has valid aspectRatio (0.75)
  PASS: artwork aw-04 has valid aspectRatio (1.77)
  PASS: artwork aw-05 has valid aspectRatio (1)
  PASS: artwork aw-06 has valid aspectRatio (1.2)
  PASS: imagePath images/aw-01.png exists in unzipped folder
  PASS: imagePath images/aw-02.png exists in unzipped folder
  PASS: imagePath images/aw-03.png exists in unzipped folder
  PASS: imagePath images/aw-04.png exists in unzipped folder
  PASS: imagePath images/aw-05.png exists in unzipped folder
  PASS: imagePath images/aw-06.png exists in unzipped folder
  PASS: zip contains index.html
  PASS: index.html script src="./assets/viewer.js" resolves to an existing file

=== Step 5: Serving unzipped folder on port 15003 ===
  Unzipped gallery server started on :15003
  PASS: GET http://127.0.0.1:15003/index.html → 200 (expected 200)
  PASS: GET http://127.0.0.1:15003/index.html content-type includes 'text/html'
  PASS: GET http://127.0.0.1:15003/assets/viewer.js → 200 (expected 200)
  PASS: GET http://127.0.0.1:15003/assets/viewer.js content-type includes 'text/javascript'
  PASS: Served viewer.js body is not HTML
  PASS: GET http://127.0.0.1:15003/gallery.json → 200 (expected 200)
  PASS: GET http://127.0.0.1:15003/gallery.json content-type includes 'application/json'
  PASS: GET http://127.0.0.1:15003/images/aw-01.png → 200 (expected 200)
  PASS: GET http://127.0.0.1:15003/images/aw-01.png content-type includes 'image/'

=== Summary ===
All checks PASSED. Export chain is healthy.
```

---

## Manual E2E checklist for Hui

### Browser export → Netlify Drop

1. `npm run dev` (ensure `npm run build:viewer` was run first)
2. Open http://localhost:5173 → click "Try Demo" (no key needed)
3. Wait for gallery to load → click ⬇ Export → wait for download
4. Unzip `openhall-export.zip` → drag the folder to https://netlify.com/drop
5. Verify: gallery renders, WASD works, click artwork opens info panel, Esc closes panel and re-arms pointer lock

### Mobile (iOS Safari)

1. Open the Netlify Drop URL on iPhone/iPad
2. Tap the entry button — expect "Start Tour" (not "Click to Enter")
3. Tour should start automatically; tap Next/Prev/Exit
4. Verify: no trap state, no "Click to Enter" stuck screen

### Desktop: Inspect close flow

1. Walk up to an artwork → click to dolly
2. Panel opens, cursor is now visible (no pointer lock)
3. Click ✕ Close → pointer re-locks, crosshair reappears
4. Alternatively press Esc → panel closes (no "Paused" overlay flicker), pointer re-locks

### Cross-room raycast block

1. Stand in room-a → aim crosshair through doorway into room-b
2. Artwork in room-b should only highlight when visible (no wall between camera and artwork)
3. Should not be selectable from >12 m away

---

## Conventional commits (suggested)

```
fix: add aspectRatio to Artwork schema; bundler writes it, viewer reads it
fix: room-builder loads textures for any non-placeholder: imagePath
fix: chain builds so dist/assets/viewer.js always exists
fix: bundler fails loudly on HTML viewer response and image fetch errors
fix: dev export uses pre-built /assets/viewer.js, not Vite dev module
fix: mobile entry shows Start Tour when pointer lock unavailable
fix: raycast limited to 12m with wall occlusion
fix: inspect panel unlocks pointer on dolly, re-locks on close
fix: escapeHtml applied to all LLM/user text in innerHTML
fix: vite base './' for GitHub Pages; drop vercel COOP/COEP headers
feat: scripts/verify-export.mjs end-to-end export chain verification
test: add 13 tests for aspectRatio round-trip, HTML check, escapeHtml, texture branch
```

---

## Known issue: gitignore for public/assets/viewer.js

The `.gitignore` file could not be edited (tool restriction). Need to manually add:

```
public/assets/viewer.js
```

to `.gitignore` to prevent the pre-built viewer from being committed.

---

*Session completed by Bob (IBM Bob AI coding assistant)*
