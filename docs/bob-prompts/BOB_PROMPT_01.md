# Bob Prompt 01 — Project scaffold + gallery.json schema + walkable room

Read AGENTS.md, PRODUCT_PLAN.md, and ROADMAP.md in this folder first — they define the project, architecture rules, and scope. This task covers Week 1 of the roadmap only. Do not build anything from later weeks (no AI calls, no upload UI, no export yet).

## Task

Set up the Openhall project and get me to the Week 1 milestone: a walkable, hardcoded 3D gallery room.

### 1. Scaffold

- Initialize a git repo. Copy the planning docs (PRODUCT_PLAN.md, ROADMAP.md, BOB_PROMPT_*.md) into `docs/`; keep AGENTS.md at the repo root. Copy the provided .gitignore to the root before the first commit
- Vite + TypeScript (strict) project, with Three.js, zod, and Vitest as dependencies
- ESLint + Prettier configured
- MIT LICENSE file (this is an open-source project)
- Directory layout exactly as specified in AGENTS.md
- A minimal README stub (one paragraph, will be expanded later)
- Make the initial commit before writing any feature code, so history starts clean

### 2. gallery.json schema (the most important deliverable)

Define the schema in `src/schema/gallery.schema.ts` using zod, exported with inferred TypeScript types. It must describe:

- **rooms**: id, dimensions (width/depth/height in meters), connections to other rooms (doorway position + width)
- **surfaces**: wall/floor/ceiling material presets (e.g. white-plaster, concrete, dark-wood floor) and accent color
- **lighting**: ambient intensity, color temperature (warm/neutral/cold), per-artwork spotlight on/off
- **placements**: artwork id → room id, wall (n/s/e/w), horizontal offset, hanging height, display size
- **artworks**: id, image path, title, medium, year, label text (the AI-written wall label), optional artist statement
- **tour**: ordered waypoints (position + look-at target + artwork id) for guided tour mode

Also create `src/demo/sample-gallery.json`: one hardcoded gallery with 2 connected rooms and 6 artworks (use solid-color placeholder images generated at build time or simple included PNGs), which must validate against the schema. Add a unit test that validates it.

### 3. Procedural room builder

`src/viewer/room-builder.ts`: takes a validated gallery object and builds the Three.js scene — walls/floor/ceiling meshes from room dimensions and material presets, doorway openings between connected rooms, artwork planes with simple frames at their placements, lighting per the lighting config. No imported 3D models; everything procedural. Keep it framework-free vanilla TS per AGENTS.md rule 2.

### 4. First-person controls

- PointerLockControls: click to lock, mouse-look, WASD movement (fixed eye height 1.6m, no jump/gravity)
- AABB collision against walls so the visitor can't walk through them (doorways passable)
- A controls-hint overlay shown on first entry ("WASD to move, mouse to look, click to interact"), dismissed on pointer lock
- Unit tests for the AABB collision logic

### 5. Definition of done for this task

`npm run dev` opens the demo gallery; I can walk both rooms with WASD + mouse, collide with walls, pass through the doorway, and see 6 framed placeholder artworks correctly placed and lit. `npm test` passes. Commit in small conventional commits. Save this session's log to `docs/bob-sessions/01-scaffold.md` and commit it.

If any architecture decision isn't covered by AGENTS.md, ask me before deviating from it.
