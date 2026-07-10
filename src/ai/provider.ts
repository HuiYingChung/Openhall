/**
 * provider.ts — AIProvider interface and shared types.
 * All AI work goes through this interface; nothing in the viewer or exporter
 * imports from watsonx.ts or openai-compat.ts directly.
 */

import type { WorkAnalysis } from '../schema/analysis.schema';
import type { CurationPlan } from '../schema/analysis.schema';
import type { Gallery } from '../schema/gallery.schema';
import { GallerySchema } from '../schema/gallery.schema';
import { assembleGallery, LabelsResponseSchema } from './gallery-assembler';
import type { LabelsResponse } from './gallery-assembler';
import { buildLabelsPrompt } from './prompts/labels.prompt';
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
  /**
   * SHA-256 hex fingerprint of the image bytes, derived at upload time.
   * Used by aiInputKey() to detect same-filename/different-content replacements.
   * Absent for demo artworks and test stubs.
   */
  contentHash?: string;
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
// Progress events emitted by composeGalleryFromPlan
// ---------------------------------------------------------------------------

export type ComposeProgressEvent =
  | { type: 'title' }
  /** The real exhibition title the model chose (or the fallback). */
  | { type: 'title-done'; title: string }
  | { type: 'labels-batch-start'; batch: number; totalBatches: number; artworkIds: string[] }
  /** `retried` reports honestly whether this batch needed the one retry. */
  | { type: 'labels-batch-done'; batch: number; totalBatches: number; entries: LabelsResponse; retried: boolean }
  | { type: 'assembling' }
  /** Real numbers from the deterministic assembly — success is information too. */
  | { type: 'assembled'; rooms: number; roomDims: string[]; placements: number; tourStops: number }
  // Only the labels step retries: it is the one structured-JSON output here.
  // The title is plain text with a fallback — it never enters the retry path.
  | { type: 'retry'; step: 'labels' };

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
   * @param onProgress - optional pipeline progress callback (compose events only)
   */
  generateGallery(
    artworks: UploadedArtwork[],
    analyses: WorkAnalysis[],
    plan: CurationPlan,
    preset: StylePreset,
    onProgress?: (evt: ComposeProgressEvent) => void
  ): Promise<Gallery>;
}

// ---------------------------------------------------------------------------
// generateValidated — shared retry helper (used by all providers)
// ---------------------------------------------------------------------------

/**
 * Call `llmFn` to get a raw string, parse as JSON, validate with `schema`.
 * On failure, re-call with the validation errors appended (up to maxRetries).
 * `onRetry` is called exactly once on each retry attempt (not on the first try).
 * Throws if all retries are exhausted.
 */
export async function generateValidated<T>(
  llmFn: (extraContext: string) => Promise<string>,
  schema: z.ZodType<T>,
  // AGENTS.md architecture rule 4: retry ONCE on invalid output, then fail.
  maxRetries = 1,
  onRetry?: () => void
): Promise<T> {
  let extraContext = '';
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) onRetry?.();
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

// ---------------------------------------------------------------------------
// composeGalleryFromPlan — shared gallery composition (used by all providers)
// ---------------------------------------------------------------------------

/**
 * Build the final Gallery from a curation plan the reliable way: the LLM
 * writes only short text (exhibition title + wall labels); every piece of
 * geometry — rooms, placements, doorways, tour path — comes from
 * assembleGallery() deterministically.
 *
 * Extracted from WatsonxProvider so every provider shares one composition
 * path. Letting a model emit gallery.json freeform produced walkable but
 * spatially incoherent tours (waypoints through walls, backtracking flow);
 * models narrate space, they don't reason about it.
 *
 * @param generate plain text completion: (prompt, maxTokens) → raw model text
 */
export async function composeGalleryFromPlan(
  generate: (prompt: string, maxTokens: number) => Promise<string>,
  artworks: UploadedArtwork[],
  analyses: WorkAnalysis[],
  plan: CurationPlan,
  preset: StylePreset,
  onProgress?: (evt: ComposeProgressEvent) => void
): Promise<Gallery> {
  // Step 1: derive an exhibition title (tiny output — 32 tokens).
  // Plain text, NOT JSON — generateValidated would reject every real reply.
  // An unhelpful or failing model falls back to the default title.
  onProgress?.({ type: 'title' });
  const titlePrompt = `In 4 words or fewer, suggest an exhibition title based on this curator note: "${plan.curatorNote}". Reply with ONLY the title, no quotes.`;
  let rawTitle = '';
  try {
    rawTitle = await generate(titlePrompt, 32);
  } catch {
    rawTitle = '';
  }
  const exhibitionTitle = rawTitle.replace(/^["']|["']$/g, '').trim() || 'New Exhibition';
  onProgress?.({ type: 'title-done', title: exhibitionTitle });

  // Step 2: build all geometry deterministically (rooms, placements, doorways, tour)
  onProgress?.({ type: 'assembling' });
  const shell = assembleGallery(plan, preset, artworks, exhibitionTitle);
  onProgress?.({
    type: 'assembled',
    rooms: shell.rooms.length,
    roomDims: shell.rooms.map((r) => `${r.width}×${r.depth} m`),
    placements: shell.placements.length,
    tourStops: shell.tour.length,
  });

  // Step 3: ask the LLM for labels + narration, in batches of ≤3 works (~800 tokens each)
  const BATCH_SIZE = 3;
  const totalBatches = Math.ceil(artworks.length / BATCH_SIZE);
  const labelMap: Record<string, { label: string; narration?: string; artistStatement?: string }> = {};

  for (let i = 0; i < artworks.length; i += BATCH_SIZE) {
    const batch = artworks.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    onProgress?.({
      type: 'labels-batch-start',
      batch: batchNum,
      totalBatches,
      artworkIds: batch.map((a) => a.id),
    });
    const prompt = buildLabelsPrompt(batch, analyses, plan.curatorNote);
    let retried = false;
    const entries = await generateValidated(
      async (extraContext) => generate(prompt + extraContext, 600),
      LabelsResponseSchema,
      1, // AGENTS.md rule 4: retry once, then fail loudly
      () => {
        retried = true;
        onProgress?.({ type: 'retry', step: 'labels' });
      }
    );
    onProgress?.({ type: 'labels-batch-done', batch: batchNum, totalBatches, entries, retried });
    for (const entry of entries) {
      labelMap[entry.artworkId] = {
        label: entry.label,
        narration: entry.narration,
        artistStatement: entry.artistStatement,
      };
    }
  }

  // Step 4: merge labels, narration, and artistStatement into artwork records
  const artworksWithLabels = shell.artworks.map((aw) => ({
    ...aw,
    label: labelMap[aw.id]?.label ?? 'No label available.',
    ...(labelMap[aw.id]?.narration
      ? { narration: labelMap[aw.id].narration }
      : {}),
    ...(labelMap[aw.id]?.artistStatement
      ? { artistStatement: labelMap[aw.id].artistStatement }
      : {}),
  }));

  // Step 5: validate the assembled gallery
  return GallerySchema.parse({ ...shell, artworks: artworksWithLabels });
}
