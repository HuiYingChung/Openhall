# Bob Prompt 03B — Start and verify the local E2E environment

Goal: get the full local test environment running and verified, so Hui only has to open the browser and upload images. Do not build any new features.

## 1. Start both services (keep them running)

- Token worker: `npx wrangler dev worker/token-exchange.ts --port 8787` in the background. If wrangler needs config or errors, fix whatever it takes to get it serving (a minimal `wrangler.toml` is fine to commit).
- App: `npm run dev` in the background (expect http://localhost:5173).

## 2. Verify — don't just start them, prove they work

- `curl http://localhost:5173` returns the app HTML
- POST to `http://localhost:8787` with the API key from `.env` returns a real IAM token (reuse the logic from `scripts/check-watsonx.mjs`). Never print the key or the full token — print only "token OK, expires in Ns".

## 3. Dev-only convenience: pre-fill the browser settings

So Hui doesn't have to copy keys around: add a small dev-only bootstrap that pre-fills settings from Vite env vars.

- `.env` additions (gitignored already): `VITE_WATSONX_API_KEY`, `VITE_WATSONX_PROJECT_ID`, `VITE_TOKEN_WORKER_URL=http://localhost:8787` — copy values from the existing vars
- In app startup, guarded by `import.meta.env.DEV` only: if these vars exist and localStorage has no settings yet, call `saveWatsonxSettings()` with them
- This must be completely inert in production builds. Add a comment explaining why.

## 4. Hand off

When everything is verified, print exactly what Hui should do next:
open http://localhost:5173 → settings should already be filled → upload 6–10 images → one-sentence brief → pick a preset → Generate → walk the gallery.

Then stop and keep both services running. Log the session to `docs/bob-sessions/03b-e2e-env.md`.
