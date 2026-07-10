/**
 * gallery-assembler.ts — Deterministic gallery geometry + label orchestration.
 *
 * Why this exists:
 *   Asking the LLM to emit the entire gallery.json (rooms, coordinates, placements,
 *   tour waypoints, AND labels for every work) in one shot reliably exceeds
 *   max_new_tokens and produces truncated JSON. Coordinate geometry is not a
 *   creative task — it should be computed in code. Only the creative text (wall
 *   labels) needs the LLM, in small focused batches.
 *
 * Responsibilities:
 *   assembleGallery()   — build the full Gallery struct deterministically from
 *                          CurationPlan + StylePreset + UploadedArtwork metadata.
 *                          Labels are inserted separately by the caller.
 *   PRESET_PARAMS       — single source for preset-to-material mapping (was in
 *                          gallery.prompt.ts; that file is now unused).
 */

import { z } from 'zod';
import type { StylePreset, UploadedArtwork } from './provider';
import type { CurationPlan } from '../schema/analysis.schema';
import type {
  Gallery,
  Room,
  Placement,
  TourWaypoint,
  Doorway,
  WallSide,
} from '../schema/gallery.schema';

// ---------------------------------------------------------------------------
// Preset parameters — materials, proportions, lighting
// ---------------------------------------------------------------------------

export const PRESET_PARAMS: Record<
  StylePreset,
  {
    wall: string;
    floor: string;
    accent: string;
    ambientIntensity: number;
    temperature: string;
    widthBase: number;
    depthBase: number;
    height: number;
  }
> = {
  'white-cube': {
    wall: 'white-plaster',
    floor: 'light-wood',
    accent: '#e8e0d8',
    ambientIntensity: 0.45,
    temperature: 'neutral',
    widthBase: 12,
    depthBase: 10,
    height: 3.5,
  },
  'concrete-industrial': {
    wall: 'concrete',
    floor: 'polished-concrete',
    accent: '#607080',
    ambientIntensity: 0.3,
    temperature: 'cold',
    widthBase: 14,
    depthBase: 12,
    height: 4.0,
  },
  'warm-wood': {
    wall: 'dark-wood',
    floor: 'dark-wood',
    accent: '#c0a070',
    ambientIntensity: 0.5,
    temperature: 'warm',
    widthBase: 10,
    depthBase: 10,
    height: 3.2,
  },
  'dark-dramatic': {
    wall: 'black-plaster',
    floor: 'raw-concrete',
    accent: '#2a2a2a',
    ambientIntensity: 0.2,
    temperature: 'neutral',
    widthBase: 12,
    depthBase: 10,
    height: 4.0,
  },
};

// ---------------------------------------------------------------------------
// Labels schema (for LLM batch calls)
// ---------------------------------------------------------------------------

export const LabelEntrySchema = z.object({
  artworkId: z.string(),
  label: z.string().min(10),
  narration: z.string().optional(),
  artistStatement: z.string().optional(),
});
export type LabelEntry = z.infer<typeof LabelEntrySchema>;

export const LabelsResponseSchema = z.array(LabelEntrySchema);
export type LabelsResponse = z.infer<typeof LabelsResponseSchema>;

// ---------------------------------------------------------------------------
// Deterministic room geometry
// ---------------------------------------------------------------------------

/** Width increment per extra artwork in a room (so rooms with more art are wider) */
const WIDTH_PER_EXTRA_ARTWORK = 1.5;

/**
 * Build Room objects for every room in the curation plan.
 * Rooms are chained linearly east→west: room i connects to room i+1 on its east wall.
 */
export function buildRooms(
  plan: CurationPlan,
  preset: StylePreset
): Room[] {
  const p = PRESET_PARAMS[preset];

  return plan.rooms.map((brief, idx) => {
    // Scale room width slightly based on artwork count in the room
    const extra = Math.max(0, brief.artworkIds.length - 3) * WIDTH_PER_EXTRA_ARTWORK;
    const width = Math.round((p.widthBase + extra) * 10) / 10;
    const depth = p.depthBase;

    // Linear chain: every room except the last has a doorway on its east wall
    const doorways =
      idx < plan.rooms.length - 1
        ? [
            {
              targetRoomId: plan.rooms[idx + 1].roomId,
              wall: 'e' as WallSide,
              offsetFromCenter: 0,
              width: 2.0,
              height: 2.4,
            },
          ]
        : [];

    return {
      id: brief.roomId,
      width,
      depth,
      height: p.height,
      surfaces: {
        wall: p.wall as Room['surfaces']['wall'],
        floor: p.floor as Room['surfaces']['floor'],
        accentColor: p.accent,
      },
      lighting: {
        ambientIntensity: p.ambientIntensity,
        temperature: p.temperature as Room['lighting']['temperature'],
        artworkSpotlights: true,
      },
      doorways,
    };
  });
}

