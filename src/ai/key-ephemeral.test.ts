// @vitest-environment jsdom
/**
 * key-ephemeral.test.ts — hosted-deployment policy: API keys are NEVER
 * persisted (deploy/vercel-ph branch). Keys live in module memory for one
 * page load; only non-secret settings reach localStorage. Keys persisted by
 * earlier versions are scrubbed on load and never adopted.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { saveWatsonxSettings, loadWatsonxSettings } from './watsonx';
import { saveOpenAISettings, loadOpenAISettings } from './openai-compat';
import { forgetStoredCredentials } from '../ui/app';

beforeEach(() => {
  localStorage.clear();
  forgetStoredCredentials(); // also resets the module-level memory keys
});

describe('watsonx key never persists', () => {
  it('keeps the key out of localStorage while returning it from memory', () => {
    saveWatsonxSettings({
      apiKey: 'wx-secret-123',
      projectId: 'proj-1',
      wxUrl: 'https://us-south.ml.cloud.ibm.com',
      tokenWorkerUrl: '/api/relay',
    });

    const raw = localStorage.getItem('openhall_watsonx')!;
    expect(raw).not.toContain('wx-secret-123');

    const loaded = loadWatsonxSettings()!;
    expect(loaded.apiKey).toBe('wx-secret-123'); // same page load: still usable
    expect(loaded.projectId).toBe('proj-1'); // non-secrets persist
    expect(loaded.tokenWorkerUrl).toBe('/api/relay');
  });

  it('scrubs a key persisted by an earlier version without adopting it', () => {
    localStorage.setItem(
      'openhall_watsonx',
      JSON.stringify({ apiKey: 'legacy-secret', projectId: 'p', wxUrl: 'u', tokenWorkerUrl: '' })
    );

    const loaded = loadWatsonxSettings()!;
    expect(loaded.apiKey).not.toBe('legacy-secret');
    expect(localStorage.getItem('openhall_watsonx')).not.toContain('legacy-secret');
    expect(loaded.projectId).toBe('p'); // non-secrets survive the scrub
  });

  it('forgetStoredCredentials wipes the in-memory key too', () => {
    saveWatsonxSettings({ apiKey: 'wx-secret-456', projectId: 'p', wxUrl: 'u', tokenWorkerUrl: '' });
    forgetStoredCredentials();

    // Re-create stored (non-secret) settings as a fresh page load would see them.
    localStorage.setItem(
      'openhall_watsonx',
      JSON.stringify({ apiKey: '', projectId: 'p', wxUrl: 'u', tokenWorkerUrl: '' })
    );
    expect(loadWatsonxSettings()!.apiKey).toBe('');
  });
});

describe('openai-compat key never persists', () => {
  it('keeps the key out of localStorage while returning it from memory', () => {
    saveOpenAISettings({ apiKey: 'sk-secret-789', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' });

    const raw = localStorage.getItem('openhall_openai')!;
    expect(raw).not.toContain('sk-secret-789');

    const loaded = loadOpenAISettings()!;
    expect(loaded.apiKey).toBe('sk-secret-789');
    expect(loaded.model).toBe('gpt-4o');
  });

  it('scrubs a key persisted by an earlier version without adopting it', () => {
    localStorage.setItem(
      'openhall_openai',
      JSON.stringify({ apiKey: 'legacy-sk', baseUrl: 'b', model: 'm' })
    );

    const loaded = loadOpenAISettings()!;
    expect(loaded.apiKey).not.toBe('legacy-sk');
    expect(localStorage.getItem('openhall_openai')).not.toContain('legacy-sk');
  });

  it('forgetStoredCredentials wipes the in-memory key too', () => {
    saveOpenAISettings({ apiKey: 'sk-secret-000', baseUrl: 'b', model: 'm' });
    forgetStoredCredentials();

    localStorage.setItem('openhall_openai', JSON.stringify({ apiKey: '', baseUrl: 'b', model: 'm' }));
    expect(loadOpenAISettings()!.apiKey).toBe('');
  });
});
