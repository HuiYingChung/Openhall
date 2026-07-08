// @vitest-environment jsdom
/**
 * narration.test.ts — Unit tests for pickNarrationText and canAutoAdvance.
 */

import { describe, it, expect } from 'vitest';
import { pickNarrationText, canAutoAdvance } from './narration';
import type { Gallery, TourWaypoint } from '../schema/gallery.schema';
import { GallerySchema } from '../schema/gallery.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGallery(overrides: Partial<Parameters<typeof GallerySchema.parse>[0]> = {}): Gallery {
  return GallerySchema.parse({
    version: '1.0',
    title: 'Test Gallery',
    rooms: [
      {
        id: 'room-1',
        width: 10,
        depth: 10,
        height: 3.5,
        surfaces: { wall: 'white-plaster', floor: 'light-wood', accentColor: '#c0a070' },
        lighting: { ambientIntensity: 0.4, temperature: 'neutral', artworkSpotlights: false },
        doorways: [],
      },
    ],
    artworks: [
      {
        id: 'aw-01',
        imagePath: 'images/aw-01.jpg',
        title: 'Painting One',
        medium: 'Oil',
        label: 'A wall label for painting one.',
        narration: 'This is the spoken narration for painting one.',
      },
      {
        id: 'aw-02',
        imagePath: 'images/aw-02.jpg',
        title: 'Painting Two',
        medium: 'Acrylic',
        label: 'A wall label for painting two.',
        // no narration — fallback to label
      },
      {
        id: 'aw-03',
        imagePath: 'images/aw-03.jpg',
        title: 'Painting Three',
        medium: 'Watercolour',
        label: '', // empty label, no narration
      },
    ],
    placements: [],
    tour: [],
    ...overrides,
  });
}

function wp(artworkId?: string): TourWaypoint {
  return {
    artworkId,
    position: { x: 0, y: 1.6, z: 0 },
    lookAt: { x: 0, y: 1.5, z: -5 },
  };
}

// ---------------------------------------------------------------------------
// pickNarrationText
// ---------------------------------------------------------------------------

describe('pickNarrationText', () => {
  it('returns narration when both narration and label exist', () => {
    const gallery = makeGallery();
    expect(pickNarrationText(wp('aw-01'), gallery))
      .toBe('This is the spoken narration for painting one.');
  });

  it('falls back to label when narration is absent', () => {
    const gallery = makeGallery();
    expect(pickNarrationText(wp('aw-02'), gallery))
      .toBe('A wall label for painting two.');
  });

  it('returns empty string when neither narration nor label', () => {
    const gallery = makeGallery();
    expect(pickNarrationText(wp('aw-03'), gallery)).toBe('');
  });

  it('returns empty string for an unknown artworkId', () => {
    const gallery = makeGallery();
    expect(pickNarrationText(wp('aw-99'), gallery)).toBe('');
  });

  it('returns empty string when artworkId is undefined', () => {
    const gallery = makeGallery();
    expect(pickNarrationText(wp(undefined), gallery)).toBe('');
  });

  it('returns artist statement for the ARTIST_MESH_ID stop', () => {
    const gallery = makeGallery({
      artist: {
        name: 'Jane Artist',
        statement: 'I paint quiet interiors.',
        links: [],
      },
    });
    expect(pickNarrationText(wp('__artist__'), gallery))
      .toBe('I paint quiet interiors.');
  });

  it('returns empty string for artist stop when no statement', () => {
    const gallery = makeGallery({
      artist: { name: 'Jane Artist', links: [] },
    });
    expect(pickNarrationText(wp('__artist__'), gallery)).toBe('');
  });

  it('returns empty string for artist stop when no artist block', () => {
    const gallery = makeGallery();
    expect(pickNarrationText(wp('__artist__'), gallery)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// canAutoAdvance
// ---------------------------------------------------------------------------

describe('canAutoAdvance', () => {
  it('false when dwell has not elapsed, not speaking', () => {
    expect(canAutoAdvance(3, 8, false)).toBe(false);
  });

  it('false when dwell has elapsed but still speaking', () => {
    expect(canAutoAdvance(10, 8, true)).toBe(false);
  });

  it('true when dwell has elapsed and not speaking', () => {
    expect(canAutoAdvance(10, 8, false)).toBe(true);
  });

  it('safety fallback: true at 2x dwell even while speaking', () => {
    expect(canAutoAdvance(16, 8, true)).toBe(true);
  });

  it('safety fallback: true at exactly 2x dwell while speaking', () => {
    expect(canAutoAdvance(16, 8, true)).toBe(true);
    expect(canAutoAdvance(15.9, 8, true)).toBe(false);
  });

  it('true immediately when dwell is 0 and not speaking', () => {
    expect(canAutoAdvance(0, 0, false)).toBe(true);
  });
});
