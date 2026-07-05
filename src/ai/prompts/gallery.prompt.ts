/**
 * gallery.prompt.ts
 * Expected output schema: GallerySchema (src/schema/gallery.schema.ts)
 *
 * Input: curation plan + artwork metadata + style preset
 */

import type { StylePreset } from '../provider';
import type { UploadedArtwork } from '../provider';
import type { WorkAnalysis } from '../../schema/analysis.schema';
import type { CurationPlan } from '../../schema/analysis.schema';

const PRESET_PARAMS: Record<StylePreset, {
  wall: string; floor: string; accent: string;
  ambientIntensity: number; temperature: string;
  widthBase: number; heightBase: number;
}> = {
  'white-cube': {
    wall: 'white-plaster', floor: 'light-wood', accent: '#e8e0d8',
    ambientIntensity: 0.45, temperature: 'neutral',
    widthBase: 12, heightBase: 3.5,
  },
  'concrete-industrial': {
    wall: 'concrete', floor: 'polished-concrete', accent: '#607080',
    ambientIntensity: 0.3, temperature: 'cold',
    widthBase: 14, heightBase: 4.0,
  },
  'warm-wood': {
    wall: 'dark-wood', floor: 'dark-wood', accent: '#c0a070',
    ambientIntensity: 0.5, temperature: 'warm',
    widthBase: 10, heightBase: 3.2,
  },
  'dark-dramatic': {
    wall: 'black-plaster', floor: 'raw-concrete', accent: '#2a2a2a',
    ambientIntensity: 0.2, temperature: 'neutral',
    widthBase: 12, heightBase: 4.0,
  },
};

export function buildGalleryPrompt(
  artworks: UploadedArtwork[],
  analyses: WorkAnalysis[],
  plan: CurationPlan,
  preset: StylePreset,
  exhibitionTitle: string
): string {
  const p = PRESET_PARAMS[preset];

  // Build artwork reference block
  const artworkRef = artworks.map((aw) => {
    const analysis = analyses.find((a) => a.artworkId === aw.id);
    return `  { "id": "${aw.id}", "title": "${aw.title || 'Untitled'}", "medium": "${aw.medium || 'Unknown medium'}", "year": ${aw.year ?? 'null'}, "style": "${analysis?.style ?? ''}", "mood": "${analysis?.mood ?? ''}", "description": "${analysis?.description ?? ''}" }`;
  }).join(',\n');

  const placementsRef = JSON.stringify(plan.placements, null, 2);

  return `You are an exhibition designer generating a gallery.json configuration file.

EXHIBITION TITLE: "${exhibitionTitle}"
STYLE PRESET: ${preset}
CURATOR NOTE: "${plan.curatorNote}"

ARTWORKS:
[
${artworkRef}
]

CURATION PLACEMENTS:
${placementsRef}

ROOM LAYOUT: ${plan.roomCount} room(s), roomIds: ${plan.rooms.map(r => r.roomId).join(', ')}

Generate a complete gallery.json. Respond with ONLY a JSON object matching this exact schema:

{
  "version": "1.0",
  "title": "<exhibition title>",
  "rooms": [
    {
      "id": "<roomId from plan>",
      "width": <${p.widthBase}–${p.widthBase + 4}, metres>,
      "depth": <8–14, metres>,
      "height": ${p.heightBase},
      "surfaces": {
        "wall": "${p.wall}",
        "floor": "${p.floor}",
        "accentColor": "${p.accent}"
      },
      "lighting": {
        "ambientIntensity": ${p.ambientIntensity},
        "temperature": "${p.temperature}",
        "artworkSpotlights": true
      },
      "doorways": [
        {
          "targetRoomId": "<next room id>",
          "wall": "e",
          "offsetFromCenter": 0,
          "width": 2.0,
          "height": 2.4
        }
      ]
    }
  ],
  "artworks": [
    {
      "id": "<artworkId>",
      "imagePath": "images/<artworkId>.jpg",
      "title": "<title or Untitled>",
      "medium": "<medium>",
      "year": <year or omit>,
      "label": "<2–3 sentence wall label — factual, based only on visual analysis, no invented biography>"
    }
  ],
  "placements": [
    {
      "artworkId": "<id>",
      "roomId": "<roomId>",
      "wall": "<n|s|e|w>",
      "offsetFromCenter": <from curation plan>,
      "hangingHeight": 1.5,
      "displayWidth": <0.8–2.0 metres, proportional to importance>
    }
  ],
  "tour": [
    {
      "artworkId": "<id in tourOrder>",
      "position": { "x": <2m in front of artwork on its wall side>, "y": 1.6, "z": <same> },
      "lookAt": { "x": <artwork x>, "y": 1.5, "z": <artwork z> },
      "label": "<artwork title>"
    }
  ]
}

Rules:
- Connect rooms with doorways on the east wall of each room (except the last)
- Tour positions must be 2m in front of the artwork, facing it
- Wall labels: 2–3 sentences, observe what you see, no invented facts about the artist
- Respond with ONLY the JSON object — no markdown fences, no extra text`;
}

export { PRESET_PARAMS };
