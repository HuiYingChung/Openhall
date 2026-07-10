/**
 * validation.test.ts — §3 regression tests for semantic AI output validation.
 *
 * Tests one failure per invariant plus valid cases.
 * Provider-level retry behavior is covered in provider.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { buildAnalysisSchema, buildCurationSchema, buildLabelsSchema } from './validation';

// ─── buildAnalysisSchema ────────────────────────────────────────────────────

const validAnalysis = {
  artworkId: 'aw-01',
  style: 'abstract expressionism',
  palette: ['#cc3333'],
  subject: 'two figures',
  mood: 'melancholic',
  description: 'A study in tension.',
};

describe('buildAnalysisSchema (§3)', () => {
  it('accepts a valid analysis with the correct artworkId', () => {
    expect(buildAnalysisSchema('aw-01').safeParse(validAnalysis).success).toBe(true);
  });

  it('rejects when artworkId does not match the expected id', () => {
    const bad = { ...validAnalysis, artworkId: 'aw-WRONG' };
    const result = buildAnalysisSchema('aw-01').safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ─── buildCurationSchema ────────────────────────────────────────────────────

const validPlan = {
  roomCount: 2,
  rooms: [
    { roomId: 'room-1', theme: 'Tension', artworkIds: ['aw-01', 'aw-02'] },
    { roomId: 'room-2', theme: 'Resolution', artworkIds: ['aw-03'] },
  ],
  placements: [
    { artworkId: 'aw-01', roomId: 'room-1', wall: 'n', offsetFromCenter: -2 },
    { artworkId: 'aw-02', roomId: 'room-1', wall: 's', offsetFromCenter: 2 },
    { artworkId: 'aw-03', roomId: 'room-2', wall: 'n', offsetFromCenter: 0 },
  ],
  tourOrder: ['aw-01', 'aw-02', 'aw-03'],
  curatorNote: 'A journey.',
};
const expectedIds = ['aw-01', 'aw-02', 'aw-03'];

describe('buildCurationSchema (§3)', () => {
  it('accepts a valid curation plan', () => {
    expect(buildCurationSchema(expectedIds).safeParse(validPlan).success).toBe(true);
  });

  it('rejects when roomCount != rooms.length', () => {
    const bad = { ...validPlan, roomCount: 1 }; // 2 rooms but roomCount=1
    expect(buildCurationSchema(expectedIds).safeParse(bad).success).toBe(false);
  });

  it('rejects when room ids are not unique', () => {
    const bad = {
      ...validPlan,
      rooms: [
        { roomId: 'room-1', theme: 'A', artworkIds: ['aw-01'] },
        { roomId: 'room-1', theme: 'B', artworkIds: ['aw-02', 'aw-03'] }, // duplicate roomId
      ],
    };
    expect(buildCurationSchema(expectedIds).safeParse(bad).success).toBe(false);
  });

  it('rejects when an artwork is missing from rooms.artworkIds', () => {
    const bad = {
      ...validPlan,
      rooms: [
        { roomId: 'room-1', theme: 'A', artworkIds: ['aw-01'] },
        { roomId: 'room-2', theme: 'B', artworkIds: ['aw-02'] }, // aw-03 missing
      ],
    };
    expect(buildCurationSchema(expectedIds).safeParse(bad).success).toBe(false);
  });

  it('rejects when a foreign artwork id appears in rooms.artworkIds', () => {
    const bad = {
      ...validPlan,
      rooms: [
        { roomId: 'room-1', theme: 'A', artworkIds: ['aw-01', 'aw-02', 'aw-FOREIGN'] },
        { roomId: 'room-2', theme: 'B', artworkIds: ['aw-03'] },
      ],
    };
    expect(buildCurationSchema(expectedIds).safeParse(bad).success).toBe(false);
  });

  it('rejects when an artwork appears in more than one room', () => {
    const bad = {
      ...validPlan,
      rooms: [
        { roomId: 'room-1', theme: 'A', artworkIds: ['aw-01', 'aw-02'] },
        { roomId: 'room-2', theme: 'B', artworkIds: ['aw-02', 'aw-03'] }, // aw-02 duplicate
      ],
    };
    expect(buildCurationSchema(expectedIds).safeParse(bad).success).toBe(false);
  });

  it('rejects when placements has a duplicate artworkId', () => {
    const bad = {
      ...validPlan,
      placements: [
        { artworkId: 'aw-01', roomId: 'room-1', wall: 'n', offsetFromCenter: 0 },
        { artworkId: 'aw-01', roomId: 'room-1', wall: 's', offsetFromCenter: 0 }, // aw-01 twice
        { artworkId: 'aw-03', roomId: 'room-2', wall: 'n', offsetFromCenter: 0 },
      ],
    };
    expect(buildCurationSchema(expectedIds).safeParse(bad).success).toBe(false);
  });

  it('rejects when placements omits an expected artwork', () => {
    const bad = {
      ...validPlan,
      placements: [
        { artworkId: 'aw-01', roomId: 'room-1', wall: 'n', offsetFromCenter: 0 },
        // aw-02 and aw-03 missing
      ],
    };
    expect(buildCurationSchema(expectedIds).safeParse(bad).success).toBe(false);
  });

  it('rejects when a placement references a non-existent room', () => {
    const bad = {
      ...validPlan,
      placements: [
        { artworkId: 'aw-01', roomId: 'room-NONEXISTENT', wall: 'n', offsetFromCenter: 0 },
        { artworkId: 'aw-02', roomId: 'room-1', wall: 's', offsetFromCenter: 0 },
        { artworkId: 'aw-03', roomId: 'room-2', wall: 'n', offsetFromCenter: 0 },
      ],
    };
    expect(buildCurationSchema(expectedIds).safeParse(bad).success).toBe(false);
  });

  it('rejects when a placement roomId does not match the room in which the artwork was assigned', () => {
    // aw-01 is in room-1 per rooms.artworkIds, but its placement says room-2
    const bad = {
      ...validPlan,
      placements: [
        { artworkId: 'aw-01', roomId: 'room-2', wall: 'n', offsetFromCenter: 0 }, // wrong room
        { artworkId: 'aw-02', roomId: 'room-1', wall: 's', offsetFromCenter: 0 },
        { artworkId: 'aw-03', roomId: 'room-2', wall: 'e', offsetFromCenter: 0 },
      ],
    };
    expect(buildCurationSchema(expectedIds).safeParse(bad).success).toBe(false);
  });

  it('rejects when tourOrder omits an artwork', () => {
    const bad = { ...validPlan, tourOrder: ['aw-01', 'aw-02'] }; // aw-03 missing
    expect(buildCurationSchema(expectedIds).safeParse(bad).success).toBe(false);
  });

  it('rejects when tourOrder has a foreign artwork', () => {
    const bad = { ...validPlan, tourOrder: ['aw-01', 'aw-02', 'aw-FOREIGN'] };
    expect(buildCurationSchema(expectedIds).safeParse(bad).success).toBe(false);
  });

  it('accepts reordering within a room while keeping the room chain monotonic', () => {
    const reordered = { ...validPlan, tourOrder: ['aw-02', 'aw-01', 'aw-03'] };
    expect(buildCurationSchema(expectedIds).safeParse(reordered).success).toBe(true);
  });

  it('rejects a tourOrder that returns to an earlier room', () => {
    const backtracking = { ...validPlan, tourOrder: ['aw-01', 'aw-03', 'aw-02'] };
    expect(buildCurationSchema(expectedIds).safeParse(backtracking).success).toBe(false);
  });

  it('rejects a tourOrder that starts in a later room and moves backwards', () => {
    const backwards = { ...validPlan, tourOrder: ['aw-03', 'aw-02', 'aw-01'] };
    expect(buildCurationSchema(expectedIds).safeParse(backwards).success).toBe(false);
  });

  it('accepts a valid single-room plan', () => {
    const oneRoom = {
      roomCount: 1,
      rooms: [{ roomId: 'room-1', theme: 'All', artworkIds: ['aw-01', 'aw-02', 'aw-03'] }],
      placements: [
        { artworkId: 'aw-01', roomId: 'room-1', wall: 'n', offsetFromCenter: -2 },
        { artworkId: 'aw-02', roomId: 'room-1', wall: 'n', offsetFromCenter: 2 },
        { artworkId: 'aw-03', roomId: 'room-1', wall: 's', offsetFromCenter: 0 },
      ],
      tourOrder: ['aw-01', 'aw-02', 'aw-03'],
      curatorNote: 'All in one room.',
    };
    expect(buildCurationSchema(expectedIds).safeParse(oneRoom).success).toBe(true);
  });
});

// ─── buildLabelsSchema ──────────────────────────────────────────────────────

const batchIds = ['aw-01', 'aw-02'];
const validLabels = [
  { artworkId: 'aw-01', label: 'A wall label for work one.', narration: 'Spoken narration one.' },
  { artworkId: 'aw-02', label: 'A wall label for work two.', narration: 'Spoken narration two.' },
];

describe('buildLabelsSchema (§3)', () => {
  it('accepts a valid labels batch', () => {
    expect(buildLabelsSchema(batchIds).safeParse(validLabels).success).toBe(true);
  });

  it('rejects when narration is missing on an entry', () => {
    const bad = [
      { artworkId: 'aw-01', label: 'Label one.', narration: 'Narration one.' },
      { artworkId: 'aw-02', label: 'Label two.' }, // narration missing
    ];
    expect(buildLabelsSchema(batchIds).safeParse(bad).success).toBe(false);
  });

  it('rejects when narration is empty string', () => {
    const bad = [
      { artworkId: 'aw-01', label: 'Label one.', narration: '' }, // empty
      { artworkId: 'aw-02', label: 'Label two.', narration: 'Narration two.' },
    ];
    expect(buildLabelsSchema(batchIds).safeParse(bad).success).toBe(false);
  });

  it('rejects when an id is duplicated in the response', () => {
    const bad = [
      { artworkId: 'aw-01', label: 'Label one.', narration: 'Narration one.' },
      { artworkId: 'aw-01', label: 'Duplicate.', narration: 'Duplicate narration.' }, // duplicate
    ];
    expect(buildLabelsSchema(batchIds).safeParse(bad).success).toBe(false);
  });

  it('rejects when an expected id is missing from the response', () => {
    const bad = [
      { artworkId: 'aw-01', label: 'Label one.', narration: 'Narration one.' },
      // aw-02 is missing
    ];
    expect(buildLabelsSchema(batchIds).safeParse(bad).success).toBe(false);
  });

  it('rejects when a foreign id appears in the response', () => {
    const bad = [
      { artworkId: 'aw-01', label: 'Label one.', narration: 'Narration one.' },
      { artworkId: 'aw-FOREIGN', label: 'Label foreign.', narration: 'Narration foreign.' },
    ];
    expect(buildLabelsSchema(batchIds).safeParse(bad).success).toBe(false);
  });
});

// ─── GallerySchema integrity checks ─────────────────────────────────────────

import { GallerySchema, ARTIST_TOUR_ID } from '../schema/gallery.schema';
import sampleGallery from '../demo/sample-gallery.json';

describe('GallerySchema integrity checks (§3)', () => {
  it('sample-gallery.json still passes after integrity checks', () => {
    expect(GallerySchema.safeParse(sampleGallery).success).toBe(true);
  });

  it('rejects duplicate room ids', () => {
    const r = sampleGallery.rooms[0];
    const bad = { ...sampleGallery, rooms: [r, { ...r, id: r.id }] }; // same id twice
    expect(GallerySchema.safeParse(bad).success).toBe(false);
  });

  it('rejects duplicate artwork ids', () => {
    const a = sampleGallery.artworks[0];
    const bad = { ...sampleGallery, artworks: [a, { ...a }] };
    expect(GallerySchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a placement that references an unknown roomId', () => {
    const bad = {
      ...sampleGallery,
      placements: [
        ...sampleGallery.placements.slice(0, -1),
        { ...sampleGallery.placements[0], roomId: 'room-NONEXISTENT' },
      ],
    };
    expect(GallerySchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a placement that references an unknown artworkId', () => {
    const bad = {
      ...sampleGallery,
      placements: [
        ...sampleGallery.placements.slice(0, -1),
        { ...sampleGallery.placements[0], artworkId: 'aw-NONEXISTENT' },
      ],
    };
    expect(GallerySchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a duplicate placement for the same artwork', () => {
    const bad = {
      ...sampleGallery,
      placements: [...sampleGallery.placements, sampleGallery.placements[0]],
    };
    expect(GallerySchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a tour waypoint referencing an unknown artworkId', () => {
    const bad = {
      ...sampleGallery,
      tour: [
        ...sampleGallery.tour,
        { artworkId: 'aw-NONEXISTENT', position: { x: 0, y: 0, z: 0 }, lookAt: { x: 1, y: 0, z: 0 } },
      ],
    };
    expect(GallerySchema.safeParse(bad).success).toBe(false);
  });

  it('accepts the reserved ARTIST_TOUR_ID waypoint when gallery.artist is present', () => {
    const withArtist = {
      ...sampleGallery,
      artist: { name: 'Jane', links: [] },
      tour: [
        ...sampleGallery.tour,
        { artworkId: ARTIST_TOUR_ID, position: { x: 0, y: 0, z: 0 }, lookAt: { x: 1, y: 0, z: 0 } },
      ],
    };
    expect(GallerySchema.safeParse(withArtist).success).toBe(true);
  });

  it('rejects the reserved ARTIST_TOUR_ID waypoint when gallery.artist is absent', () => {
    const noArtist = {
      ...sampleGallery,
      artist: undefined,
      tour: [
        ...sampleGallery.tour,
        { artworkId: ARTIST_TOUR_ID, position: { x: 0, y: 0, z: 0 }, lookAt: { x: 1, y: 0, z: 0 } },
      ],
    };
    expect(GallerySchema.safeParse(noArtist).success).toBe(false);
  });
});
