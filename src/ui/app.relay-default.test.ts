/**
 * app.relay-default.test.ts — hosted-relay default for the Settings screen
 * (deploy/vercel-ph branch). First-time visitors must get the same-origin
 * relay pre-filled; anything the user saved — including a deliberate blank —
 * must win over the default.
 */

import { describe, expect, it } from 'vitest';
import { HOSTED_RELAY_PATH, initialTokenWorkerUrl } from './app';

describe('initialTokenWorkerUrl', () => {
  it('pre-fills the hosted same-origin relay for first-time visitors', () => {
    expect(initialTokenWorkerUrl(undefined)).toBe(HOSTED_RELAY_PATH);
    expect(HOSTED_RELAY_PATH).toBe('/api/relay');
  });

  it('keeps a saved custom relay URL', () => {
    expect(initialTokenWorkerUrl('https://my-worker.workers.dev')).toBe(
      'https://my-worker.workers.dev'
    );
  });

  it('respects a deliberately blank saved value', () => {
    expect(initialTokenWorkerUrl('')).toBe('');
  });
});
