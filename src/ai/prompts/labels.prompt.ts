/**
 * labels.prompt.ts
 * Expected output schema: LabelsResponseSchema (src/ai/gallery-assembler.ts)
 *
 * Input: a small batch (3–4) of artwork analyses + curator context.
 * Output: per-artwork wall labels only — NOT coordinates, rooms, or placements.
 * Kept small so the model never needs more than ~400 output tokens per batch.
 */

import type { WorkAnalysis } from '../../schema/analysis.schema';
import type { UploadedArtwork } from '../provider';

export function buildLabelsPrompt(
  artworks: UploadedArtwork[],
  analyses: WorkAnalysis[],
  curatorNote: string
): string {
  const artworkBlock = artworks
    .map((aw) => {
      const an = analyses.find((a) => a.artworkId === aw.id);
      return `  { "id": "${aw.id}", "title": "${aw.title || 'Untitled'}", "medium": "${aw.medium || 'Unknown medium'}", "style": "${an?.style ?? ''}", "subject": "${an?.subject ?? ''}", "mood": "${an?.mood ?? ''}", "description": "${an?.description ?? ''}" }`;
    })
    .join(',\n');

  return `You are writing wall labels for an art exhibition.

CURATOR NOTE: "${curatorNote}"

ARTWORKS:
[
${artworkBlock}
]

For each artwork, write a 2–3 sentence wall label. Base it ONLY on the visual analysis provided — do not invent facts about the artist's biography or intent.

Respond with ONLY a JSON array:
[
  {
    "artworkId": "<id>",
    "label": "<2–3 sentence wall label>",
    "artistStatement": "<optional one sentence, only if mood strongly suggests a clear voice>"
  }
]

Rules:
- Neutral curatorial tone
- No invented biography, no speculation about artist identity
- artistStatement is optional — omit it if unsure
- Respond with ONLY the JSON array — no markdown fences, no extra text`;
}
