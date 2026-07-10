// @vitest-environment jsdom
/**
 * app.cache-key.test.ts — the regeneration-cache fingerprint.
 * Switching AI provider (or OpenAI model) must change the key, otherwise the
 * free "Continue" path silently reuses the old provider's gallery.
 *
 * Upload order IS preserved in the key because the curation prompt receives
 * artworks in array order and uses that order for grouping decisions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addThumbnail, aiInputKey, type AppData } from './app';
import { saveOpenAISettings } from '../ai/openai-compat';
import { _resetArtworkIdAllocator, allocateArtworkId } from './image-utils';

function makeData(): AppData {
  return {
    artworks: [
      {
        id: 'aw-01', filename: 'a.jpg', analysisDataUrl: '', displayObjectUrl: '',
        aspectRatio: 1, title: '', medium: '', contentHash: 'hash-a',
      },
      {
        id: 'aw-02', filename: 'b.jpg', analysisDataUrl: '', displayObjectUrl: '',
        aspectRatio: 1, title: '', medium: '', contentHash: 'hash-b',
      },
    ],
    userBrief: 'A quiet show',
    preset: 'white-cube',
    analyses: [],
    gallery: null,
  };
}

describe('aiInputKey', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetArtworkIdAllocator();
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(), writable: true, configurable: true,
    });
  });

  it('is stable for identical inputs', () => {
    const data = makeData();
    expect(aiInputKey(data)).toBe(aiInputKey(makeData()));
  });

  it('changes when artworks, brief, or preset change', () => {
    const base = aiInputKey(makeData());
    const fewer = makeData();
    fewer.artworks.pop();
    expect(aiInputKey(fewer)).not.toBe(base);
    const otherBrief = makeData();
    otherBrief.userBrief = 'A loud show';
    expect(aiInputKey(otherBrief)).not.toBe(base);
    const otherPreset = makeData();
    otherPreset.preset = 'warm-wood';
    expect(aiInputKey(otherPreset)).not.toBe(base);
  });

  it('changes when the provider changes', () => {
    const data = makeData();
    localStorage.setItem('openhall_provider', 'watsonx');
    const wxKey = aiInputKey(data);
    localStorage.setItem('openhall_provider', 'openai');
    expect(aiInputKey(data)).not.toBe(wxKey);
  });

  it('changes when the OpenAI model changes', () => {
    const data = makeData();
    localStorage.setItem('openhall_provider', 'openai');
    saveOpenAISettings({ apiKey: 'k', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' });
    const k4o = aiInputKey(data);
    saveOpenAISettings({ apiKey: 'k', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1' });
    expect(aiInputKey(data)).not.toBe(k4o);
  });

  it('ignores the OpenAI model while watsonx is selected', () => {
    const data = makeData();
    localStorage.setItem('openhall_provider', 'watsonx');
    saveOpenAISettings({ apiKey: 'k', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' });
    const before = aiInputKey(data);
    saveOpenAISettings({ apiKey: 'k', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1' });
    expect(aiInputKey(data)).toBe(before);
  });

  // Upload order is preserved: the curation prompt receives artworks in array
  // order and that order influences how rooms are grouped (pipeline-order-sensitive).
  it('upload order is preserved — reversing the array produces a different key', () => {
    const data = makeData();
    const reversed = makeData();
    reversed.artworks.reverse();
    expect(aiInputKey(reversed)).not.toBe(aiInputKey(data));
  });

  // ─── §1 regression tests ───────────────────────────────────────────────────

  // 1. Same ids but different image fingerprints produce different keys.
  it('[§1.1] same ids but different contentHash produces a different key', () => {
    const base = aiInputKey(makeData());
    const changed = makeData();
    changed.artworks[0].contentHash = 'hash-totally-different';
    expect(aiInputKey(changed)).not.toBe(base);
  });

  // 2a. Title is free display metadata and does not invalidate AI output.
  it('[§1.2a] title change does not change the key', () => {
    const base = aiInputKey(makeData());
    const changed = makeData();
    changed.artworks[0].title = 'New Title';
    expect(aiInputKey(changed)).toBe(base);
  });

  // 2b. Medium is optional display metadata and does not invalidate AI output.
  it('[§1.2b] medium change does not change the key', () => {
    const base = aiInputKey(makeData());
    const changed = makeData();
    changed.artworks[0].medium = 'Watercolour';
    expect(aiInputKey(changed)).toBe(base);
  });

  it('treats whitespace-only title and medium as blank metadata', () => {
    const blank = makeData();
    const whitespace = makeData();
    whitespace.artworks[0].title = '   ';
    whitespace.artworks[0].medium = '  \n ';

    expect(aiInputKey(whitespace)).toBe(aiInputKey(blank));
  });

  // 2c. Year is optional display metadata and does not invalidate AI output.
  it('[§1.2c] year change does not change the key', () => {
    const base = aiInputKey(makeData());
    const changed = makeData();
    changed.artworks[0].year = 2023;
    expect(aiInputKey(changed)).toBe(base);
  });

  // 3. Identity/branding-only edits do NOT change the key.
  it('[§1.3] identity-only edits do not change the key', () => {
    const base = makeData();
    const withIdv = makeData();
    withIdv.identity = {
      title: 'My Override',
      description: 'Something',
      artistName: 'Jane',
      artistStatement: 'I paint.',
      portraitObjectUrl: 'blob:fake',
      links: [{ label: 'Web', url: 'https://jane.example' }],
    };
    expect(aiInputKey(withIdv)).toBe(aiInputKey(base));
  });

  // 4a. Delete-middle-then-add: new id must not duplicate any live id.
  it('[§1.4a] delete-middle-then-add does not duplicate a live id', () => {
    _resetArtworkIdAllocator(1);
    // Simulate: allocate 3 ids, delete middle, allocate 1 more
    const id1 = allocateArtworkId(); // aw-01
    const id2 = allocateArtworkId(); // aw-02 (will be deleted)
    const id3 = allocateArtworkId(); // aw-03
    const liveIds = new Set([id1, id3]);
    // Delete middle (id2) from live set — allocate a new one
    const id4 = allocateArtworkId(); // aw-04
    expect(liveIds.has(id4)).toBe(false); // no collision with remaining live ids
    expect(id4).not.toBe(id2); // and not the same as the deleted one either
  });

  // 4b. Delete-last-then-add: new id must not equal the deleted one.
  it('[§1.4b] delete-last-then-add never duplicates a live id', () => {
    _resetArtworkIdAllocator(10);
    const id10 = allocateArtworkId(); // aw-10 (deleted)
    const id11 = allocateArtworkId(); // aw-11 (new)
    expect(id11).not.toBe(id10);
  });

  // 5. Replacing last image with different bytes cannot enter the "Continue" path.
  it('[§1.5] replacing the last image with different bytes invalidates the cache', () => {
    const data = makeData();
    data.gallery = { version: '1.0', title: 'X', rooms: [] as never, artworks: [], placements: [], tour: [] };
    data.lastGenKey = aiInputKey(data);

    // Same ids, same everything, but a different contentHash (different bytes)
    const replaced = makeData();
    replaced.artworks[1].contentHash = 'hash-completely-different';
    expect(aiInputKey(replaced)).not.toBe(data.lastGenKey);
  });

  // 6. Removing the final artwork produces a different key (disables "Continue").
  it('[§1.6] removing the final artwork produces a different key', () => {
    const withTwo = aiInputKey(makeData());
    const withOne = makeData();
    withOne.artworks.pop();
    expect(aiInputKey(withOne)).not.toBe(withTwo);
  });

  it('ignores punctuation inside free display metadata', () => {
    const first = makeData();
    first.artworks[0].title = 'a:b';
    first.artworks[0].medium = 'c|d';
    const second = makeData();
    second.artworks[0].title = 'a';
    second.artworks[0].medium = 'b:c|d';
    expect(aiInputKey(first)).toBe(aiInputKey(second));
  });
});

describe('addThumbnail cache-state notifications', () => {
  it('notifies when artwork metadata changes so the paid/free hint refreshes', () => {
    const data = makeData();
    const grid = document.createElement('div');
    const onDataChange = vi.fn();
    addThumbnail(grid, data.artworks[0], data, onDataChange);

    const title = grid.querySelector<HTMLInputElement>('[data-field="title"]')!;
    const medium = grid.querySelector<HTMLInputElement>('[data-field="medium"]')!;
    expect(title.placeholder).toContain('optional');
    expect(medium.placeholder).toContain('optional');
    title.value = 'Changed title';
    title.dispatchEvent(new Event('input', { bubbles: true }));

    expect(data.artworks[0].title).toBe('Changed title');
    expect(onDataChange).toHaveBeenCalledOnce();
  });

  it('folds metadata edits into a cached gallery without changing the AI key', () => {
    const data = makeData();
    data.analyses = [
      {
        artworkId: 'aw-01',
        suggestedTitle: 'AI Harbor',
        style: 'photography',
        palette: ['#112233'],
        subject: 'harbor',
        mood: 'quiet',
        description: 'A quiet harbor.',
      },
    ];
    data.gallery = {
      version: '1.0',
      title: 'Cached Gallery',
      rooms: [],
      artworks: [
        { id: 'aw-01', imagePath: 'images/aw-01.jpg', title: 'AI Harbor', label: 'Label.' },
      ],
      placements: [],
      tour: [
        {
          artworkId: 'aw-01',
          position: { x: 0, y: 1.6, z: 2 },
          lookAt: { x: 0, y: 1.5, z: 0 },
          label: 'AI Harbor',
        },
      ],
    };
    data.lastGenKey = aiInputKey(data);
    const grid = document.createElement('div');
    addThumbnail(grid, data.artworks[0], data);

    const title = grid.querySelector<HTMLInputElement>('[data-field="title"]')!;
    const medium = grid.querySelector<HTMLInputElement>('[data-field="medium"]')!;
    const year = grid.querySelector<HTMLInputElement>('[data-field="year"]')!;
    title.value = 'Artist Harbor';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    medium.value = 'Ink';
    medium.dispatchEvent(new Event('input', { bubbles: true }));
    year.value = '2024';
    year.dispatchEvent(new Event('input', { bubbles: true }));

    expect(data.gallery.artworks[0]).toMatchObject({
      title: 'Artist Harbor',
      medium: 'Ink',
      year: 2024,
    });
    expect(data.gallery.tour[0].label).toBe('Artist Harbor');
    expect(aiInputKey(data)).toBe(data.lastGenKey);

    title.value = '';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    expect(data.gallery.artworks[0].title).toBe('AI Harbor');
    expect(data.artworkTitleSources?.['aw-01']).toBe('ai');
  });

  it('removes the final artwork, revokes its URL, and notifies the UI', () => {
    const data = makeData();
    data.artworks = [{ ...data.artworks[0], displayObjectUrl: 'blob:display' }];
    const grid = document.createElement('div');
    const onDataChange = vi.fn();
    addThumbnail(grid, data.artworks[0], data, onDataChange);

    grid.querySelector<HTMLButtonElement>('[data-remove]')!.click();

    expect(data.artworks).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:display');
    expect(onDataChange).toHaveBeenCalledOnce();
  });
});
