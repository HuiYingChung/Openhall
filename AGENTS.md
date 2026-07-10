# AGENTS.md — Project context for IBM Bob (and any AI coding agent)

## What this project is

**Openhall**: an open-source web tool that turns up to 10 uploaded artwork images into an AI-curated, deterministically built, walkable 3D gallery (first-person WASD + mouse), exportable as a self-contained static site the artist hosts themselves. BYOK (bring-your-own-API-key); IBM watsonx.ai is the primary AI provider. See docs/PRODUCT_PLAN.md for full context, docs/ROADMAP.md for schedule.

## Tech stack

- Vite + TypeScript (strict mode)
- Three.js for all 3D (no game engine, no physics library)
- No database and no Openhall-operated backend. The watsonx browser route requires a user-configured stateless Cloudflare relay for IBM IAM token exchange and the watsonx ML request; the OpenAI-compatible route calls its provider directly
- JSZip for export packaging
- Vitest for unit and integration tests; Playwright for the exported-bundle browser smoke test

## Architecture rules (important)

1. **`gallery.json` is the single source of truth.** The generation pipeline produces it, the viewer renders it, and the exporter ships it. Schema lives in `src/schema/gallery.schema.ts` (zod). Never let the viewer depend on AI code or vice versa — they only share the schema.
2. **The 3D viewer must stay framework-free** (vanilla TS + Three.js) so the export bundle is small and self-contained. UI chrome around it may use a framework if needed.
3. **AI providers go behind one interface** (`AIProvider`): `analyzeArtwork(artwork) → WorkAnalysis`, `curate(analyses, brief) → CurationPlan`, and `generateGallery(artworks, analyses, plan, preset, onProgress?) → Gallery`. The shared composition path handles the title, deterministic assembly, and label/narration batches. Implementations: `WatsonxProvider` (primary), `OpenAICompatProvider` (fallback).
4. **Structured LLM outputs are JSON**, validated with zod; on validation failure, retry once with the error message appended, then surface a friendly error. Never parse structure out of freeform LLM text. One deliberate exception: the exhibition title is requested as plain text, trimmed, stripped of surrounding single or double quotes, and given `New Exhibition` as the empty-response fallback — do NOT route it through JSON validation; real models don't answer naming questions in JSON (learned the hard way in session 10).
5. **Rooms are procedural.** Geometry is generated deterministically from the curation plan and selected style preset. No imported 3D models for architecture.
6. **Room count is AI-decided, not fixed.** The curation step chooses how many rooms based on artwork count and grouping; room dimensions are deterministic (preset base size, with width increased by 1.5 metres for each artwork beyond the first three in a room — see `PRESET_PARAMS` in `gallery-assembler.ts`). The curation and gallery schemas cap rooms at 4; the upload UI separately caps artworks at 10. Rooms form one linear eastward chain only. Curation validation requires a monotonic room order, the assembler inserts doorway transit waypoints, and the tour viewer passes through them without treating them as visitor stops. No L-shaped, circular, or freeform floor plans in MVP. Style presets define materials, lighting, and proportions — never room count.
7. **API keys live in localStorage only.** They must never be sent anywhere except the selected provider's endpoint or the user-configured watsonx relay. The relay may send the key to IBM IAM and model payloads to the allowlisted watsonx ML host. No analytics, no request-body logging, and no Openhall-operated credential service.

## Directory layout

```
src/
  schema/        gallery.schema.ts, analysis.schema.ts (zod, shared contract)
  ai/            provider.ts (interface), watsonx.ts, openai-compat.ts, prompts/
  viewer/        room-builder.ts, controls.ts, collision.ts, interactions.ts, tour.ts
  ui/            upload, settings (BYOK), label editor, export
  export/        bundler.ts (JSZip)
  demo/          prebuilt gallery.json + sample source attribution
public/demo/     bundled CC0 sample artwork images
worker/          watsonx IAM + ML relay (required for the watsonx browser route)
docs/            Bob, Claude, and Codex prompts/session evidence
```

## Conventions

- Conventional commits (`feat:`, `fix:`, `docs:`...). Small, focused commits.
- Reusable structured-output prompt templates live in `src/ai/prompts/` as separate files with comments naming their expected schemas. The short plain-text exhibition-title prompt is the deliberate inline exception.
- Test schema validation, curation-plan → placement/tour math, collision AABB logic, exporter completeness, credential exclusion, and zero external HTTP requests on exported-viewer startup. 3D visual feel is still verified manually.
- TypeScript strict; no `any` without a `// why:` comment.
- Keep the export bundle under 5 MB excluding artwork images.

## Working rules for AI coding agents (process & known pitfalls)

### Process

1. **Plan before code.** For any non-trivial task, state the plan (files to touch, approach) in 3–5 lines before writing code. If the plan conflicts with this file, stop and ask.
2. **Small steps, verified steps.** One feature or fix per commit. Run `npm test` and boot `npm run dev` after each meaningful change — don't stack unverified changes.
3. **Tests are the spec.** Write/update the unit test alongside the code, not after. Never weaken, skip, or delete a failing test to make the suite green — a failing test means the code is wrong, not the test. If a test is truly wrong, say so explicitly and justify before touching it.
4. **Fail loudly.** No silent `catch` blocks, no swallowing errors to make the demo look smooth, no fallback fake data without an explicit `// DEMO FALLBACK` marker. A visible error beats an invisible lie.
5. **No leftovers.** Don't commit `TODO: implement`, commented-out blocks, unused exports, or console.log debugging. Done means done.
6. **Log the session.** Any AI-agent session that changes code or docs ends with a committed summary log — Bob sessions to `docs/bob-sessions/`, Claude sessions to `docs/claude-sessions/`, and Codex sessions to `docs/codex-sessions/`, following the existing format. Paste the actual tail output of the verification commands you ran; never summarize a red run as green — if something failed (even for environment reasons), say so in both the log and your summary. Read-only sessions need no log.
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
- **Always commit:** source, `src/demo/` sample assets, prompt templates, planning docs (docs/PRODUCT_PLAN.md, docs/ROADMAP.md, AGENTS.md), Bob prompts in `docs/bob-prompts/`, and AI-tool session logs in `docs/bob-sessions/`, `docs/claude-sessions/`, and `docs/codex-sessions/` (submission evidence), `.env.example` with placeholder values only.
- If a file might contain a real credential, stop and ask before committing.

## MVP scope guard

In scope: features F1–F10 in docs/PRODUCT_PLAN.md §5. Out of scope (do not build, even if asked casually): accounts, hosted persistence, multiplayer, VR/WebXR, video or imported 3D artworks, payments, managed public AI usage, and one-click deployment APIs. If a request conflicts with the scope guards here or in docs/ROADMAP.md, flag it instead of building.

## Definition of done (MVP)

Upload 10 images + one-sentence curatorial brief + style preset + BYOK key → walkable gallery (WASD, mouse-look, click-to-inspect, tour mode) → export zip → unzipped bundle works on Netlify Drop with zero modification. Demo mode loads a prebuilt gallery with no key for the visitor and export experience; it does not simulate upload or AI generation.
