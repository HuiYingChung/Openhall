/**
 * gallery-assembler.test.ts — Unit tests for deterministic gallery geometry.
 *
 * Covers:
 *   - buildRooms: correct material/dimensions from preset; doorway chain
 *   - buildPlacements: all plan placements are present with correct fields
 *   - buildTourWaypoints: positions 2m in front of artwork, y = eye height
 *   - assembleGallery: output passes GallerySchema (with placeholder labels filled)
 */

import { describe, it, expect } from 'vitest';
import {
  buildRooms,
  buildPlacements,
  buildTourWaypoints,
  assembleGallery,
  PRESET_PARAMS,
} from './gallery-assembler';
import { GallerySchema } from '../schema/gallery.schema';
import type { CurationPlan } from '../schema/analysis.schema';
import type { UploadedArtwork } from './provider';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLAN_2_ROOMS: CurationPlan = {
  roomCount: 2,
  rooms: [
    { roomId: 'r1', theme: 'Nature', artworkIds: ['aw-01', 'aw-02', 'aw-03'] },
    { roomId: 'r2', theme: 'Urban', artworkIds: ['aw-04', 'aw-05', 'aw-06'] },
  ],
  placements: [
    { artworkId: 'aw-01', roomId: 'r1', wall: 'n', offsetFromCenter: 0 },
    { artworkId: 'aw-02', roomId: 'r1', wall: 's', offsetFromCenter: -2 },
    { artworkId: 'aw-03', roomId: 'r1', wall: 'w', offsetFromCenter: 1 },
    { artworkId: 'aw-04', roomId: 'r2', wall: 'n', offsetFromCenter: 0 },
    { artworkId: 'aw-05', roomId: 'r2', wall: 'e', offsetFromCenter: 0 },
    { artworkId: 'aw-06', roomId: 'r2', wall: 's', offsetFromCenter: 2 },
  ],
  tourOrder: ['aw-01', 'aw-02', 'aw-03', 'aw-04', 'aw-05', 'aw-06'],
  curatorNote: 'A journey from natural landscapes to city life.',
};

const ARTWORKS_6: UploadedArtwork[] = Array.from({ length: 6 }, (_, i) => ({
  id: `aw-0${i + 1}`,
  filename: `img${i + 1}.jpg`,
  analysisDataUrl: 'data:image/png;base64,ABC',
  displayObjectUrl: 'blob:x',
  aspectRatio: 1.5,
  title: `Work ${i + 1}`,
  medium: 'Oil on canvas',
}));

// ---------------------------------------------------------------------------
// buildRooms
// ---------------------------------------------------------------------------

