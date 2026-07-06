# Bob Prompt 03C — Fix: watsonx ML API also blocks CORS; worker must proxy all calls

Live E2E result: IAM token exchange via the worker **works** (pipeline reached "Analysing artwork 1 of 6"), but the first vision call died:

```
Access to fetch at 'https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=...'
from origin 'http://localhost:5173' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

The step-0 probe only checked CORS on the IAM endpoint. `us-south.ml.cloud.ibm.com` has no CORS either — the browser cannot call watsonx directly at all.

## Fix

1. Extend `worker/token-exchange.ts` into a general watsonx proxy:
   - Keep the existing IAM exchange route (e.g. `POST /token`)
   - Add `POST /proxy/*`: forward the request to `https://us-south.ml.cloud.ibm.com/*` (path + query preserved), passing through the `Authorization` header and JSON body, and return the response with CORS headers
   - Restrict the proxy to that single host — reject any other target. Never log bodies (they contain artwork images)
2. Update `WatsonxProvider.chat()`: when `tokenWorkerUrl` is set, send ML calls to `{tokenWorkerUrl}/proxy/ml/v1/text/chat?...` instead of `wxUrl` directly. Node scripts keep calling IBM directly (no CORS in Node).
3. Update the routes in npm script / wrangler config if needed. Keep `npm run worker:dev` working.
4. Update the step-0 probe script to also check ML API CORS, so the doc trail reflects reality. Note the finding in `docs/bob-sessions/`.
5. Restart both services, verify with curl (proxy route returns a real model response using the token), then hand off to Hui and keep services running.

Do not change anything else. Tests/lint/tsc must stay green.

Note for the product story: with this architecture the artwork images transit the user's own deployed worker (still their infrastructure, still BYOK), not any third-party server. Mention this in the README later.
