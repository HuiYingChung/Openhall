/**
 * collision.ts — Axis-Aligned Bounding Box (AABB) collision detection for
 * first-person camera movement. Doorways are represented as gaps in wall AABBs.
 */

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Returns true if a circular player (centred at (px, pz) with given radius)
 * overlaps the AABB.
 */
export function circleOverlapsAABB(
  px: number,
  pz: number,
  radius: number,
  box: AABB
): boolean {
  // Clamp player centre to the nearest point on the AABB
  const nearestX = Math.max(box.minX, Math.min(px, box.maxX));
  const nearestZ = Math.max(box.minZ, Math.min(pz, box.maxZ));
  const dx = px - nearestX;
  const dz = pz - nearestZ;
  return dx * dx + dz * dz < radius * radius;
}

/**
 * Resolve a player movement from (px, pz) → (nx, nz) against a list of AABBs.
 * Returns the corrected new position.
 */
export function resolveCollisions(
  px: number,
  pz: number,
  nx: number,
  nz: number,
  radius: number,
  walls: AABB[]
): { x: number; z: number } {
  let rx = nx;
  let rz = nz;

  for (const wall of walls) {
    if (!circleOverlapsAABB(rx, rz, radius, wall)) continue;

    // Try sliding along X only
    const slideX = circleOverlapsAABB(nx, pz, radius, wall);
    // Try sliding along Z only
    const slideZ = circleOverlapsAABB(px, nz, radius, wall);

    if (slideX && slideZ) {
      // Blocked in both axes — stay put
      rx = px;
      rz = pz;
    } else if (slideX) {
      // Can slide along Z
      rx = px;
    } else if (slideZ) {
      // Can slide along X
      rz = pz;
    }
    // If neither slideX nor slideZ is true, the overlap is only in the diagonal
    // — allow the move (edge case, very rare at normal speeds).
  }

  return { x: rx, z: rz };
}

/**
 * Build wall AABBs for a room, carving out doorway openings.
 *
 * @param originX  World-space X of the room's bottom-left corner
 * @param originZ  World-space Z of the room's bottom-left corner
 * @param width    Room width (X axis)
 * @param depth    Room depth (Z axis)
 * @param doorways Doorway descriptors to carve out
 * @param wallThickness Thickness used for the AABB (default 0.3m)
 */
export interface DoorwayCut {
  wall: 'n' | 's' | 'e' | 'w';
  offsetFromCenter: number;
  width: number;
}

export function buildWallAABBs(
  originX: number,
  originZ: number,
  width: number,
  depth: number,
  doorways: DoorwayCut[],
  wallThickness = 0.3
): AABB[] {
  const t = wallThickness;
  const halfW = width / 2;
  const halfD = depth / 2;
  const cx = originX + halfW;
  const cz = originZ + halfD;

  // Helper: split a 1-D segment [lo, hi] by cutting out [cutLo, cutHi]
  // Returns 0, 1, or 2 remaining segments.
  function cutSegment(
    lo: number,
    hi: number,
    cutLo: number,
    cutHi: number
  ): Array<[number, number]> {
    const clampedLo = Math.max(lo, cutLo);
    const clampedHi = Math.min(hi, cutHi);
    if (clampedLo >= clampedHi) return [[lo, hi]]; // no overlap
    const segments: Array<[number, number]> = [];
    if (lo < clampedLo) segments.push([lo, clampedLo]);
    if (clampedHi < hi) segments.push([clampedHi, hi]);
    return segments;
  }

  const aabbs: AABB[] = [];

  // Collect doorway cuts per wall side
  const cuts: Record<'n' | 's' | 'e' | 'w', DoorwayCut[]> = {
    n: [],
    s: [],
    e: [],
    w: [],
  };
  for (const d of doorways) cuts[d.wall].push(d);

  // North wall (z = originZ)
  {
    const wallZ = { minZ: originZ - t, maxZ: originZ + t };
    let xSegs: Array<[number, number]> = [[originX, originX + width]];
    for (const d of cuts.n) {
      const cutLo = cx + d.offsetFromCenter - d.width / 2;
      const cutHi = cx + d.offsetFromCenter + d.width / 2;
      xSegs = xSegs.flatMap(([lo, hi]) => cutSegment(lo, hi, cutLo, cutHi));
    }
    for (const [lo, hi] of xSegs) {
      aabbs.push({ minX: lo, maxX: hi, ...wallZ });
    }
  }

  // South wall (z = originZ + depth)
  {
    const wallZ = { minZ: originZ + depth - t, maxZ: originZ + depth + t };
    let xSegs: Array<[number, number]> = [[originX, originX + width]];
    for (const d of cuts.s) {
      const cutLo = cx + d.offsetFromCenter - d.width / 2;
      const cutHi = cx + d.offsetFromCenter + d.width / 2;
      xSegs = xSegs.flatMap(([lo, hi]) => cutSegment(lo, hi, cutLo, cutHi));
    }
    for (const [lo, hi] of xSegs) {
      aabbs.push({ minX: lo, maxX: hi, ...wallZ });
    }
  }

  // West wall (x = originX)
  {
    const wallX = { minX: originX - t, maxX: originX + t };
    let zSegs: Array<[number, number]> = [[originZ, originZ + depth]];
    for (const d of cuts.w) {
      const cutLo = cz + d.offsetFromCenter - d.width / 2;
      const cutHi = cz + d.offsetFromCenter + d.width / 2;
      zSegs = zSegs.flatMap(([lo, hi]) => cutSegment(lo, hi, cutLo, cutHi));
    }
    for (const [lo, hi] of zSegs) {
      aabbs.push({ ...wallX, minZ: lo, maxZ: hi });
    }
  }

  // East wall (x = originX + width)
  {
    const wallX = { minX: originX + width - t, maxX: originX + width + t };
    let zSegs: Array<[number, number]> = [[originZ, originZ + depth]];
    for (const d of cuts.e) {
      const cutLo = cz + d.offsetFromCenter - d.width / 2;
      const cutHi = cz + d.offsetFromCenter + d.width / 2;
      zSegs = zSegs.flatMap(([lo, hi]) => cutSegment(lo, hi, cutLo, cutHi));
    }
    for (const [lo, hi] of zSegs) {
      aabbs.push({ ...wallX, minZ: lo, maxZ: hi });
    }
  }

  return aabbs;
}
