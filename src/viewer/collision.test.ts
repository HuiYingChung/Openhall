/**
 * collision.test.ts — Unit tests for AABB collision detection logic.
 * Tests cover: overlap detection, movement resolution, wall AABB generation,
 * and doorway carving.
 */

import { describe, it, expect } from 'vitest';
import {
  circleOverlapsAABB,
  resolveCollisions,
  buildWallAABBs,
  type AABB,
} from '../viewer/collision';

// ---------------------------------------------------------------------------
// circleOverlapsAABB
// ---------------------------------------------------------------------------

describe('circleOverlapsAABB', () => {
  const box: AABB = { minX: 0, maxX: 4, minZ: 0, maxZ: 1 };

  it('returns true when circle centre is inside the box', () => {
    expect(circleOverlapsAABB(2, 0.5, 0.3, box)).toBe(true);
  });

  it('returns true when circle overlaps box edge', () => {
    // Centre just outside east edge, radius crosses it
    expect(circleOverlapsAABB(4.2, 0.5, 0.3, box)).toBe(true);
  });

  it('returns false when circle is clearly outside', () => {
    expect(circleOverlapsAABB(6, 0.5, 0.3, box)).toBe(false);
  });

  it('returns false when circle is clearly beyond tangent distance', () => {
    // Nearest point is (4, 0.5); distance = 0.4 > radius 0.3 → no overlap
    expect(circleOverlapsAABB(4.4, 0.5, 0.3, box)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveCollisions
// ---------------------------------------------------------------------------

describe('resolveCollisions', () => {
  const wall: AABB = { minX: -10, maxX: 10, minZ: -0.3, maxZ: 0.3 };

  it('allows movement that does not hit any wall', () => {
    const result = resolveCollisions(0, 5, 1, 5, 0.3, [wall]);
    expect(result.x).toBe(1);
    expect(result.z).toBe(5);
  });

  it('blocks movement into wall', () => {
    // Moving from z=1 toward wall at z=0, wall extends x from -10 to 10
    const result = resolveCollisions(0, 1, 0, 0.1, 0.3, [wall]);
    // z movement blocked, x stays same as old
    expect(result.x).toBe(0);
    expect(result.z).toBe(1); // reverted to old z
  });

  it('allows sliding along wall (x movement when z is blocked)', () => {
    // Player at (0, 1), moves diagonally into wall: new pos (1, 0.1)
    const result = resolveCollisions(0, 1, 1, 0.1, 0.3, [wall]);
    // z blocked → keep old z (1), x slides through
    expect(result.z).toBe(1);
    expect(result.x).toBe(1);
  });

  it('returns same position when fully blocked', () => {
    // Player trapped: both slide axes hit wall
    // wall spans all of z and x planes
    const bigWall: AABB = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
    const result = resolveCollisions(0, 0, 1, 1, 0.3, [bigWall]);
    expect(result.x).toBe(0);
    expect(result.z).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildWallAABBs
// ---------------------------------------------------------------------------

describe('buildWallAABBs', () => {
  it('generates 4 AABBs for a room with no doorways', () => {
    const aabbs = buildWallAABBs(0, 0, 10, 8, []);
    expect(aabbs.length).toBe(4);
  });

  it('splits a wall into 2 AABBs when a doorway is carved out of the middle', () => {
    // North wall (z=0) gets a centred doorway 2m wide
    const aabbs = buildWallAABBs(0, 0, 10, 8, [{ wall: 'n', offsetFromCenter: 0, width: 2 }]);
    // buildWallAABBs has no doorway-height concept; no transom is generated.
    // 2 north segments + 1 south + 1 west + 1 east = 5 total.
    expect(aabbs.length).toBe(5);
    const northSegs = aabbs.filter((b) => b.maxZ <= 0.5);
    expect(northSegs.length).toBe(2);
  });

  it('produces AABBs that block passage through a solid wall', () => {
    const aabbs = buildWallAABBs(0, 0, 10, 8, []);
    // Trying to pass through north wall at centre
    const blocked = aabbs.some((b) => circleOverlapsAABB(5, 0.1, 0.3, b));
    expect(blocked).toBe(true);
  });

  it('allows passage through a doorway gap', () => {
    // Centred doorway on north wall, 2m wide
    const aabbs = buildWallAABBs(0, 0, 10, 8, [{ wall: 'n', offsetFromCenter: 0, width: 2 }]);
    // Player at wall centre (x=5, z near 0) — should NOT be blocked
    const blocked = aabbs.some((b) => circleOverlapsAABB(5, 0.0, 0.3, b));
    expect(blocked).toBe(false);
  });
});
