/**
 * gallery.schema.test.ts — Validates that sample-gallery.json conforms
 * to GallerySchema. This is a standing spec: the file must always pass.
 */

import { describe, it, expect } from 'vitest';
import { GallerySchema } from '../schema/gallery.schema';
import sampleGallery from '../demo/sample-gallery.json';

describe('GallerySchema', () => {
  it('sample-gallery.json passes schema validation', () => {
    const result = GallerySchema.safeParse(sampleGallery);
    if (!result.success) {
      console.error(result.error.format());
    }
    expect(result.success).toBe(true);
  });

  it('rejects a gallery with no rooms', () => {
    const bad = { ...sampleGallery, rooms: [] };
    const result = GallerySchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects a gallery with wrong version', () => {
    const bad = { ...sampleGallery, version: '2.0' };
    const result = GallerySchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('infers correct TypeScript types (compile-time check)', () => {
    const result = GallerySchema.parse(sampleGallery);
    // If TypeScript compiles this test, types are correct
    const roomId: string = result.rooms[0].id;
    const artworkId: string = result.artworks[0].id;
    expect(typeof roomId).toBe('string');
    expect(typeof artworkId).toBe('string');
  });

  it('rejects a gallery with more than 4 rooms (AGENTS.md rule 6 cap)', () => {
    const singleRoom = sampleGallery.rooms[0];
    const bad = { ...sampleGallery, rooms: [singleRoom, singleRoom, singleRoom, singleRoom, singleRoom] };
    const result = GallerySchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
