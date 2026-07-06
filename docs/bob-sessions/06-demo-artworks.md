# Bob Session 06 — Demo gallery with real CC0 artworks + cleanup

**Date:** 2026-07-06  
**Prompt file:** BOB_PROMPT_06.md

## Summary

Wired 8 Met Museum Open Access (CC0) artworks into demo mode, fixed the demo-export edge case, deleted the broken deploy workflow. Three small commits.

---

## What was done

### 1. Computed actual image dimensions

Wrote a one-off inline Node script reading JPEG SOF markers to get pixel dimensions of all 8 downloaded JPEGs:

| File | Pixels | Aspect ratio used |
|------|--------|-------------------|
| vangogh-wheatfield.jpg | 599×477 | 1.256 |
| seurat-circus.jpg | 600×401 | 1.496 |
| pissarro-peasants.jpg | 599×463 | 1.294 |
| manet-boating.jpg | 599×457 | 1.311 |
| degas-dance-class.jpg | 579×624 | 0.928 (portrait) |
| cezanne-apples.jpg | 600×476 | 1.261 |
| renoir-peaches.jpg | 599×497 | 1.205 |
| vangogh-cypresses.jpg | 495×624 | 0.793 (portrait) |

Aspect ratios were computed from actual pixel dimensions, not canvas measurements.

### 2. Rewrote `src/demo/sample-gallery.json`

- Replaced 6 placeholder artworks with 8 real works per SOURCES.md
- `imagePath`: `demo/<filename>.jpg` (served by Vite from `public/demo/`)
- Grounded labels (2–3 sentences): artist, date, subject, medium, acquisition; no invented provenance
- `artistStatement` omitted (historical works)
- Exhibition title: "Impressionist Highlights — Demo"
- Room A surface changed to warm/white-plaster; Room B kept neutral/white-plaster
- **Room A (12×10): 4 works** — Wheat Field (N, −3), Circus Sideshow (N, +3), Pissarro Peasants (S, 0), Boating (W, 0)
- **Room B (10×14): 4 works** — Degas Dance Class (N, −2), Cézanne Apples (N, +2), Renoir Peaches (S, 0), Cypresses (E, 0)
- Tour visits all 8 in a natural circuit (room A north → west → south → room B north → east → south)
- `npm test` green: `gallery.schema.test` validates the new file; `placement-sanity.test` confirms no placements are out of bounds

### 3. Fixed `room-builder.test.ts` environment

Now that sample-gallery.json uses real `demo/` paths instead of `placeholder:` values, `buildScene` invokes `THREE.TextureLoader` (which needs `document`). Added `// @vitest-environment jsdom` to the test file — minimal fix, no test logic changed.

### 4. Fixed demo-export edge case (`src/ui/app.ts`)

In demo mode `data.artworks = []`, so `artworkUrls` was empty. The bundler then left `demo/xxx.jpg` paths in `gallery.json` while packing no images — producing a broken zip.

**Fix**: the Export click handler now iterates `data.gallery.artworks` before calling `buildExportBundle`. For any artwork with no entry in `artworkUrls` (and a non-placeholder `imagePath`), it `fetch()`es the same-origin path, creates a blob: URL, and adds it to the map. Fails loudly on HTTP error (existing behaviour preserved).

### 5. Extended `bundler.test.ts`

Added one new test: "packages an artwork whose URL was fetched from imagePath (demo-mode flow)". It simulates the app's pre-fetch step (artworkUrls pre-filled with a blob:-style URL for an artwork whose imagePath is `demo/vangogh-wheatfield.jpg`) and asserts the exported gallery.json has a relative `images/` path and correct `aspectRatio: 1.256`.

Also updated the "preserves existing aspectRatio" test comment and expected value from `1.33` (old placeholder) to `1.256` (Van Gogh Wheat Field).

### 6. Deleted `.github/workflows/deploy.yml`

Removed in its own commit. Stays recoverable in git history. Deploy decision is postponed.

---

## Commits

1. `chore: delete .github/workflows/deploy.yml — deploy decision postponed`
2. `feat: replace placeholder artworks with 8 real CC0 works in demo gallery`
3. `fix: export from demo mode by fetching imagePath when artworkUrls is empty`

---

## Validation

- `npm test` — 93/93 passed (10 test files)
- `npx tsc --noEmit` — clean
- `npx eslint .` — clean
- `npm run build` — clean (pre-existing chunk size warning unrelated)
- `node scripts/verify-export.mjs` — all 33 checks PASSED

---

## Manual verification checklist (for Hui)

- [ ] `npm run dev` → click Demo → both rooms show real paintings (not coloured squares)
- [ ] Walk both rooms, confirm all 8 paintings visible, correct aspect ratios (no stretching / black planes)
- [ ] Click 🎯 Tour → all 8 waypoints visit, labels correct
- [ ] Click ⬇ Export from demo mode → unzip → open `index.html` → all 8 paintings load in exported gallery
