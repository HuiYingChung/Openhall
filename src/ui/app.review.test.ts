// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GallerySchema } from '../schema/gallery.schema';
import {
  aiInputKey,
  applySuppressedArtworkTitles,
  renderLabels,
  titleSourcesAfterGeneration,
  type AppData,
} from './app';

function makeData(): AppData {
  const gallery = GallerySchema.parse({
    version: '1.0',
    title: 'Review Test',
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
        imagePath: 'placeholder:aw-01',
        title: 'Harbor Quiet',
        medium: 'Oil on canvas',
        label: 'A calm harbor scene.',
      },
    ],
    placements: [],
    tour: [
      {
        artworkId: 'aw-01',
        position: { x: 0, y: 1.6, z: 2 },
        lookAt: { x: 0, y: 1.5, z: 0 },
        label: 'Harbor Quiet',
      },
    ],
  });

  const data: AppData = {
    artworks: [
      {
        id: 'aw-01',
        filename: 'harbor.jpg',
        analysisDataUrl: '',
        displayObjectUrl: '',
        aspectRatio: 1,
        title: '',
        medium: 'Oil on canvas',
      },
    ],
    userBrief: 'Quiet water.',
    preset: 'white-cube',
    analyses: [],
    gallery,
    artworkTitleSources: { 'aw-01': 'ai' },
  };
  data.lastGenKey = aiInputKey(data);
  return data;
}

function render(data: AppData): HTMLElement {
  const root = document.createElement('main');
  document.body.appendChild(root);
  renderLabels(root, data, vi.fn(), () => null, vi.fn());
  return root;
}

describe('review artwork metadata', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('labels AI titles, tracks edits and preserves an explicit clear', () => {
    const data = makeData();
    const root = render(data);

    expect(root.textContent).toContain('AI suggested titles');
    expect(root.querySelector('[data-title-source="aw-01"]')?.textContent).toContain('AI suggestion');

    const title = root.querySelector<HTMLInputElement>('[data-field="title"]')!;
    title.value = 'Artist Revision';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    expect(data.gallery!.artworks[0].title).toBe('Artist Revision');
    expect(data.artworks[0].title).toBe('Artist Revision');
    expect(data.gallery!.tour[0].label).toBe('Artist Revision');
    expect(data.lastGenKey).toBe(aiInputKey(data));
    expect(root.querySelector('[data-title-source="aw-01"]')?.textContent).toContain('Edited by you');

    title.value = '';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    expect(data.gallery!.artworks[0].title).toBe('');
    expect(data.artworks[0].title).toBe('');
    expect(data.suppressedArtworkTitleIds?.has('aw-01')).toBe(true);
    expect(data.gallery!.tour[0].label).toBeUndefined();
    expect(data.lastGenKey).toBe(aiInputKey(data));
    expect(root.querySelector('[data-title-source="aw-01"]')?.textContent).toContain('No title');

    const regenerated = makeData().gallery!;
    applySuppressedArtworkTitles(regenerated, data.suppressedArtworkTitleIds);
    expect(regenerated.artworks[0].title).toBe('');
    expect(regenerated.tour[0].label).toBeUndefined();

    renderLabels(root, data, vi.fn(), () => null, vi.fn());
    expect(root.querySelector<HTMLInputElement>('[data-field="title"]')?.value).toBe('');
    expect(root.textContent).not.toContain('Untitled');
  });

  it('deletes medium when the optional field is cleared', () => {
    const data = makeData();
    const root = render(data);
    const medium = root.querySelector<HTMLInputElement>('[data-field="medium"]')!;

    expect(medium.placeholder).toContain('optional');
    medium.value = '';
    medium.dispatchEvent(new Event('input', { bubbles: true }));

    expect(data.gallery!.artworks[0].medium).toBeUndefined();
    expect(data.artworks[0].medium).toBe('');
    expect(data.lastGenKey).toBe(aiInputKey(data));
  });

  it('sets and clears the optional year without touching the cache key', () => {
    const data = makeData();
    const root = render(data);
    const year = root.querySelector<HTMLInputElement>('[data-field="year"]')!;

    expect(year.placeholder).toContain('optional');
    year.value = '1999';
    year.dispatchEvent(new Event('input', { bubbles: true }));
    expect(data.gallery!.artworks[0].year).toBe(1999);
    expect(data.artworks[0].year).toBe(1999);
    expect(data.lastGenKey).toBe(aiInputKey(data));

    year.value = '';
    year.dispatchEvent(new Event('input', { bubbles: true }));
    expect(data.gallery!.artworks[0].year).toBeUndefined();
    expect(data.artworks[0].year).toBeUndefined();
    expect(data.lastGenKey).toBe(aiInputKey(data));

    // type="text" (spinner removed) admits raw non-numeric input — it must
    // never reach the gallery contract as NaN.
    year.value = 'abc';
    year.dispatchEvent(new Event('input', { bubbles: true }));
    expect(data.gallery!.artworks[0].year).toBeUndefined();
    expect(data.artworks[0].year).toBeUndefined();
  });

  it('does not claim a user-provided title was AI-suggested', () => {
    const data = makeData();
    data.artworks[0].title = 'Artist Title';
    data.gallery!.artworks[0].title = 'Artist Title';
    data.artworkTitleSources = {};
    const root = render(data);

    expect(root.querySelector('[data-title-source="aw-01"]')).toBeNull();
    expect(root.textContent).not.toContain('AI suggested titles');
  });

  it('preserves AI-title provenance states across a later generation', () => {
    const data = makeData();
    data.artworkTitleSources = { 'aw-01': 'none' };
    data.suppressedArtworkTitleIds = new Set(['aw-01']);

    expect(titleSourcesAfterGeneration(
      data.artworks,
      data.artworkTitleSources,
      data.suppressedArtworkTitleIds
    )).toEqual({ 'aw-01': 'none' });
  });
});
