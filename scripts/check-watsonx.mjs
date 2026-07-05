#!/usr/bin/env node
/**
 * check-watsonx.mjs — Connectivity probe for IBM watsonx.ai
 *
 * Usage:
 *   node scripts/check-watsonx.mjs
 *
 * Required env vars (copy .env.example → .env and fill in):
 *   WATSONX_API_KEY      IBM Cloud API key
 *   WATSONX_PROJECT_ID   watsonx.ai project ID (from the project URL)
 *
 * What this checks:
 *   1. IAM token exchange  (POST iam.cloud.ibm.com/identity/token)
 *   2. CORS headers on the IAM endpoint  → PASS/FAIL for browser-direct feasibility
 *   3. Granite text LLM  (ibm/granite-3-3-8b-instruct via /ml/v1/text/chat)
 *   4. Granite Vision     (ibm/granite-vision-3-2-2b via /ml/v1/text/chat with image_url)
 *
 * Never reads keys from anything except process.env.
 * Never prints the API key or bearer token to stdout.
 */

import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

// ---------------------------------------------------------------------------
// Load .env if present (simple parser — no dependency needed)
// ---------------------------------------------------------------------------
if (existsSync('.env')) {
  const lines = readFileSync('.env', 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

const API_KEY = process.env.WATSONX_API_KEY;
const PROJECT_ID = process.env.WATSONX_PROJECT_ID;

if (!API_KEY || API_KEY === 'your-ibm-cloud-api-key-here') {
  console.error('ERROR: WATSONX_API_KEY is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!PROJECT_ID || PROJECT_ID === 'your-watsonx-project-id-here') {
  console.error('ERROR: WATSONX_PROJECT_ID is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const IAM_URL = 'https://iam.cloud.ibm.com/identity/token';
const WX_BASE = 'https://us-south.ml.cloud.ibm.com';
const WX_VERSION = '2024-05-31';

const TEXT_MODEL = 'ibm/granite-3-3-8b-instruct';
const VISION_MODEL = 'ibm/granite-vision-3-2-2b';

// A tiny 1×1 red PNG as a data URI — no external file needed
const TEST_IMAGE_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); }
function info(msg) { console.log(`  ℹ  ${msg}`); }
function section(title) { console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`); }

// ---------------------------------------------------------------------------
// Step 1 — IAM token exchange
// ---------------------------------------------------------------------------

section('Step 1: IAM token exchange');

let bearerToken = null;
let tokenExpiry = 0;

try {
  const body = new URLSearchParams({
    grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
    apikey: API_KEY,
  });

  const res = await fetch(IAM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  // ---------------------------------------------------------------------------
  // Step 2 — CORS probe (check response headers from the token exchange)
  // ---------------------------------------------------------------------------
  section('Step 2: CORS headers (browser-direct feasibility)');
  const acao = res.headers.get('access-control-allow-origin');
  const acam = res.headers.get('access-control-allow-methods');
  if (acao) {
    pass(`Access-Control-Allow-Origin: ${acao}`);
    if (acam) info(`Access-Control-Allow-Methods: ${acam}`);
    pass('Browser-direct IAM token exchange: FEASIBLE');
  } else {
    fail('No Access-Control-Allow-Origin header on IAM response');
    fail('Browser-direct IAM token exchange: NOT FEASIBLE — token-exchange worker required');
    info('(This is expected. The Cloudflare Worker in worker/ will handle this.)');
  }

  if (!res.ok) {
    fail(`IAM token exchange HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const json = await res.json();
  bearerToken = json.access_token;
  tokenExpiry = Date.now() + json.expires_in * 1000;
  pass(`IAM token received (expires in ${json.expires_in}s, type: ${json.token_type})`);
  info('Token value hidden for security');

} catch (err) {
  fail(`IAM exchange failed: ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 3 — Granite text LLM
// ---------------------------------------------------------------------------

section(`Step 3: Granite text LLM  (${TEXT_MODEL})`);

try {
  const res = await fetch(`${WX_BASE}/ml/v1/text/chat?version=${WX_VERSION}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({
      model_id: TEXT_MODEL,
      project_id: PROJECT_ID,
      messages: [{ role: 'user', content: 'Reply with exactly: OPENHALL_OK' }],
      parameters: {
        max_new_tokens: 16,
        temperature: 0,
      },
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    fail(`HTTP ${res.status}: ${txt}`);
  } else {
    const json = await res.json();
    const reply = json?.choices?.[0]?.message?.content ?? json?.results?.[0]?.generated_text ?? '(no content field)';
    pass(`Response: ${reply.trim()}`);
    if (reply.trim().includes('OPENHALL_OK')) {
      pass('Text LLM round-trip: PASS');
    } else {
      info('Response received but did not contain expected token — model may be correct, prompt may have been reformatted.');
    }
  }
} catch (err) {
  fail(`Text LLM call failed: ${err.message}`);
}

// ---------------------------------------------------------------------------
// Step 4 — Granite Vision
// ---------------------------------------------------------------------------

section(`Step 4: Granite Vision  (${VISION_MODEL})`);

try {
  const res = await fetch(`${WX_BASE}/ml/v1/text/chat?version=${WX_VERSION}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({
      model_id: VISION_MODEL,
      project_id: PROJECT_ID,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: TEST_IMAGE_DATA_URI },
            },
            {
              type: 'text',
              text: 'What color is this 1×1 pixel image? Reply in one word.',
            },
          ],
        },
      ],
      parameters: {
        max_new_tokens: 16,
        temperature: 0,
      },
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    fail(`HTTP ${res.status}: ${txt}`);
    // Common failure: vision model not available in this region/plan
    if (res.status === 404 || res.status === 400) {
      info(`Model ${VISION_MODEL} may not be available in your region or plan tier.`);
      info('Try: ibm/granite-vision-3-1-2b or check your watsonx.ai model catalogue.');
    }
  } else {
    const json = await res.json();
    const reply = json?.choices?.[0]?.message?.content ?? json?.results?.[0]?.generated_text ?? '(no content field)';
    pass(`Response: ${reply.trim()}`);
    pass('Vision model round-trip: PASS');
  }
} catch (err) {
  fail(`Vision model call failed: ${err.message}`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

section('Summary');
info('Review the PASS/FAIL lines above, then tell Bob:');
info('  A) Browser-direct CORS result (Step 2)');
info('  B) Which model IDs actually worked (Steps 3 + 4)');
info('  C) Any HTTP error bodies (they contain the real error message)');
info('Bob will use this to configure the AI provider and decide whether');
info('the Cloudflare token-exchange worker is needed.');
