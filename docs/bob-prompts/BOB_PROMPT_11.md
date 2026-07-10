# Bob Prompt 11 — Final debug hardening: correct artwork identity, bounded images, and trustworthy AI output

Openhall is feature-complete, but a final read-only audit found several correctness bugs in state transitions that the current green suite does not cover. This is a debugging task, not a polish round. Fix the confirmed causes below with regression tests; do not redesign the app or add features.

Read `AGENTS.md`, `docs/PRODUCT_PLAN.md`, and the relevant source/tests before changing code. The architectural contracts in `AGENTS.md` still apply, especially: `gallery.json` is the source of truth, AI stages communicate through validated schemas, failures retry once then surface visibly, and the viewer remains framework-free.

Process requirements (non-negotiable):

- Start from the current `main` only after confirming the tree is clean. Work on a NEW branch named `final-debug-hardening`; never commit directly to `main`.
- Before each fix, add a focused regression test that fails for the reported bug. Then make the smallest change that turns it green. Do not weaken existing tests.
- Keep commits small and conventional. One commit per numbered section is preferred; do not mix a broad refactor with a fix.
- Commit all work, including `docs/bob-sessions/11-final-debug-hardening.md`. End with a clean `git status`. Do not push.
- The session log must paste the ACTUAL tail output of `npm test`, `npm run lint`, and `npm run build`. If any command or manual check cannot run, record that explicitly in both the log and final summary; never report an unrun or red check as green.

## 1. Stable artwork identity and a truthful AI cache key

Confirmed bugs:

- `src/ui/app.ts` creates an artwork id from `data.artworks.length + 1`. With `[aw-01, aw-02, aw-03]`, deleting `aw-02` and uploading again can create a second `aw-03`.
- `aiInputKey()` fingerprints only ids, brief, preset, provider, and model. Replacing an image with different bytes but the same recycled id produces a cache hit and silently reuses the old image's analysis, curation, labels, and narration.
- Editing an uploaded artwork's title, medium, or year also leaves the cache key unchanged, even though those fields are copied into the assembled gallery.

Required behavior:

- Every uploaded artwork receives a stable, unique id that is not derived from the current array length and cannot collide with any other upload in the session, even after arbitrary removals. Keep the `aw-` prefix; a UUID or another tested monotonic allocator is acceptable. Do not renumber retained artworks.
- Give each upload a deterministic content fingerprint derived from its actual image bytes (SHA-256 via browser Web Crypto is appropriate). Filename, byte length, and `lastModified` alone are not sufficient because they do not identify content reliably. Never log image bytes or the fingerprint.
- `aiInputKey()` must change when image content, title, medium, or year changes. It must remain stable for identical logical inputs and must still change for brief, preset, provider, and OpenAI model changes. Artist identity/branding stays OUT of this key because it is deliberately applied without an AI call.
- Preserve order independence only if the rest of the product treats upload order as irrelevant. If upload order affects curation or tour intent, the key must preserve it instead. Decide from the real prompts and pipeline, document the decision in the test name, and make key behavior match pipeline behavior.
- Removing an artwork must immediately refresh the Generate button, paid/free hint, pending confirmation state, and auto-favicon source. It must not leave the UI claiming a stale free cache hit.
- Clear the file input after processing so selecting the same file again fires a new `change` event.

Regression tests must cover at least:

1. Same ids but different image fingerprints produce different keys.
2. Title, medium, and year changes each produce a different key.
3. Identity/branding-only edits do not produce a different key.
4. Delete-middle-then-add and delete-last-then-add never duplicate a live id.
5. Replacing the last image with different bytes cannot enter the `Continue — no AI` path.
6. Removing the final artwork disables generation and invalidates the stale UI state.

Extract only small pure helpers where necessary to make this testable. Do not refactor all of `app.ts`.

## 2. Actually create the promised ≤2048px display/export image

Confirmed bug: upload currently creates a 1024px analysis data URL, then calls `createDisplayObjectUrl(file)` on the untouched original file. The `UploadedArtwork` contract says `displayObjectUrl` is ≤2048px, but a full-resolution phone/camera image is sent directly to Three.js and copied into the export zip.

Required behavior:

