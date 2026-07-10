/**
 * app.identity.test.ts — §4 regression tests for applyIdentity and
 * buildScene artist waypoint idempotency.
 */

import { describe, it, expect } from 'vitest';
import {
  applyIdentity,
  shouldSeedCuratorDescription,
  syncReviewIdentity,
  type AppData,
} from './app';
import type { Gallery } from '../schema/gallery.schema';
import { ARTIST_TOUR_ID } from '../schema/gallery.schema';
import { ARTIST_MESH_ID } from '../viewer/room-builder';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGallery(title = 'AI Title'): Gallery {
  return {
    version: '1.0',
    title,
    rooms: [{
      id: 'room-1', width: 12, depth: 10, height: 3.5,
      surfaces: { wall: 'white-plaster', floor: 'light-wood', accentColor: '#e8e0d8' },
      lighting: { ambientIntensity: 0.45, temperature: 'neutral', artworkSpotlights: true },
      doorways: [],
    }],
    artworks: [],
    placements: [],
    tour: [],
  };
}

function makeData(identity?: AppData['identity'], generatedTitle?: string): AppData {
  return {
    artworks: [], userBrief: '', preset: 'white-cube', analyses: [], gallery: null,
    identity: identity ?? { links: [] },
    generatedTitle,
  };
}

// ─── applyIdentity — clear behavior ──────────────────────────────────────────

describe('applyIdentity (§4)', () => {
  it('sets title from identity override when provided', () => {
    const gallery = makeGallery('AI Title');
    const data = makeData({ title: 'User Override', links: [] }, 'AI Title');
    applyIdentity(gallery, data);
    expect(gallery.title).toBe('User Override');
  });

  it('restores generatedTitle when title override is cleared', () => {
    const gallery = makeGallery('AI Title');
    const data = makeData({ title: undefined, links: [] }, 'AI Title');
    applyIdentity(gallery, data);
    expect(gallery.title).toBe('AI Title');
  });

  it('does not clobber gallery.title when neither override nor generatedTitle exists', () => {
    const gallery = makeGallery('AI Title');
    const data = makeData({ title: undefined, links: [] }, undefined);
    applyIdentity(gallery, data);
    expect(gallery.title).toBe('AI Title'); // unchanged
  });

  it('assigns description branding when set', () => {
    const gallery = makeGallery();
    const data = makeData({ description: 'My desc', links: [] });
    applyIdentity(gallery, data);
    expect(gallery.branding?.description).toBe('My desc');
  });

  it('deletes description branding when cleared', () => {
    const gallery = makeGallery();
    gallery.branding = { description: 'Old desc', authorName: 'Jane' };
    const data = makeData({ description: undefined, artistName: 'Jane', links: [] });
    applyIdentity(gallery, data);
    expect(gallery.branding?.description).toBeUndefined();
    // Unrelated field (authorName) not deleted
    expect(gallery.branding?.authorName).toBe('Jane');
  });

  it('assigns authorName branding when set', () => {
    const gallery = makeGallery();
    const data = makeData({ artistName: 'Jane', links: [] });
    applyIdentity(gallery, data);
    expect(gallery.branding?.authorName).toBe('Jane');
  });

  it('deletes authorName branding when cleared (artist removed)', () => {
    const gallery = makeGallery();
    gallery.branding = { authorName: 'OldName' };
    const data = makeData({ artistName: undefined, links: [] });
    applyIdentity(gallery, data);
    expect(gallery.branding?.authorName).toBeUndefined();
  });

  it('sets gallery.artist when artistName is present', () => {
    const gallery = makeGallery();
    const data = makeData({ artistName: 'Jane', links: [] });
    applyIdentity(gallery, data);
    expect(gallery.artist?.name).toBe('Jane');
  });

  it('clears gallery.artist when artistName is removed', () => {
    const gallery = makeGallery();
    gallery.artist = { name: 'OldArtist', links: [] };
    const data = makeData({ artistName: undefined, links: [] });
    applyIdentity(gallery, data);
    expect(gallery.artist).toBeUndefined();
  });

  it('clearing artistName also removes the reserved artist tour stop, so the export re-validates', () => {
    const gallery = makeGallery();
    gallery.artist = { name: 'OldArtist', links: [] };
    // Simulate a prior buildScene run having prepended the reserved intro stop.
    gallery.tour = [
      {
        artworkId: ARTIST_TOUR_ID,
        position: { x: 0, y: 1.6, z: 2 },
        lookAt: { x: 0, y: 1.5, z: 0 },
        label: 'Welcome — OldArtist',
      },
      { position: { x: 3, y: 1.6, z: 2 }, lookAt: { x: 3, y: 1.5, z: 0 }, label: 'Stop 1' },
    ];

    const data = makeData({ artistName: undefined, links: [] });
    applyIdentity(gallery, data);

    expect(gallery.artist).toBeUndefined();
    expect(gallery.tour.map((w) => w.artworkId)).not.toContain(ARTIST_TOUR_ID);
    expect(gallery.tour).toHaveLength(1); // the ordinary stop survives
    // The regression this guards: the exported viewer parses gallery.json on
    // boot, and an orphaned reserved stop fails that parse.
    expect(() => GallerySchema.parse(gallery)).not.toThrow();
  });

  it('keeps the reserved artist tour stop while the artist remains set', () => {
    const gallery = makeGallery();
    gallery.artist = { name: 'Jane', links: [] };
    gallery.tour = [
      {
        artworkId: ARTIST_TOUR_ID,
        position: { x: 0, y: 1.6, z: 2 },
        lookAt: { x: 0, y: 1.5, z: 0 },
        label: 'Welcome — Jane',
      },
    ];

    const data = makeData({ artistName: 'Jane', links: [] });
    applyIdentity(gallery, data);

    expect(gallery.artist?.name).toBe('Jane');
    expect(gallery.tour.map((w) => w.artworkId)).toContain(ARTIST_TOUR_ID);
    expect(() => GallerySchema.parse(gallery)).not.toThrow();
  });

  it('apply → clear → re-apply: no stale fields remain', () => {
    const gallery = makeGallery('AI Title');
    const dataWithOverride = makeData({
      title: 'User Title',
      description: 'User desc',
      artistName: 'Jane',
      links: [{ label: 'Web', url: 'https://jane.example' }],
    }, 'AI Title');
    applyIdentity(gallery, dataWithOverride);
    expect(gallery.title).toBe('User Title');
    expect(gallery.branding?.description).toBe('User desc');
    expect(gallery.artist?.name).toBe('Jane');

    // Clear the override
    const dataCleared = makeData({
      title: undefined,
      description: undefined,
      artistName: undefined,
      links: [],
    }, 'AI Title');
    applyIdentity(gallery, dataCleared);
    expect(gallery.title).toBe('AI Title'); // restored from snapshot
    expect(gallery.branding?.description).toBeUndefined(); // cleared
    expect(gallery.branding?.authorName).toBeUndefined(); // cleared
    expect(gallery.artist).toBeUndefined(); // cleared
  });
});

