// @vitest-environment jsdom
/**
 * image-utils.test.ts — §2 regression tests for bounded display/export images.
 *
 * jsdom does not implement HTMLCanvasElement painting, so we stub canvas,
 * Image, and URL.createObjectURL. Tests verify dimension fitting and failure
 * paths deterministically.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  computeContentFingerprint,
  createDisplayBlobUrl,
  fitDimensions,
  generateFaviconFromFile,
} from './image-utils';

describe('fit dimensions (§2 dimension contract)', () => {
  it('landscape image larger than max is scaled down', () => {
    const r = fitDimensions(4000, 2000, 2048);
    expect(r.width).toBe(2048);
    expect(r.height).toBe(1024);
  });

  it('portrait image larger than max is scaled down', () => {
    const r = fitDimensions(1000, 5000, 2048);
    expect(r.width).toBe(Math.round(2048 * (1000 / 5000)));
    expect(r.height).toBe(2048);
  });

  it('image already within bounds is not upscaled', () => {
    const r = fitDimensions(800, 600, 2048);
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
  });

  it('square image at exactly max is not changed', () => {
    const r = fitDimensions(2048, 2048, 2048);
    expect(r.width).toBe(2048);
    expect(r.height).toBe(2048);
  });
});

// ─── Canvas & URL stubs ────────────────────────────────────────────────────

let lastCanvasWidth = 0;
let lastCanvasHeight = 0;
let toBlobShouldFail = false;

// Natural dimensions used by the current Image stub
let stubNW = 800;
let stubNH = 600;
let stubShouldFail = false;

// We need URL.createObjectURL defined in jsdom; assign simple stubs.
const revokedUrls: string[] = [];
let urlCounter = 0;

beforeEach(() => {
  lastCanvasWidth = 0;
  lastCanvasHeight = 0;
  toBlobShouldFail = false;
  stubNW = 800;
  stubNH = 600;
  stubShouldFail = false;
  revokedUrls.length = 0;
  urlCounter = 0;

  // Define or reassign URL stubs (jsdom may not have these)
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => `blob:stub-${urlCounter++}`),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn((url: string) => revokedUrls.push(url)),
    writable: true,
    configurable: true,
  });

  // Stub document.createElement('canvas')
  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...rest: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- why: jsdom createElement signature variance
    if (tag !== 'canvas') return origCreateElement(tag, ...(rest as [any?]));
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({ drawImage: vi.fn() }),
      toBlob: vi.fn((cb: (b: Blob | null) => void) => {
        // Capture canvas dimensions at time of toBlob call
        lastCanvasWidth = (canvas as { width: number }).width;
        lastCanvasHeight = (canvas as { height: number }).height;
        if (toBlobShouldFail) cb(null);
        else cb(new Blob(['fake'], { type: 'image/jpeg' }));
      }),
      toDataURL: vi.fn(() => 'data:image/png;base64,favicon'),
    };
    return canvas as unknown as HTMLCanvasElement;
  });

  // Stub Image constructor to fire onload/onerror async using a real jsdom element
  vi.spyOn(globalThis, 'Image').mockImplementation(() => {
    const img = document.createElement('img');
    Object.defineProperty(img, 'naturalWidth', { value: stubNW, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: stubNH, configurable: true });
    // Override src to intercept and fire events
    const origSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(img, 'src', {
      set(_url: string) {
        if (stubShouldFail) {
          setTimeout(() => img.onerror?.(new Event('error')), 0);
        } else {
          setTimeout(() => img.onload?.(new Event('load')), 0);
        }
      },
      get() { return origSrcDescriptor?.get?.call(this) ?? ''; },
      configurable: true,
    });
    return img as HTMLImageElement;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeFile(name = 'art.jpg', type = 'image/jpeg'): File {
  return new File(['x'.repeat(100)], name, { type });
}

describe('createDisplayBlobUrl (§2 display-copy path)', () => {
  it('returns a blob: URL (not the original file URL)', async () => {
    const url = await createDisplayBlobUrl(makeFile(), 2048);
    expect(url).toMatch(/^blob:stub-/);
  });

  it('revokes the temporary load URL after loading', async () => {
    // createObjectURL is called twice: temp load URL then final display blob
    const url = await createDisplayBlobUrl(makeFile(), 2048);
    // The first blob URL (temp load) must have been revoked
    expect(revokedUrls).toContain('blob:stub-0');
    // The returned URL (display blob) must NOT have been revoked
    expect(revokedUrls).not.toContain(url);
  });

  it('landscape 4000x2000: canvas is sized to 2048x1024 (bounded, aspect-correct)', async () => {
    stubNW = 4000; stubNH = 2000;
    await createDisplayBlobUrl(makeFile(), 2048);
    expect(lastCanvasWidth).toBe(2048);
    expect(lastCanvasHeight).toBe(1024);
  });

  it('portrait 1000x5000: canvas height is 2048, width is proportional', async () => {
    stubNW = 1000; stubNH = 5000;
    await createDisplayBlobUrl(makeFile(), 2048);
    expect(lastCanvasHeight).toBe(2048);
    expect(lastCanvasWidth).toBe(Math.round(2048 * (1000 / 5000)));
  });

  it('small 800x600 image is NOT upscaled — canvas stays at natural size', async () => {
    stubNW = 800; stubNH = 600;
    await createDisplayBlobUrl(makeFile(), 2048);
    expect(lastCanvasWidth).toBe(800);
    expect(lastCanvasHeight).toBe(600);
  });

  it('rejects with a visible error when toBlob returns null', async () => {
    toBlobShouldFail = true;
    await expect(createDisplayBlobUrl(makeFile('bad.jpg'), 2048))
      .rejects.toThrow('Failed to encode display image: bad.jpg');
  });

  it('rejects with a visible error when the image fails to load', async () => {
    stubShouldFail = true;
    await expect(createDisplayBlobUrl(makeFile('corrupt.jpg'), 2048))
      .rejects.toThrow('Failed to load image: corrupt.jpg');
    // Temp load URL must be revoked even on failure
    expect(revokedUrls).toContain('blob:stub-0');
  });

  it('display-copy path uses a Blob URL — not the original File object URL', async () => {
    // createObjectURL is called for the temp load URL and then again for the blob.
    // The returned URL must come from the second call (the blob, not the file).
    const url = await createDisplayBlobUrl(makeFile(), 2048);
    // Both blob:stub-0 (temp) and blob:stub-1 (display) should have been created
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    // The returned display URL is NOT the temp load URL
    expect(url).not.toBe('blob:stub-0');
    expect(url).toBe('blob:stub-1');
  });
});

describe('computeContentFingerprint (§1 content identity)', () => {
  it('is stable for identical bytes and changes for different bytes', async () => {
    const a1 = await computeContentFingerprint(new File(['same bytes'], 'a.jpg'));
    const a2 = await computeContentFingerprint(new File(['same bytes'], 'renamed.jpg'));
    const b = await computeContentFingerprint(new File(['different bytes'], 'a.jpg'));
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).not.toBe('');
  });

  it('uses a content-derived fallback when Web Crypto is unavailable', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const first = await computeContentFingerprint(new File(['fallback-a'], 'a.jpg'));
      const second = await computeContentFingerprint(new File(['fallback-b'], 'b.jpg'));
      expect(first).toMatch(/^fnv1a64-/);
      expect(first).not.toBe(second);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
      else delete (globalThis as { crypto?: unknown }).crypto;
    }
  });
});

describe('generateFaviconFromFile (temporary URL lifecycle)', () => {
  it('revokes the temporary URL after a successful conversion', async () => {
    const result = await generateFaviconFromFile(makeFile('icon.png', 'image/png'));
    expect(result).toBe('data:image/png;base64,favicon');
    expect(revokedUrls).toContain('blob:stub-0');
  });

  it('revokes the temporary URL when conversion fails', async () => {
    stubShouldFail = true;
    await expect(generateFaviconFromFile(makeFile('bad.png', 'image/png'))).rejects.toThrow();
    expect(revokedUrls).toContain('blob:stub-0');
  });
});
