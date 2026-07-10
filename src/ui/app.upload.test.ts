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
});
