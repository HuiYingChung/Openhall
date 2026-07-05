/**
 * provider.ts — AIProvider interface and shared types.
 * All AI work goes through this interface; nothing in the viewer or exporter
 * imports from watsonx.ts or openai-compat.ts directly.
 */

import type { WorkAnalysis } from '../schema/analysis.schema';
import type { CurationPlan } from '../schema/analysis.schema';
import type { Gallery } from '../schema/gallery.schema';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Uploaded artwork (pre-AI)
// ---------------------------------------------------------------------------

export interface UploadedArtwork {
  /** Client-assigned id (e.g. "aw-01") */
  id: string;
  /** Original filename */
  filename: string;
  /** Object URL for the ~1024px analysis image (data URI or blob URL) */
  analysisDataUrl: string;
  /** Object URL for the ≤2048px display image */
  displayObjectUrl: string;
  /** Real aspect ratio (width / height) read from the image */
  aspectRatio: number;
  /** User-supplied metadata (may be empty strings) */
  title: string;
  medium: string;
  year?: number;
}

// ---------------------------------------------------------------------------
// Style presets
// ---------------------------------------------------------------------------

export type StylePreset = 'white-cube' | 'concrete-industrial' | 'warm-wood' | 'dark-dramatic';

export const STYLE_PRESETS: Record<StylePreset, { label: string; description: string }> = {
  'white-cube': {
    label: 'White Cube',
    description: 'Minimalist white walls, light wood floor, neutral lighting — the classic gallery.',
  },
  'concrete-industrial': {
    label: 'Industrial',
    description: 'Raw concrete walls and floor, cold lighting, high ceilings.',
  },
  'warm-wood': {
    label: 'Warm Wood',
    description: 'Dark wood panels, warm amber lighting, intimate proportions.',
  },
  'dark-dramatic': {
    label: 'Dark & Dramatic',
    description: 'Black plaster walls, targeted spotlights, high contrast.',
  },
};

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface AIProvider {
  /**
   * Analyse a single artwork image.
   * @param artwork - uploaded work with a data URL usable for the vision model
   */
  analyzeArtwork(artwork: UploadedArtwork): Promise<WorkAnalysis>;

  /**
   * Produce a curation plan from all analyses + the user's brief sentence.
   */
  curate(analyses: WorkAnalysis[], userBrief: string): Promise<CurationPlan>;

  /**
   * Generate a full validated gallery.json from the curation plan + style preset.
   * @param artworks - original uploads (for titles, mediums, aspect ratios)
   */
  generateGallery(
    artworks: UploadedArtwork[],
    analyses: WorkAnalysis[],
    plan: CurationPlan,
    preset: StylePreset
  ): Promise<Gallery>;
}

// ---------------------------------------------------------------------------
// generateValidated — shared retry helper (used by all providers)
// ---------------------------------------------------------------------------

/**
 * Call `llmFn` to get a raw string, parse as JSON, validate with `schema`.
 * On failure, re-call with the validation errors appended (up to maxRetries).
 * Throws if all retries are exhausted.
 */
export async function generateValidated<T>(
  llmFn: (extraContext: string) => Promise<string>,
  schema: z.ZodType<T>,
  maxRetries = 2
): Promise<T> {
  let extraContext = '';
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await llmFn(extraContext);

    // Extract JSON from the response — models sometimes wrap in markdown fences
    const jsonStr = extractJSON(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      lastError = e;
      extraContext = `\n\nYour previous response could not be parsed as JSON. Error: ${String(e)}\nRaw response was:\n${raw}\n\nPlease respond with ONLY valid JSON, no markdown fences or extra text.`;
      continue;
    }

    const result = schema.safeParse(parsed);
    if (result.success) return result.data;

    lastError = result.error;
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    extraContext = `\n\nYour previous JSON response failed validation:\n${issues}\n\nPlease fix these issues and respond with ONLY the corrected JSON.`;
  }

  throw new Error(
    `generateValidated: all ${maxRetries + 1} attempts failed. Last error: ${String(lastError)}`
  );
}

/**
 * Extract a JSON object/array from a string that may contain markdown fences
 * or surrounding prose.
 */
export function extractJSON(text: string): string {
  // Strip ```json ... ``` or ``` ... ``` fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // Find the first { or [ and last matching } or ]
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  let start = -1;
  if (firstBrace === -1 && firstBracket === -1) return text.trim();
  if (firstBrace === -1) start = firstBracket;
  else if (firstBracket === -1) start = firstBrace;
  else start = Math.min(firstBrace, firstBracket);

  const endBrace = text.lastIndexOf('}');
  const endBracket = text.lastIndexOf(']');
  const end = Math.max(endBrace, endBracket);

  if (start === -1 || end === -1 || end < start) return text.trim();
  return text.slice(start, end + 1);
}
