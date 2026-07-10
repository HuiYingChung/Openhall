# Codex session — security, provider, and worker hardening

**Date:** 2026-07-10

**Branch:** `final-debug-hardening`

**Starting head:** `d4d550d`

**Implementation commits:**

- `ef90710` — `fix: escape viewer and upload error surfaces`
- `bfd047f` — `fix: surface title provider failures`
- `9bc4e32` — `fix: reject truncated OpenAI-compatible output`
- `d850aa5` — `fix: fail closed for unconfigured browser origins`

## Scope and provenance

This session continued the read-only Claude-main review comparison recorded in
`docs/codex-sessions/2026-07-10-claude-main-review-handoff.md`. The creator
approved the first four recommended fixes: the two confirmed HTML-injection
surfaces, title-generation error propagation, OpenAI-compatible truncation
handling, and worker browser-origin hardening.

No branch switch, merge, push, deployment, or paid Watsonx/OpenAI-compatible
request was performed. Openhall remains a solo creator project; agent names in
these logs identify AI collaboration tools, not additional human team members.

## Changes made

### Exported-viewer and upload HTML safety

- Replaced the exported viewer's boot-error `innerHTML` interpolation with DOM
  nodes whose error detail is assigned through `textContent`.
- Escaped the saved curatorial brief before embedding it in the upload
  `<textarea>` so `</textarea>` cannot break into executable markup.
- Added two jsdom regressions that use explicit textarea/pre breakout payloads
  and prove no injected image element is created while the original text still
  round-trips.

### Title fallback semantics

- Preserved `New Exhibition` for a successful but empty title response.
- Removed the catch-all around the title request, so authentication, quota,
  network, and other provider exceptions reach the existing friendly error UI.
- Added a regression proving a provider 401 stops the pipeline after one call
  instead of becoming a false success.

### OpenAI-compatible truncation

- Read `finish_reason` from OpenAI-compatible chat responses.
- Reject both `length` and `max_tokens` immediately with an actionable message,
  matching the existing watsonx fail-fast behavior.
- Added two no-network regression cases and verified truncation is not retried
  as a JSON-formatting problem.

### Worker browser-origin policy

- Blank/missing `ALLOWED_ORIGINS` now permits only the two documented local Vite
  origins instead of silently opening browser access to every website.
- Exact comma-separated origins are supported; `*` remains available only as an
  explicit opt-in.
- A browser request carrying a disallowed `Origin` receives 403 before its key,
  bearer token, image data, or request body can reach IBM.
- Responses now include `Vary: Origin` and omit an empty
  `Access-Control-Allow-Origin` header.
- Requests with no `Origin` remain allowed because Origin can be omitted or
  forged by non-browser clients. README and `wrangler.toml` now state plainly
  that this is browser abuse mitigation, not authentication.
- Added worker tests to the normal Vitest include set.

## Verification — final successful run

### Full test suite

Command: `npm test`

```text
 Test Files  30 passed (30)
      Tests  412 passed (412)
   Start at  12:17:31
   Duration  14.32s (transform 2.48s, setup 4ms, collect 9.98s, tests 10.50s, environment 59.75s, prepare 14.74s)
```

This includes the real export-chain integration test and the exported-bundle
Chromium smoke test. The pre-existing jsdom
`HTMLCanvasElement.getContext()` warnings remain non-failing environment noise;
the actual Chromium export boot passed separately in the same run.

### Production build

Command: `npm run build`

```text
dist-viewer/viewer.js  752.04 kB │ gzip: 170.43 kB
✓ built in 1.82s

dist/index.html                         1.07 kB │ gzip:   0.61 kB
dist/assets/index-ByYQ_KOU.css          9.50 kB │ gzip:   2.59 kB
dist/assets/sample-gallery-Bjq5TFw_.js  9.08 kB │ gzip:   3.50 kB
dist/assets/bundler-6IZEL_Fs.js       103.28 kB │ gzip:  32.95 kB
dist/assets/index-XHk28Lrd.js         676.59 kB │ gzip: 176.89 kB
✓ built in 2.42s
```

Vite still emits its pre-existing warning that the main application chunk is
larger than 500 kB. The self-contained viewer remains well below the 5 MB export
budget excluding artwork images.

### Lint and TypeScript

Commands:

```text
npm run lint
npx tsc --noEmit
npx tsc -p tests/tsconfig.json
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM worker/token-exchange.ts
```

Final output:

```text
> openhall@0.1.0 lint
> eslint .
```

All four exited 0. The three TypeScript commands emitted no output.

### Local app boot

Command: `npm run dev -- --host 127.0.0.1`, followed by an HTTP request to the
local app.

```text
HTTP 200
Openhall title OK
```

The local server was terminated immediately after this check.

## Failed or unavailable checks — recorded honestly

- The first sandboxed targeted-test launch for the HTML fixes failed before test
  collection with esbuild `spawn EPERM`. The exact two tests were rerun normally
  and passed 2/2.
- The first worker targeted-test launch also encountered `spawn EPERM`; a later
  attempt then correctly reported that `worker/**/*.test.ts` was not in the
  Vitest include list. The include was updated, after which the worker suite
  passed 5/5 and the final full suite passed 412/412.
- An attempted `npx tsc -p tsconfig.worker.json --noEmit` failed with TS5058
  because this repository has no such config. The existing explicit strict
  worker command documented above was then run and passed; the missing command
  is not reported as green.
- The first sandboxed production build failed at Vite/esbuild with `spawn EPERM`.
  It was rerun with the approved local bundler permission and passed. The failed
  attempt was not treated as verification.

## Deliberately not claimed

- No live provider call was made, so current credentials, quota, upstream model
  behavior, and Cloudflare deployment settings were not re-verified.
- Worker tests prove local policy and upstream-call suppression with mocked
  network state; no Worker was deployed.
- The remaining lower-priority audit findings (geometry limits, damaged settings,
  per-frame hover allocations, dead helper/script cleanup, and README accuracy)
  were not part of this approved implementation batch.
