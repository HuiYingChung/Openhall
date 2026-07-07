// @vitest-environment jsdom
/**
 * app.links.test.ts — artist link normalisation.
 * Users often type bare domains or omit labels; these must still render.
 */

import { describe, it, expect } from 'vitest';
import { normalizeUrl, cleanArtistLinks } from './app';

describe('normalizeUrl', () => {
  it('keeps full http(s) URLs unchanged', () => {
    expect(normalizeUrl('https://jane.example/x')).toBe('https://jane.example/x');
    expect(normalizeUrl('http://jane.example')).toBe('http://jane.example');
  });

  it('prepends https:// to a bare domain', () => {
    expect(normalizeUrl('instagram.com/jane')).toBe('https://instagram.com/jane');
    expect(normalizeUrl('www.jane.example')).toBe('https://www.jane.example');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  jane.example  ')).toBe('https://jane.example');
  });

  it('rejects non-URL text and empty input', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('just some words')).toBe('');
    expect(normalizeUrl('nodomain')).toBe('');
  });
});

describe('cleanArtistLinks', () => {
  it('normalises URLs and drops rows without a usable address', () => {
    const out = cleanArtistLinks([
      { label: 'IG', url: 'instagram.com/jane' },
      { label: '', url: '' },
      { label: 'Bad', url: 'not a url' },
    ]);
    expect(out).toEqual([{ label: 'IG', url: 'https://instagram.com/jane' }]);
  });

  it('derives a label from the host when the label is blank', () => {
    const out = cleanArtistLinks([{ label: '', url: 'https://www.jane.example/portfolio' }]);
    expect(out).toEqual([{ label: 'jane.example', url: 'https://www.jane.example/portfolio' }]);
  });
});
