// @vitest-environment jsdom
/**
 * bundler.test.ts — Unit tests for the export bundler.
 *
 * Tests:
 *   - buildIndexHtml produces valid HTML with correct script reference
 *   - buildExportBundle: all placements have their image in the zip
 *   - buildExportBundle: gallery.json entry is present with correct artworkId paths
 *   - buildExportBundle: index.html is present
 */

import { describe, it, expect, vi } from 'vitest';
import { buildExportBundle, downloadZip } from '../export/bundler';
import { GallerySchema } from '../schema/gallery.schema';
import sampleGallery from '../demo/sample-gallery.json';
import type { Gallery } from '../schema/gallery.schema';
import JSZip from 'jszip';

// ---------------------------------------------------------------------------
// Mock fetch globally so tests don't make real network requests
// ---------------------------------------------------------------------------

const DUMMY_JS = 'console.log("viewer");';
const DUMMY_IMAGE_PNG = new Blob(['fakepng'], { type: 'image/png' });

function makeFetch(imageBlob: Blob = DUMMY_IMAGE_PNG): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const urlStr = String(url);
    if (urlStr.includes('viewer.js') || urlStr.includes('viewer-entry')) {
      return new Response(DUMMY_JS, { status: 200 });
    }
    // Any other URL → return a fake image blob
    return new Response(imageBlob, {
      status: 200,
      headers: { 'Content-Type': imageBlob.type },
    });
  }) as unknown as typeof fetch;
}

function makeGallery(): Gallery {
  return GallerySchema.parse(sampleGallery);
}

function makeArtworkUrls(gallery: Gallery): Map<string, string> {
  return new Map(gallery.artworks.map((aw) => [aw.id, `https://example.com/images/${aw.id}.jpg`]));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildExportBundle', () => {
  it('includes index.html in the zip', async () => {
    const gallery = makeGallery();
    const artworkUrls = makeArtworkUrls(gallery);
    vi.stubGlobal('fetch', makeFetch());

    const { blob } = await buildExportBundle({
      gallery,
      artworkUrls,
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
    });

    const zip = await JSZip.loadAsync(blob);
    expect(zip.file('index.html')).not.toBeNull();
  });

  it('includes gallery.json in the zip', async () => {
    const gallery = makeGallery();
    const artworkUrls = makeArtworkUrls(gallery);
    vi.stubGlobal('fetch', makeFetch());

    const { blob } = await buildExportBundle({
      gallery,
      artworkUrls,
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
    });

    const zip = await JSZip.loadAsync(blob);
    const galleryFile = zip.file('gallery.json');
    expect(galleryFile).not.toBeNull();

    const galleryJson = JSON.parse(await galleryFile!.async('string'));
    expect(galleryJson.version).toBe('1.0');
  });

  it('includes viewer JS in assets/', async () => {
    const gallery = makeGallery();
    vi.stubGlobal('fetch', makeFetch());

    const { blob } = await buildExportBundle({
      gallery,
      artworkUrls: makeArtworkUrls(gallery),
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
    });

    const zip = await JSZip.loadAsync(blob);
    const viewerFile = zip.file('assets/viewer.js');
    expect(viewerFile).not.toBeNull();
    const content = await viewerFile!.async('string');
    expect(content).toBe(DUMMY_JS);
  });

  it('every placement artworkId has a gallery.json entry and relative imagePath', async () => {
    // This test verifies that every placed artwork is represented in gallery.json
    // with a relative images/ path (not blob: or https:).
    const gallery = makeGallery();
    const artworkUrls = makeArtworkUrls(gallery);
    vi.stubGlobal('fetch', makeFetch());

    const { blob } = await buildExportBundle({
      gallery,
      artworkUrls,
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
    });

    const zip = await JSZip.loadAsync(blob);
    const galleryJson = JSON.parse(await zip.file('gallery.json')!.async('string')) as {
      artworks: Array<{ id: string; imagePath: string }>;
    };
    const artworkById = new Map<string, string>(galleryJson.artworks.map((a) => [a.id, a.imagePath]));

    for (const placement of gallery.placements) {
      const imagePath = artworkById.get(placement.artworkId);
      expect(imagePath, `artwork ${placement.artworkId} missing from gallery.json artworks`).toBeDefined();
      expect(imagePath, `artwork ${placement.artworkId} imagePath should start with 'images/'`).toMatch(/^images\//);
    }
  });

  it('gallery.json artworkPaths are relative (no blob: or data: URLs)', async () => {
    const gallery = makeGallery();
    const artworkUrls = makeArtworkUrls(gallery);
    vi.stubGlobal('fetch', makeFetch());

    const { blob } = await buildExportBundle({
      gallery,
      artworkUrls,
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
    });

    const zip = await JSZip.loadAsync(blob);
    const galleryJson = JSON.parse(await zip.file('gallery.json')!.async('string'));
    for (const aw of galleryJson.artworks) {
      expect(aw.imagePath).not.toMatch(/^blob:/);
      expect(aw.imagePath).not.toMatch(/^data:/);
      expect(aw.imagePath).toMatch(/^images\//);
    }
  });

  it('index.html references assets/viewer.js with a relative path', async () => {
    const gallery = makeGallery();
    vi.stubGlobal('fetch', makeFetch());

    const { blob } = await buildExportBundle({
      gallery,
      artworkUrls: makeArtworkUrls(gallery),
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
    });

    const zip = await JSZip.loadAsync(blob);
    const html = await zip.file('index.html')!.async('string');
    expect(html).toContain('./assets/viewer.js');
    expect(html).not.toContain('http');
    expect(html).not.toContain('https');
  });
});

describe('downloadZip', () => {
  it('triggers a download by creating an anchor and clicking it', () => {
    // Provide stubs for the browser APIs jsdom doesn't implement
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    URL.revokeObjectURL = vi.fn();

    const anchor = { href: '', download: '', click: vi.fn() };
    vi.spyOn(document, 'createElement').mockReturnValueOnce(anchor as unknown as HTMLAnchorElement);

    const blob = new Blob(['test'], { type: 'application/zip' });
    downloadZip(blob, 'test.zip');

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe('blob:mock-url');
    expect(anchor.download).toBe('test.zip');
    expect(anchor.click).toHaveBeenCalled();
  });
});