- Keep the analysis copy bounded to a 1024px longest edge.
- Create a separate display/export image whose longest edge is at most 2048px, with aspect ratio preserved and no upscaling of smaller originals. A canvas-produced JPEG `Blob` plus an object URL is appropriate; keep sensible visual quality and do not add a dependency.
- The real viewer texture and the exported `images/<artwork-id>.jpg` must both use this bounded display copy, never the original upload.
- Make image conversion failure visible and recoverable: catch errors per file, continue processing other valid files, and show one clear error/toast naming or counting skipped files. No unhandled promise rejection and no silent fallback to the original giant file.
- Revoke object URLs when an artwork is removed and when a portrait is replaced or removed. Also revoke temporary favicon-input URLs after conversion. Do not revoke a URL while the live scene or exporter still needs it.

Tests must cover dimension fitting in both landscape and portrait orientations, no upscaling, conversion failure cleanup, and the display-copy path being distinct from the original file URL. If jsdom cannot prove actual encoded dimensions, keep unit tests deterministic with the existing Canvas stubbing style and add the real-browser check below; do not fake a browser result in the test log.

## 3. Reject semantically invalid AI JSON and trigger the existing one retry

Confirmed bug: Zod currently validates field shapes but not referential integrity. A curation plan can contain duplicate or foreign ids, disagree with `roomCount`, omit an artwork, or point a placement at the wrong/nonexistent room and still pass. Label batches can omit expected ids or return duplicates/extras; missing labels then silently become `No label available.` instead of causing the promised validation retry. `WorkAnalysisSchema` also does not verify that the returned `artworkId` matches the image being analysed.

Implement reusable dynamic schemas or validation helpers that know the expected ids for the current call. Validation errors must flow through `generateValidated()` so the normal single retry receives the Zod error context. Do not parse or repair free-form JSON manually, and do not silently drop foreign entries.

Required invariants:

### Vision analysis

- The returned `artworkId` exactly equals the id passed to `analyzeArtwork()` in both Watsonx and OpenAI-compatible providers.

### Curation plan

- `roomCount === rooms.length`.
- Room ids are unique.
- The union of every `room.artworkIds` is exactly the expected input artwork-id set: no missing, duplicate, or foreign ids.
- Placements contain exactly one entry per expected artwork.
- Every placement references an existing room and the same room to which that artwork was assigned.
- `tourOrder` is an exact permutation of the expected artwork ids.

### Label/narration batches

- Each batch response contains exactly one entry for each id requested in that batch, with no duplicate, missing, or foreign ids.
- `narration` is required and non-empty because `labels.prompt.ts` explicitly requires spoken narration for every artwork. `artistStatement` may remain optional.
- Delete the `No label available.` silent-success path for generated galleries. After one invalid retry, fail visibly through the existing friendly error flow. Demo data is not affected.

### Final `GallerySchema`

- Add internal integrity checks appropriate to a self-contained `gallery.json`: unique room/artwork ids; placements and tour entries reference existing records; no duplicate placement for an artwork. Preserve valid support for the reserved artist tour id only when an artist exists—do not reject the intentional artist-intro waypoint.
- Do not make the viewer or exporter import AI modules. Shared invariants belong in schema/helpers at the existing boundary.

Regression tests must include one failure for every invariant above plus valid one-room and multi-room plans. Provider-level mocked tests must prove that a wrong id fails the first attempt, receives exactly one retry, and succeeds only if the second response has the exact expected id set. Also prove that two invalid responses surface an error rather than producing a partial gallery.

## 4. Clearing identity must remove stale exported identity and tour state

Confirmed bugs:

- `applyIdentity()` only assigns non-empty fields. After a custom title, description, author, or URL has been applied, clearing the corresponding draft can leave the old value in `data.gallery` and the export.
- `buildScene()` mutates `gallery.tour` by unshifting the reserved artist intro. If the artist is later removed, the old waypoint and old name are not removed.

Required behavior:

