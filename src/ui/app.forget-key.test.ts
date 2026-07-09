// @vitest-environment jsdom
/**
 * app.forget-key.test.ts — the shared-computer escape hatch.
 * forgetStoredCredentials() must leave nothing key-like in localStorage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { forgetStoredCredentials } from './app';

describe('forgetStoredCredentials', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes both provider settings and the provider choice', () => {
    localStorage.setItem('openhall_watsonx', JSON.stringify({ apiKey: 'k', projectId: 'p', wxUrl: 'u', tokenWorkerUrl: 'w' }));
    localStorage.setItem('openhall_openai', JSON.stringify({ apiKey: 'sk', baseUrl: 'b', model: 'm' }));
    localStorage.setItem('openhall_provider', 'watsonx');

    forgetStoredCredentials();

    expect(localStorage.getItem('openhall_watsonx')).toBeNull();
    expect(localStorage.getItem('openhall_openai')).toBeNull();
    expect(localStorage.getItem('openhall_provider')).toBeNull();
  });

  it('is a safe no-op when nothing is stored', () => {
    expect(() => forgetStoredCredentials()).not.toThrow();
    expect(localStorage.getItem('openhall_watsonx')).toBeNull();
  });
});
