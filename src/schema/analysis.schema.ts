/**
 * analysis.schema.ts — Zod schemas for intermediate AI pipeline outputs.
 * These are NOT part of gallery.json — they are transient pipeline types.
 *
 * Flow:
 *   images → WorkAnalysis[] (vision stage)
 *          → CurationPlan   (curation stage)
 *          → Gallery        (gallery-gen stage, validates against gallery.schema.ts)
 */

import { z } from 'zod';
import { WallSideSchema } from './gallery.schema';

// ---------------------------------------------------------------------------
// Stage 1 — per-artwork vision analysis
// ---------------------------------------------------------------------------

export const WorkAnalysisSchema = z.object({
  /** Matches the artwork id assigned during upload */
  artworkId: z.string(),
  /** Short image-grounded title suggestion, used only when the artist left title blank */
  suggestedTitle: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => value.toLowerCase() !== 'untitled', {
      message: 'AI title suggestion must not be "Untitled"',
    })
    .describe('A concise image-grounded artwork title, never "Untitled"'),
  style: z.string().describe('Art style or movement (e.g. "abstract expressionism", "photography")'),
  palette: z
    .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
    .min(1)
    .max(6)
    .describe('Dominant colours as hex strings'),
  subject: z.string().describe('What is depicted or represented'),
  mood: z.string().describe('Emotional tone or atmosphere'),
  description: z.string().describe('One sentence describing the work for curation purposes'),
});
export type WorkAnalysis = z.infer<typeof WorkAnalysisSchema>;

// ---------------------------------------------------------------------------
// Stage 2 — curation plan
// ---------------------------------------------------------------------------

export const RoomBriefSchema = z.object({
  roomId: z.string(),
  /** Human-readable theme for this room (used in wall-label generation) */
  theme: z.string(),
  /** Ordered list of artwork ids assigned to this room */
  artworkIds: z.array(z.string()),
});
export type RoomBrief = z.infer<typeof RoomBriefSchema>;

export const PlacementBriefSchema = z.object({
  artworkId: z.string(),
  roomId: z.string(),
  wall: WallSideSchema,
  /** Horizontal offset from wall centre (metres). 0 = centred. */
  offsetFromCenter: z.number().min(-6).max(6),
});
export type PlacementBrief = z.infer<typeof PlacementBriefSchema>;

export const CurationPlanSchema = z.object({
  /**
   * Number of rooms to create (1–4).
   * AI chooses based on artwork count, grouping, and user brief.
   */
  roomCount: z.number().int().min(1).max(4),
  rooms: z.array(RoomBriefSchema).min(1).max(4),
  placements: z.array(PlacementBriefSchema),
  /** Ordered list of artwork ids for the guided tour */
  tourOrder: z.array(z.string()),
  /**
   * One sentence describing the overall curatorial intent.
   * Used as context when generating gallery params and labels.
   */
  curatorNote: z.string(),
});
export type CurationPlan = z.infer<typeof CurationPlanSchema>;
