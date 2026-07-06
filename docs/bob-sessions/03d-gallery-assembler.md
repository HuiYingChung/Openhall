# Bob Session 03D — Fix: stage-3 gallery.json output truncated
**Date:** 2026-07-05  
**Prompt:** BOB_PROMPT_03D.md  
**Status:** ✅ Complete — verified live with real API

---

## Root cause

The previous stage-3 path called `buildGalleryPrompt()` and asked the LLM to emit the **entire `gallery.json`** in one shot:  
rooms + doorways + placements + tour waypoints + 2–3 sentence labels for every artwork = **>3500 tokens of output**.  
`granite-3-8b-instruct` hit `max_new_tokens: 3000` and stopped mid-array. Same truncation point every retry → all 3 attempts failed with `SyntaxError: Expected ',' or ']' after array element in JSON at position 3533`.

LLMs are not the right tool for emitting coordinate geometry. The fix is to compute geometry in code and ask the LLM only for the small creative text it's actually good at.

---

## Fix

### Architecture change

| Stage | Before | After |
|---|---|---|
| Stage 3 input | `CurationPlan + preset` | unchanged |
| Stage 3 LLM call | One call emitting entire `gallery.json` (~3000 tokens) | **Removed** |
| Geometry | LLM-generated | Deterministic code (`gallery-assembler.ts`) |
| Labels | Bundled in same call | Separate batches of ≤4 works (~600 tokens each) |
| Stage 3 output | `Gallery` (after 3 retries that always fail) | `Gallery` (assembled + label-merged + `GallerySchema.parse`) |

### New files

**[`src/ai/gallery-assembler.ts`](src/ai/gallery-assembler.ts)**  
Deterministic geometry from `CurationPlan` + `StylePreset`:
- `buildRooms()` — room dimensions from preset, scaled slightly by artwork count; linear east doorway chain
- `buildPlacements()` — converts `PlacementBrief[]` to full `Placement[]` with fixed defaults
- `buildTourWaypoints()` — 2m in front of each artwork's wall, eye height 1.6m, looks at artwork centre
- `assembleGallery()` — orchestrates all of the above, returns shell with empty label placeholders
- `PRESET_PARAMS` — single source for all preset→material/lighting mappings (was in `gallery.prompt.ts`)
- `LabelsResponseSchema` — zod schema for the LLM label batch output

**[`src/ai/prompts/labels.prompt.ts`](src/ai/prompts/labels.prompt.ts)**  
Asks the LLM for `{ artworkId, label, artistStatement? }[]` for a batch of ≤4 works.  
Max output ~600 tokens — well within model limits.

**[`src/ai/gallery-assembler.test.ts`](src/ai/gallery-assembler.test.ts)**  
21 unit tests covering: room materials, doorway chain, last-room no-doorways, placement field preservation, tour waypoint positions (north/south/east/west walls at 2m distance), eye height, GallerySchema validity of assembled output.

**[`scripts/check-stage3.mjs`](scripts/check-stage3.mjs)**  
Standalone Node verification script. Runs full stage-3 path with real API key for 6 synthetic artworks.

### Modified files

**[`src/ai/watsonx.ts`](src/ai/watsonx.ts)**  
- `generateGallery()` rewritten: title (32 tokens) → `assembleGallery()` → label batches → `GallerySchema.parse()`
- `chat()` now checks `finish_reason`: if `'length'` or `'max_tokens'`, throws immediately with a clear message instead of returning truncated text for retries to fail on
- Removed import of `buildGalleryPrompt` and `extractJSON` (no longer needed here)

---

## Verification results

### Unit tests

```
7 test files, 59 tests passed (was 38)
  ✅ src/ai/gallery-assembler.test.ts  21 tests (new)
  ✅ all existing tests unchanged
```

### Live Node run (`node scripts/check-stage3.mjs`)

```
── Step 1: IAM token
  ✅ Token OK, expires in 3600s
── Step 2: Exhibition title (32 tokens)
  ✅ Title: "Abstraction's TactileSpectrum"
── Step 3: Deterministic geometry (in-process)
  ✅ 2 rooms built, 6 placements
  ✅ Doorways: 1 connection(s)
── Step 4: Label batches (≤4 works per call)
  ✅ Batch 1: 4 labels, max chars: 275
  ✅ Batch 2: 2 labels, max chars: 277
── Step 5: Assemble and schema-validate gallery
  ✅ Gallery structure valid
  ✅ 2 rooms, 6 artworks, 6 placements, 6 tour waypoints
  ℹ  All labels present: YES
── Summary
  ✅ Stage-3 gallery generation: PASS
```

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ Clean |
| `npm test` (vitest) | ✅ 59/59 pass |
| Stage-3 live run (6 works) | ✅ All labels present, valid structure |

---

## Why this is better

- **Reliable:** geometry never hits a token limit. Each label batch is ~600 tokens — far from any model ceiling.
- **Faster:** 2 label batches (for 6 works) vs 1 very large call that always failed.
- **Cheaper:** fewer retries, smaller outputs.
- **Testable:** deterministic functions have proper unit tests. The old LLM-as-geometry-engine had none.

---

## Services running

- **Token worker:** `npm run worker:dev` → `http://localhost:8787`
- **Vite app:** `npm run dev` → `http://localhost:5173`
