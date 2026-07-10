# Session 11 — Final Debug Hardening

**Branch:** `final-debug-hardening`

**Base commit (work order):** `f7d61dc`

**Session implementation commits:** 7 (6 numbered fixes + 1 lint follow-up)

**Date:** 2026-07-10

---

## Summary

Bob implemented all six numbered debug sections from BOB_PROMPT_11.md with regression tests written before each fix. 73 new tests were added (313 → 386 passing). The Bob session was then stopped before manual browser verification and before this log was committed; Codex audited and completed the work in the addendum below.

---

## Commits (chronological)

| Hash | Section | Description |
|------|---------|-------------|
| `b1bd7b9` | §1 | Stable artwork id allocator, content fingerprint, and accurate aiInputKey |
| `6696d02` | §2 | Bounded display/export image (≤2048px) and URL lifecycle |
| `ff99a91` | §3 | Semantic AI validation and GallerySchema integrity checks |
| `c10c263` | §4 | Identity apply/clear correctness and idempotent buildScene artist waypoint |
| `0d6bbbc` | §5 | Bind Watsonx token cache to active credentials |
| `6c40626` | §6 | disposeScene environment texture leak |
| `dd2cbaf` | fix | Lint errors from §2–§5 changes |

---

## §1 — Stable artwork identity and truthful AI cache key

**Files changed:** `src/ai/provider.ts`, `src/ui/image-utils.ts`, `src/ui/app.ts`, `src/ui/app.cache-key.test.ts`

**Bugs fixed:**
- Artwork ids were derived from `data.artworks.length + 1` — deleting then uploading could create a second `aw-03`.
- `aiInputKey()` only fingerprinted ids, not image bytes, title, medium, or year — same-filename replacement was a cache hit.
- Removing an artwork did not refresh the Generate button state.

**Fixes:**
- `allocateArtworkId()` — monotonic session counter, never reuses after removals.
- `computeContentFingerprint(file)` — SHA-256 via `globalThis.crypto.subtle`, hex-encoded, never logged.
- `UploadedArtwork.contentHash` field added.
- `aiInputKey()` now segments each artwork as `id:hash:title:medium:year`, preserving upload order (pipeline-order-sensitive per curation prompt review). Identity fields remain excluded.
- `handleFiles`: uses allocator + fingerprint, catches per-file errors, shows one visible toast for skipped files, clears file input after processing.
- `addThumbnail`: accepts `onRemove` callback; remove handler revokes display URL, calls `disarmOnInputChange()` + `refreshFav()`.
- Upload order is now preserved in key (not sorted) — documented in test name.

**Tests:** 15 tests in `app.cache-key.test.ts` covering all six §1 numbered invariants, updated order-preservation assertion.

---

## §2 — Actually create the promised ≤2048px display/export image

**Files changed:** `src/ui/image-utils.ts`, `src/ui/app.ts`, `src/ui/image-utils.test.ts` (new)

**Bug fixed:** `createDisplayObjectUrl(file)` returned the original full-resolution file directly to Three.js and the exporter.

**Fixes:**
- `createDisplayBlobUrl(file, maxEdge=2048)` — canvas downscale to ≤2048px longest edge, no upscaling, JPEG blob, revokes temp load URL on load and on error.
- `handleFiles` uses `createDisplayBlobUrl` instead of `createDisplayObjectUrl`.
- Favicon: temp URL revoked after `generateFaviconDataUrl`; file input cleared.
- Portrait: old blob URL revoked before replacement; revoked on reset.
- Artwork remove handler revokes `displayObjectUrl`.

**Tests:** 12 tests in `image-utils.test.ts` — dimension fitting (landscape/portrait/no-upscale/exact-max), toBlob-null failure, load failure with URL cleanup, distinct blob URL contract.

---

## §3 — Reject semantically invalid AI JSON and trigger the existing one retry

**Files changed:** `src/ai/validation.ts` (new), `src/ai/watsonx.ts`, `src/ai/openai-compat.ts`, `src/ai/provider.ts`, `src/schema/gallery.schema.ts`, `src/ai/provider.test.ts`, `src/ai/validation.test.ts` (new)

**Bugs fixed:**
- `WorkAnalysisSchema` did not verify returned `artworkId` matched the one requested.
- `CurationPlanSchema` did not check roomCount/rooms.length, unique ids, partition invariant, or placement-room consistency.
- Label batches could omit ids or return duplicates; missing labels became `'No label available.'` silently.
- `GallerySchema` had no internal integrity checks.

**Fixes:**
- `buildAnalysisSchema(expectedId)` — rejects wrong artworkId.
- `buildCurationSchema(expectedIds)` — 7 invariant checks (roomCount, unique room ids, partition, unique placements, placement completeness, room reference, artwork-room assignment, tourOrder permutation).
- `buildLabelsSchema(batchIds)` — exact id set + narration required and non-empty.
- Both providers use new dynamic schemas; `composeGalleryFromPlan` uses per-batch labels schema.
- Deleted `'No label available.'` silent fallback — two invalid responses now surface through `generateValidated()`.
- `GallerySchema.superRefine()` — unique room/artwork ids, placement referential integrity, no duplicate placement per artwork, tour waypoint reference validity with `ARTIST_TOUR_ID` exception.
- `ARTIST_TOUR_ID = '__artist__'` exported from `gallery.schema.ts`.

