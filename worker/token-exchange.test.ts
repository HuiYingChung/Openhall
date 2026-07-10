import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { resolveCorsPolicy } from './token-exchange';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('resolveCorsPolicy', () => {
  it('uses local-development origins when configuration is blank', () => {
    expect(resolveCorsPolicy('http://localhost:5173', '')).toEqual({
      allowed: true,
      responseOrigin: 'http://localhost:5173',
    });
    expect(resolveCorsPolicy('https://untrusted.example', '')).toEqual({ allowed: false });
  });

  it('requires an exact configured origin but supports an explicit wildcard', () => {
    expect(resolveCorsPolicy('https://gallery.example', 'https://gallery.example')).toEqual({
      allowed: true,
      responseOrigin: 'https://gallery.example',
    });
    expect(resolveCorsPolicy('https://gallery.example.evil', 'https://gallery.example')).toEqual({
      allowed: false,
    });
    expect(resolveCorsPolicy('https://gallery.example', '*').allowed).toBe(true);
  });

  it('allows requests without Origin because CORS is not authentication', () => {
    expect(resolveCorsPolicy('', 'https://gallery.example')).toEqual({ allowed: true });
  });
});

describe('token worker browser-origin enforcement', () => {
  it('answers an allowed preflight with the exact origin and Vary header', async () => {
    const response = await worker.fetch(new Request('https://worker.example/token', {
      method: 'OPTIONS',
      headers: { Origin: 'https://gallery.example' },
    }), { ALLOWED_ORIGINS: 'https://gallery.example' });

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://gallery.example');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('rejects a disallowed browser request before contacting IBM', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch');
    const response = await worker.fetch(new Request('https://worker.example/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
      body: JSON.stringify({ apiKey: 'not-sent-upstream' }),
    }), { ALLOWED_ORIGINS: 'https://gallery.example' });

    expect(response.status).toBe(403);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(upstream).not.toHaveBeenCalled();
  });
});
