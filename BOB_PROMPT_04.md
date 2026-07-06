# Bob Prompt 04 — Week 3: interaction, export, polish

Read AGENTS.md, PRODUCT_PLAN.md, ROADMAP.md, and WEEK2_TEST_REPORT.md first. Week 2 is done and E2E-verified (2026-07-05). This task covers Week 3: feature-complete MVP. No Week 4 items (no README rewrite, no video).

Architecture reminder: the browser cannot reach IBM endpoints directly at all — the worker proxies IAM **and** all ML calls (see BOB_PROMPT_03C). Nothing in this week may reintroduce a direct browser→IBM call.

## 0. Carry-over fixes from the Week 2 report (do first, separate commits)

1. **placement-sanity inbound doorway offset**: `getAllDoorwaysOnWall()` doesn't re-convert `offsetFromCenter` to the receiving room's wall center like room-builder does. Extract room-builder's conversion logic and share it; add a test case with two rooms of different depth.
2. ESLint: add `{ ignores: ['dist/'] }`.
3. Settings form: set the API key via `input.value = ...`, not an innerHTML template string.

## 1. Artwork interaction (`src/viewer/interactions.ts`)

- Raycast from screen center while pointer-locked (crosshair pick); subtle hover highlight on the aimed artwork + small crosshair dot UI
- Click an artwork → smooth camera dolly to its viewing position (2 m in front, facing it, ~0.6 s ease) → info panel (title / medium / year / wall label). Esc or click closes the panel and returns WASD control
- Movement and collision stay disabled during dolly/panel; no way to get stuck

## 2. Tour mode (`src/viewer/tour.ts`)

- "Tour" button → camera follows the gallery.json tour waypoints in order: smooth movement, pause at each work with its label shown, Next / Prev / Exit controls
- Exit anywhere returns to free walk at the current position
- **Touch/mobile fallback**: on touch devices (no pointer lock), tour mode is the primary navigation, plus simple drag-to-look while paused. Basic is fine — it must not crash or trap the user

## 3. Export (`src/export/bundler.ts`)

- "Export" → JSZip bundle: framework-free viewer build, `gallery.json`, images, `index.html` — downloads as `openhall-export.zip`
- The unzipped folder must run on Netlify Drop and GitHub Pages **with zero modification**: relative paths only, no AI/provider code, no settings UI, no keys, no dev-only code
- Bundle < 5 MB excluding artwork images
- The exported viewer includes interaction + tour (sections 1–2), demo the same walkable experience

Build note: this likely needs a second Vite build target (viewer-only entry). Keep it simple — one extra entry/config, no plugin architecture.

## 4. Demo mode

- Commit 6–8 small public-domain sample artworks to `src/demo/` + one pre-generated `gallery.json` (generate it once with the real pipeline, then commit the output)
- From the landing/settings screen, "View demo gallery" → walkable instantly, zero keys, zero network calls to AI

## 5. Visual polish

- Simple frames around artworks (procedural box geometry, per-preset material)
- Per-work spotlight + preset-tuned ambient; avoid washed-out or pitch-black corners
- Loading/progress states polish (generation stages, texture loading)
- Dispose geometries/materials/textures on scene rebuild — regeneration must not leak

## 6. Deploy

- Worker: prepare `wrangler deploy` config with `ALLOWED_ORIGINS` set to the hosted app origin; app: prepare GitHub Pages or Vercel deploy config
- Deploying needs Hui's accounts — set everything up, then **stop and ask Hui** to run the deploy commands / connect accounts. Document exact steps in the session log

## Definition of done

`npm test` passes with new unit tests for: exporter output completeness (every placement has its image, entry file present), tour waypoint sequencing, doorway-offset conversion fix. `npx eslint .` and `npx tsc --noEmit` clean. Manual: full E2E with real key → hover/click-inspect/dolly works, tour completes, Esc never locks the user out; export zip dragged onto Netlify Drop is walkable unmodified; demo mode works in a fresh browser profile with no key. Cross-browser smoke: Chrome + Firefox + one mobile browser (tour fallback). Session log to `docs/bob-sessions/04-week3-interaction-export.md`. Small conventional commits, one feature per commit.