**Tests:** 31 tests in `validation.test.ts` — one failure per invariant, valid single-room and multi-room plans, GallerySchema integrity; 22 tests in `provider.test.ts` (updated existing + 1 new "loud failure on double-invalid").

---

## §4 — Clearing identity must remove stale exported identity and tour state

**Files changed:** `src/ui/app.ts`, `src/viewer/room-builder.ts`, `src/ui/app.identity.test.ts` (new)

**Bugs fixed:**
- `applyIdentity()` only assigned non-empty fields — clearing a draft left stale value in `gallery`.
- `buildScene()` did not remove the artist waypoint when artist was removed; repeated builds could accumulate it.

**Fixes:**
- `AppData.generatedTitle` — snapshot populated after AI generation; used as restore target when user title override is cleared.
- `applyIdentity()` — exported; each field assigned when set, deleted when cleared. `gallery.branding` set to `undefined` when all fields cleared. Handles title restore from `generatedTitle`.
- `buildScene()` — remove any existing `ARTIST_MESH_ID` waypoint before (re)inserting. When `gallery.artist` is absent, purge any stale artist waypoint.

**Tests:** 13 tests in `app.identity.test.ts` — apply/clear/restore, field deletion, buildScene idempotency for artist waypoint.

---

## §5 — Bind Watsonx token caching to the active credentials

**Files changed:** `src/ai/watsonx.ts`, `src/ui/app.ts`, `src/ai/watsonx.test.ts` (new)

**Bug fixed:** Module-level `_tokenCache` was unbound to credentials — saving new settings or "Forget my key" left old account's token active in memory.

**Fixes:**
- `TokenCache.settingsKey` — credential-binding key (`apiKey|projectId|tokenWorkerUrl|wxUrl`), held only in module memory, never logged or thrown.
- `getToken()` — reuses cache only when `settingsKey` matches AND not expired.
- `saveWatsonxSettings()` — calls `invalidateToken()` before writing.
- `forgetStoredCredentials()` — calls `invalidateToken()` in addition to localStorage cleanup.
- 401 invalidation unchanged.

**Tests:** 6 tests in `watsonx.test.ts` — same-settings reuse, changed-key refetch, saveWatsonxSettings invalidates, forgetStoredCredentials invalidates, 401 invalidates, no credential in thrown messages.

---

## §6 — Bounded cleanup only

**Files changed:** `src/viewer/room-builder.ts`, `src/viewer/room-builder.test.ts`

**Bug fixed:** `disposeScene()` did not dispose `scene.environment` — the PMREMGenerator-derived texture from `makeStudioEnvTexture()` was leaked on every gallery regeneration.

**Fix:**
- `disposeScene()` checks `scene.environment instanceof THREE.Texture`, disposes it, and sets reference to `null`. Does not affect null/non-texture environments.

**Tests:** 2 new tests in `room-builder.test.ts` — environment disposal fires and reference is cleared; no throw when already null.

---

## Verification

### `npm test`

```
Test Files  25 passed (25)
      Tests  386 passed (386)
   Start at  01:27:50
   Duration  15.63s (transform 1.87s, setup 7ms, collect 9.83s, tests 9.59s, environment 61.58s, prepare 17.38s)
```

### `npm run lint`

```
> openhall@0.1.0 lint
> eslint .
```
(No output = no errors)

### `npm run build`

```
dist-viewer/viewer.js  751.96 kB │ gzip: 170.43 kB
✓ built in 1.85s

dist/index.html                          1.07 kB │ gzip:   0.61 kB
dist/assets/index-ByYQ_KOU.css          9.50 kB │ gzip:   2.59 kB
dist/assets/sample-gallery-Bjq5TFw_.js  9.08 kB │ gzip:   3.50 kB
dist/assets/bundler-DJEjK_IF.js       103.28 kB │ gzip:  32.95 kB
dist/assets/index-Cm9z1D2G.js         675.40 kB │ gzip: 176.54 kB
✓ built in 2.50s
```
(Chunk size warning is pre-existing, not introduced by this session.)

### Manual browser checks

- The live Watsonx flow was not run during the Bob portion. The later Codex takeover also deliberately avoided a paid provider call, so manual items that require a real AI response remain explicitly unclaimed.
- Manual item 3 (≥4000px image display/export dimensions) and item 7 (export zip open in local HTTP server): not verified manually. Automated evidence: `createDisplayBlobUrl` canvas-size tests confirm ≤2048px output contract; export-chain integration test and export-viewer smoke test remain green.

---

## Codex takeover addendum

The review-screen favicon URL leak noted above was part of Prompt 11's lifecycle scope and was fixed during the Codex takeover, together with several integration gaps that the first pass did not cover:

- review-screen identity edits now remain the source of truth after Back → cached rebuild;
- metadata edits disarm stale paid-call confirmation state and refresh the cost hint;
- cache-key serialization cannot collide on user-entered delimiter characters;
- content fingerprints remain content-derived when Web Crypto is unavailable;
- favicon temporary URLs are revoked on both success and failure paths;
- every stale/duplicate artist tour waypoint is removed before rebuilding;
- entering the demo no longer destroys a user's existing upload/gallery draft.

Final implementation commit: `5546873` (`fix: close final debug hardening gaps`). Final verification reached 26 test files and 402/402 tests, with lint, both TypeScript scopes, the token worker check, production build, and local browser checks passing. See `docs/codex-sessions/2026-07-10-final-debug-takeover.md` for the exact results and the explicitly untested live-provider boundary.
