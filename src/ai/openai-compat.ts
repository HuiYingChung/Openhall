/**
 * openai-compat.ts — OpenAI-compatible provider (fallback).
 * Works with any OpenAI-compatible API: OpenAI, Together, Groq, etc.
 * Vision analysis uses the same model as text if the model supports images
 * (e.g. gpt-4o, llama-vision endpoints).
 */

import { generateValidated, composeGalleryFromPlan } from './provider';
import { buildAnalyzePrompt } from './prompts/analyze.prompt';
import { buildCuratePrompt, serializeCurationAnalyses } from './prompts/curate.prompt';
import { buildAnalysisSchema, buildCurationSchema } from './validation';
import type { AIProvider, UploadedArtwork, StylePreset } from './provider';
import type { WorkAnalysis, CurationPlan } from '../schema/analysis.schema';
import type { Gallery } from '../schema/gallery.schema';

export interface OpenAICompatSettings {
  apiKey: string;
  /** e.g. https://api.openai.com/v1  or  https://api.together.xyz/v1 */
  baseUrl: string;
  /** Model to use for text + vision (e.g. "gpt-4o") */
  model: string;
}

/**
 * Hosted-deployment policy (deploy/vercel-ph): the API key must never touch
 * persistent storage — memory only, one page load. Non-secret settings
 * (base URL, model) still persist in localStorage for convenience.
 */
let memoryApiKey = '';

export function loadOpenAISettings(): OpenAICompatSettings | null {
  try {
    const raw = localStorage.getItem('openhall_openai');
    if (!raw) return null;
    const stored = JSON.parse(raw) as OpenAICompatSettings;
    if (stored.apiKey) {
      // Scrub any key persisted by an earlier version; never adopt it.
      localStorage.setItem('openhall_openai', JSON.stringify({ ...stored, apiKey: '' }));
    }
    return { ...stored, apiKey: memoryApiKey };
  } catch {
    return null;
  }
}

export function saveOpenAISettings(s: OpenAICompatSettings): void {
  memoryApiKey = s.apiKey;
  localStorage.setItem('openhall_openai', JSON.stringify({ ...s, apiKey: '' }));
}

/** Wipe the in-memory key (shared-computer escape hatch). */
export function clearMemoryApiKey(): void {
  memoryApiKey = '';
}

// ---------------------------------------------------------------------------
// Raw chat call
// ---------------------------------------------------------------------------

async function chat(
  settings: OpenAICompatSettings,
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>,
  maxTokens = 1024
): Promise<string> {
  const res = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI-compat HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    choices?: Array<{
      message?: { content?: string };
      finish_reason?: string;
    }>;
  };
  const finishReason = json.choices?.[0]?.finish_reason;
  if (finishReason === 'length' || finishReason === 'max_tokens') {
    throw new Error(
      `OpenAI-compat output truncated (finish_reason: "${finishReason}"). ` +
        'Increase max_tokens or reduce the requested output size.'
    );
  }
  return json?.choices?.[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// OpenAICompatProvider
// ---------------------------------------------------------------------------

export class OpenAICompatProvider implements AIProvider {
  constructor(private settings: OpenAICompatSettings) {}

  async analyzeArtwork(artwork: UploadedArtwork): Promise<WorkAnalysis> {
    const prompt = buildAnalyzePrompt(artwork.id);
    return generateValidated(
      async (extraContext) =>
        chat(this.settings, [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: artwork.analysisDataUrl } },
              { type: 'text', text: prompt + extraContext },
            ],
          },
        ], 512),
      buildAnalysisSchema(artwork.id)
    );
  }

  async curate(analyses: WorkAnalysis[], userBrief: string): Promise<CurationPlan> {
    const expectedIds = analyses.map((a) => a.artworkId);
    const prompt = buildCuratePrompt(
      serializeCurationAnalyses(analyses),
      userBrief,
      analyses.length
    );
    return generateValidated(
      async (extraContext) =>
        chat(this.settings, [{ role: 'user', content: prompt + extraContext }], 1024),
      buildCurationSchema(expectedIds)
    );
  }

  async generateGallery(
    artworks: UploadedArtwork[],
    analyses: WorkAnalysis[],
    plan: CurationPlan,
    preset: StylePreset,
    onProgress?: (evt: import('./provider').ComposeProgressEvent) => void
  ): Promise<Gallery> {
    // Shared composition: LLM writes title + labels; geometry is assembled
    // deterministically. The old freeform whole-gallery.json prompt produced
    // spatially incoherent tours — see composeGalleryFromPlan in provider.ts.
    return composeGalleryFromPlan(
      (prompt, maxTokens) =>
        chat(this.settings, [{ role: 'user', content: prompt }], maxTokens),
      artworks,
      analyses,
      plan,
      preset,
      onProgress
    );
  }
}
