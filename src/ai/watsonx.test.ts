// @vitest-environment jsdom
/**
 * watsonx.test.ts — §5 regression tests for Watsonx token cache credential binding.
 *
 * All tests mock fetch to avoid real network calls.
 * API keys must never appear in thrown messages or logs — verified by tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadWatsonxSettings,
  saveWatsonxSettings,
  invalidateToken,
  WatsonxProvider,
  type WatsonxSettings,
} from './watsonx';
import { forgetStoredCredentials } from '../ui/app';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSettings(overrides: Partial<WatsonxSettings> = {}): WatsonxSettings {
  return {
    apiKey: 'sk-test-key-account-A',
    projectId: 'project-A',
    wxUrl: 'https://us-south.ml.cloud.ibm.com',
    tokenWorkerUrl: '',
    ...overrides,
  };
}

function makeTokenResponse(token = 'tok-A', expiresIn = 3600) {
  return {
    status: 200,
    json: async () => ({ access_token: token, expires_in: expiresIn }),
    ok: true,
    text: async () => '',
  };
}

function makeChatResponse() {
  return {
    status: 200,
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"value": "x"}' }, finish_reason: 'stop' }],
    }),
    text: async () => '',
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  invalidateToken(); // start each test with a clean cache
  vi.restoreAllMocks();
});

describe('Watsonx token cache (§5)', () => {
  it('same settings reuse a valid cached token without a new IAM call', async () => {
    const settings = makeSettings();
    saveWatsonxSettings(settings);

    // Reset cache that saveWatsonxSettings just invalidated
    invalidateToken();

    let iamCallCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('iam.cloud.ibm.com')) {
        iamCallCount++;
        return makeTokenResponse('tok-A') as unknown as Response;
      }
      return makeChatResponse() as unknown as Response;
    });

    const provider = new WatsonxProvider(settings);
    // Two calls with same settings — only one IAM call expected
    await provider.analyzeArtwork({
      id: 'aw-01', filename: 'a.jpg', analysisDataUrl: 'data:image/jpeg;base64,/9j/',
      displayObjectUrl: '', aspectRatio: 1, title: '', medium: '',
    }).catch(() => {}); // allow validation failure from mock response
    await provider.analyzeArtwork({
      id: 'aw-01', filename: 'a.jpg', analysisDataUrl: 'data:image/jpeg;base64,/9j/',
      displayObjectUrl: '', aspectRatio: 1, title: '', medium: '',
    }).catch(() => {});

    expect(iamCallCount).toBe(1); // token was reused
  });

  it('changed credentials cause a new IAM call (different apiKey)', async () => {
    // Settings A token call
    const settingsA = makeSettings({ apiKey: 'sk-account-A-xxxxxxxx' });
    invalidateToken();

    let iamCallCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('iam.cloud.ibm.com')) {
        iamCallCount++;
        return makeTokenResponse(`tok-${iamCallCount}`) as unknown as Response;
      }
      return makeChatResponse() as unknown as Response;
    });

    const providerA = new WatsonxProvider(settingsA);
    await providerA.analyzeArtwork({
      id: 'aw-01', filename: 'a.jpg', analysisDataUrl: 'data:image/jpeg;base64,/9j/',
      displayObjectUrl: '', aspectRatio: 1, title: '', medium: '',
    }).catch(() => {});
    expect(iamCallCount).toBe(1);

    // Different apiKey — cache should not be reused
    const settingsB = makeSettings({ apiKey: 'sk-account-B-yyyyyyyy' });
    const providerB = new WatsonxProvider(settingsB);
    await providerB.analyzeArtwork({
      id: 'aw-01', filename: 'a.jpg', analysisDataUrl: 'data:image/jpeg;base64,/9j/',
      displayObjectUrl: '', aspectRatio: 1, title: '', medium: '',
    }).catch(() => {});
    expect(iamCallCount).toBe(2); // new IAM call for different key
  });

  it('saveWatsonxSettings invalidates the cached token', async () => {
    const settings = makeSettings({ apiKey: 'sk-account-A-xxxxxxxx' });
    invalidateToken();

    let iamCallCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('iam.cloud.ibm.com')) {
        iamCallCount++;
        return makeTokenResponse(`tok-${iamCallCount}`) as unknown as Response;
      }
      return makeChatResponse() as unknown as Response;
    });

    const provider = new WatsonxProvider(settings);
    await provider.analyzeArtwork({
      id: 'aw-01', filename: 'a.jpg', analysisDataUrl: 'data:image/jpeg;base64,/9j/',
      displayObjectUrl: '', aspectRatio: 1, title: '', medium: '',
    }).catch(() => {});
    expect(iamCallCount).toBe(1);

    // Save new settings — should invalidate the token
    saveWatsonxSettings({ ...settings, projectId: 'project-B' });

    await provider.analyzeArtwork({
      id: 'aw-01', filename: 'a.jpg', analysisDataUrl: 'data:image/jpeg;base64,/9j/',
      displayObjectUrl: '', aspectRatio: 1, title: '', medium: '',
    }).catch(() => {});
    expect(iamCallCount).toBe(2); // forced new IAM call after saveWatsonxSettings
  });

  it('forgetStoredCredentials invalidates the in-memory token', async () => {
    const settings = makeSettings({ apiKey: 'sk-account-A-xxxxxxxx' });
    invalidateToken();

    let iamCallCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('iam.cloud.ibm.com')) {
        iamCallCount++;
        return makeTokenResponse(`tok-${iamCallCount}`) as unknown as Response;
      }
      return makeChatResponse() as unknown as Response;
    });

    const provider = new WatsonxProvider(settings);
    await provider.analyzeArtwork({
      id: 'aw-01', filename: 'a.jpg', analysisDataUrl: 'data:image/jpeg;base64,/9j/',
      displayObjectUrl: '', aspectRatio: 1, title: '', medium: '',
    }).catch(() => {});
    expect(iamCallCount).toBe(1);

    // Forget credentials — should purge the in-memory token
    forgetStoredCredentials();

    await provider.analyzeArtwork({
      id: 'aw-01', filename: 'a.jpg', analysisDataUrl: 'data:image/jpeg;base64,/9j/',
      displayObjectUrl: '', aspectRatio: 1, title: '', medium: '',
    }).catch(() => {});
    expect(iamCallCount).toBe(2); // new IAM call after forget
  });

  it('a 401 response invalidates the token', async () => {
    const settings = makeSettings({ apiKey: 'sk-account-A-xxxxxxxx' });
    invalidateToken();

    let iamCallCount = 0;
    let mlCallCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('iam.cloud.ibm.com')) {
        iamCallCount++;
        return makeTokenResponse(`tok-${iamCallCount}`) as unknown as Response;
      }
      mlCallCount++;
      if (mlCallCount === 1) {
        // First ML call returns 401
        return { status: 401, ok: false, text: async () => 'Unauthorized' } as unknown as Response;
      }
      return makeChatResponse() as unknown as Response;
    });

    const provider = new WatsonxProvider(settings);
    // The first call will get a 401 — invalidateToken() is called inside chat()
    await provider.analyzeArtwork({
      id: 'aw-01', filename: 'a.jpg', analysisDataUrl: 'data:image/jpeg;base64,/9j/',
      displayObjectUrl: '', aspectRatio: 1, title: '', medium: '',
    }).catch(() => {}); // expected to fail due to 401

    // Second call should fetch a new token (not reuse the invalidated one)
    await provider.analyzeArtwork({
      id: 'aw-01', filename: 'a.jpg', analysisDataUrl: 'data:image/jpeg;base64,/9j/',
      displayObjectUrl: '', aspectRatio: 1, title: '', medium: '',
    }).catch(() => {});

    expect(iamCallCount).toBe(2); // token refetched after 401
  });

  it('credentials do not appear in thrown error messages', async () => {
    const settings = makeSettings({ apiKey: 'sk-MY-SECRET-KEY-xxxxxxxx' });
    invalidateToken();

    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('iam.cloud.ibm.com')) {
        return { status: 400, ok: false, text: async () => 'Bad Request' } as unknown as Response;
      }
      return makeChatResponse() as unknown as Response;
    });

    const provider = new WatsonxProvider(settings);
    let thrownMessage = '';
    try {
      await provider.analyzeArtwork({
        id: 'aw-01', filename: 'a.jpg', analysisDataUrl: 'data:image/jpeg;base64,/9j/',
        displayObjectUrl: '', aspectRatio: 1, title: '', medium: '',
      });
    } catch (e) {
      thrownMessage = String(e);
    }
    // The full API key must not appear in thrown error messages
    expect(thrownMessage).not.toContain('sk-MY-SECRET-KEY-xxxxxxxx');
    expect(thrownMessage.length).toBeGreaterThan(0); // some error was thrown
  });
});
