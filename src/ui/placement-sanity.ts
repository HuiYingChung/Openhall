/**
 * placement-sanity.ts — Clamps placement offsets so artworks fit within
 * their wall and don't crowd doorways.
 *
 * Called after gallery generation, before buildScene, so the viewer always
 * gets valid placements regardless of LLM output variance.
 */

import type { Gallery, Placement, Room, Doorway } from '../schema/gallery.schema';

const FRAME_MARGIN = 0.2; // metres from wall edge
const DOORWAY_MARGIN = 0.3; // metres clearance from doorway edge

/**
 * Return a copy of the gallery with all placement offsets clamped to safe ranges.
 * Mutates nothing — returns a new gallery object.
 */
export function sanitizePlacements(gallery: Gallery): Gallery {
  const roomMap = new Map<string, Room>(gallery.rooms.map((r) => [r.id, r]));

  const sanitized = gallery.placements.map((p) => sanitizePlacement(p, roomMap, gallery));

  return { ...gallery, placements: sanitized };
}

function sanitizePlacement(
  placement: Placement,
  roomMap: Map<string, Room>,
  gallery: Gallery
): Placement {
  const room = roomMap.get(placement.roomId);
  if (!room) return placement;

  const isNS = placement.wall === 'n' || placement.wall === 's';
  // Wall length: N/S walls span room width; E/W walls span room depth
  const wallLength = isNS ? room.width : room.depth;
  const halfWork = placement.displayWidth / 2;

  // Maximum offset so the artwork (+ frame margin) stays on the wall
  const maxOffset = wallLength / 2 - halfWork - FRAME_MARGIN;

  // Collect doorways on the same wall (own + inbound)
  const allDoorways = getAllDoorwaysOnWall(room, placement.wall, gallery);

  let lo = -maxOffset;
  let hi = maxOffset;

  // Shrink the allowed range around each doorway
  for (const d of allDoorways) {
    const dLo = d.offsetFromCenter - d.width / 2 - halfWork - DOORWAY_MARGIN;
    const dHi = d.offsetFromCenter + d.width / 2 + halfWork + DOORWAY_MARGIN;
    // If artwork would overlap the doorway zone, choose the larger side
    const currentOffset = placement.offsetFromCenter;
    if (currentOffset < dHi && currentOffset > dLo) {
      // Push to whichever side has more room
      if (currentOffset >= 0) lo = Math.max(lo, dHi);
      else hi = Math.min(hi, dLo);
    }
  }

  const clamped = Math.max(lo, Math.min(hi, placement.offsetFromCenter));
  if (clamped === placement.offsetFromCenter) return placement;
  return { ...placement, offsetFromCenter: clamped };
}

function getAllDoorwaysOnWall(room: Room, wall: string, gallery: Gallery): Doorway[] {
  const own = room.doorways.filter((d) => d.wall === wall);
  // Inbound doorways (from other rooms targeting this room, translated to opposite wall)
  const opposite: Record<string, string> = { n: 's', s: 'n', e: 'w', w: 'e' };
  const inbound: Doorway[] = [];
  for (const otherRoom of gallery.rooms) {
    if (otherRoom.id === room.id) continue;
    for (const d of otherRoom.doorways) {
      if (d.targetRoomId === room.id && opposite[d.wall] === wall) {
        inbound.push({ ...d, wall: wall as Doorway['wall'] });
      }
    }
  }
  return [...own, ...inbound];
}
