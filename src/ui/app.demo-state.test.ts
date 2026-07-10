/**
 * Regression coverage for the demo preview boundary. Entering the bundled
 * demo must not discard a user's uploaded artwork URLs or generated gallery.
 */

import { describe, expect, it } from 'vitest';
import type { UploadedArtwork } from '../ai/provider';
import { GallerySchema } from '../schema/gallery.schema';
import sampleGallery from '../demo/sample-gallery.json';
import {
  captureDraftBeforeDemo,
  restoreDraftAfterDemo,
  type AppData,
} from './app';

function makeArtwork(): UploadedArtwork {
  return {
    id: 'aw-17',
    filename: 'kept.jpg',
    analysisDataUrl: 'data:image/jpeg;base64,analysis',
    displayObjectUrl: 'blob:user-display-copy',
    aspectRatio: 1.5,
    title: 'Kept work',
    medium: 'Oil',
    contentHash: 'content-hash',
  };
}

describe('demo draft preservation', () => {
  it('restores uploaded artworks and a cached gallery after leaving demo mode', () => {
    const userArtworks = [makeArtwork()];
    const userGallery = GallerySchema.parse(sampleGallery);
    const data: AppData = {
      artworks: userArtworks,
      userBrief: 'User exhibition',
      preset: 'white-cube',
      analyses: [],
      gallery: userGallery,
      lastGenKey: 'user-cache-key',
    };
    const snapshot = captureDraftBeforeDemo(data);

    data.artworks = [];
    data.gallery = GallerySchema.parse(sampleGallery);
    data.isDemo = true;
    restoreDraftAfterDemo(data, snapshot);

    expect(data.artworks).toBe(userArtworks);
    expect(data.artworks[0].displayObjectUrl).toBe('blob:user-display-copy');
    expect(data.gallery).toBe(userGallery);
    expect(data.isDemo).toBeUndefined();
    expect(data.lastGenKey).toBe('user-cache-key');
  });

  it('restores an empty pre-demo state without retaining the demo gallery', () => {
    const data: AppData = {
      artworks: [],
      userBrief: '',
      preset: 'white-cube',
      analyses: [],
      gallery: null,
    };
    const snapshot = captureDraftBeforeDemo(data);

    data.gallery = GallerySchema.parse(sampleGallery);
    data.isDemo = true;
    restoreDraftAfterDemo(data, snapshot);

    expect(data.gallery).toBeNull();
    expect(data.artworks).toEqual([]);
    expect(data.isDemo).toBeUndefined();
  });
});
