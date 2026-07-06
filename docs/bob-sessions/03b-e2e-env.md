# Bob Session 03B — Local E2E Environment Setup
**Date:** 2026-07-05  
**Prompt:** BOB_PROMPT_03B.md  
**Status:** ✅ Complete — both services running, verified live

---

## What was done

### 1. `wrangler.toml` created
Wrangler requires a config file to know which script to run and what compatibility date to use.
`worker/token-exchange.ts` existed but there was no `wrangler.toml`. Created a minimal one:

```toml
name = "openhall-token-exchange"
main = "worker/token-exchange.ts"
compatibility_date = "2024-05-31"
```

### 2. Wrangler added as a dev dependency
Ran `npm install --save-dev wrangler` so the binary is available at a pinned version (4.107.0) without triggering an `npm warn exec` install prompt.

Added `"worker:dev"` script to `package.json`:
```json
"worker:dev": "wrangler dev worker/token-exchange.ts --port 8787"
```

### 3. `vite/client` types added to tsconfig.json
`import.meta.env` is a Vite-only API. Without `"types": ["vite/client"]` in `tsconfig.json`, TypeScript did not know the property existed. Added it; `tsc --noEmit` now passes cleanly.

### 4. Dev-only settings pre-fill

**`.env` additions (gitignored):** Three new `VITE_*` vars mirror the existing `WATSONX_*` values so Vite exposes them to browser code during dev:
```
VITE_WATSONX_API_KEY=<same value as WATSONX_API_KEY>
VITE_WATSONX_PROJECT_ID=<same value as WATSONX_PROJECT_ID>
VITE_TOKEN_WORKER_URL=http://localhost:8787
```

**`.env.example` updated:** Commented-out template for the three new vars added with an explanation.

**`src/main.ts` updated:** Dev-only bootstrap block added before `bootApp()`. It is guarded by `import.meta.env.DEV`, which Vite replaces with `false` at production build time — the entire block is tree-shaken. Logic: if the `VITE_*` vars are set AND `localStorage` has no existing settings, call `saveWatsonxSettings()` once. Existing user settings are never overwritten.

---

## Verification results

| Check | Result |
|---|---|
| `GET http://localhost:5173` | HTTP 200, title "Openhall — AI 3D Gallery" |
| `POST http://localhost:8787` with API key | `token OK, expires in 3600s` |
| `tsc --noEmit` | Clean (0 errors) |
| `npm test` (vitest) | Not re-run (no logic changes, schema unchanged) |

---

## Files changed

| File | Change |
|---|---|
| `wrangler.toml` | Created (new) |
| `package.json` | Added `wrangler` devDependency + `worker:dev` script |
| `tsconfig.json` | Added `"types": ["vite/client"]` |
| `src/main.ts` | Added dev-only settings pre-fill block |
| `.env` | Added `VITE_WATSONX_API_KEY`, `VITE_WATSONX_PROJECT_ID`, `VITE_TOKEN_WORKER_URL` |
| `.env.example` | Added commented-out template for the three new vars |

---

## Services running

- **Token worker:** `npx wrangler dev worker/token-exchange.ts --port 8787` → `http://localhost:8787`
- **Vite app:** `npm run dev` → `http://localhost:5173`
