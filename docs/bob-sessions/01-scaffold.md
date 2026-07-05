# Bob Session 01 — Scaffold + gallery.json schema + walkable room

**Date:** 2026-07-05  
**Prompt file:** `docs/BOB_PROMPT_01.md`  
**Week:** 1 of 4  
**Goal:** Repo scaffold → walkable hardcoded 3D gallery; `npm test` green; `npm run dev` runnable.

---

## What was built this session

### 1. Project scaffold
- `git init`, planning docs copied to `docs/`
- `package.json`: Vite 5 + TypeScript strict + Three.js 0.165 + zod + Vitest + ESLint (flat config, v9) + Prettier
- `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.prettierrc`, `eslint.config.js`
- `LICENSE` (MIT), `README.md` stub, `index.html`
- Directory tree per AGENTS.md: `src/{schema,ai/prompts,viewer,ui,export,demo}`, `worker/`, `docs/bob-sessions/`

### 2. `src/schema/gallery.schema.ts` — the single source of truth
Zod schema + inferred TypeScript types for:
- `GallerySchema` (version, title, rooms, artworks, placements, tour)
- `RoomSchema` (id, width/depth/height, surfaces, lighting, doorways)
- `SurfacesSchema` (wall/floor material presets, accentColor hex)
- `LightingSchema` (ambientIntensity, temperature, artworkSpotlights)
- `DoorwaySchema` (targetRoomId, wall, offsetFromCenter, width, height)
- `PlacementSchema` (artworkId, roomId, wall, offsetFromCenter, hangingHeight, displayWidth)
- `ArtworkSchema` (id, imagePath, title, medium, year, label, artistStatement)
- `TourWaypointSchema` (artworkId, position, lookAt, label)
- **`.max(4)` cap on rooms** per AGENTS.md rule 6 (AI-decided room count, capped at 4 for ≤10 artworks)

### 3. `src/demo/sample-gallery.json`
Two connected rooms (white-plaster + neutral / concrete + cold), 6 placeholder artworks (solid-color planes named by colour), 6 placements across both rooms, 6 tour waypoints. Validates against schema.

### 4. `src/viewer/collision.ts`
- `circleOverlapsAABB(px, pz, radius, box)` — nearest-point AABB test
- `resolveCollisions(px, pz, nx, nz, radius, walls)` — slide-along-axis resolution
- `buildWallAABBs(originX, originZ, width, depth, doorways)` — generates per-wall AABBs with doorway gaps carved out as 1-D segment splits

### 5. `src/viewer/room-builder.ts`
Procedural Three.js scene from a validated `Gallery` object:
- Rooms laid out in a linear row along +X (satisfies AGENTS.md "linear chain")
- Floor/ceiling `PlaneGeometry`, wall panels built as segment quads (doorway openings as gaps, no CSG)
- Material presets mapped to `MeshStandardMaterial` colors
- Artwork planes (`PlaneGeometry`) with thin frame quad, solid placeholder color derived from `imagePath`
- Per-room ambient + hemisphere + point light; temperature mapped to `THREE.Color`

### 6. `src/viewer/controls.ts`
- `FirstPersonControls` wrapping Three.js `PointerLockControls`
- WASD + arrow key movement, fixed eye height 1.6 m
- Calls `resolveCollisions` each frame; doorways passable
- `teleport()` and `lookAtPoint()` for tour mode (Week 3)

### 7. `src/ui/overlay.ts`
Controls hint overlay (WASD diagram, "Click to Enter" button). Dismissed on pointer lock. Stores seen-flag in `localStorage`.

### 8. `src/main.ts`
Wires renderer → schema validation → scene build → controls → overlay → resize → `requestAnimationFrame` loop.

---

## Tests

| File | Tests | Result |
|------|-------|--------|
| `src/schema/gallery.schema.test.ts` | 5 | ✅ all pass |
| `src/viewer/collision.test.ts` | 12 | ✅ all pass |
| **Total** | **17** | **✅** |

---

## Decisions made

| Decision | Rationale |
|----------|-----------|
| ESLint v9 flat config (`eslint.config.js`) | `@typescript-eslint` v7 requires ESLint ≤8; upgraded to v8 plugin for ESLint v9 compat |
| Rooms laid out along +X | Simplest linear chain; L-shape deferred to Week 2 when AI drives room count |
| `Group` for artwork (canvas + frame) cast to `Mesh` for scene API | Avoids a second `scene.add` call; raycasting done on canvas child mesh by userData |
| `.max(4)` on rooms array | Direct encoding of AGENTS.md rule 6 constraint in the schema |
| No texture loading for placeholder artworks | Week 1 goal is walkable geometry; real image loading is Week 2 |

---

## Design decisions deferred to later weeks

- L-shaped room layout (when AI produces 3–4 rooms)
- Image texture loading from `artwork.imagePath`
- Raycaster hover/click on artwork meshes (Week 3)
- Tour mode playback (Week 3)
- Export bundler (Week 3)
- AI pipeline (Week 2)

---

## Follow-up notes for next session (BOB_PROMPT_02)

The `AGENTS.md` rule 6 update (room count is AI-decided, cap 4, linear/L-shaped chains only) was reviewed and applied to the schema this session. No impact on Week 1 viewer code; will drive the curation prompt design in Week 2.
