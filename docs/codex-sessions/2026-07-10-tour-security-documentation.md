# Codex session — tour safety, export security, and documentation truth pass

**Date:** 2026-07-10

**Branch:** `codex/tour-security-docs`

**Starting head:** `1d20496`

## Scope and provenance

This session continued the README audit by using the implementation and tests as
the source of truth, except where the README described a core product promise
that required a product fix. The requested order was:

1. fix tour routing and placement/tour synchronization;
2. add credential-exclusion and external-request export tests;
3. align CI with the documented Node version; and
4. reconcile README, PRODUCT_PLAN, ROADMAP, and AGENTS.

No branch switch, push, pull request, deployment, API credential use, paid model
call, or live-provider generation was performed after the branch was created.

## Focused implementation commits

- `60e32b5 fix: keep guided tours on valid gallery paths`
  - Requires curation tour order to move monotonically through the linear room
    chain.
  - Inserts non-stop transit waypoints at room doorways and traverses them in
    both directions without counting or narrating them as artwork stops.
  - Keeps artwork waypoints aligned when placement sanity clamps an offset.
  - Removes boundary wrapping that could animate the camera through walls.
- `9a59601 test: prove exported galleries contain no credentials`
  - Stores recognizable sentinel secrets for both provider routes, builds the
    export, and scans every ZIP entry for either secret.
  - Fails the real exported-viewer Chromium smoke test if startup requests any
    HTTP(S) origin other than the local static-site origin.
- `3ad2b37 ci: test the documented Node version`
  - Updates GitHub Actions from Node 20 to the documented Node 22.12 baseline.

## Documentation truth pass

- Replaced stale freeform-geometry and L-shaped-layout descriptions with the
  current AI-curation/deterministic-assembly boundary.
- Described the user-configured Cloudflare relay as required for both IBM IAM
  and watsonx ML browser requests, without presenting CORS as authentication.
- Corrected the watsonx vision model ID to
  `meta/llama-3-2-11b-vision-instruct`.
- Corrected the 10-artwork base request count to 16 and the all-eligible-retries
  maximum to 31.
- Replaced the claim that demo content was AI-generated once with the truthful
  description: the eight-work demo is prebuilt and pre-authored.
- Scoped the external-network test claim to the automated viewer boot path; it
  does not claim to observe browser/OS online speech services.
- Added the real OpenAI-compatible browser constraints: CORS, an OpenAI-style
  `/chat/completions` route, multimodal input, and data-URL image support.
- Made the current roadmap evidence-based and separated automated MVP coverage
  from pending live-provider, artist, device, browser, publishing, and
  judge-packaging validation.
- Linked the official July challenge page and recorded its July 31, 2026,
  11:59 PM ET deadline and three-minute maximum video requirement.
- Preserved the creator's requested `Narrative` label for the line *Built with
  Bob. Powered by watsonx. Owned by artists.*

## Verification — final successful runs

### Production build

Command: `npm run build`

```text
dist-viewer/viewer.js  753.40 kB │ gzip: 170.78 kB
✓ built in 1.85s

dist/index.html                         1.07 kB │ gzip:   0.61 kB
dist/assets/index-ByYQ_KOU.css          9.50 kB │ gzip:   2.59 kB
dist/assets/sample-gallery-UF_cOVZ-.js  9.15 kB │ gzip:   3.52 kB
dist/assets/bundler-CQQN8ZFj.js       103.28 kB │ gzip:  32.95 kB
dist/assets/index-D-Ysp5lu.js         679.33 kB │ gzip: 177.89 kB
✓ built in 2.46s
```

The existing Vite warning about the main application chunk exceeding 500 kB
remains non-failing. The exported viewer remains well below the 5 MB budget
excluding artwork images.

### Full test suite

Command: `npm test`

```text
Test Files  30 passed (30)
     Tests  419 passed (419)
  Start at  15:28:36
  Duration  14.28s (transform 3.83s, setup 5ms, collect 11.15s, tests 10.38s, environment 60.61s, prepare 14.25s)
```

This includes the real export-chain integration test, credential sentinels,
doorway-aware tour regression tests, and exported-bundle Chromium smoke test.
The recurring jsdom `HTMLCanvasElement.getContext()` warnings were non-failing;
the real Chromium test passed in the same run.

### Lint

Command: `npm run lint`

```text
> openhall@0.1.0 lint
> eslint .
```

Exit code 0 with no lint findings.

### Development-server smoke check

Command: `npm run dev -- --host 127.0.0.1`, followed by an HTTP probe.

```text
APP HTTP 200
APP TITLE Openhall — AI 3D Gallery
APP TITLE OK
STARTED DEV PROCESS STOPPED
```

The server process started by this session was stopped after the probe. A
separate IPv6-only Node listener on `[::1]:5173`, started hours before this
probe, was left untouched because it did not belong to this run.

### Documentation integrity

```text
git diff --check: PASS
local Markdown links: PASS
stale-claim search: PASS (no matches)
Node v22.21.0
```

The stale-claim search covered the wrong model ID, `pre-generated`, the removed
ROADMAP cut-list reference, the old title-verbatim rule, absolute third-party
script/network wording, and the unconfirmed three-day claim.

## Failed or non-required checks — recorded honestly

- The first sandboxed build failed while Vite loaded its config because Windows
  blocked esbuild with `spawn EPERM`. The approved local-permission rerun above
  passed; the sandbox failure was not treated as product verification.
- An extra `npx prettier --check` reported existing Markdown formatting style
  differences in README and PRODUCT_PLAN. Markdown formatting is not part of
  the repository's CI or lint chain. The files were not mechanically reflowed,
  because that would add a large unrelated formatting diff; `git diff --check`
  and local-link validation both passed.
- The first HTTP probe required the exact title `<title>Openhall</title>` and
  therefore failed even though the response was HTTP 200; the real title is
  `Openhall — AI 3D Gallery`. The corrected semantic check above passed.
- Terminating the outer dev command initially left its Vite child listening on
  IPv4 port 5173. The child PID was identified, stopped explicitly, and then
  confirmed no longer listening. A legacy `wmic` process-query attempt was not
  available on this Windows host; `Get-Process` and `netstat` supplied the
  required cleanup evidence.

## Deliberately not claimed

- No current watsonx or OpenAI-compatible generation was performed.
- No manual Netlify Drop or GitHub Pages publication was performed; local static
  serving and Chromium startup do not substitute for those host-specific checks.
- No public deployment, screenshot/GIF, video, mobile-browser pass, external
  artist test, repository visibility change, push, or pull request was performed.
- External product and competition details were checked against their official
  pages on July 10, 2026, but the submission rules should still be re-read before
  the final upload because the organizer can amend them.