// ---------------------------------------------------------------------------
// Deterministic placement geometry
// ---------------------------------------------------------------------------

const DEFAULT_HANGING_HEIGHT = 1.5;
const DEFAULT_DISPLAY_WIDTH = 1.2;

/**
 * Convert CurationPlan placements into full Placement objects.
 * Hanging height and display width are fixed defaults for MVP —
 * the curation plan already chose walls and offsets.
 */
export function buildPlacements(plan: CurationPlan): Placement[] {
  return plan.placements.map((pb) => ({
    artworkId: pb.artworkId,
    roomId: pb.roomId,
    wall: pb.wall,
    offsetFromCenter: pb.offsetFromCenter,
    hangingHeight: DEFAULT_HANGING_HEIGHT,
    displayWidth: DEFAULT_DISPLAY_WIDTH,
  }));
}

// ---------------------------------------------------------------------------
// Tour waypoints
// ---------------------------------------------------------------------------

/** How far in front of a wall the camera stands when viewing an artwork */
const TOUR_STAND_DISTANCE = 2.0;
/** Camera eye height */
const TOUR_EYE_HEIGHT = 1.6;

/**
 * Compute world-space position and lookAt for each artwork in tourOrder.
 * Each waypoint is TOUR_STAND_DISTANCE metres in front of the artwork's wall,
 * centred on the artwork's horizontal offset.
 *
 * Room origins: rooms are laid out in a linear east chain.
 * Room i originX = sum of widths of rooms 0..i-1.
 * Room centre: (originX + width/2, originZ + depth/2).
 */
