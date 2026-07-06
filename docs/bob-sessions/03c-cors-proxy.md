# Bob Session 03C — CORS Proxy: watsonx ML API also blocks browser requests
**Date:** 2026-07-05  
**Prompt:** BOB_PROMPT_03C.md  
**Status:** ✅ Complete — both services running, both proxy routes verified live

---

## Root cause

The live E2E test (from 03B) reached "Analysing artwork 1 of 6" and then died:

```
Access to fetch at 'https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=...'
from origin 'http://localhost:5173' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

The step-0 probe (`scripts/check-watsonx.mjs`) only checked CORS on the IAM endpoint. It turns out **`us-south.ml.cloud.ibm.com` also has no CORS headers at all** — the browser cannot call the watsonx ML API directly. The token-exchange worker needed to proxy all ML calls, not just the token exchange.

## Fix

### 1. `worker/token-exchange.ts` — extended into a general watsonx proxy

Two routes now:

| Route | Purpose |
|---|---|
| `POST /token` (was `/`) | IBM Cloud API key → IAM bearer token |
| `POST /proxy/*` | Forward to `https://us-south.ml.cloud.ibm.com/*`, preserving path + query + `Authorization` header |

The proxy is **hard-coded to `us-south.ml.cloud.ibm.com`** — no arbitrary upstream is possible. Bodies are never logged. `Authorization` header is forwarded; `Content-Type` is always `application/json`.

### 2. `src/ai/watsonx.ts` — two targeted changes

**`getToken()`**: was posting to `settings.tokenWorkerUrl` (bare URL); now posts to `${settings.tokenWorkerUrl}/token`.

**`chat()`**: URL selection now:
```ts
const url = settings.tokenWorkerUrl
  ? `${settings.tokenWorkerUrl}/proxy/ml/v1/text/chat?version=${WX_VERSION}`
  : `${settings.wxUrl}/ml/v1/text/chat?version=${WX_VERSION}`;
```
Node scripts (`check-watsonx.mjs`) pass no `tokenWorkerUrl` so they continue calling IBM directly — no behaviour change there.

### 3. `scripts/check-watsonx.mjs` — new Step 2b

Added an OPTIONS preflight probe to the ML endpoint immediately after the existing IAM CORS probe. Documents the confirmed finding: ML API also lacks CORS headers, worker proxy is required.

---

## Verification results

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ Clean |
| `npm test` (vitest) | ✅ 38/38 pass |
| `POST http://localhost:8787/token` | ✅ `token OK, expires in 3600s` |
| `POST http://localhost:8787/proxy/ml/v1/text/chat` | ✅ `HTTP 200, model reply: PROXY_OK` |

---

## Architecture note (for README later)

With this architecture, artwork images transit only the user's **own deployed Cloudflare Worker** — still BYOK, still their infrastructure. No third-party server ever sees the artwork data or bearer token.

---

## Files changed

| File | Change |
|---|---|
| `worker/token-exchange.ts` | Added `/proxy/*` route; renamed `/` → `/token`; added `Authorization` to CORS allowed headers |
| `src/ai/watsonx.ts` | `getToken()` posts to `/token`; `chat()` routes through `/proxy/ml/v1/text/chat` when `tokenWorkerUrl` is set |
| `scripts/check-watsonx.mjs` | Added Step 2b ML CORS probe (OPTIONS preflight to ML endpoint) |

---

## Services running

- **Token worker:** `npm run worker:dev` → `http://localhost:8787`
- **Vite app:** `npm run dev` → `http://localhost:5173`
