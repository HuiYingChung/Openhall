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

## Follow-up in the same session — ephemeral API keys (never stored)

After the first production deploy went live (verified: CSP headers, SPA
rewrite, relay answering 405 to GET, fresh viewer build), Huiying's call:
API keys must be one-time — never persisted anywhere. Her scope decision:
hosted branch only; strictness decision: memory-only (strictest claim),
accepted that F5 requires re-entering the key — reasonable because a reload
loses uploads and progress anyway, so re-pasting is the smallest part of
redoing the flow. Regenerating after edits needs no re-entry (SPA, one page
load).

Changes:

- `watsonx.ts` / `openai-compat.ts`: `apiKey` now lives in a module-level
  memory variable only. `save*Settings` persists the settings object with
  `apiKey: ''`; `load*Settings` merges the memory key back in. Keys
  persisted by the earlier deploy are scrubbed on load and deliberately not
  adopted. New `clearMemoryApiKey()` on both; `forgetStoredCredentials()`
  wipes memory keys + token cache too.
- Settings UI copy: intro says never stored / memory only; both key fields
  labeled "(never stored — memory only)" with `autocomplete="off"`; escape
  hatch reworded to "Clear settings" (it clears non-secret settings + any
  in-memory key). Key-gating logic needed no changes — every gate reads
  `load*Settings()?.apiKey`, which is empty after reload and routes to
  Settings.
- New `src/ai/key-ephemeral.test.ts` (6 tests): key absent from
  localStorage after save, usable from memory same-load, legacy-key scrub
  without adoption, hatch wipes memory — both providers.

Deliberate divergence: AGENTS.md rule 7 says "API keys live in localStorage
only" — that remains true for main; this branch's hosted policy is stricter
by owner decision and is documented in the Settings copy.

Verification: 445 passed (445) — 439 prior + 6 new; lint and build clean.

## Follow-up 2 — keyless exploring (judges can use the upload screen)

Huiying's call: judges/visitors without any API key should be able to use
the upload page — uploads, brief, presets, identity — with only generation
gated. Changes: upload is now always the landing screen (boot and
exit-to-menu no longer route keyless visitors to Settings); the Settings
screen always offers Cancel (there is always an upload screen to return
to); when artworks are ready but no key is present, the Generate button
reads "Add API key to generate →" with an explanatory hint, and clicking it
routes to Settings instead of arming a generation (draft and uploads stay
in memory). The cached "Continue → (no AI, no cost)" path stays available
without a key. New regression test in app.upload.test.ts covers the
keyless button label, hint, and Settings routing.

Verification: 446 passed (446); lint and build clean.

## Follow-up 3 — production bug: deep relay paths 404'd

Huiying's real-key generation on the live site failed with `watsonx HTTP
404 … NOT_FOUND cle1::…` — Vercel's own 404, not IBM's. Probing confirmed
the asymmetry: `/api/relay/xyz` (one segment) reached the function (405),
`/api/relay/proxy/ml/v1/text/chat` (deep) did not. Root cause: Vercel's
plain-api filesystem router matches a `[...path].ts` catch-all against only
ONE segment. The earlier live verification probed only `/token` (single
segment) — lesson recorded: probe the deepest route, not the shallowest.

Fix (documented rewrite-parameter mechanism, not a workaround): function
moved to fixed `api/relay.ts`; vercel.json adds
`{ source: "/api/relay/:path*", destination: "/api/relay" }` ahead of the
SPA rewrite — matched segments arrive in the `path` query parameter.
`resolveRoute()` now takes (pathname, pathParam) and prefers the parameter;
the proxy route strips `path` from the query it forwards upstream. Direct
deep-path invocation still works via the pathname fallback. Two new tests
(rewrite-style token + proxy with param stripping; 448 total).

Verification: 448 passed (448); lint and build clean. Post-deploy check
must probe GET `/api/relay/proxy/ml/v1/text/chat` expecting 405, then a
real generation run.
