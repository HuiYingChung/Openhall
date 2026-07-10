# Codex session — final debug takeover

**Date:** 2026-07-10

**Branch:** `final-debug-hardening`

**Bob implementation head at takeover:** `dd2cbaf`

**Codex implementation commit:** `5546873`

**Work order:** `docs/bob-prompts/BOB_PROMPT_11.md`

## Scope and provenance

IBM Bob was stopped after committing the six Prompt 11 sections and a lint follow-up. Codex then audited the implementation commit-by-commit, finished the missing integration work, ran automated and real-browser checks, and recorded the result.

Openhall remains a solo creator project. The agent names in this repository identify the AI tools used for implementation/review evidence; they do not represent a multi-person team.

No branch switch, merge, push, deployment, or paid AI-provider request was performed during this takeover.

## Gaps found after the Bob pass

1. **Review identity could revert.** Review-screen title, description, artist name, URL, and statement edits changed `gallery` but not the upload identity draft. Back → cached rebuild reapplied stale values. An explicitly cleared curator description could also reappear.
2. **Artwork metadata left stale cost state.** Editing title/medium/year changed the real AI input but did not disarm the two-click paid-call confirmation or refresh its hint.
3. **Cache keys could collide.** The delimiter-joined key was ambiguous when metadata itself contained `:`, `,`, or `|`.
4. **Content identity could become empty.** If `crypto.subtle` was absent or rejected, every file received an empty fingerprint and same-slot replacement could reuse stale AI output.
5. **Review favicon leaked a blob URL.** The upload copy revoked its temporary URL; the review copy did not.
6. **Upload failure could orphan a display URL.** The persistent display copy was created in the same `Promise.all` as operations that could still reject.
7. **Artist waypoints were not fully idempotent.** Only the first reserved waypoint was removed, and an artist with no available plaque slot could retain a stale waypoint.
8. **Demo preview destroyed an in-progress user draft.** A real browser run showed that upload → demo → Back returned with zero artworks and no reachable cleanup path for the old blob URL.
9. **Some tests mirrored implementation.** The image-fit test copied an internal helper rather than testing the production function.

## Changes made

- Structured `aiInputKey()` serialization and metadata-change UI notifications.
- SHA-256 fingerprint with deterministic content-derived FNV-1a fallback.
- Shared favicon-from-file helper with `finally` cleanup on both screens.
- Persistent ≤2048px display URL created only after analysis/hash success.
- Review identity edits synchronized through the same `applyIdentity()` fold used before scene builds.
- Explicit description clear preserved without suppressing untouched curator seeding.
- All reserved artist waypoints purged before optional reinsertion.
- User artwork/gallery references snapshotted while demo data is active and restored on exit.
- 16 additional regression tests over Bob's 386-test result, bringing the suite to 402.

## Verification — final successful run

### Full test suite

Command: `npm test -- --reporter=dot`

```text
 Test Files  26 passed (26)
      Tests  402 passed (402)
   Start at  02:30:47
   Duration  14.97s (transform 2.27s, setup 5ms, collect 10.31s, tests 9.38s, environment 62.42s, prepare 13.46s)
```

This includes `tests/export-chain.integration.test.ts` and `tests/export-viewer.smoke.test.ts`; the latter builds a real export ZIP, unpacks it, serves it, and boots it in Chromium while checking for missing assets and page/console errors.

The repeated jsdom message `Not implemented: HTMLCanvasElement's getContext()` remains expected test-environment noise from Three.js text-canvas paths; it does not fail a test. Real Chromium coverage is present separately.

### Lint

Command: `npm run lint`

```text
> openhall@0.1.0 lint
> eslint .
```

Exit code 0; no lint findings.

### TypeScript

Commands:

```text
npx tsc -p tests/tsconfig.json
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM worker/token-exchange.ts
```

Both exited 0 with no output. The main application `tsc` check also ran inside the production build.

### Production build

Command: `npm run build`

```text
dist-viewer/viewer.js  751.85 kB │ gzip: 170.40 kB
✓ built in 1.70s

dist/index.html                         1.07 kB │ gzip:   0.61 kB
dist/assets/index-ByYQ_KOU.css          9.50 kB │ gzip:   2.59 kB
dist/assets/sample-gallery-Bjq5TFw_.js  9.08 kB │ gzip:   3.50 kB
dist/assets/bundler-ry3wDlYY.js       103.28 kB │ gzip:  32.95 kB
dist/assets/index-DugjrTLS.js         676.39 kB │ gzip: 176.86 kB
✓ built in 2.28s
```

Vite still emits its pre-existing warning that the main application chunk exceeds 500 kB. The self-contained viewer is about 0.75 MB and remains well below the 5 MB export budget excluding artwork images.

### Local Chromium checks

A generated 4100×2100 JPEG was used only as a temporary test artifact and removed afterward. No AI provider was called.

Observed results:

```text
upload display copy: 2048×1049, source = blob:
first Generate click: "Click again to confirm — this uses API credits"
after artwork-title edit: "Generate Gallery →", armed class removed
after final artwork removal: 0 cards, Generate disabled, hint empty, old blob URL revoked
same file re-upload: 1 card, file input cleared, 2048×1049
demo re-entry: exactly 1 visible canvas, correct demo title, no failure screen
demo round-trip after fix: 1 card, title preserved, same blob URL, blob still readable, 2048px width
clean round-trip browser session: 0 console errors
```

The first diagnostic browser session intentionally fetched a revoked blob URL to prove revocation, producing one expected `ERR_FILE_NOT_FOUND`. It also attempted pointer lock in headless Chromium, which reports that the root document is not valid for pointer lock. A fresh second session avoided those diagnostic actions and completed the upload → demo → Back regression with zero console errors.

## Failed or unavailable checks — recorded honestly

- The first sandboxed focused-test attempt and first sandboxed dev-server start failed at esbuild with `spawn EPERM`. The same commands were rerun with the approved local execution permission and passed. This was an environment restriction, not treated as a green run until the reruns succeeded.
- The first lint pass found one test-only issue: `'Crypto' is not defined  no-undef`. The cast was corrected, then lint passed.
- `node scripts/verify-export.mjs` returned `MODULE_NOT_FOUND` because that historical script no longer exists. It is not reported as passing. Its former purpose is now covered by the export-chain integration and real Chromium export-viewer smoke tests in the 402-test suite.

## Deliberately not claimed

- No live Watsonx or OpenAI-compatible request was made, so current credentials, quota, provider latency, and provider-side model behavior were not re-verified in this session.
- Headless Chromium cannot validate the real pointer-lock mouse experience. The scene canvas and entry flow were checked, while WASD/mouse feel remains a human recording rehearsal item.
- The app's visible Export-button download interaction was not manually downloaded in this session; the underlying real ZIP build, unzip, serve, asset loading, and browser boot path passed automatically.

## Final assessment

No reproducible P0/P1 defect remains in the audited Prompt 11 scope after this takeover. That statement is limited to the code paths and environments above; it does not substitute for one final live-provider rehearsal before recording the competition video.