describe('review identity source-of-truth (§4 takeover regressions)', () => {
  it('keeps a review title edit when the cached gallery is rebuilt', () => {
    const gallery = makeGallery('AI Title');
    const data = makeData({ title: 'Upload title', links: [] }, 'AI Title');
    data.gallery = gallery;

    syncReviewIdentity(data, 'title', 'Review title');
    applyIdentity(gallery, data);

    expect(data.identity?.title).toBe('Review title');
    expect(gallery.title).toBe('Review title');
  });

  it('clearing the review title restores the generated title on cached rebuild', () => {
    const gallery = makeGallery('Old override');
    const data = makeData({ title: 'Old override', links: [] }, 'AI Title');
    data.gallery = gallery;

    syncReviewIdentity(data, 'title', '');
    applyIdentity(gallery, data);

    expect(data.identity?.title).toBeUndefined();
    expect(gallery.title).toBe('AI Title');
  });

  it('preserves an explicit review-description clear instead of reseeding curator text', () => {
    const gallery = makeGallery();
    gallery.branding = { description: 'Curator description' };
    const data = makeData({ links: [] }, 'AI Title');
    data.gallery = gallery;
    data.curatorNote = 'Curator description';

    syncReviewIdentity(data, 'description', '');
    applyIdentity(gallery, data);

    expect(data.identity?.description).toBe('');
    expect(gallery.branding?.description).toBeUndefined();
    expect(shouldSeedCuratorDescription(data)).toBe(false);
  });

  it('still seeds the curator description when the identity field was untouched', () => {
    const data = makeData({ links: [] }, 'AI Title');
    data.gallery = makeGallery();
    data.curatorNote = 'Curator description';
    expect(shouldSeedCuratorDescription(data)).toBe(true);
  });

  it('syncs review artist name, URL, and statement back to upload drafts', () => {
    const gallery = makeGallery();
    gallery.artist = { name: 'Old name', links: [] };
    const data = makeData({ artistName: 'Old name', links: [] }, 'AI Title');
    data.gallery = gallery;

    syncReviewIdentity(data, 'artistName', 'New name');
    syncReviewIdentity(data, 'authorUrl', 'artist.example');
    syncReviewIdentity(data, 'artistStatement', 'New statement');

    expect(data.identity?.artistName).toBe('New name');
    expect(data.identity?.links[0]?.url).toBe('artist.example');
    expect(data.identity?.artistStatement).toBe('New statement');
    expect(gallery.artist).toMatchObject({
      name: 'New name',
      statement: 'New statement',
      links: [{ url: 'https://artist.example' }],
    });
    expect(gallery.branding).toMatchObject({
      authorName: 'New name',
      authorUrl: 'https://artist.example',
    });
  });

  it('recreates the artist after clearing and retyping the review name', () => {
    const gallery = makeGallery();
    gallery.artist = { name: 'Old name', links: [] };
    const data = makeData({ artistName: 'Old name', links: [] }, 'AI Title');
    data.gallery = gallery;

    syncReviewIdentity(data, 'artistName', '');
    expect(gallery.artist).toBeUndefined();

    syncReviewIdentity(data, 'artistName', 'Replacement name');
    expect(gallery.artist?.name).toBe('Replacement name');
    expect(gallery.branding?.authorName).toBe('Replacement name');
  });
});

