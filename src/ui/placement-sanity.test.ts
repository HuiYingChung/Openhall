/**
 * placement-sanity.test.ts — Unit tests for sanitizePlacements.
 */

import { describe, it, expect } from 'vitest';
import { sanitizePlacements, convertInboundOffset, buildRoomOrigins, deoverlapWallItems } from '../ui/placement-sanity';
import { GallerySchema } from '../schema/gallery.schema';
import sampleGallery from '../demo/sample-gallery.json';
import type { Gallery } from '../schema/gallery.schema';

function baseGallery(): Gallery {
  return GallerySchema.parse(sampleGallery);
}

describe('sanitizePlacements', () => {
  it('leaves valid placements unchanged', () => {
    const gallery = baseGallery();
    const result = sanitizePlacements(gallery);
    // All placements in the sample gallery should be within bounds
    expect(result.placements).toEqual(gallery.placements);
  });

  it('clamps placement offset that exceeds wall half-width', () => {
    const gallery = baseGallery();
    // Room-a is 12m wide; north wall half-width = 6m
    // Place an artwork with displayWidth=1.2 at offset=6 (too close to edge)
    gallery.placements[0] = {
      ...gallery.placements[0],
      roomId: 'room-a',
      wall: 'n',
      offsetFromCenter: 6, // too far right — would clip off wall
      displayWidth: 1.2,
    };
    const result = sanitizePlacements(gallery);
    // Max offset = wallLength/2 - displayWidth/2 - FRAME_MARGIN = 6 - 0.6 - 0.2 = 5.2
    expect(result.placements[0].offsetFromCenter).toBeLessThanOrEqual(5.2);
  });

  it('keeps the artwork tour waypoint aligned after clamping a placement', () => {
    const gallery = baseGallery();
    const room = gallery.rooms.find((r) => r.id === 'room-a')!;
    const placement = gallery.placements.find((p) => p.artworkId === 'aw-01')!;
    const waypoint = gallery.tour.find((w) => w.artworkId === 'aw-01')!;

    placement.roomId = 'room-a';
    placement.wall = 'n';
    placement.offsetFromCenter = 6;
    placement.displayWidth = 1.2;
    waypoint.position.x = room.width / 2 + placement.offsetFromCenter;
    waypoint.lookAt.x = waypoint.position.x;

    const result = sanitizePlacements(gallery);
    const sanitizedPlacement = result.placements.find((p) => p.artworkId === 'aw-01')!;
    const syncedWaypoint = result.tour.find((w) => w.artworkId === 'aw-01')!;
    const expectedX = room.width / 2 + sanitizedPlacement.offsetFromCenter;

    expect(sanitizedPlacement.offsetFromCenter).toBeCloseTo(5.2);
    expect(syncedWaypoint.position.x).toBeCloseTo(expectedX);
    expect(syncedWaypoint.lookAt.x).toBeCloseTo(expectedX);
  });

  it('clamps negative offset that exceeds wall half-width', () => {
    const gallery = baseGallery();
    gallery.placements[0] = {
      ...gallery.placements[0],
      roomId: 'room-a',
      wall: 'n',
      offsetFromCenter: -8,
      displayWidth: 1.2,
    };
    const result = sanitizePlacements(gallery);
    expect(result.placements[0].offsetFromCenter).toBeGreaterThanOrEqual(-5.2);
  });

  it('returns a new gallery object (does not mutate input)', () => {
    const gallery = baseGallery();
    const original = JSON.stringify(gallery.placements);
    sanitizePlacements(gallery);
    expect(JSON.stringify(gallery.placements)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// convertInboundOffset — doorway offset re-expression between rooms of
// different depths (the bug from the Week 2 report).
// ---------------------------------------------------------------------------

describe('convertInboundOffset', () => {
  it('re-expresses offset correctly for the sample gallery (room-a depth 10 → room-b depth 14)', () => {
    // room-a (depth 10) has an east doorway centred (offset=0) into room-b (depth 14).
    // srcCZ = 0 + 10/2 = 5; worldZ = 5 + 0 = 5; tgtCZ = 0 + 14/2 = 7; offset = 5-7 = -2.
    const gallery = baseGallery();
    const origins = buildRoomOrigins(gallery);
    const roomA = gallery.rooms.find((r) => r.id === 'room-a')!;
    const roomB = gallery.rooms.find((r) => r.id === 'room-b')!;
    const doorway = roomA.doorways.find((d) => d.targetRoomId === 'room-b')!;

    const result = convertInboundOffset(
      doorway,
      roomA,
      origins.get('room-a')!,
      roomB,
      origins.get('room-b')!
    );
    // srcCZ=5, worldZ=5, tgtCZ=7, expected offset = -2
    expect(result).toBeCloseTo(-2);
  });

  it('returns 0 when rooms have the same depth and doorway is centred', () => {
    // Construct two rooms of equal depth 10.
    // East doorway from room-x (depth 10) centred → room-y (depth 10) should yield 0.
    const gallery: Gallery = GallerySchema.parse({
      version: '1.0',
      title: 'Same depth test',
      rooms: [
        {
          id: 'room-x',
          width: 10,
          depth: 10,
          height: 3.5,
          surfaces: { wall: 'white-plaster', floor: 'light-wood', accentColor: '#c0a070' },
          lighting: { ambientIntensity: 0.4, temperature: 'neutral', artworkSpotlights: true },
          doorways: [{ targetRoomId: 'room-y', wall: 'e', offsetFromCenter: 0, width: 2, height: 2.4 }],
        },
        {
          id: 'room-y',
          width: 10,
          depth: 10,
          height: 3.5,
          surfaces: { wall: 'white-plaster', floor: 'light-wood', accentColor: '#c0a070' },
          lighting: { ambientIntensity: 0.4, temperature: 'neutral', artworkSpotlights: true },
          doorways: [],
        },
      ],
      artworks: [],
      placements: [],
      tour: [],
    });
    const origins = buildRoomOrigins(gallery);
    const roomX = gallery.rooms[0];
    const roomY = gallery.rooms[1];
    const doorway = roomX.doorways[0];
    const result = convertInboundOffset(doorway, roomX, origins.get('room-x')!, roomY, origins.get('room-y')!);
    expect(result).toBeCloseTo(0);
  });

  it('re-expresses offset correctly when rooms have different depths', () => {
    // Two rooms: room-X (depth 6) opens east (offset=+1) into room-Y (depth 14).
    // room-X wall center Z = 0 + 6/2 = 3; world doorway Z = 3 + 1 = 4.
    // room-Y wall center Z = 0 + 14/2 = 7; expected offset = 4 - 7 = -3.
    const gallery: Gallery = GallerySchema.parse({
      version: '1.0',
      title: 'Depth test',
      rooms: [
        {
          id: 'room-x',
          width: 10,
          depth: 6,
          height: 3.5,
          surfaces: { wall: 'white-plaster', floor: 'light-wood', accentColor: '#c0a070' },
          lighting: { ambientIntensity: 0.4, temperature: 'neutral', artworkSpotlights: true },
          doorways: [
            { targetRoomId: 'room-y', wall: 'e', offsetFromCenter: 1, width: 2, height: 2.4 },
          ],
        },
        {
          id: 'room-y',
          width: 10,
          depth: 14,
          height: 3.5,
          surfaces: { wall: 'white-plaster', floor: 'light-wood', accentColor: '#c0a070' },
          lighting: { ambientIntensity: 0.4, temperature: 'neutral', artworkSpotlights: true },
          doorways: [],
        },
      ],
      artworks: [],
      placements: [],
      tour: [],
    });
    const origins = buildRoomOrigins(gallery);
    const roomX = gallery.rooms[0];
    const roomY = gallery.rooms[1];
    const doorway = roomX.doorways[0];

    const result = convertInboundOffset(
      doorway,
      roomX,
      origins.get('room-x')!,
      roomY,
      origins.get('room-y')!
    );
    // Expected: worldZ = 3 + 1 = 4; tgtCZ = 14/2 = 7; offset = 4 - 7 = -3
    expect(result).toBeCloseTo(-3);
  });

  it('a placement near the inbound doorway on the west wall is pushed clear', () => {
    // room-x (depth 6) → room-y (depth 14), doorway offset=+1 from center.
    // Inbound offset on room-y's west wall = -3 (see test above).
    // Place an artwork on room-y's west wall at offset=-3 (right on the doorway).
    // sanitizePlacements should push it clear.
    const gallery: Gallery = GallerySchema.parse({
      version: '1.0',
      title: 'Depth test',
      rooms: [
        {
          id: 'room-x',
          width: 10,
          depth: 6,
          height: 3.5,
          surfaces: { wall: 'white-plaster', floor: 'light-wood', accentColor: '#c0a070' },
          lighting: { ambientIntensity: 0.4, temperature: 'neutral', artworkSpotlights: true },
          doorways: [
            { targetRoomId: 'room-y', wall: 'e', offsetFromCenter: 1, width: 2, height: 2.4 },
          ],
        },
        {
          id: 'room-y',
          width: 10,
          depth: 14,
          height: 3.5,
          surfaces: { wall: 'white-plaster', floor: 'light-wood', accentColor: '#c0a070' },
          lighting: { ambientIntensity: 0.4, temperature: 'neutral', artworkSpotlights: true },
          doorways: [],
        },
      ],
      artworks: [{ id: 'aw-test', imagePath: 'images/test.jpg', title: 'T', medium: 'Oil', label: 'L' }],
      placements: [
        { artworkId: 'aw-test', roomId: 'room-y', wall: 'w', offsetFromCenter: -3, hangingHeight: 1.5, displayWidth: 1.2 },
      ],
      tour: [],
    });
    const result = sanitizePlacements(gallery);
    // The doorway centre is at offset -3 on room-y's west wall.
    // Doorway half-width = 1.0, artwork halfWork = 0.6, DOORWAY_MARGIN = 0.3
    // Artwork at -3 is within doorway zone [-4.9, -1.1]; it should be moved.
    const newOffset = result.placements[0].offsetFromCenter;
    // Should be pushed below -4.9 (to the far side) or clamped within the wall
    const doorwayClearance = -3 - 1.0 - 0.6 - 0.3; // = -4.9
    expect(newOffset).toBeLessThanOrEqual(doorwayClearance + 0.01);
  });
});

// ---------------------------------------------------------------------------
// deoverlapWallItems — same-wall artwork overlap resolution
// (regression: generated galleries showed stacked/overlapping artworks)
// ---------------------------------------------------------------------------

function expectNoOverlap(offsets: number[], halves: number[], gap = 0.3): void {
  const spans = offsets
    .map((o, i) => [o - halves[i], o + halves[i]])
    .sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) {
    expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1] + gap - 1e-9);
  }
}

describe('deoverlapWallItems', () => {
  it('leaves already-valid layouts untouched', () => {
    const items = [
      { offset: -3, half: 0.6 },
      { offset: 0, half: 0.6 },
      { offset: 3, half: 0.6 },
    ];
    expect(deoverlapWallItems(items, 12)).toEqual([-3, 0, 3]);
  });

  it('separates two artworks at the same offset', () => {
    const items = [
      { offset: 1, half: 0.6 },
      { offset: 1, half: 0.6 },
    ];
    const out = deoverlapWallItems(items, 12);
    expectNoOverlap(out, [0.6, 0.6]);
    out.forEach((o) => {
      expect(o - 0.6).toBeGreaterThanOrEqual(-5.8 - 1e-9);
      expect(o + 0.6).toBeLessThanOrEqual(5.8 + 1e-9);
    });
  });

  it('resolves a pile-up clamped into the same corner', () => {
    // Three works all clamped to the right edge by the per-placement pass
    const items = [
      { offset: 5.2, half: 0.6 },
      { offset: 5.2, half: 0.6 },
      { offset: 5.2, half: 0.6 },
    ];
    const out = deoverlapWallItems(items, 12);
    expectNoOverlap(out, [0.6, 0.6, 0.6]);
    out.forEach((o) => expect(o + 0.6).toBeLessThanOrEqual(5.8 + 1e-9));
  });

  it('routes artworks around a doorway zone', () => {
    // Doorway blocks [-1.3, 1.3]; two works want the centre
    const items = [
      { offset: -0.5, half: 0.6 },
      { offset: 0.5, half: 0.6 },
    ];
    const out = deoverlapWallItems(items, 12, [[-1.3, 1.3]]);
    expectNoOverlap(out, [0.6, 0.6]);
    // Neither artwork may intrude into the doorway zone
    for (const o of out) {
      expect(o + 0.6 <= -1.3 + 1e-9 || o - 0.6 >= 1.3 - 1e-9).toBe(true);
    }
  });

  it('spreads evenly rather than exploding when a wall is over-crowded', () => {
    const items = Array.from({ length: 4 }, () => ({ offset: 0, half: 0.6 }));
    const out = deoverlapWallItems(items, 4); // 3.6 m usable, 4×1.2 m art
    // Best-effort: all on the wall, monotone spread
    out.forEach((o) => {
      expect(o).toBeGreaterThanOrEqual(-1.8 - 1e-9);
      expect(o).toBeLessThanOrEqual(1.8 + 1e-9);
    });
    const sorted = [...out].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]).toBeGreaterThan(sorted[i - 1]);
  });
});

describe('sanitizePlacements same-wall overlap integration', () => {
  it('separates two LLM placements that overlap on one wall', () => {
    const gallery = baseGallery();
    gallery.placements[0] = {
      ...gallery.placements[0], roomId: 'room-a', wall: 'n',
      offsetFromCenter: 1.0, displayWidth: 1.2,
    };
    gallery.placements[1] = {
      ...gallery.placements[1], roomId: 'room-a', wall: 'n',
      offsetFromCenter: 1.4, displayWidth: 1.2,
    };
    const result = sanitizePlacements(gallery);
    const a = result.placements[0];
    const b = result.placements[1];
    const gapBetween = Math.abs(a.offsetFromCenter - b.offsetFromCenter);
    expect(gapBetween).toBeGreaterThanOrEqual(1.2 + 0.3 - 1e-9);
  });
});
