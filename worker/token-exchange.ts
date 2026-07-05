/**
 * token-exchange.ts — Cloudflare Worker for watsonx IAM token exchange.
 *
 * Why this exists: IBM's IAM endpoint (iam.cloud.ibm.com/identity/token)
 * does NOT return CORS headers, so browser code cannot call it directly.
 * This ~50-line worker proxies the exchange server-side.
 *
 * Deploy: `wrangler deploy` (free Cloudflare Workers tier)
 * Set WATSONX_URL in your .env.example for the browser to point here.
 *
 * Security:
 * - The API key travels in the request body over HTTPS only
 * - No key logging, no key storage
 * - The returned token is scoped to the caller's project; not stored
 * - Add a ALLOWED_ORIGINS env var to restrict which domains can call this
 */

export interface Env {
  ALLOWED_ORIGINS?: string; // comma-separated, e.g. "https://openhall.art,https://your-deploy.netlify.app"
}

const IAM_URL = 'https://iam.cloud.ibm.com/identity/token';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    const origin = request.headers.get('Origin') ?? '';
    const allowedOrigins = env.ALLOWED_ORIGINS
      ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
      : ['*'];
    const corsOrigin = allowedOrigins.includes('*') || allowedOrigins.includes(origin)
      ? origin || '*'
      : '';

    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

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

    // Exchange with IBM IAM
    const iamRes = await fetch(IAM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
        apikey: apiKey,
      }).toString(),
    });

    const iamBody = await iamRes.text();
    // Forward the IAM response (success or error) with CORS headers
    return new Response(iamBody, {
      status: iamRes.status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  },
};
