# Claude session — 2026-07-24 — Vercel hosted deployment (deploy/vercel-ph)

Context: Huiying is preparing a Product Hunt submission and wants a hosted
instance on Vercel. Her explicit rule: this work lives on a temporary branch
(`deploy/vercel-ph`), is never merged to main, and stays out of the IBM
challenge evidence because it is not Bob's work (the hosted-demo *link* may
still appear on the challenge page — it showcases the Bob-built product;
this branch only adds deployment plumbing). Plan doc reviewed and approved
in the Cowork session before any code was written.

Design: the watsonx CORS relay (`worker/token-exchange.ts`, user-deployed
Cloudflare Worker) becomes a same-origin Vercel function for the hosted
instance, so visitors get a working watsonx BYOK route with zero setup.
The worker and its self-hosting docs are untouched — that route remains for
self-hosters, and the Settings field stays editable to point at it.

## Changes (this branch only)

- `api/relay/[...path].ts` (new): port of the worker. `POST /api/relay/token`
  (IAM exchange) and `POST /api/relay/proxy/*` (forward to the single
  allowlisted watsonx ML host). Same-origin, so all CORS machinery is gone.
  Kept/added defence-in-depth: stateless, no body logging, `no-store`,
  Origin-must-match-own-host when present (not auth — same policy as the
  worker), 6 MB body cap (vision payloads are ~0.5 MB), unknown paths 404
  before any upstream contact. Body is buffered, not streamed (JSON payloads).
- `api/relay/relay.test.ts` (new): route mapping, origin policy, oversized
  body, apiKey required, proxy-forwards-only-to-allowlisted-host, 404 path.
- `vercel.json`: SPA rewrite now excludes `/api`; `maxDuration: 120` for the
  relay (needs Fluid compute — legacy Hobby cap is 60s and would cut LLM
  calls); CSP (`script-src 'self'`; `connect-src` stays broad because the
  OpenAI-compatible base URL is user-configured), nosniff, no-referrer.
- `src/ui/app.ts`: Settings — Token Worker URL defaults to `/api/relay` for
  first-time visitors via new exported `initialTokenWorkerUrl()` (saved
  values, including deliberate blank, win); intro + help copy now disclose
  the hosted relay honestly (stateless, never logged, forwards only to IBM,
  open-source link, self-host option, throwaway-key tip). The stale
  "Granite" dropdown label was deliberately NOT touched — that is a product
  fix for Bob on main.
- `src/ui/app.relay-default.test.ts` (new): default/saved/blank precedence.
- `tsconfig.json` include + eslint block + vitest include extended to `api/`.

## Verification (cloud staged copy, Node v22.22.2)

Baseline on main before changes: 426 passed (426). Note: the 2026-07-10
session log records 442; main's suite shrank between 7/10 and 7/16 edits —
not investigated here, baseline taken from code as ground truth.

After changes:

```
 Test Files  35 passed (35)
      Tests  439 passed (439)
```

`npm run lint` clean. `npm run build` clean (pre-existing chunk-size warning).

Environment note: the cloud sandbox ships Chromium build 1194 while
Playwright 1.61.1 expects 1228; fixed with symlinks in /opt/pw-browsers
(environment-only workaround, no repo change).

## Honest limitations

- The CSP and the deployed relay were not yet exercised in a real browser at
  the time of this log — first Vercel preview must verify: demo mode loads
  (fonts, images, viewer), a real watsonx generation run, an OpenAI-compat
  run, and export. CSP is the most likely thing to need loosening.
- Deployment is via GitHub push (`create-vercel-branch.cmd`, untracked) +
  Vercel Git integration with Production Branch = `deploy/vercel-ph`;
  binary assets made direct MCP file-tree deploy impractical.
