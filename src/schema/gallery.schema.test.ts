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

  it('accepts artwork without a medium', () => {
    const artworks = sampleGallery.artworks.map((artwork, index) => {
      if (index !== 0) return artwork;
      const { medium: _medium, ...withoutMedium } = artwork;
      return withoutMedium;
    });

    const result = GallerySchema.safeParse({ ...sampleGallery, artworks });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.artworks[0].medium).toBeUndefined();
    }
  });

  it('rejects a gallery with more than 4 rooms (AGENTS.md rule 6 cap)', () => {
    const singleRoom = sampleGallery.rooms[0];
    const bad = { ...sampleGallery, rooms: [singleRoom, singleRoom, singleRoom, singleRoom, singleRoom] };
    const result = GallerySchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('accepts an optional branding block', () => {
    const withBranding = {
      ...sampleGallery,
      branding: {
        description: 'A small exhibition of late works.',
        authorName: 'Jane Artist',
        authorUrl: 'https://jane.example',
      },
    };
    const result = GallerySchema.safeParse(withBranding);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.branding?.authorName).toBe('Jane Artist');
    }
  });

  it('treats branding as optional (absent is valid)', () => {
    const result = GallerySchema.safeParse(sampleGallery);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.branding).toBeUndefined();
    }
  });

  it('accepts an optional artist block with links', () => {
    const withArtist = {
      ...sampleGallery,
      artist: {
        name: 'Jane Artist',
        statement: 'I paint quiet interiors.',
        portraitPath: 'images/portrait.jpg',
        links: [
          { label: 'Instagram', url: 'https://instagram.com/jane' },
          { label: 'Website', url: 'https://jane.example' },
        ],
      },
    };
    const result = GallerySchema.safeParse(withArtist);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.artist?.name).toBe('Jane Artist');
      expect(result.data.artist?.links).toHaveLength(2);
    }
  });

  it('defaults artist.links to an empty array and allows no portrait', () => {
    const withArtist = { ...sampleGallery, artist: { name: 'Solo' } };
    const result = GallerySchema.safeParse(withArtist);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.artist?.links).toEqual([]);
      expect(result.data.artist?.portraitPath).toBeUndefined();
    }
  });

  it('rejects an artist block with no name', () => {
    const bad = { ...sampleGallery, artist: { statement: 'no name here' } };
    const result = GallerySchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('accepts artwork with optional narration field', () => {
    // Use a copy with narration explicitly set on the first artwork and stripped from the rest.
    const strippedArtworks = sampleGallery.artworks.map(({ narration: _n, ...rest }) => rest);
    const withNarration = {
      ...sampleGallery,
      artworks: strippedArtworks.map((aw, i) =>
        i === 0 ? { ...aw, narration: 'A spoken docent voice for this work.' } : aw
      ),
    };
    const result = GallerySchema.safeParse(withNarration);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.artworks[0].narration).toBe('A spoken docent voice for this work.');
      expect(result.data.artworks[1].narration).toBeUndefined();
    }
  });

  it('treats artwork narration as optional (absent is valid)', () => {
    // Verify a copy with all narration fields removed still passes validation.
    const withoutNarration = {
      ...sampleGallery,
      artworks: sampleGallery.artworks.map(({ narration: _n, ...rest }) => rest),
    };
    const result = GallerySchema.safeParse(withoutNarration);
    expect(result.success).toBe(true);
  });

  it('rejects narration exceeding 600 characters', () => {
    const tooLong = {
      ...sampleGallery,
      artworks: [{ ...sampleGallery.artworks[0], narration: 'x'.repeat(601) }],
    };
    const result = GallerySchema.safeParse(tooLong);
    expect(result.success).toBe(false);
  });

  it('sample-gallery.json narration fields all pass the 600-char limit', () => {
    const result = GallerySchema.safeParse(sampleGallery);
    expect(result.success).toBe(true);
    if (result.success) {
      for (const aw of result.data.artworks) {
        if (aw.narration !== undefined) {
          expect(aw.narration.length).toBeLessThanOrEqual(600);
        }
      }
    }
  });
});
