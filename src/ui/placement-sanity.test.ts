/**
 * placement-sanity.test.ts — Unit tests for sanitizePlacements.
 */

import { describe, it, expect } from 'vitest';
import { sanitizePlacements, convertInboundOffset, buildRoomOrigins } from '../ui/placement-sanity';
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
