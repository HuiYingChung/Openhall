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
const ART_GAP = 0.3; // minimum metres between artwork edges on the same wall

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

  // Second pass: resolve artwork-vs-artwork overlaps per (room, wall).
  // The per-placement clamp above cannot see siblings — and can even create
  // overlaps (two works clamped into the same corner) — so this runs after.
  const byWall = new Map<string, number[]>();
  sanitized.forEach((p, i) => {
    const key = `${p.roomId}:${p.wall}`;
    const arr = byWall.get(key);
    if (arr) arr.push(i);
    else byWall.set(key, [i]);
  });

  const result = [...sanitized];
  for (const idxs of byWall.values()) {
    if (idxs.length < 2) continue;
    const first = sanitized[idxs[0]];
    const room = roomMap.get(first.roomId);
    if (!room) continue;
    const isNS = first.wall === 'n' || first.wall === 's';
    const wallLength = isNS ? room.width : room.depth;
    const blocked: Array<[number, number]> = getAllDoorwaysOnWall(
      room, first.wall, gallery, roomOrigins
    ).map((d) => [
      d.offsetFromCenter - d.width / 2 - DOORWAY_MARGIN,
      d.offsetFromCenter + d.width / 2 + DOORWAY_MARGIN,
    ]);
    const items = idxs.map((i) => ({
      offset: sanitized[i].offsetFromCenter,
      half: sanitized[i].displayWidth / 2,
    }));
    const adjusted = deoverlapWallItems(items, wallLength, blocked);
    idxs.forEach((i, k) => {
      if (adjusted[k] !== sanitized[i].offsetFromCenter) {
        result[i] = { ...sanitized[i], offsetFromCenter: adjusted[k] };
      }
    });
  }

  return { ...gallery, placements: result };
}

// ---------------------------------------------------------------------------
// Same-wall overlap resolution (pure — unit-testable)
// ---------------------------------------------------------------------------

export interface WallItem {
  /** Desired offset from the wall centre */
  offset: number;
  /** Half of displayWidth */
  half: number;
}

/**
 * Resolve overlaps among artworks sharing one wall. Returns adjusted offsets
 * in the same order as `items`, moved the minimum amount:
 *   1. The wall span (minus frame margins) is split into free segments
 *      around `blocked` intervals (doorway zones).
 *   2. Each item goes to the nearest segment that still has room,
 *      overflowing to a neighbour when full.
 *   3. Within a segment, a two-pass sweep enforces ART_GAP spacing;
 *      a genuinely over-crowded segment falls back to even spacing.
 */
export function deoverlapWallItems(
  items: WallItem[],
  wallLength: number,
  blocked: Array<[number, number]> = [],
  gap = ART_GAP
): number[] {
  const lo = -wallLength / 2 + FRAME_MARGIN;
  const hi = wallLength / 2 - FRAME_MARGIN;

  // Free segments = [lo, hi] minus blocked intervals
  let segs: Array<[number, number]> = [[lo, hi]];
  for (const [blo, bhi] of blocked) {
    segs = segs.flatMap(([a, b]) => {
      const clo = Math.max(a, blo);
      const chi = Math.min(b, bhi);
      if (clo >= chi) return [[a, b]] as Array<[number, number]>;
      const out: Array<[number, number]> = [];
      if (a < clo) out.push([a, clo]);
      if (chi < b) out.push([chi, b]);
      return out;
    });
  }
  segs = segs.filter(([a, b]) => b - a > 0.01);
  if (segs.length === 0) return items.map((it) => it.offset);

  // Stable sort by desired offset, remembering original index
  const order = items
    .map((it, i) => ({ offset: it.offset, half: it.half, i }))
    .sort((a, b) => a.offset - b.offset);

  // Assign to segments: nearest segment with remaining width capacity
  const segLen = segs.map(([a, b]) => b - a);
  const segItems: Array<typeof order> = segs.map(() => []);
  const segUsed = segs.map(() => 0);
  for (const it of order) {
    const ranked = segs
      .map(([a, b], si) => ({
        si,
        dist: it.offset < a ? a - it.offset : it.offset > b ? it.offset - b : 0,
      }))
      .sort((x, y) => x.dist - y.dist);
    let chosen = ranked[0].si;
    for (const { si } of ranked) {
      const needed = segUsed[si] + it.half * 2 + (segItems[si].length > 0 ? gap : 0);
      if (needed <= segLen[si]) {
        chosen = si;
        break;
      }
    }
    segItems[chosen].push(it);
    segUsed[chosen] += it.half * 2 + (segItems[chosen].length > 1 ? gap : 0);
  }

  const result = new Array<number>(items.length);
  for (let si = 0; si < segs.length; si++) {
    const list = segItems[si];
    if (list.length === 0) continue;
    const [a, b] = segs[si];
    const totalW = list.reduce((sum, it) => sum + it.half * 2, 0) + gap * (list.length - 1);
    if (totalW > b - a) {
      // Over-crowded segment: spread evenly (best effort)
      const step = (b - a) / list.length;
      list.forEach((it, k) => {
        result[it.i] = a + step * (k + 0.5);
      });
      continue;
    }
    // Two-pass sweep: forward push, then backward clamp into the segment
    const pos = list.map((it) => Math.max(a + it.half, Math.min(b - it.half, it.offset)));
    for (let k = 1; k < list.length; k++) {
      const minPos = pos[k - 1] + list[k - 1].half + gap + list[k].half;
      if (pos[k] < minPos) pos[k] = minPos;
    }
    const last = list.length - 1;
    if (pos[last] > b - list[last].half) {
      pos[last] = b - list[last].half;
      for (let k = last - 1; k >= 0; k--) {
        const maxPos = pos[k + 1] - list[k + 1].half - gap - list[k].half;
        if (pos[k] > maxPos) pos[k] = maxPos;
      }
    }
    list.forEach((it, k) => {
      result[it.i] = pos[k];
    });
  }
  return result;
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
