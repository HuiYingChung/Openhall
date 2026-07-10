/**
 * curate.prompt.ts
 * Expected output schema: CurationPlanSchema (src/schema/analysis.schema.ts)
 *
 * Input: WorkAnalysis[] JSON + user brief string
 */

import type { WorkAnalysis } from '../../schema/analysis.schema';

/**
 * Artwork title suggestions are editable display metadata, not curatorial
 * evidence. Keep them out of room themes, curator notes, and exhibition naming.
 */
export function serializeCurationAnalyses(analyses: WorkAnalysis[]): string {
  return JSON.stringify(
    analyses.map(({ artworkId, style, palette, subject, mood, description }) => ({
      artworkId,
      style,
      palette,
      subject,
      mood,
      description,
    })),
    null,
    2
  );
}

export function buildCuratePrompt(analysesJson: string, userBrief: string, artworkCount: number): string {
  return `You are an experienced exhibition curator. You have received ${artworkCount} artworks to arrange into a walkable gallery.

ARTIST'S BRIEF:
"${userBrief}"

ARTWORK ANALYSES:
${analysesJson}

Design the exhibition layout. Respond with ONLY a JSON object matching this exact schema:

{
  "roomCount": <integer 1–4, chosen based on how the works group naturally>,
  "rooms": [
    {
      "roomId": "room-1",
      "theme": "<thematic description of this room>",
      "artworkIds": ["<id>", ...]
    }
  ],
  "placements": [
    {
      "artworkId": "<id>",
      "roomId": "room-1",
      "wall": "<n|s|e|w>",
      "offsetFromCenter": <metres from wall centre, typically -3 to 3>
    }
  ],
  "tourOrder": ["<artworkId>", ...],
  "curatorNote": "<one sentence describing the overall curatorial intent>"
}

Rules:
- roomCount: 1 for ≤3 works, 2 for 4–6, 3 for 7–9, 4 for 10 works; adjust if works group strongly
- Each room should hold 2–4 works; avoid placing more than 2 works on the same wall
- offsetFromCenter: space works at least 1.5m apart on the same wall (use ±2 for two works)
- tourOrder: visit works in a narrative arc — start strong, end strong
- tourOrder: finish each room before entering the next; follow rooms[] order and never return to an earlier room
- roomId values must be "room-1", "room-2", etc.
- Respond with ONLY the JSON object — no markdown fences, no extra text`;
}
