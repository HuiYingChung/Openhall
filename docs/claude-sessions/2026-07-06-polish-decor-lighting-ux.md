# Claude session — 2026-07-06 — Polish: decor system, physical lighting, tour/inspect UX

Context: Bob's trial credits are nearly exhausted. Per the team's division of labor
(Bob = structure & features, Claude = aesthetics & polish), Claude implemented
directly in the repo this session; Hui drove all design decisions and manually
verified every change in the browser.

## Bob (BOB_PROMPT_08, its final credited session)

- Entry overlay now says Esc pauses/exits
- Settings screen Cancel button (hidden on first run)
- Review Wall Labels "← Back to edit" (reuses exitToMenu teardown)
- Follow-up: close (×) button on the entry hint overlay

## Claude — engine & visual work (shared by demo, generated galleries, and exports)

- **Per-style decor system** (`src/viewer/decor.ts`, new): four design languages
  (White Cube / Industrial / Warm Wood / Dark & Dramatic) derived from
  `surfaces.wall` — no gallery.json schema change. 3D picture frames (gold inner
  lip on Dark & Dramatic), ceiling spot fixtures with emissive lenses mounted
  1 m off the wall and angled at the artwork, brass picture lights (Warm Wood),
  baseboards that respect doorway gaps, style-specific benches with collision
  AABBs, per-style ceiling colors, fake entrance portal in the first room
  (doors, jambs, handles, entrance light; coexists with art ≥2.2 m from wall centre).
- **Physical lighting**: ACES filmic tone mapping, procedural studio environment
  map (IBL reflections for glossy floors/metals), physical light units with
  per-style budgets, point-light grid so large rooms have no dark corners.
- **Floors**: procedural textures (wood planks with butt joints, concrete
  blotches, marble veins; seeded PRNG) + per-material reflectivity
  (polished concrete 0.28 gloss → raw concrete 0.92 matte).
- **Artwork legibility**: subtle env reflection while walking; reflections are
  fully suppressed during inspect so the work reads like the flat image.

## Claude — UX work

- Inspect panel: defaults bottom-right, draggable (shared `wirePanelDrag`),
  grab-bar handle + hint text, scrollable when long
- Tour label: desktop = draggable floating card defaulting bottom-left (never
  covers the artwork); narrow viewports (<768 px) = full-width bottom sheet
  (≤38 vh, scrollable) with collapse/expand toggle that shrinks it to a slim
  strip; controls dock as a full-width bottom bar beneath the sheet
- Layout is width-based only and now responds live to resize/rotation
- HUD Menu/Export buttons moved into a flex row (no more overlap)
- Homepage: tagline, 4-step how-it-works, Settings/API hint with a direct
  "view the demo gallery" link (demo flow now shared between screens)
- Brief field helper text explains how the sentence steers grouping, tour
  order, and label tone

## Ops & incidents

- watsonx Lite token quota exhausted mid-testing (300k tokens); plan upgraded
  to pay-as-you-go same day; spending notification set at $10
- Dropbox silently reverted uncommitted edits three separate times; recovered
  each time. Mitigation: `save-work.cmd` one-click checkpoint at repo root,
  and commit-after-every-batch discipline
- `npm run dev` now rebuilds the viewer engine first, so exports can never
  ship a stale engine; the staleness guard also warns when viewer.meta.json
  is missing

## State at end of session

All of the above committed and pushed. Pending next session: `npx vitest run`
(expected ~135 tests incl. new decor/entrance suites), walk the three
non-white-cube styles with the new lighting, Room B warmth judgement call.
