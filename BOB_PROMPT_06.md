# Bob Prompt 06 — Demo gallery with real CC0 artworks + cleanup

Hui has downloaded 8 public-domain images (Met Museum Open Access, CC0) into `public/demo/`. Their filenames, artists, titles, dates, media, and source links are documented in `src/demo/SOURCES.md` — read it first. This prompt wires them into demo mode and closes two loose ends.

## 1. Rewrite `src/demo/sample-gallery.json` with the real works

- Replace the 6 placeholder artworks with the 8 real works from SOURCES.md: real `title`, `medium` ("Oil on canvas"), `year` (use the start year for ranged dates: 1891 for "1891–92", 1887 for "1887–88", 1890 for "ca. 1890")
- `imagePath`: `"demo/<filename>.jpg"` — these resolve against the app origin because the files live in `public/demo/` (Vite serves `public/` at the root; `base: './'` keeps it working in builds)
- `aspectRatio`: compute from the ACTUAL image pixel dimensions (write a tiny one-off node script reading the JPEG headers, or use the canvas-dimension approximations in SOURCES.md only if pixel reading is impractical — say which you did)
- `label`: 2–3 sentences per work. Grounded facts only (artist, date, what is depicted, medium); no invented provenance or quotes. `artistStatement`: omit — these are historical works
- Update `title` of the exhibition (e.g. "Impressionist Highlights — Demo") and re-plan placements across the two rooms for 8 works (4+4 or 5+3; keep the existing room/doorway geometry; respect wall widths and the doorway on the shared wall) and regenerate the `tour` waypoints to match (2 m in front of each work, correct lookAt)
- Sanity: `npm test` must stay green (gallery.schema.test validates this file); walk it in demo mode to confirm no overlapping works, nothing hanging in the doorway

## 2. Demo-mode textures must actually load

`room-builder.ts` loads a texture for any non-`placeholder:` path, so `demo/xxx.jpg` should now render as a real image. Verify in the browser (demo mode → walk both rooms → all 8 works show paintings, correct aspect ratios, no stretched or black planes).

## 3. Close the demo-export edge case

Exporting from demo mode currently produces a broken zip: `data.artworks` is empty, so no images are packed, while gallery.json keeps `demo/...` paths pointing at nothing. Fix minimally: in the Export click handler, when an artwork has no entry in `artworkUrls`, fetch its `imagePath` (same-origin) and pack that — so demo exports work like generated ones. Extend `verify-export.mjs` or a unit test to cover an artwork whose URL comes from `imagePath`. Fail loudly if a fetch fails (existing behaviour).

## 4. Delete `.github/workflows/deploy.yml`

We are not deploying via GitHub Pages (deploy decision is postponed; the workflow fails on every push and spams notifications). Delete the file in its own commit — it stays recoverable in git history.

## Definition of done

`npm test` / `npx eslint .` / `npx tsc --noEmit` / `npm run build` green; `node scripts/verify-export.mjs` all PASS. Manual: demo mode shows all 8 paintings with correct ratios in both rooms; tour visits all 8 in a sensible order; export from demo mode → unzip → paintings visible. `public/demo/*.jpg` and `src/demo/SOURCES.md` ARE committed (sample assets rule in AGENTS.md / .gitignore comment). Session log to `docs/bob-sessions/06-demo-artworks.md`. Small conventional commits — do NOT squash everything into one this time. Do not push; Hui pushes.
