// @vitest-environment jsdom
/**
 * app.cache-key.test.ts — the regeneration-cache fingerprint.
 * Switching AI provider (or OpenAI model) must change the key, otherwise the
 * free "Continue" path silently reuses the old provider's gallery.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { aiInputKey, type AppData } from './app';
import { saveOpenAISettings } from '../ai/openai-compat';

function makeData(): AppData {
  return {
    artworks: [
      {
        id: 'aw-01', filename: 'a.jpg', analysisDataUrl: '', displayObjectUrl: '',
        aspectRatio: 1, title: '', medium: '',
      },
      {
        id: 'aw-02', filename: 'b.jpg', analysisDataUrl: '', displayObjectUrl: '',
        aspectRatio: 1, title: '', medium: '',
      },
    ],
    userBrief: 'A quiet show',
    preset: 'white-cube',
    analyses: [],
    gallery: null,
  };
}

describe('aiInputKey', () => {
  beforeEach(() => localStorage.clear());

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

  it('sorts artwork ids so upload order does not matter', () => {
    const data = makeData();
    const reversed = makeData();
    reversed.artworks.reverse();
    expect(aiInputKey(reversed)).toBe(aiInputKey(data));
  });
});