// ─── buildScene artist waypoint idempotency ───────────────────────────────────

import { buildScene } from '../viewer/room-builder';
import { GallerySchema } from '../schema/gallery.schema';
import sampleGallery from '../demo/sample-gallery.json';

// @vitest-environment jsdom  ← already at top of file

function parsedGallery(): Gallery {
  return GallerySchema.parse(sampleGallery);
}

function galleryWithArtist(name = 'Jane'): Gallery {
  return { ...parsedGallery(), artist: { name, links: [] } };
}

function galleryWithoutArtist(): Gallery {
  const g = parsedGallery();
  delete g.artist;
  return g;
}

describe('buildScene artist waypoint (§4)', () => {
  it('repeated builds with an artist create exactly one artist intro waypoint', () => {
    const gallery = galleryWithArtist();
    buildScene(gallery);
    const afterFirst = gallery.tour.filter((w) => w.artworkId === ARTIST_MESH_ID).length;
    buildScene(gallery);
    const afterSecond = gallery.tour.filter((w) => w.artworkId === ARTIST_MESH_ID).length;
    expect(afterFirst).toBe(1);
    expect(afterSecond).toBe(1); // idempotent — not doubled
  });

  it('rebuilding after artist removal removes the stale artist waypoint', () => {
    const gallery = galleryWithArtist();
    buildScene(gallery); // adds artist waypoint
    expect(gallery.tour.some((w) => w.artworkId === ARTIST_MESH_ID)).toBe(true);

    // Remove artist and rebuild
    gallery.artist = undefined;
    buildScene(gallery);
    expect(gallery.tour.some((w) => w.artworkId === ARTIST_MESH_ID)).toBe(false);
  });

  it('a gallery without an artist never gets an artist waypoint', () => {
    const gallery = galleryWithoutArtist();
    buildScene(gallery);
    expect(gallery.tour.some((w) => w.artworkId === ARTIST_MESH_ID)).toBe(false);
  });

  it('collapses duplicate legacy artist waypoints to exactly one', () => {
    const gallery = galleryWithArtist();
    const template = gallery.tour[0];
    gallery.tour.unshift(
      { ...template, artworkId: ARTIST_MESH_ID, label: 'Old artist stop 1' },
      { ...template, artworkId: ARTIST_MESH_ID, label: 'Old artist stop 2' },
    );

    buildScene(gallery);

    expect(gallery.tour.filter((w) => w.artworkId === ARTIST_MESH_ID)).toHaveLength(1);
  });
});
