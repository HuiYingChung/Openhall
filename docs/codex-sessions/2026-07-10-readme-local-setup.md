# Codex session — evaluator-ready local setup documentation

**Date:** 2026-07-10

**Branch:** `main`

**Starting head:** `d0246f5`

**Documentation commit:** `4ae2eef`

## Scope and provenance

The creator asked for a candid review of whether a first-time evaluator could
actually follow the README and see Openhall locally, especially whether two
terminals were required. This session changed documentation and package metadata
only; no product behavior was changed.

No branch switch, push, deployment, API credential use, or paid AI-provider call
was performed.

## Findings addressed

- The quick start incorrectly said `npm run dev` opened the browser. Vite starts
  the server but the user must open the printed URL themselves.
- It did not say to keep the terminal running or use `Ctrl+C` to stop it.
- Fresh-clone prerequisites and commands were incomplete: no Node version,
  `git clone`, repository `cd`, or reproducible `npm ci` path.
- Demo, OpenAI-compatible, local watsonx, and deployed-worker workflows did not
  clearly state their different terminal requirements.
- `.env.example` looked mandatory even though demo mode and credentials entered
  through Settings do not need it.
- The README still reported 313 tests, 19 work orders, L-shaped rooms, the old
  worker size, and pre-Codex collaboration provenance.
- The README worker deploy command duplicated the entry already configured in
  `wrangler.toml`.

## Changes made

- Added a fresh-clone quick start for Node.js 22.12+, `npm ci`, one app terminal,
  manual browser opening, and `Ctrl+C` shutdown.
- Stated explicitly that demo and OpenAI-compatible use one app terminal; local
  watsonx uses a second terminal for `npm run worker:dev`; a deployed worker
  returns watsonx use to one local app terminal.
- Added the exact local worker URL (`http://localhost:8787`) and app URL
  (`http://localhost:5173`), including the warning not to start the app twice.
- Aligned deployment instructions with `wrangler.toml`: `npx wrangler login`
  followed by `npx wrangler deploy`.
- Added `engines.node >=22.12.0` to `package.json` and the lockfile root entry.
- Clarified that `.env` is optional and identified the diagnostic-script and
  dev-prefill use cases.
- Updated current evidence and architecture claims to 412 tests, 20 work orders,
  14 merged PRs, linear-only rooms, current title fallback/error semantics, and
  the hardened worker behavior.
- Added Codex to the collaboration provenance and removed unresolved hidden
  README TODO comments.

## Verification — final successful run

### Production build

Command: `npm run build`

```text
dist-viewer/viewer.js  752.04 kB │ gzip: 170.43 kB
✓ built in 1.74s

dist/index.html                         1.07 kB │ gzip:   0.61 kB
dist/assets/index-ByYQ_KOU.css          9.50 kB │ gzip:   2.59 kB
dist/assets/sample-gallery-Bjq5TFw_.js  9.08 kB │ gzip:   3.50 kB
dist/assets/bundler-6IZEL_Fs.js       103.28 kB │ gzip:  32.95 kB
dist/assets/index-XHk28Lrd.js         676.59 kB │ gzip: 176.89 kB
✓ built in 2.31s
```

The pre-existing Vite warning about the main application chunk exceeding 500 kB
remains. The exported viewer is still well below the 5 MB budget excluding art.

### Full test suite

Command: `npm test`

```text
 Test Files  30 passed (30)
      Tests  412 passed (412)
   Start at  12:47:38
   Duration  14.38s (transform 3.10s, setup 3ms, collect 9.62s, tests 9.67s, environment 63.54s, prepare 14.06s)
```

This includes the real export-chain integration and exported-bundle Chromium
smoke tests. The existing jsdom canvas warnings were non-failing; real Chromium
coverage passed in the same run.

### Lint and package metadata

Commands: `npm run lint`, package/lock engine comparison, and `git diff --check`.

```text
> openhall@0.1.0 lint
> eslint .

v22.21.0 >=22.12.0 package-lock match
```

All exited 0 with no lint or whitespace findings.

### Documented two-terminal local flow

The README's two commands were run simultaneously without an API key:

```text
Terminal 1: npm run worker:dev
Terminal 2: npm run dev -- --host 127.0.0.1

APP HTTP 200
APP title OK
WORKER HTTP 204
WORKER ACAO http://localhost:5173
```

Both processes were terminated afterward; ports 5173 and 8787 were confirmed
closed.

## Failed checks — recorded honestly

- The first sandboxed production build reached Vite configuration loading and
  failed with esbuild `spawn EPERM`. It was rerun with the approved local bundler
  permission and passed; the failed attempt was not treated as verification.
- The final stale-string search intentionally returned `rg` exit code 1 because
  none of the obsolete claims remained. Its preceding port, status, and
  whitespace checks passed; the no-match exit is recorded rather than described
  as a successful command exit.

## Deliberately not claimed

- No fresh network clone or registry install was performed; reproducibility is
  based on the committed lockfile, current Node engine declaration, successful
  build, and the repository's existing cold-clone CI history.
- No live watsonx or OpenAI-compatible generation was performed.
- No Cloudflare Worker was deployed; only the local Wrangler worker was started
  and its allowed-origin preflight was verified.