describe('buildRooms', () => {
  it('returns one room per plan entry', () => {
    const rooms = buildRooms(PLAN_2_ROOMS, 'white-cube');
    expect(rooms).toHaveLength(2);
    expect(rooms[0].id).toBe('r1');
    expect(rooms[1].id).toBe('r2');
  });

  it('applies white-cube preset materials', () => {
    const rooms = buildRooms(PLAN_2_ROOMS, 'white-cube');
    const p = PRESET_PARAMS['white-cube'];
    expect(rooms[0].surfaces.wall).toBe(p.wall);
    expect(rooms[0].surfaces.floor).toBe(p.floor);
    expect(rooms[0].surfaces.accentColor).toBe(p.accent);
    expect(rooms[0].height).toBe(p.height);
  });

  it('applies dark-dramatic preset materials', () => {
    const rooms = buildRooms(PLAN_2_ROOMS, 'dark-dramatic');
    const p = PRESET_PARAMS['dark-dramatic'];
    expect(rooms[0].surfaces.wall).toBe(p.wall);
    expect(rooms[0].lighting.ambientIntensity).toBe(p.ambientIntensity);
    expect(rooms[0].lighting.temperature).toBe(p.temperature);
  });

  it('chains doorways east: first room has doorway to second room', () => {
    const rooms = buildRooms(PLAN_2_ROOMS, 'white-cube');
    expect(rooms[0].doorways).toHaveLength(1);
    expect(rooms[0].doorways[0].targetRoomId).toBe('r2');
    expect(rooms[0].doorways[0].wall).toBe('e');
  });

  it('last room has no doorways', () => {
    const rooms = buildRooms(PLAN_2_ROOMS, 'white-cube');
    expect(rooms[rooms.length - 1].doorways).toHaveLength(0);
  });

  it('doorway has positive width and height', () => {
    const rooms = buildRooms(PLAN_2_ROOMS, 'white-cube');
    const d = rooms[0].doorways[0];
    expect(d.width).toBeGreaterThan(0);
    expect(d.height).toBeGreaterThan(0);
  });

  it('single-room plan has no doorways', () => {
    const singlePlan: CurationPlan = {
      roomCount: 1,
      rooms: [{ roomId: 'r1', theme: 'Solo', artworkIds: ['aw-01'] }],
      placements: [{ artworkId: 'aw-01', roomId: 'r1', wall: 'n', offsetFromCenter: 0 }],
      tourOrder: ['aw-01'],
      curatorNote: 'A solo exhibition.',
    };
    const rooms = buildRooms(singlePlan, 'warm-wood');
    expect(rooms[0].doorways).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildPlacements
// ---------------------------------------------------------------------------

describe('buildPlacements', () => {
  it('returns one placement per plan placement', () => {
    const placements = buildPlacements(PLAN_2_ROOMS);
    expect(placements).toHaveLength(PLAN_2_ROOMS.placements.length);
  });

  it('preserves artworkId, roomId, wall, offsetFromCenter from plan', () => {
    const placements = buildPlacements(PLAN_2_ROOMS);
    for (let i = 0; i < PLAN_2_ROOMS.placements.length; i++) {
      const pb = PLAN_2_ROOMS.placements[i];
      const p = placements[i];
      expect(p.artworkId).toBe(pb.artworkId);
      expect(p.roomId).toBe(pb.roomId);
      expect(p.wall).toBe(pb.wall);
      expect(p.offsetFromCenter).toBe(pb.offsetFromCenter);
    }
  });

  it('all placements have positive hangingHeight and displayWidth', () => {
    const placements = buildPlacements(PLAN_2_ROOMS);
    for (const p of placements) {
      expect(p.hangingHeight).toBeGreaterThan(0);
      expect(p.displayWidth).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// buildTourWaypoints
// ---------------------------------------------------------------------------

describe('buildTourWaypoints', () => {
  const rooms = buildRooms(PLAN_2_ROOMS, 'white-cube');

  it('adds a doorway transit waypoint when the tour enters the next room', () => {
    const waypoints = buildTourWaypoints(PLAN_2_ROOMS, rooms, ARTWORKS_6);
    expect(waypoints).toHaveLength(PLAN_2_ROOMS.tourOrder.length + 1);

    const transit = waypoints.find((w) => w.kind === 'transit');
    expect(transit).toBeDefined();
    expect(transit?.artworkId).toBeUndefined();
    expect(transit?.position.x).toBeCloseTo(rooms[0].width);
    expect(transit?.position.z).toBeCloseTo(rooms[0].depth / 2);
    expect(transit!.lookAt.x).toBeGreaterThan(transit!.position.x);
  });

  it('camera y is at eye height (1.6m)', () => {
    const waypoints = buildTourWaypoints(PLAN_2_ROOMS, rooms, ARTWORKS_6);
    for (const wp of waypoints) {
      expect(wp.position.y).toBeCloseTo(1.6);
    }
  });

  it('stand position is ~2m in front of the artwork on the north wall', () => {
    const waypoints = buildTourWaypoints(PLAN_2_ROOMS, rooms, ARTWORKS_6);
    // aw-01 is on north wall of r1 (z=0), offset=0
    // stand position should be z ≈ 2 (2m in front = towards room centre)
    const wp = waypoints.find((w) => w.artworkId === 'aw-01')!;
    expect(wp).toBeDefined();
    expect(wp.position.z).toBeCloseTo(2.0);
    // lookAt z should be 0 (the north wall)
    expect(wp.lookAt.z).toBeCloseTo(0);
  });

  it('stand position is ~2m in front on south wall', () => {
    const waypoints = buildTourWaypoints(PLAN_2_ROOMS, rooms, ARTWORKS_6);
    // aw-02 is on south wall of r1 (z=depth=10), offset=-2
    const wp = waypoints.find((w) => w.artworkId === 'aw-02')!;
    expect(wp).toBeDefined();
    const room = rooms.find((r) => r.id === 'r1')!;
    expect(wp.position.z).toBeCloseTo(room.depth - 2.0);
    expect(wp.lookAt.z).toBeCloseTo(room.depth);
  });

  it('each waypoint has a label', () => {
    const waypoints = buildTourWaypoints(PLAN_2_ROOMS, rooms, ARTWORKS_6);
    for (const wp of waypoints.filter((w) => w.kind !== 'transit')) {
      expect(typeof wp.label).toBe('string');
      expect((wp.label ?? '').length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// assembleGallery — schema validity
// ---------------------------------------------------------------------------

describe('assembleGallery', () => {
  it('produces output that passes GallerySchema after labels are filled in', () => {
    const shell = assembleGallery(PLAN_2_ROOMS, 'white-cube', ARTWORKS_6, 'Test Show');
    // Fill placeholder labels
    const artworksWithLabels = shell.artworks.map((aw) => ({
      ...aw,
      label: 'A test label for this work.',
    }));
    const result = GallerySchema.safeParse({ ...shell, artworks: artworksWithLabels });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('has the correct version and title', () => {
    const shell = assembleGallery(PLAN_2_ROOMS, 'white-cube', ARTWORKS_6, 'My Show');
    expect(shell.version).toBe('1.0');
    expect(shell.title).toBe('My Show');
  });

  it('produces one artwork record per input artwork', () => {
    const shell = assembleGallery(PLAN_2_ROOMS, 'white-cube', ARTWORKS_6, 'Test');
    expect(shell.artworks).toHaveLength(ARTWORKS_6.length);
  });

  it('omits blank medium instead of inventing a sentinel value', () => {
    const artworks = ARTWORKS_6.map((artwork, index) => (
      index === 0 ? { ...artwork, medium: '   ' } : artwork
    ));
    const shell = assembleGallery(PLAN_2_ROOMS, 'white-cube', artworks, 'Test');

    expect(shell.artworks[0]).not.toHaveProperty('medium');
    expect(JSON.stringify(shell.artworks)).not.toContain('Unknown medium');
    expect(shell.artworks[1].medium).toBe('Oil on canvas');
  });

  it('artwork imagePaths use artworkId', () => {
    const shell = assembleGallery(PLAN_2_ROOMS, 'white-cube', ARTWORKS_6, 'Test');
    for (const aw of shell.artworks) {
      expect(aw.imagePath).toBe(`images/${aw.id}.jpg`);
    }
  });

  it('tour waypoints cover all tourOrder entries', () => {
    const shell = assembleGallery(PLAN_2_ROOMS, 'white-cube', ARTWORKS_6, 'Test');
    const artworkStops = shell.tour.filter((waypoint) => waypoint.kind !== 'transit');
    expect(artworkStops).toHaveLength(PLAN_2_ROOMS.tourOrder.length);
    const waypointIds = new Set(artworkStops.map((w) => w.artworkId));
    for (const id of PLAN_2_ROOMS.tourOrder) {
      expect(waypointIds.has(id)).toBe(true);
    }
  });

  it('rooms match plan room count', () => {
    const shell = assembleGallery(PLAN_2_ROOMS, 'white-cube', ARTWORKS_6, 'Test');
    expect(shell.rooms).toHaveLength(PLAN_2_ROOMS.roomCount);
  });
});