- Establish one explicit source of truth for the AI-generated title versus the user's current title override. Clearing a previous override must restore the correct generated title, not retain the stale override. A stored generated-title snapshot or an equivalent small, tested solution is acceptable.
- Identity-owned branding fields must be assigned when present and explicitly deleted when cleared. Do not delete unrelated branding values such as a curator-seeded description unless the user actually cleared/overrode that field according to current UI semantics.
- Clearing artist name removes `gallery.artist`, exported author identity owned by that draft, portrait/link data, and any reserved artist tour waypoint.
- Scene rebuilds must be idempotent: repeated builds with an artist create exactly one intro; rebuilding the same gallery after artist removal creates none. Prefer avoiding mutation of the input gallery, but if changing the `buildScene` return contract would cause a broad rewrite, make the existing mutation explicitly remove/rebuild only the reserved waypoint and cover it thoroughly.
- Review-screen edits and upload-screen drafts must not fight each other when the user goes Back to edit and returns without an AI call. Test the actual intended source-of-truth flow.

Add focused tests for apply → clear → cached rebuild, artist present → repeated rebuild, and artist present → remove → rebuild/export.

## 5. Bind Watsonx token caching to the active credentials

Confirmed bug: `src/ai/watsonx.ts` has one module-level token cache. Saving different Watsonx settings or using “Forget my key” clears localStorage but can leave the old account's bearer token active in memory until expiry.

Required behavior:

- A cached token may be reused only for the same active Watsonx authentication context. Bind the cache entry to the settings that produced it, including the API key identity and relevant endpoint/worker context, without logging or persisting any additional secret.
- `saveWatsonxSettings()` invalidates an incompatible cached token. `forgetStoredCredentials()` must invalidate the in-memory Watsonx token as well as localStorage.
- Preserve the existing expiry buffer and 401 invalidation behavior.
- Add `watsonx.test.ts` with mocked fetch proving: same settings reuse a valid token; changed credentials fetch a new token; save/forget invalidates; 401 invalidates; no credential appears in thrown messages or logs.

## 6. Bounded cleanup only

While touching lifecycle code, fix these confirmed leaks without starting a performance refactor:

- `disposeScene()` must dispose `scene.environment` when it is an owned disposable texture and clear the reference. Do not dispose shared external assets twice.
- Replacing/removing uploaded portrait and favicon input files must revoke their temporary object URLs.
- Keep existing mesh/material/texture disposal behavior and tests intact.

Do NOT optimize per-frame interaction traversal, split `app.ts`, change the room algorithm, or redesign renderer ownership in this work order.

## Out of scope — do not build

UI visual polish, new upload features, accounts, storage, analytics, new AI models/providers, prompt-copy rewrites unrelated to validation, room-layout changes, exporter redesign, demo-content/attribution edits, README/ROADMAP cleanup, bundle chunking, or a general `app.ts`/Three.js refactor. List any newly noticed issue in the session log; do not implement it unless it blocks one of the numbered fixes.

## Verification

Automated:

- Run the focused test file after each section, then the full suite.
- `npm test`
- `npm run lint`
- `npm run build`
- If this repository still uses the separate test/worker TypeScript configs, run those exact typechecks too and paste their actual tail output.

Manual, real browser:

1. Upload three images; generate; return to edit; delete the middle image; add a different image. There must be no duplicate id and the action must require a new AI call.
2. Delete the last image and replace it with different bytes but the same filename. It must require a new AI call. Metadata-only edits must also invalidate the AI cache; identity-only edits must not.
3. Upload at least one real image whose longest edge exceeds 4000px. Confirm the live display/export source is ≤2048px, the scene remains responsive, and the exported JPEG dimensions are ≤2048px.
4. Try one corrupt/spoofed image together with one valid image. The valid image must still upload and the bad file must produce a visible error.
5. Add artist identity, generate/build twice, then clear the artist and rebuild without AI. Confirm no artist plaque, no old artist tour stop/name, and no stale author/link in the exported `gallery.json` or HTML metadata.
6. Change Watsonx credentials/settings during the same page session and confirm the next request obtains a fresh token. Use safe test credentials only; never paste keys into the log.
7. Export, unzip, and open through a local HTTP server. Confirm all artwork images load, tour/voice works, and there are no console errors or missing files.

If a real Watsonx key or high-resolution test image is unavailable, say exactly which manual item was not run. Do not substitute mocked evidence for the manual result.
