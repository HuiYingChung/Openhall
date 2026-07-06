# Bob Prompt 03 — Week 2: AI pipeline (upload → analysis → gallery.json)

Read AGENTS.md, PRODUCT_PLAN.md, ROADMAP.md, and WEEK1_TEST_REPORT.md first. This task covers Week 2 of the roadmap: upload images + one sentence → AI produces a validated gallery.json that the Week 1 viewer renders. No Week 3 features (no raycast interaction, no export, no tour-mode UI).

Before starting: commit the uncommitted Week 1 fix changes (Bugs 2–4 + cleanups) as separate conventional commits — only Bug 1 was committed.

## 0. watsonx connectivity check (do this first)

Hui has a watsonx.ai API key. Write `scripts/check-watsonx.mjs`, a standalone Node script that:

- Reads `WATSONX_API_KEY` and `WATSONX_PROJECT_ID` from env vars (never hardcode, never commit keys; add `.env` to .gitignore)
- Exchanges the key for an IAM bearer token at `iam.cloud.ibm.com/identity/token`
- Calls a Granite text model with a trivial prompt and prints the response
- Calls Granite Vision with a small test image and prints the response
- Also probes whether the IAM endpoint returns CORS headers (`Access-Control-Allow-Origin`) — print a clear PASS/FAIL for "browser-direct feasible"

Stop after this script and ask Hui to run it. The CORS result decides step 3.

## 1. Upload UI + client-side processing

- Drag-drop / file-picker upload, max 10 images, JPEG/PNG/WebP
- Client-side resize + compress (canvas, longest edge ~1024px for AI analysis; keep a higher-res copy ≤2048px for display textures)
- Read real aspect ratio here and store it with each work — the viewer's hardcoded 0.75 ratio must be replaced by texture aspect
- Thumbnail grid with per-work title/medium/year fields (optional user input)

## 2. BYOK settings + provider abstraction

- Settings screen: provider selector (watsonx / OpenAI-compatible), API key, endpoint/project-id fields; persisted in localStorage; keys never leave the browser except direct calls to the chosen provider
- `src/ai/provider.ts` interface: `analyzeImage(image) → WorkAnalysis`, `generateJSON(prompt, schema) → unknown`. Two implementations: watsonx (Granite Vision + Granite LLM) and OpenAI-compatible (chat/completions with image content)

## 3. watsonx IAM token handling

- If step 0 showed browser-direct works: exchange + cache the IAM token client-side (respect expiry)
- If CORS blocks it: minimal serverless token-exchange worker in `worker/` (Cloudflare Worker style, ~50 lines: accept API key over HTTPS, return IAM token, no logging, no storage). The browser still calls ml.cloud.ibm.com directly with the bearer token
- Ask Hui before choosing if the result is ambiguous

## 4. AI pipeline (three prompt stages, all zod-validated with retry)

Shared helper: `generateValidated(prompt, zodSchema, maxRetries=2)` — parse LLM output as JSON, validate with zod, on failure re-prompt with the validation errors appended.

1. **Vision analysis** — per work: style, palette (hex array), subject, mood, 1-sentence description → `WorkAnalysisSchema`
2. **Curation** — input: all analyses + user's one-sentence brief; output: room count (1–4), grouping, ordering, wall assignment, tour waypoint order → intermediate `CurationSchema`
3. **Gallery generation** — curation + 1 of 4 style presets (white-cube / concrete-industrial / warm-wood / dark-dramatic) → full `gallery.json` conforming to `GallerySchema`, including per-work wall labels (2–3 sentences, no invented facts about the artist) and tour waypoints with positions computed from placements (stand 2m in front of each work)

Labels must be editable in the UI after generation (plain textarea list is fine this week).

## 5. Wire into the viewer

"Generate gallery" → progress states (analyzing n/10, curating, building) → validated gallery.json + uploaded images (as object URLs) → existing `buildScene`. Artwork planes now use real image textures and real aspect ratios. Placement sanity pass before rendering: clamp offsets so works fit their wall and don't overlap doorways.

## Definition of done

`npm test` passes (add unit tests for: generateValidated retry logic with a mocked LLM, placement sanity clamp, curation schema). `npx eslint .` and `npx tsc --noEmit` clean. Live flow works end-to-end with Hui's watsonx key: upload 6–10 images + one sentence → walkable gallery with real textures, correct aspect ratios, labels, and no impassable doorways. Session log to `docs/bob-sessions/03-ai-pipeline.md`. Small conventional commits.

If a watsonx model id or endpoint shape differs from what you expect, check the current watsonx.ai REST docs rather than guessing.