export function buildTourWaypoints(
  plan: CurationPlan,
  rooms: Room[],
  artworks: UploadedArtwork[]
): TourWaypoint[] {
  // Build a lookup: roomId → {originX, width, depth}
  const roomOrigins: Record<string, { originX: number; width: number; depth: number }> = {};
  let cumulativeX = 0;
  for (const room of rooms) {
    roomOrigins[room.id] = { originX: cumulativeX, width: room.width, depth: room.depth };
    cumulativeX += room.width;
  }

  // Placement lookup by artworkId
  const placementByArtwork: Record<string, (typeof plan.placements)[0]> = {};
  for (const pb of plan.placements) {
    placementByArtwork[pb.artworkId] = pb;
  }

  const waypoints: TourWaypoint[] = [];
  let previousRoomId: string | undefined;

  for (const artworkId of plan.tourOrder) {
    const pb = placementByArtwork[artworkId];
    if (!pb) continue;

    const ro = roomOrigins[pb.roomId];
    if (!ro) continue;

    const aw = artworks.find((a) => a.id === artworkId);

    if (previousRoomId !== undefined && previousRoomId !== pb.roomId) {
      const fromIndex = rooms.findIndex((room) => room.id === previousRoomId);
      const toIndex = rooms.findIndex((room) => room.id === pb.roomId);
      if (fromIndex < 0 || toIndex < 0) {
        throw new Error(`Cannot route tour between unknown rooms "${previousRoomId}" and "${pb.roomId}".`);
      }

      const direction = toIndex > fromIndex ? 1 : -1;
      for (let roomIndex = fromIndex; roomIndex !== toIndex; roomIndex += direction) {
        const fromRoom = rooms[roomIndex];
        const toRoom = rooms[roomIndex + direction];
        const ownedByFrom = fromRoom.doorways.find((d) => d.targetRoomId === toRoom.id);
        const ownedByTo = toRoom.doorways.find((d) => d.targetRoomId === fromRoom.id);
        const ownerRoom = ownedByFrom ? fromRoom : toRoom;
        const doorway = ownedByFrom ?? ownedByTo;
        if (!doorway) {
          throw new Error(`Cannot route tour: rooms "${fromRoom.id}" and "${toRoom.id}" have no connecting doorway.`);
        }

        const doorwayPosition = getDoorwayWorldPosition(
          doorway,
          ownerRoom,
          roomOrigins[ownerRoom.id]
        );
        const targetOrigin = roomOrigins[toRoom.id];
        waypoints.push({
          kind: 'transit',
          position: { x: doorwayPosition.x, y: TOUR_EYE_HEIGHT, z: doorwayPosition.z },
          lookAt: {
            x: targetOrigin.originX + targetOrigin.width / 2,
            y: TOUR_EYE_HEIGHT,
            z: targetOrigin.depth / 2,
          },
        });
      }
    }

    // Room centre in world space
    const cx = ro.originX + ro.width / 2;
    const cz = ro.depth / 2;

    // Artwork world position on its wall
    let artX: number;
    let artZ: number;
    let standX: number;
    let standZ: number;

    switch (pb.wall) {
      case 'n':
        // North wall: z = 0, x = cx + offset
        artX = cx + pb.offsetFromCenter;
        artZ = 0;
        standX = artX;
        standZ = TOUR_STAND_DISTANCE;
        break;
      case 's':
        // South wall: z = depth, x = cx + offset
        artX = cx + pb.offsetFromCenter;
        artZ = ro.depth;
        standX = artX;
        standZ = ro.depth - TOUR_STAND_DISTANCE;
        break;
      case 'w':
        // West wall: x = originX, z = cz + offset
        artX = ro.originX;
        artZ = cz + pb.offsetFromCenter;
        standX = ro.originX + TOUR_STAND_DISTANCE;
        standZ = artZ;
        break;
      case 'e':
      default:
        // East wall: x = originX + width, z = cz + offset
        artX = ro.originX + ro.width;
        artZ = cz + pb.offsetFromCenter;
        standX = ro.originX + ro.width - TOUR_STAND_DISTANCE;
        standZ = artZ;
        break;
    }

    waypoints.push({
      kind: 'stop',
      artworkId,
      position: { x: standX, y: TOUR_EYE_HEIGHT, z: standZ },
      lookAt: { x: artX, y: DEFAULT_HANGING_HEIGHT, z: artZ },
      label: aw?.title || artworkId,
    });
    previousRoomId = pb.roomId;
  }

  return waypoints;
}

function getDoorwayWorldPosition(
  doorway: Doorway,
  room: Room,
  origin: { originX: number; width: number; depth: number }
): { x: number; z: number } {
  const centreX = origin.originX + room.width / 2;
  const centreZ = room.depth / 2;

  switch (doorway.wall) {
    case 'n':
      return { x: centreX + doorway.offsetFromCenter, z: 0 };
    case 's':
      return { x: centreX + doorway.offsetFromCenter, z: room.depth };
    case 'w':
      return { x: origin.originX, z: centreZ + doorway.offsetFromCenter };
    case 'e':
      return { x: origin.originX + room.width, z: centreZ + doorway.offsetFromCenter };
  }
}

// ---------------------------------------------------------------------------
// assembleGallery — build Gallery struct with placeholder labels
// ---------------------------------------------------------------------------

/**
 * Build a complete Gallery struct from the curation plan.
 * Labels are set to the placeholder `''` — callers must fill them in afterwards
 * using the LLM label batches before validating with GallerySchema.
 */
export function assembleGallery(
  plan: CurationPlan,
  preset: StylePreset,
  artworks: UploadedArtwork[],
  title: string
): Omit<Gallery, 'artworks'> & {
  artworks: Array<Omit<Gallery['artworks'][number], 'label'> & { label: string }>;
} {
  const rooms = buildRooms(plan, preset);
  const placements = buildPlacements(plan);
  const tour = buildTourWaypoints(plan, rooms, artworks);

  const galleryArtworks = artworks.map((aw) => ({
    id: aw.id,
    imagePath: `images/${aw.id}.jpg`,
    title: aw.title || 'Untitled',
    medium: aw.medium || 'Unknown medium',
    ...(aw.year !== undefined ? { year: aw.year } : {}),
    label: '', // filled in by label batches
  }));

  return {
    version: '1.0' as const,
    title,
    rooms,
    artworks: galleryArtworks,
    placements,
    tour,
  };
}
