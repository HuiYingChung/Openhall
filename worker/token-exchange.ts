/**
 * token-exchange.ts — Cloudflare Worker: watsonx IAM token exchange + ML API proxy.
 *
 * Routes:
 *   POST /token        — exchanges an IBM Cloud API key for an IAM bearer token.
 *                        (IAM endpoint has no CORS headers; this proxies it.)
 *   POST /proxy/*      — forwards the request to https://us-south.ml.cloud.ibm.com/*
 *                        (watsonx ML API also has no CORS headers; this proxies it.)
 *                        Restricted to that single host — any other target is rejected.
 *   OPTIONS *          — CORS preflight (returns 204)
 *
 * Why a proxy for ML too: https://us-south.ml.cloud.ibm.com has no CORS headers,
 * so the browser cannot call watsonx directly at all. Artwork images transit only
 * the user's own deployed worker (still BYOK, still their infrastructure).
 *
 * Deploy: `wrangler deploy` (free Cloudflare Workers tier)
 *
 * Security:
 *   - The API key travels in the POST /token request body over HTTPS only
 *   - The bearer token travels in the Authorization header of /proxy/* requests
 *   - No bodies are logged (they contain artwork images and bearer tokens)
 *   - Add ALLOWED_ORIGINS env var to restrict which domains can call this
 */

export interface Env {
  ALLOWED_ORIGINS?: string; // comma-separated, e.g. "https://openhall.art,https://your-deploy.netlify.app"
}

const IAM_URL = 'https://iam.cloud.ibm.com/identity/token';
const WX_PROXY_HOST = 'https://us-south.ml.cloud.ibm.com';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS headers
    const origin = request.headers.get('Origin') ?? '';
    const allowedOrigins = env.ALLOWED_ORIGINS
      ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
      : ['*'];
    const corsOrigin =
      allowedOrigins.includes('*') || allowedOrigins.includes(origin) ? origin || '*' : '';

    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // -------------------------------------------------------------------------
    // Route: POST /token — IAM key → bearer token exchange
    // -------------------------------------------------------------------------
    if (url.pathname === '/token' || url.pathname === '/') {
      let apiKey: string;
      try {
        const body = (await request.json()) as { apiKey?: string };
        if (!body.apiKey || typeof body.apiKey !== 'string') {
          return new Response(JSON.stringify({ error: 'apiKey required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        apiKey = body.apiKey;
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
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
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }

    // -------------------------------------------------------------------------
    // Route: POST /proxy/* — forward to watsonx ML API
    // Restricted to us-south.ml.cloud.ibm.com only.
    // -------------------------------------------------------------------------
    if (url.pathname.startsWith('/proxy/')) {
      // Strip /proxy prefix, preserve the rest of path + query
      const upstreamPath = url.pathname.slice('/proxy'.length);
      const upstreamUrl = `${WX_PROXY_HOST}${upstreamPath}${url.search}`;

      // Forward Authorization and Content-Type; never log the body
      const upstreamHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const auth = request.headers.get('Authorization');
      if (auth) upstreamHeaders['Authorization'] = auth;

      const upstreamRes = await fetch(upstreamUrl, {
        method: 'POST',
        headers: upstreamHeaders,
        body: request.body,
      });

      const responseBody = await upstreamRes.text();
      return new Response(responseBody, {
        status: upstreamRes.status,
        headers: {
          ...corsHeaders,
          'Content-Type': upstreamRes.headers.get('Content-Type') ?? 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
