/**
 * labels.prompt.ts
 * Expected output schema: LabelsResponseSchema (src/ai/gallery-assembler.ts)
 *
 * Input: a small batch (2–3) of artwork analyses + curator context.
 * Output: per-artwork wall labels + spoken narration — NOT coordinates, rooms,
 * or placements. Kept small so the model stays within ~800 output tokens per
 * batch (narration roughly doubles prior label-only budget; batch reduced from
 * 3–4 to 2–3 works to stay reliable).
 */

import type { WorkAnalysis } from '../../schema/analysis.schema';
import type { UploadedArtwork } from '../provider';

export function buildLabelsPrompt(
  artworks: UploadedArtwork[],
  analyses: WorkAnalysis[],
  curatorNote: string
): string {
  const artworkBlock = JSON.stringify(
    artworks.map((aw) => {
      const an = analyses.find((a) => a.artworkId === aw.id);
      return {
        id: aw.id,
        style: an?.style ?? '',
        subject: an?.subject ?? '',
        mood: an?.mood ?? '',
        description: an?.description ?? '',
      };
    }),
    null,
    2
  );

  return `You are writing wall labels and spoken narration for an art exhibition.

CURATOR NOTE: ${JSON.stringify(curatorNote)}

ARTWORKS:
${artworkBlock}

For each artwork, write:
1. A 2–3 sentence wall label (neutral curatorial tone, written to be read).
2. A spoken narration (2–4 sentences, warm conversational docent voice, ~60 words max, written to be heard aloud while a visitor looks at the work).

Respond with ONLY a JSON array:
[
  {
    "artworkId": "<id>",
    "label": "<2–3 sentence wall label>",
    "narration": "<2–4 sentences, spoken docent voice, ~60 words max>",
    "artistStatement": "<optional one sentence, only if mood strongly suggests a clear voice>"
  }
]

Rules:
- label: neutral curatorial tone, for reading on a wall plaque
- narration: warmer than the label — what a gallery guide would SAY while the visitor looks at the work; no coordinates, no invented biography, grounded only in the visual analysis provided
- Artwork title, medium, and year are editable display metadata and intentionally omitted here; do not infer or mention a title, medium, or year
- narration is required for every artwork
- artistStatement is optional — omit it if unsure
- Respond with ONLY the JSON array — no markdown fences, no extra text`;
}
