/**
 * placement-sanity.test.ts — Unit tests for sanitizePlacements.
 */

import { describe, it, expect } from 'vitest';
import { sanitizePlacements } from '../ui/placement-sanity';
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
