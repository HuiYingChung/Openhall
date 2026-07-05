# Bob Session 03 — Week 2: AI pipeline (upload → analysis → gallery.json)

**Date:** 2026-07-05  
**Prompt file:** `docs/BOB_PROMPT_03.md`  
**Week:** 2 of 4

---

## Step 0: watsonx connectivity probe

Ran `node scripts/check-watsonx.mjs` after correcting the project ID format (API key was mistakenly put in the Project ID field).

**Results:**
| Check | Result |
|---|---|
| IAM token exchange | ✅ Working |
| CORS on IAM endpoint | ❌ No `Access-Control-Allow-Origin` — browser-direct blocked |
| Granite text models | ❌ `ibm/granite-3-3-8b-instruct` not found (404) |
| Listed all 24 available models | ✅ |
| `ibm/granite-3-8b-instruct` | ✅ Working — replied `OPENHALL_OK` |
| `meta-llama/llama-3-2-11b-vision-instruct` | ✅ Working — identified red pixel correctly |

**Decisions made:**
- **Text LLM:** `ibm/granite-3-8b-instruct`
- **Vision LLM:** `meta-llama/llama-3-2-11b-vision-instruct` (only vision model on this plan — no Granite Vision available)
- **Token exchange:** Cloudflare Worker required (CORS blocks browser-direct IAM)

---

## Files created / modified

### New schemas
- **`src/schema/analysis.schema.ts`** — `WorkAnalysisSchema` (per-artwork: style, palette, subject, mood, description) and `CurationPlanSchema` (roomCount 1–4, room groupings, placements, tourOrder, curatorNote)

### AI layer
- **`src/ai/provider.ts`** — `AIProvider` interface, `UploadedArtwork` type, `STYLE_PRESETS` map, `generateValidated()` retry helper, `extractJSON()` fence stripper
- **`src/ai/watsonx.ts`** — `WatsonxProvider` with IAM token cache (60s early refresh), `loadWatsonxSettings()` / `saveWatsonxSettings()`, all 3 pipeline stages
- **`src/ai/openai-compat.ts`** — `OpenAICompatProvider` as fallback (same interface, OpenAI chat/completions format)
- **`src/ai/prompts/analyze.prompt.ts`** — vision analysis prompt → `WorkAnalysisSchema`
- **`src/ai/prompts/curate.prompt.ts`** — curation prompt → `CurationPlanSchema`
- **`src/ai/prompts/gallery.prompt.ts`** — gallery generation prompt → `GallerySchema`, with per-preset material/lighting params

### Token worker
- **`worker/token-exchange.ts`** — Cloudflare Worker (~80 lines): POST `{apiKey}` → exchange with IBM IAM → return bearer token with CORS headers. Supports `ALLOWED_ORIGINS` env var.

### UI
- **`src/ui/app.ts`** — Full application state machine (settings → upload → generating → labels → viewer):
  - Settings screen: provider selector, BYOK fields, demo mode button
  - Upload screen: drag-drop / file picker, 10-image limit, per-work title/medium/year fields, preset buttons
  - Generating screen: progress bar across 5 stages (analyse ×N, curate, design, verify, build)
  - Label editor: editable textareas for all AI-generated wall labels before entering the gallery
- **`src/ui/image-utils.ts`** — `resizeToDataUrl()` (canvas resize to max edge, JPEG compression), `createDisplayObjectUrl()`, `readImageDimensions()`
- **`src/ui/placement-sanity.ts`** — `sanitizePlacements()`: clamps `offsetFromCenter` so artworks stay on wall and clear doorways; returns new gallery object (immutable)

### Viewer updates
- **`src/viewer/room-builder.ts`** — `buildScene()` now accepts optional `aspectRatios: Map<string, number>`; `buildArtworkPlane()` accepts `aspectRatio?`, uses `THREE.TextureLoader` for blob/data URLs, falls back to placeholder colour for demo mode. Fixed `group as unknown as Mesh` type cast — now returns `{group, canvasMesh, worldPos}` properly.

### Entry point
- **`src/main.ts`** — Slimmed to 3 lines: imports and calls `bootApp()`.

---

## Tests (38 total, all passing)

| File | Tests | What's covered |
|---|---|---|
| `src/ai/provider.test.ts` | 9 | `extractJSON` (4 cases), `generateValidated` retry logic (5 cases) |
| `src/schema/analysis.schema.test.ts` | 5 | `WorkAnalysisSchema` valid/invalid, `CurationPlanSchema` valid/roomCount cap/offsetBounds |
| `src/ui/placement-sanity.test.ts` | 4 | No-op on valid placements, clamp pos/neg offset, immutability |
| (existing) | 20 | gallery schema, collision, room-builder integration |

---

## Known gaps / Week 3 items

- Token-exchange worker not yet deployed — browser flow requires `tokenWorkerUrl` to be set in settings. For local testing, `tokenWorkerUrl` can be left blank (Node scripts bypass CORS).
- Real texture loading works but uses `TextureLoader` which is async; artwork may flash grey for one frame on first load.
- Tour mode playback not yet wired into viewer (Week 3).
- Raycast click-to-inspect not yet wired (Week 3).
