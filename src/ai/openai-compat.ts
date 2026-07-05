/**
 * openai-compat.ts — OpenAI-compatible provider (fallback).
 * Works with any OpenAI-compatible API: OpenAI, Together, Groq, etc.
 * Vision analysis uses the same model as text if the model supports images
 * (e.g. gpt-4o, llama-vision endpoints).
 */

import { WorkAnalysisSchema, CurationPlanSchema } from '../schema/analysis.schema';
import { GallerySchema } from '../schema/gallery.schema';
import { generateValidated, extractJSON } from './provider';
import { buildAnalyzePrompt } from './prompts/analyze.prompt';
import { buildCuratePrompt } from './prompts/curate.prompt';
import { buildGalleryPrompt } from './prompts/gallery.prompt';
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

export function loadOpenAISettings(): OpenAICompatSettings | null {
  try {
    const raw = localStorage.getItem('openhall_openai');
    if (!raw) return null;
    return JSON.parse(raw) as OpenAICompatSettings;
  } catch {
    return null;
  }
}

export function saveOpenAISettings(s: OpenAICompatSettings): void {
  localStorage.setItem('openhall_openai', JSON.stringify(s));
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
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
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
        chat(this.settings, [{ role: 'user', content: prompt + extraContext }], 1024),
      CurationPlanSchema
    );
  }

  async generateGallery(
    artworks: UploadedArtwork[],
    analyses: WorkAnalysis[],
    plan: CurationPlan,
    preset: StylePreset
  ): Promise<Gallery> {
    const titlePrompt = `In 4 words or fewer, suggest an exhibition title based on: "${plan.curatorNote}". Reply with ONLY the title.`;
    const rawTitle = await chat(this.settings, [{ role: 'user', content: titlePrompt }], 32);
    const exhibitionTitle = extractJSON(rawTitle).replace(/^["']|["']$/g, '').trim() || 'New Exhibition';

    const prompt = buildGalleryPrompt(artworks, analyses, plan, preset, exhibitionTitle);
    return generateValidated(
      async (extraContext) =>
        chat(this.settings, [{ role: 'user', content: prompt + extraContext }], 3000),
      GallerySchema
    ) as Promise<Gallery>;
  }
}
