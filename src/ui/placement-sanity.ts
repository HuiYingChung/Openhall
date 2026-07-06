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
  // Build room origins the same way room-builder does: linear layout along +X
  const roomOrigins = buildRoomOrigins(gallery);

  const sanitized = gallery.placements.map((p) =>
    sanitizePlacement(p, roomMap, gallery, roomOrigins)
  );

  return { ...gallery, placements: sanitized };
}

/**
 * Compute room origins (min-X, min-Z corner) for each room in the same linear
 * layout that room-builder uses. Exported for unit tests.
 */
export function buildRoomOrigins(gallery: Gallery): Map<string, { x: number; z: number }> {
  const origins = new Map<string, { x: number; z: number }>();
  let cursorX = 0;
  for (const room of gallery.rooms) {
    origins.set(room.id, { x: cursorX, z: 0 });
    cursorX += room.width;
  }
  return origins;
}

/**
 * Convert an inbound doorway's offsetFromCenter from being relative to the
 * *source* room's wall center to being relative to the *target* room's wall
 * center. Mirrors the logic in room-builder.ts buildScene().
 *
 * For E/W doorways the offset is along Z; for N/S it's along X.
 */
export function convertInboundOffset(
  doorway: Doorway,
  srcRoom: Room,
  srcOrigin: { x: number; z: number },
  tgtRoom: Room,
  tgtOrigin: { x: number; z: number }
): number {
  if (doorway.wall === 'e' || doorway.wall === 'w') {
    // offset is along Z
    const srcCZ = srcOrigin.z + srcRoom.depth / 2;
    const worldZ = srcCZ + doorway.offsetFromCenter;
    const tgtCZ = tgtOrigin.z + tgtRoom.depth / 2;
    return worldZ - tgtCZ;
  } else {
    // N/S: offset is along X
    const srcCX = srcOrigin.x + srcRoom.width / 2;
    const worldX = srcCX + doorway.offsetFromCenter;
    const tgtCX = tgtOrigin.x + tgtRoom.width / 2;
    return worldX - tgtCX;
  }
}

function sanitizePlacement(
  placement: Placement,
  roomMap: Map<string, Room>,
  gallery: Gallery,
  roomOrigins: Map<string, { x: number; z: number }>
): Placement {
  const room = roomMap.get(placement.roomId);
  if (!room) return placement;

  const isNS = placement.wall === 'n' || placement.wall === 's';
  // Wall length: N/S walls span room width; E/W walls span room depth
  const wallLength = isNS ? room.width : room.depth;
  const halfWork = placement.displayWidth / 2;

  // Maximum offset so the artwork (+ frame margin) stays on the wall
  const maxOffset = wallLength / 2 - halfWork - FRAME_MARGIN;

  // Collect doorways on the same wall (own + inbound with corrected offset)
  const allDoorways = getAllDoorwaysOnWall(room, placement.wall, gallery, roomOrigins);

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

function getAllDoorwaysOnWall(
  room: Room,
  wall: string,
  gallery: Gallery,
  roomOrigins: Map<string, { x: number; z: number }>
): Doorway[] {
  const own = room.doorways.filter((d) => d.wall === wall);
  // Inbound doorways — re-convert offset to target room's wall center coordinate
  const opposite: Record<string, string> = { n: 's', s: 'n', e: 'w', w: 'e' };
  const inbound: Doorway[] = [];
  const tgtOrigin = roomOrigins.get(room.id)!;
  for (const otherRoom of gallery.rooms) {
    if (otherRoom.id === room.id) continue;
    const srcOrigin = roomOrigins.get(otherRoom.id)!;
    for (const d of otherRoom.doorways) {
      if (d.targetRoomId === room.id && opposite[d.wall] === wall) {
        const convertedOffset = convertInboundOffset(d, otherRoom, srcOrigin, room, tgtOrigin);
        inbound.push({ ...d, wall: wall as Doorway['wall'], offsetFromCenter: convertedOffset });
      }
    }
  }
  return [...own, ...inbound];
}
