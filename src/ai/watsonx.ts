/**
 * watsonx.ts — WatsonxProvider implementation.
 *
 * IAM token flow:
 *   - In production (browser): token-exchange worker handles the IAM call
 *     (IAM endpoint has no CORS headers, confirmed by connectivity probe).
 *   - In Node scripts: direct IAM call via env vars.
 *
 * Models confirmed working (2026-07):
 *   Vision:  meta/llama-3-2-11b-vision-instruct
 *   Text:    ibm/granite-3-8b-instruct
 */

import { WorkAnalysisSchema, CurationPlanSchema } from '../schema/analysis.schema';
import { generateValidated, composeGalleryFromPlan } from './provider';
import { buildAnalyzePrompt } from './prompts/analyze.prompt';
import { buildCuratePrompt } from './prompts/curate.prompt';
import type { AIProvider, UploadedArtwork, StylePreset } from './provider';
import type { WorkAnalysis, CurationPlan } from '../schema/analysis.schema';
import type { Gallery } from '../schema/gallery.schema';

export const WATSONX_VISION_MODEL = 'meta-llama/llama-3-2-11b-vision-instruct';
export const WATSONX_TEXT_MODEL = 'ibm/granite-3-8b-instruct';
const WX_VERSION = '2024-05-31';

// ---------------------------------------------------------------------------
// Settings shape (stored in localStorage)
// ---------------------------------------------------------------------------

export interface WatsonxSettings {
  apiKey: string;
  projectId: string;
  /** Defaults to https://us-south.ml.cloud.ibm.com */
  wxUrl: string;
  /**
   * URL of the token-exchange worker.
   * If empty, falls back to direct IAM (only works in Node / non-browser contexts).
   */
  tokenWorkerUrl: string;
}

export function loadWatsonxSettings(): WatsonxSettings | null {
  try {
    const raw = localStorage.getItem('openhall_watsonx');
    if (!raw) return null;
    return JSON.parse(raw) as WatsonxSettings;
  } catch {
    return null;
  }
}

export function saveWatsonxSettings(s: WatsonxSettings): void {
  localStorage.setItem('openhall_watsonx', JSON.stringify(s));
}

// ---------------------------------------------------------------------------
// IAM token cache
// ---------------------------------------------------------------------------

interface TokenCache {
  token: string;
  expiresAt: number; // ms since epoch
}

// Module-level cache — survives across provider calls within a session
let _tokenCache: TokenCache | null = null;

async function getToken(settings: WatsonxSettings): Promise<string> {
  const now = Date.now();
  // Refresh 60s before expiry
  if (_tokenCache && _tokenCache.expiresAt - now > 60_000) {
    return _tokenCache.token;
  }

  if (settings.tokenWorkerUrl) {
    // Use the token-exchange worker (browser path): POST /token
    const res = await fetch(`${settings.tokenWorkerUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: settings.apiKey }),
    });
    if (!res.ok) throw new Error(`Token worker error ${res.status}: ${await res.text()}`);
    const { access_token, expires_in } = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    _tokenCache = { token: access_token, expiresAt: now + expires_in * 1000 };
    return access_token;
  } else {
    // Direct IAM call (Node scripts only — blocked by CORS in browser)
    const body = new URLSearchParams({
      grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
      apikey: settings.apiKey,
    });
    const res = await fetch('https://iam.cloud.ibm.com/identity/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`IAM error ${res.status}: ${await res.text()}`);
    const { access_token, expires_in } = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    _tokenCache = { token: access_token, expiresAt: now + expires_in * 1000 };
    return access_token;
  }
}

/** Invalidate cached token (call on 401 responses) */
export function invalidateToken(): void {
  _tokenCache = null;
}

// ---------------------------------------------------------------------------
// Raw chat call
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
}

async function chat(
  settings: WatsonxSettings,
  modelId: string,
  messages: ChatMessage[],
  maxNewTokens = 1024
): Promise<string> {
  const token = await getToken(settings);

  // When a token worker is configured (browser path), proxy ML calls through it
  // to work around the missing CORS headers on us-south.ml.cloud.ibm.com.
  // Node scripts (no tokenWorkerUrl) call the ML API directly.
  const url = settings.tokenWorkerUrl
    ? `${settings.tokenWorkerUrl}/proxy/ml/v1/text/chat?version=${WX_VERSION}`
    : `${settings.wxUrl}/ml/v1/text/chat?version=${WX_VERSION}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model_id: modelId,
      project_id: settings.projectId,
      messages,
      parameters: { max_new_tokens: maxNewTokens, temperature: 0.1 },
    }),
  });

  if (res.status === 401) {
    invalidateToken();
    throw new Error('watsonx 401 Unauthorized — API key may be invalid or token expired');
  }
  if (!res.ok) {
    throw new Error(`watsonx HTTP ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{
      message?: { content?: string };
      finish_reason?: string;
    }>;
  };

  // Truncation detection: if the model stopped because it hit the token limit,
  // fail fast with a clear error. Retrying with the same prompt won't fix it —
  // the caller needs to reduce output size instead.
  const finishReason = json?.choices?.[0]?.finish_reason;
  if (finishReason === 'length' || finishReason === 'max_tokens') {
    throw new Error(
      `watsonx output truncated (finish_reason: "${finishReason}"). ` +
        `Increase max_new_tokens or reduce the requested output size.`
    );
  }

  return json?.choices?.[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// WatsonxProvider
// ---------------------------------------------------------------------------

export class WatsonxProvider implements AIProvider {
  constructor(private settings: WatsonxSettings) {}

  async analyzeArtwork(artwork: UploadedArtwork): Promise<WorkAnalysis> {
    const prompt = buildAnalyzePrompt(artwork.id);
    return generateValidated(
      async (extraContext) => {
        return chat(this.settings, WATSONX_VISION_MODEL, [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: artwork.analysisDataUrl } },
              { type: 'text', text: prompt + extraContext },
            ],
          },
        ], 512);
      },
      WorkAnalysisSchema
    );
  }

  async curate(analyses: WorkAnalysis[], userBrief: string): Promise<CurationPlan> {
    const prompt = buildCuratePrompt(
      JSON.stringify(analyses, null, 2),
      userBrief,
      analyses.length
    );
    return generateValidated(
      async (extraContext) =>
        chat(this.settings, WATSONX_TEXT_MODEL, [
          { role: 'user', content: prompt + extraContext },
        ], 1024),
      CurationPlanSchema
    );
  }

  async generateGallery(
    artworks: UploadedArtwork[],
    analyses: WorkAnalysis[],
    plan: CurationPlan,
    preset: StylePreset
  ): Promise<Gallery> {
    // Shared composition: LLM writes title + labels; geometry is assembled
    // deterministically (see composeGalleryFromPlan in provider.ts).
    return composeGalleryFromPlan(
      (prompt, maxTokens) =>
        chat(this.settings, WATSONX_TEXT_MODEL, [{ role: 'user', content: prompt }], maxTokens),
      artworks,
      analyses,
      plan,
      preset
    );
  }
}
