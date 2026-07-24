/**
 * api/relay.ts — Vercel function: watsonx IAM token exchange + ML API proxy.
 *
 * Same-origin port of `worker/token-exchange.ts` for the hosted deployment
 * (deploy/vercel-ph branch only; the Cloudflare worker remains the
 * self-hosting route and is untouched). The app reaches it through the
 * Settings "Token Worker URL" default `/api/relay`:
 *
 *   POST /api/relay/token    — exchanges an IBM Cloud API key for an IAM bearer token
 *                              (IBM IAM has no CORS headers; browsers cannot call it)
 *   POST /api/relay/proxy/*  — forwards to https://us-south.ml.cloud.ibm.com/*
 *                              (watsonx ML API has no CORS headers either)
 *
 * Routing: Vercel's plain-api filesystem router matches only ONE dynamic
 * segment, so a `[...path].ts` catch-all silently 404s on deep paths like
 * /api/relay/proxy/ml/v1/text/chat (found in production by a real
 * generation run). The function therefore lives at the fixed path
 * /api/relay, and a vercel.json rewrite maps /api/relay/:path* onto it —
 * the matched segments arrive in the `path` query parameter (documented
 * rewrite behavior). resolveRoute() accepts both that parameter and a raw
 * deep pathname, so direct invocation keeps working too.
 *
 * Served from the app's own origin, so unlike the worker there is no CORS
 * machinery at all. Security posture (mirrors the worker):
 *   - Stateless: no storage, no server-side secrets, no request-body logging
 *     (bodies contain API keys, bearer tokens, and artwork images).
 *   - Forwards ONLY to IBM IAM and the single allowlisted watsonx ML host;
 *     every other destination is rejected.
 *   - `Cache-Control: no-store` on every response.
 *   - When a browser sends an Origin header it must match this deployment's
 *     own host. Defence-in-depth against cross-site freeloading — NOT
 *     authentication (Origin is forgeable; non-browser clients omit it).
 *   - Bodies above MAX_BODY_BYTES are rejected up front. Vision payloads are
 *     1024px JPEG data URLs (~0.5 MB), far below the cap.
 *
 * Duration: LLM calls wait on watsonx for tens of seconds; maxDuration is
 * raised to 120s in vercel.json (requires Fluid compute, the default).
 */

const IAM_URL = 'https://iam.cloud.ibm.com/identity/token';
const WX_PROXY_HOST = 'https://us-south.ml.cloud.ibm.com';
const MAX_BODY_BYTES = 6 * 1024 * 1024;

export type RelayRoute =
  | { kind: 'token' }
  | { kind: 'proxy'; upstreamPath: string }
  | { kind: 'unknown' };

/**
 * Map a request to a relay route. `pathParam` is the rewrite-provided `path`
 * query parameter (e.g. "token" or "proxy/ml/v1/text/chat"); when absent the
 * raw pathname is used. Exported for unit tests.
 */
export function resolveRoute(pathname: string, pathParam: string | null): RelayRoute {
  const sub = pathParam
    ? '/' + pathParam.replace(/^\/+/, '')
    : pathname.replace(/^\/api\/relay/, '');
  if (sub === '' || sub === '/' || sub === '/token') return { kind: 'token' };
  if (sub.startsWith('/proxy/')) return { kind: 'proxy', upstreamPath: sub.slice('/proxy'.length) };
  return { kind: 'unknown' };
}

/**
 * Browser same-origin check. Requests without Origin are allowed because
 * Origin is forgeable and must never be treated as auth (same policy as the
 * worker). Exported for unit tests.
 */
export function originAllowed(origin: string | null, requestHost: string): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? url.host;

  if (!originAllowed(request.headers.get('origin'), host)) {
    return json(403, { error: 'Origin not allowed' });
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return json(413, { error: 'Request body too large' });
  }

  const route = resolveRoute(url.pathname, url.searchParams.get('path'));

  // -------------------------------------------------------------------------
  // POST /api/relay/token — IAM key → bearer token exchange
  // -------------------------------------------------------------------------
  if (route.kind === 'token') {
    let apiKey: string;
    try {
      const body = (await request.json()) as { apiKey?: string };
      if (!body.apiKey || typeof body.apiKey !== 'string') {
        return json(400, { error: 'apiKey required' });
      }
      apiKey = body.apiKey;
    } catch {
      return json(400, { error: 'Invalid JSON body' });
    }

    const iamRes = await fetch(IAM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
        apikey: apiKey,
      }).toString(),
    });

    const iamBody = await iamRes.text();
    return new Response(iamBody, {
      status: iamRes.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  // -------------------------------------------------------------------------
  // POST /api/relay/proxy/* — forward to the watsonx ML API host only
  // -------------------------------------------------------------------------
  if (route.kind === 'proxy') {
    // Forward the original query string minus the rewrite's own `path` param.
    const upstreamParams = new URLSearchParams(url.searchParams);
    upstreamParams.delete('path');
    const search = upstreamParams.toString();
    const upstreamUrl = `${WX_PROXY_HOST}${route.upstreamPath}${search ? `?${search}` : ''}`;

    // Forward Authorization and Content-Type; never log the body. The body is
    // buffered (not streamed) — payloads are JSON and comfortably in memory.
    const upstreamHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = request.headers.get('authorization');
    if (auth) upstreamHeaders['Authorization'] = auth;

    const upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: upstreamHeaders,
      body: await request.text(),
    });

    const responseBody = await upstreamRes.text();
    return new Response(responseBody, {
      status: upstreamRes.status,
      headers: {
        'Content-Type': upstreamRes.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  return json(404, { error: 'Not found' });
}
