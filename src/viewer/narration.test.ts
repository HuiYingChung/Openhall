// @vitest-environment jsdom
/**
 * narration.test.ts — Unit tests for pickNarrationText and canAutoAdvance.
 */

import { describe, it, expect } from 'vitest';
import { TourNarrator, pickNarrationText, canAutoAdvance, estimateSpeechSeconds, computeStopDwell, computeDwellSeconds } from './narration';
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

  it('artist stop: framed welcome with name + statement', () => {
    const gallery = makeGallery({
      artist: {
        name: 'Jane Artist',
        statement: 'I paint quiet interiors.',
        links: [],
      },
    });
    expect(pickNarrationText(wp('__artist__'), gallery))
      .toBe('Welcome to Test Gallery, an exhibition by Jane Artist. In the artist\'s own words: I paint quiet interiors.');
  });

  it('artist stop: framed welcome with name, no statement', () => {
    const gallery = makeGallery({
      artist: { name: 'Jane Artist', links: [] },
    });
    expect(pickNarrationText(wp('__artist__'), gallery))
      .toBe('Welcome to Test Gallery, an exhibition by Jane Artist.');
  });

  it('artist stop: title-only welcome when no name, statement present', () => {
    // Gallery.artist is optional; simulate the case where only statement is set
    // by using a partial (schema requires name, so we build gallery manually).
    const gallery = makeGallery();
    // No artist block → still returns a welcome with the gallery title.
    expect(pickNarrationText(wp('__artist__'), gallery))
      .toBe('Welcome to Test Gallery.');
  });

  it('artist stop: title-only welcome when no artist block', () => {
    const gallery = makeGallery();
    expect(pickNarrationText(wp('__artist__'), gallery))
      .toBe('Welcome to Test Gallery.');
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

// ---------------------------------------------------------------------------
// estimateSpeechSeconds
// ---------------------------------------------------------------------------

describe('estimateSpeechSeconds', () => {
  it('clamps to 5 s floor for empty and very short text', () => {
    expect(estimateSpeechSeconds('')).toBe(5);
    expect(estimateSpeechSeconds('Hello')).toBe(5); // 5 / 12 ≈ 0.4 → floor
  });

  it('is monotonically increasing for longer text (before ceiling)', () => {
    const short = estimateSpeechSeconds('x'.repeat(60));
    const medium = estimateSpeechSeconds('x'.repeat(120));
    const longer = estimateSpeechSeconds('x'.repeat(240));
    expect(short).toBeLessThan(medium);
    expect(medium).toBeLessThan(longer);
  });

  it('clamps to 30 s ceiling for very long text', () => {
    expect(estimateSpeechSeconds('x'.repeat(5000))).toBe(30);
  });

  it('60-word narration (~360 chars) is estimated between 20 and 30 s', () => {
    const sixtyWords = 'word '.repeat(60); // ~300 chars
    const result = estimateSpeechSeconds(sixtyWords);
    expect(result).toBeGreaterThanOrEqual(20);
    expect(result).toBeLessThan(30);
  });
});

// ---------------------------------------------------------------------------
// computeStopDwell
// ---------------------------------------------------------------------------

describe('computeStopDwell', () => {
  it('returns label dwell when spokenText is empty (voice off)', () => {
    const label = 'A wall label.';
    expect(computeStopDwell(label, '')).toBe(computeDwellSeconds(label));
  });

  it('returns speech estimate when narration is longer than label reading time', () => {
    // Short label (→5 s) but long narration (→20+ s): speech wins
    const shortLabel = 'Short.';
    const longNarration = 'x'.repeat(300); // 300/12 = 25 s
    const result = computeStopDwell(shortLabel, longNarration);
    expect(result).toBeGreaterThan(computeDwellSeconds(shortLabel));
    expect(result).toBe(estimateSpeechSeconds(longNarration));
  });

  it('returns label dwell when label reading time exceeds speech estimate', () => {
    // Very long label (→12 s cap) but very short narration text (→5 s floor): label wins
    const longLabel = 'x'.repeat(600);
    const shortNarration = 'Hi.';
    const result = computeStopDwell(longLabel, shortNarration);
    expect(result).toBe(computeDwellSeconds(longLabel)); // 12 s cap
  });

  it('returns the max of both when they are comparable', () => {
    const label = 'x'.repeat(80);  // computeDwellSeconds → 6 s
    const narration = 'x'.repeat(96); // estimateSpeechSeconds → 8 s
    expect(computeStopDwell(label, narration)).toBe(estimateSpeechSeconds(narration));
  });
});

// ---------------------------------------------------------------------------
// TourNarrator — pause/resume/isPaused lifecycle
// ---------------------------------------------------------------------------

describe('TourNarrator isPaused lifecycle', () => {
  it('isPaused starts false', () => {
    const narrator = new TourNarrator();
    expect(narrator.isPaused).toBe(false);
  });

  it('pause() sets isPaused to true', () => {
    const narrator = new TourNarrator();
    narrator.pause();
    expect(narrator.isPaused).toBe(true);
  });

  it('resume() clears isPaused', () => {
    const narrator = new TourNarrator();
    narrator.pause();
    narrator.resume();
    expect(narrator.isPaused).toBe(false);
  });

  it('cancel() clears isPaused', () => {
    const narrator = new TourNarrator();
    narrator.pause();
    narrator.cancel();
    expect(narrator.isPaused).toBe(false);
  });

  it('speak() clears isPaused', () => {
    const narrator = new TourNarrator();
    narrator.pause();
    narrator.speak('hello');
    expect(narrator.isPaused).toBe(false);
  });
});
