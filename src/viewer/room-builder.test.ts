/**
 * room-builder.test.ts — Integration tests for buildScene.
 * Tests doorway passability: both the AABB collision and the visual wall panels
 * must have the opening carved on both sides of a shared wall.
 */

import { describe, it, expect } from 'vitest';
import { GallerySchema, type Gallery } from '../schema/gallery.schema';
import { buildScene } from './room-builder';
import { circleOverlapsAABB } from './collision';
import sampleGallery from '../demo/sample-gallery.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsedSampleGallery(): Gallery {
  return GallerySchema.parse(sampleGallery);
}

// ---------------------------------------------------------------------------
// Doorway passability — Bug 1 regression
// ---------------------------------------------------------------------------

describe('buildScene doorway passability', () => {
  it('carves the doorway opening in the target room (room-b west wall)', () => {
    const gallery = parsedSampleGallery();
    const { roomLayouts } = buildScene(gallery);

    // room-b is the second room; its west wall sits at x = room-a.width = 12
    const roomB = roomLayouts.find((r) => r.roomId === 'room-b')!;
    expect(roomB).toBeDefined();

    // room-a declares doorway on its east wall, offsetFromCenter=0, width=2.
    // room-a depth=10 → cz_a=5 → doorway worldZ=5.
    // room-b depth=14 → cz_b=7 → mirrored offsetFromCenter = 5-7 = -2.
    // So room-b west wall gap is centred at worldZ=5 → z ∈ [4, 6].
    // A player at z=5 on the west wall should pass through.
    const doorwayCentreZ = 5;
    const wallX = roomB.originX; // west wall of room-b = x=12

    const blocked = roomB.wallAABBs.some((box) =>
      circleOverlapsAABB(wallX, doorwayCentreZ, 0.3, box)
    );
    expect(blocked).toBe(false);
  });

  it('still blocks passage through the solid part of room-b west wall', () => {
    const gallery = parsedSampleGallery();
    const { roomLayouts } = buildScene(gallery);

    const roomB = roomLayouts.find((r) => r.roomId === 'room-b')!;
    // Doorway gap is z∈[4,6]; check z=0.5 — well outside the gap
    const wallX = roomB.originX;
    const solidZ = roomB.originZ + 0.5;

    const blocked = roomB.wallAABBs.some((box) =>
      circleOverlapsAABB(wallX, solidZ, 0.3, box)
    );
    expect(blocked).toBe(true);
  });

  it('simulates a player walking east from room-a through the doorway into room-b', () => {
    const gallery = parsedSampleGallery();
    const { roomLayouts } = buildScene(gallery);

    const allAABBs = roomLayouts.flatMap((r) => r.wallAABBs);

    // room-a: originX=0, depth=10 → doorway worldZ=5 (gap z∈[4,6] on shared wall)
    // Player starts at (9, 5) — inside room-a, aligned with the gap, heading east.
    let px = 9;
    const pz = 5;
    const PLAYER_RADIUS = 0.3;
    const STEP = 0.5;

    for (let i = 0; i < 20; i++) {
      const nx = px + STEP;
      // Simple collision: reject if new pos overlaps any AABB
      const blocked = allAABBs.some((box) => circleOverlapsAABB(nx, pz, PLAYER_RADIUS, box));
      if (!blocked) px = nx;
    }

    // Player should have crossed x=12 (shared wall) and be inside room-b (x > 12.3)
    expect(px).toBeGreaterThan(12.3);
  });
});

// ---------------------------------------------------------------------------
// Texture-branch decision — Fix 1b regression
// ---------------------------------------------------------------------------

describe('buildScene texture branch', () => {
  it('builds artworkMeshes for each placed artwork', () => {
    const gallery = parsedSampleGallery();
    const { artworkMeshes } = buildScene(gallery);
    // All artworks in sample-gallery should produce a mesh
    for (const aw of gallery.artworks) {
      expect(artworkMeshes.has(aw.id)).toBe(true);
    }
  });

  it('uses aspectRatio from aspectRatios map when provided', () => {
    const gallery = parsedSampleGallery();
    // Provide a very tall aspect ratio (0.25) for aw-01
    const aspectRatios = new Map([['aw-01', 0.25]]);
    const { artworkMeshes } = buildScene(gallery, aspectRatios);
    const mesh = artworkMeshes.get('aw-01');
    expect(mesh).toBeDefined();
    // displayWidth=1.4, ratio=0.25 → height=5.6
    // Check mesh dimensions via bounding box (PlaneGeometry.parameters not typed)
    mesh!.geometry.computeBoundingBox();
    const bb = mesh!.geometry.boundingBox!;
    const w = bb.max.x - bb.min.x;
    const h = bb.max.y - bb.min.y;
    expect(w).toBeCloseTo(1.4, 2);
    expect(h).toBeCloseTo(5.6, 2); // 1.4 / 0.25
  });

  it('falls back to 0.75 aspect ratio when no aspectRatios map provided', () => {
    const gallery = parsedSampleGallery();
    const { artworkMeshes } = buildScene(gallery);
    const mesh = artworkMeshes.get('aw-01');
    expect(mesh).toBeDefined();
    // Without aspectRatios map: ratio = undefined → 0.75 fallback
    // displayWidth=1.4 → height = 1.4 / 0.75 ≈ 1.867
    mesh!.geometry.computeBoundingBox();
    const bb = mesh!.geometry.boundingBox!;
    const w = bb.max.x - bb.min.x;
    const h = bb.max.y - bb.min.y;
    expect(w).toBeCloseTo(1.4, 2);
    expect(h).toBeCloseTo(1.4 / 0.75, 2);
  });
});
