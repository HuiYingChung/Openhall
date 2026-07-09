# AGENTS.md — Project context for IBM Bob (and any AI coding agent)

## What this project is

**Openhall**: an open-source web tool that turns up to 10 uploaded artwork images into a fully AI-generated, walkable 3D gallery (first-person WASD + mouse), exportable as a self-contained static site the artist hosts themselves. BYOK (bring-your-own-API-key); IBM watsonx.ai is the primary AI provider. See docs/PRODUCT_PLAN.md for full context, docs/ROADMAP.md for schedule.

## Tech stack

- Vite + TypeScript (strict mode)
- Three.js for all 3D (no game engine, no physics library)
- No backend, no database. Everything client-side except an optional stateless token-exchange worker for watsonx IAM auth
- JSZip for export packaging
- Vitest for unit tests

## Architecture rules (important)

1. **`gallery.json` is the single source of truth.** AI generates it, the viewer renders it, the exporter ships it. Schema lives in `src/schema/gallery.schema.ts` (zod). Never let the viewer depend on AI code or vice versa — they only share the schema.
2. **The 3D viewer must stay framework-free** (vanilla TS + Three.js) so the export bundle is small and self-contained. UI chrome around it may use a framework if needed.
3. **AI providers go behind one interface** (`AIProvider`): `analyzeArtwork(image) → WorkAnalysis`, `curate(analyses) → CurationPlan`, `generateGallery(description, plan) → GalleryParams`, `writeLabels(analyses) → Labels`. Implementations: `WatsonxProvider` (primary), `OpenAICompatProvider` (fallback).
4. **Structured LLM outputs are JSON**, validated with zod; on validation failure, retry once with the error message appended, then surface a friendly error. Never parse structure out of freeform LLM text. One deliberate exception: the exhibition title is requested as plain text and used verbatim (with a fallback) — do NOT route it through JSON validation; real models don't answer naming questions in JSON (learned the hard way in session 10).
5. **Rooms are procedural.** Geometry is generated from `GalleryParams` (dimensions, materials, lighting). No imported 3D models for architecture.
6. **Room count is AI-decided, not fixed.** The curation step chooses how many rooms based on artwork count and grouping; room DIMENSIONS are deterministic (preset base size, slightly widened by the room's artwork count — see PRESET_PARAMS in gallery-assembler.ts). The zod schema caps rooms at 4 for ≤10 artworks; invalid output triggers the standard retry. Room arrangement uses the simplest layout that works: rooms in a linear or L-shaped chain, doorways at shared walls, no overlaps. No circular or freeform floor plans in MVP. Style presets define materials/lighting/proportions/flow character only — never room count.
7. **API keys live in localStorage only.** They must never be sent anywhere except the AI provider's own endpoint (or our token-exchange worker for watsonx). No analytics, no logging of keys.

## Directory layout (target)

```
src/
  schema/        gallery.schema.ts, analysis.schema.ts (zod, shared contract)
  ai/            provider.ts (interface), watsonx.ts, openai-compat.ts, prompts/
  viewer/        room-builder.ts, controls.ts, collision.ts, interactions.ts, tour.ts
  ui/            upload, settings (BYOK), label editor, export
  export/        bundler.ts (JSZip)
  demo/          sample images + pre-generated gallery.json
worker/          token-exchange (optional, Cloudflare Worker)
docs/            bob-sessions/  ← commit BobShell logs here
```

## Conventions

- Conventional commits (`feat:`, `fix:`, `docs:`...). Small, focused commits.
- Every AI prompt template lives in `src/ai/prompts/` as a separate file with a comment stating expected output schema.
- Unit-test: schema validation, curation-plan → placement math, collision AABB logic, exporter output completeness. 3D rendering itself is verified manually.
- TypeScript strict; no `any` without a `// why:` comment.
- Keep the export bundle under 5 MB excluding artwork images.

## Working rules for AI coding agents (process & known pitfalls)

### Process

1. **Plan before code.** For any non-trivial task, state the plan (files to touch, approach) in 3–5 lines before writing code. If the plan conflicts with this file, stop and ask.
2. **Small steps, verified steps.** One feature or fix per commit. Run `npm test` and boot `npm run dev` after each meaningful change — don't stack unverified changes.
3. **Tests are the spec.** Write/update the unit test alongside the code, not after. Never weaken, skip, or delete a failing test to make the suite green — a failing test means the code is wrong, not the test. If a test is truly wrong, say so explicitly and justify before touching it.
4. **Fail loudly.** No silent `catch` blocks, no swallowing errors to make the demo look smooth, no fallback fake data without an explicit `// DEMO FALLBACK` marker. A visible error beats an invisible lie.
5. **No leftovers.** Don't commit `TODO: implement`, commented-out blocks, unused exports, or console.log debugging. Done means done.
6. **Log the session.** Any AI-agent session that changes code or docs ends with a committed summary log — Bob sessions to `docs/bob-sessions/`, Claude sessions to `docs/claude-sessions/`, following the existing format. Paste the actual tail output of the verification commands you ran; never summarize a red run as green — if something failed (even for environment reasons), say so in both the log and your summary. Read-only sessions need no log.
7. **One agent per working tree.** Never run git operations (switch, branch, commit, stash) in this repo while another agent's session is active in it — an uncommitted tree that isn't yours means stop and wait. (Learned 2026-07-08: a mid-session branch switch by a second agent silently rerouted the first agent's commits.)

### Known AI-agent pitfalls — actively avoid

- **Hallucinated or stale APIs.** Three.js changes APIs between releases (imports from `three/examples/jsm/`, color-management defaults, renamed properties). Pin the Three.js version in package.json, and when unsure about an API, check the installed version's actual exports/types in node_modules instead of guessing from memory. Same for the watsonx.ai API — follow the current official docs, not remembered endpoint shapes.
- **Invented packages.** Never add a dependency without verifying it exists and is the canonical package. Prefer the stack in this file; adding any new dependency requires a one-line justification in the commit message.
- **Over-engineering.** No premature abstractions, config systems, plugin architectures, or "flexibility for later". This is a 4-week MVP; the simplest code that satisfies the schema contract wins. Three similar lines of code do not need a factory.
- **Scope drift.** Solving the asked task plus "improvements" nobody asked for. Do only what the prompt asks; list ideas at the end as suggestions instead of implementing them.
- **Refactor + feature in one change.** Never mix them. Refactors are separate commits with no behavior change.
- **Resource leaks in Three.js.** Dispose geometries, materials, and textures when rebuilding scenes (gallery regeneration will rebuild often). Don't create objects inside the render loop.
- **Rewriting instead of debugging.** When something breaks, find the actual cause before proposing a rewrite. Rewrites hide bugs; they don't fix them.

## Git hygiene

Follow .gitignore strictly. Rules of thumb:

- **Never commit:** API keys or anything key-like (.env, tokens, IAM credentials), node_modules, build output (dist/), user-uploaded images, exported gallery zips, OS/editor noise.
- **Always commit:** source, `src/demo/` sample assets, prompt templates, planning docs (docs/PRODUCT_PLAN.md, docs/ROADMAP.md, AGENTS.md), Bob prompts in `docs/bob-prompts/`, BobShell session logs in `docs/bob-sessions/` and Claude session logs in `docs/claude-sessions/` (submission evidence), `.env.example` with placeholder values only.
- If a file might contain a real credential, stop and ask before committing.

## MVP scope guard

In scope: features F1–F10 in docs/PRODUCT_PLAN.md §5. Out of scope (do not build, even if asked casually): accounts, hosted persistence, multiplayer, VR, video artworks, payments. If a request conflicts with the docs/ROADMAP.md cut list, flag it instead of building.

## Definition of done (MVP)

Upload 10 images + one-sentence room description + BYOK key → walkable gallery (WASD, mouse-look, click-to-inspect, tour mode) → export zip → unzipped bundle works on Netlify Drop with zero modification. Demo mode works with no key at all.
