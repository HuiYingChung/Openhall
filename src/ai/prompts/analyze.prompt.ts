/**
 * analyze.prompt.ts
 * Expected output schema: WorkAnalysisSchema (src/schema/analysis.schema.ts)
 *
 * Input: one artwork image (passed as image_url content block)
 */

export function buildAnalyzePrompt(artworkId: string): string {
  return `You are an art curator analysing a submitted artwork for an exhibition.

Analyse the image carefully and respond with ONLY a JSON object matching this exact schema:

{
  "artworkId": "${artworkId}",
  "suggestedTitle": "<a concise 2–6 word title grounded in the image>",
  "style": "<art style or movement, e.g. abstract expressionism, documentary photography>",
  "palette": ["#rrggbb", ...],
  "subject": "<what is depicted or represented in one clause>",
  "mood": "<emotional tone or atmosphere in a few words>",
  "description": "<one sentence describing this work for curation purposes>"
}

Rules:
- palette: 2–5 dominant hex colours from the image
- suggestedTitle: 2–6 words, concise, based only on what you see in the image, with no surrounding quotation marks
- Never use "Untitled" as suggestedTitle
- Do not infer or mention an artwork medium, artist, location, or date
- style, subject, mood: concise, factual, based only on what you see
- description: neutral curatorial tone, no invented artist biography
- Respond with ONLY the JSON object — no markdown fences, no extra text`;
}
