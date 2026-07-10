/**
 * validation.ts — Dynamic Zod schemas for semantic AI output validation.
 *
 * Static schemas in analysis.schema.ts validate field shapes but cannot
 * validate referential integrity (e.g. "artworkId must equal the id we asked
 * for", "every placement must reference a room from the plan"). These helpers
 * build schemas that know the expected ids for the current call, so violations
 * are caught by generateValidated() and trigger the standard one retry.
 *
 * AGENTS.md rule 4: do not parse or repair free-form JSON manually; do not
 * silently drop foreign entries.
 */

import { z } from 'zod';
import { WorkAnalysisSchema, CurationPlanSchema } from '../schema/analysis.schema';
import { LabelEntrySchema } from './gallery-assembler';

// ---------------------------------------------------------------------------
// Vision analysis — returned artworkId must match the one we passed in
// ---------------------------------------------------------------------------

/**
 * Extend WorkAnalysisSchema to check that the returned artworkId exactly
 * equals the id we asked the model to analyse.
 */
export function buildAnalysisSchema(expectedId: string) {
  return WorkAnalysisSchema.refine(
    (d) => d.artworkId === expectedId,
    {
      message: `artworkId must be exactly "${expectedId}" — do not change the id I gave you.`,
      path: ['artworkId'],
    }
  );
}

// ---------------------------------------------------------------------------
// Curation plan — full referential-integrity check
// ---------------------------------------------------------------------------

/**
 * Extend CurationPlanSchema with:
 *   - roomCount === rooms.length
 *   - room ids are unique
 *   - every room artwork-id set union == expected artwork ids (no missing/extra)
 *   - placements: exactly one per expected artwork, no duplicates or foreign ids
 *   - every placement's roomId references an existing room
 *   - every placement's roomId matches the room in which the artwork was assigned
 *   - tourOrder is an exact permutation of expectedArtworkIds
 */
export function buildCurationSchema(expectedArtworkIds: string[]) {
  const expectedSet = new Set(expectedArtworkIds);

  return CurationPlanSchema
    .refine(
      (d) => d.roomCount === d.rooms.length,
      { message: 'roomCount must equal rooms.length.', path: ['roomCount'] }
    )
    .refine(
      (d) => {
        const ids = d.rooms.map((r) => r.roomId);
        return new Set(ids).size === ids.length;
      },
      { message: 'room ids must be unique.', path: ['rooms'] }
    )
    .refine(
      (d) => {
        const allAssigned = d.rooms.flatMap((r) => r.artworkIds);
        const assignedSet = new Set(allAssigned);
        // No duplicates across rooms
        if (allAssigned.length !== assignedSet.size) return false;
        // Every expected artwork is assigned
        for (const id of expectedSet) if (!assignedSet.has(id)) return false;
        // No foreign artwork ids
        for (const id of assignedSet) if (!expectedSet.has(id)) return false;
        return true;
      },
      {
        message: `rooms.artworkIds must be a partition of [${expectedArtworkIds.join(', ')}] — no missing, duplicate, or foreign ids.`,
        path: ['rooms'],
      }
    )
    .refine(
      (d) => {
        const ids = d.placements.map((p) => p.artworkId);
        return new Set(ids).size === ids.length;
      },
      { message: 'placement artworkIds must be unique (no duplicate placements).', path: ['placements'] }
    )
    .refine(
      (d) => {
        const placedSet = new Set(d.placements.map((p) => p.artworkId));
        for (const id of expectedSet) if (!placedSet.has(id)) return false;
        for (const id of placedSet) if (!expectedSet.has(id)) return false;
        return true;
      },
      {
        message: `placements must contain exactly one entry for each of [${expectedArtworkIds.join(', ')}] — no missing, duplicate, or foreign ids.`,
        path: ['placements'],
      }
    )
    .refine(
      (d) => {
        const roomIds = new Set(d.rooms.map((r) => r.roomId));
        return d.placements.every((p) => roomIds.has(p.roomId));
      },
      { message: 'every placement.roomId must reference an existing room.', path: ['placements'] }
    )
    .refine(
      (d) => {
        // Build artwork→room map from rooms
        const artworkRoom = new Map<string, string>();
        for (const room of d.rooms) {
          for (const awId of room.artworkIds) artworkRoom.set(awId, room.roomId);
        }
        return d.placements.every((p) => artworkRoom.get(p.artworkId) === p.roomId);
      },
      {
        message: 'each placement.roomId must match the room to which that artwork was assigned in rooms[].artworkIds.',
        path: ['placements'],
      }
    )
    .refine(
      (d) => {
        if (d.tourOrder.length !== expectedArtworkIds.length) return false;
        const tourSet = new Set(d.tourOrder);
        for (const id of expectedSet) if (!tourSet.has(id)) return false;
        return true;
      },
      {
        message: `tourOrder must be an exact permutation of [${expectedArtworkIds.join(', ')}].`,
        path: ['tourOrder'],
      }
    );
}

// ---------------------------------------------------------------------------
// Label/narration batch — each response must have exactly the requested ids
// ---------------------------------------------------------------------------

/**
 * Build a schema for a labels batch response that enforces:
 *   - exactly one entry per batchId (no missing, duplicate, or foreign ids)
 *   - narration is required and non-empty for every entry (per labels.prompt.ts)
 */
export function buildLabelsSchema(batchIds: string[]) {
  const expectedSet = new Set(batchIds);

  const StrictLabelEntrySchema = LabelEntrySchema.extend({
    narration: z.string().min(1, 'narration is required and must be non-empty'),
  });

  return z.array(StrictLabelEntrySchema)
    .refine(
      (entries) => {
        const ids = entries.map((e) => e.artworkId);
        return new Set(ids).size === ids.length;
      },
      { message: 'label batch: artworkIds must be unique (no duplicate entries).' }
    )
    .refine(
      (entries) => {
        const returnedSet = new Set(entries.map((e) => e.artworkId));
        for (const id of expectedSet) if (!returnedSet.has(id)) return false;
        for (const id of returnedSet) if (!expectedSet.has(id)) return false;
        return true;
      },
      {
        message: `label batch must contain exactly one entry for each of [${batchIds.join(', ')}] — no missing, duplicate, or foreign ids.`,
      }
    );
}
