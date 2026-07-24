import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST, originAllowed, resolveRoute } from './[...path].ts';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('resolveRoute', () => {
  it('maps the token routes', () => {
    expect(resolveRoute('/api/relay/token')).toEqual({ kind: 'token' });
    expect(resolveRoute('/api/relay')).toEqual({ kind: 'token' });
    expect(resolveRoute('/api/relay/')).toEqual({ kind: 'token' });
  });

  it('maps proxy routes to the upstream path, preserving depth', () => {
    expect(resolveRoute('/api/relay/proxy/ml/v1/text/chat')).toEqual({
      kind: 'proxy',
      upstreamPath: '/ml/v1/text/chat',
    });
  });

  it('rejects anything else', () => {
    expect(resolveRoute('/api/relay/other')).toEqual({ kind: 'unknown' });
    expect(resolveRoute('/api/relay/proxy')).toEqual({ kind: 'unknown' });
  });
});

describe('originAllowed', () => {
  it('allows requests without Origin because Origin is not authentication', () => {
    expect(originAllowed(null, 'openhall.vercel.app')).toBe(true);
  });

  it('allows only the same-origin browser caller', () => {
    expect(originAllowed('https://openhall.vercel.app', 'openhall.vercel.app')).toBe(true);
    expect(originAllowed('https://evil.example', 'openhall.vercel.app')).toBe(false);
    expect(originAllowed('not-a-url', 'openhall.vercel.app')).toBe(false);
  });
});

describe('POST handler', () => {
  it('rejects a cross-site browser request before contacting IBM', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch');
    const response = await POST(
      new Request('https://openhall.vercel.app/api/relay/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
        body: JSON.stringify({ apiKey: 'not-sent-upstream' }),
      })
    );
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies up front', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch');
    const response = await POST(
      new Request('https://openhall.vercel.app/api/relay/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(7 * 1024 * 1024) },
        body: JSON.stringify({ apiKey: 'k' }),
      })
    );
    expect(response.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('requires an apiKey for the token route', async () => {
    const response = await POST(
      new Request('https://openhall.vercel.app/api/relay/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    expect(response.status).toBe(400);
  });

  it('forwards proxy calls only to the allowlisted watsonx host, with no-store', async () => {
    const upstream = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const response = await POST(
      new Request('https://openhall.vercel.app/api/relay/proxy/ml/v1/text/chat?version=2024-05-31', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
        body: JSON.stringify({ prompt: 'hi' }),
      })
    );
    expect(upstream).toHaveBeenCalledTimes(1);
    const calledUrl = upstream.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=2024-05-31');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 404 for unknown relay paths without contacting anything', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch');
    const response = await POST(
      new Request('https://openhall.vercel.app/api/relay/other', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    );
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});
