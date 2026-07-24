// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderUpload, type AppData } from './app';

function makeData(userBrief: string): AppData {
  return {
    artworks: [],
    userBrief,
    preset: 'white-cube',
    analyses: [],
    gallery: null,
  };
}

describe('renderUpload', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  it('round-trips a saved brief without allowing textarea breakout markup', () => {
    const root = document.createElement('main');
    const payload = '</textarea><img src=x onerror="globalThis.pwned=true">';

    renderUpload(root, makeData(payload), vi.fn(), vi.fn(), vi.fn());

    expect((root.querySelector('#oh-brief') as HTMLTextAreaElement).value).toBe(payload);
    expect(root.querySelector('img[src="x"]')).toBeNull();
  });

  it('explains optional artwork title and medium before upload', () => {
    const root = document.createElement('main');

    renderUpload(root, makeData('A quiet show'), vi.fn(), vi.fn(), vi.fn());

    expect(root.textContent).toContain('leave it blank for an AI suggestion');
    expect(root.textContent).toContain('Medium and year are optional');
  });

  // Keyless exploring (hosted policy): the whole upload screen works without
  // an API key; the Generate button says so and routes to Settings instead of
  // starting a generation.
  it('without a key, Generate becomes "Add API key" and routes to Settings', () => {
    const root = document.createElement('main');
    const data = makeData('A quiet show');
    data.artworks = [
      {
        id: 'aw-01',
        filename: 'a.jpg',
        analysisDataUrl: 'data:image/jpeg;base64,x',
        displayObjectUrl: 'blob:fake',
        aspectRatio: 1,
        title: '',
        medium: '',
      },
    ];
    const onGenerate = vi.fn();
    const onSettings = vi.fn();

    renderUpload(root, data, onGenerate, onSettings, vi.fn());

    const btn = root.querySelector('#oh-generate-btn') as HTMLButtonElement;
    expect(btn.textContent).toContain('Add API key to generate');
    expect(root.textContent).toContain('Everything else here works without one');

    btn.click();
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(onGenerate).not.toHaveBeenCalled();
  });
});
