// @vitest-environment jsdom
/**
 * bundler.test.ts — Unit tests for the export bundler.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildExportBundle, downloadZip, buildIndexHtml, buildPublishGuide } from '../export/bundler';
import { escapeHtml } from '../ui/escape-html';
import { GallerySchema } from '../schema/gallery.schema';
import sampleGallery from '../demo/sample-gallery.json';
import type { Gallery } from '../schema/gallery.schema';
import JSZip from 'jszip';

// ---------------------------------------------------------------------------
// Mock fetch globally so tests don't make real network requests
// ---------------------------------------------------------------------------

const DUMMY_JS = 'console.log("viewer");';
// Use Uint8Array body — jsdom's Response doesn't support Blob.stream()
const DUMMY_IMAGE_BYTES = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes

function makeFetch(imageBytes: Uint8Array = DUMMY_IMAGE_BYTES): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const urlStr = String(url);
    if (urlStr.includes('viewer.js') || urlStr.includes('viewer-entry')) {
      return new Response(DUMMY_JS, {
        status: 200,
        headers: { 'Content-Type': 'text/javascript' },
      });
    }
    // Any other URL → return fake image bytes
    return new Response(imageBytes.buffer as ArrayBuffer, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
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
// Core export tests
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

  // -------------------------------------------------------------------------
  // aspectRatio round-trip
  // -------------------------------------------------------------------------

  it('writes aspectRatio from aspectRatios map into gallery.json', async () => {
    const gallery = makeGallery();
    vi.stubGlobal('fetch', makeFetch());

    const aspectRatios = new Map([
      ['aw-01', 1.5],
      ['aw-02', 0.75],
    ]);

    const { blob } = await buildExportBundle({
      gallery,
      artworkUrls: makeArtworkUrls(gallery),
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
      aspectRatios,
    });

    const zip = await JSZip.loadAsync(blob);
    const galleryJson = JSON.parse(await zip.file('gallery.json')!.async('string')) as {
      artworks: Array<{ id: string; aspectRatio?: number }>;
    };
    const byId = new Map(galleryJson.artworks.map((a) => [a.id, a]));
    expect(byId.get('aw-01')?.aspectRatio).toBe(1.5);
    expect(byId.get('aw-02')?.aspectRatio).toBe(0.75);
  });

  it('preserves existing aspectRatio from gallery when no override map provided', async () => {
    const gallery = makeGallery();
    vi.stubGlobal('fetch', makeFetch());

    // aw-01 in sample-gallery.json (Van Gogh Wheat Field) has aspectRatio: 1.256
    const { blob } = await buildExportBundle({
      gallery,
      artworkUrls: makeArtworkUrls(gallery),
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
    });

    const zip = await JSZip.loadAsync(blob);
    const galleryJson = JSON.parse(await zip.file('gallery.json')!.async('string')) as {
      artworks: Array<{ id: string; aspectRatio?: number }>;
    };
    const aw01 = galleryJson.artworks.find((a) => a.id === 'aw-01');
    expect(aw01?.aspectRatio).toBe(1.256);
  });

  // -------------------------------------------------------------------------
  // Fail loudly: HTML viewer response
  // -------------------------------------------------------------------------

  it('throws loudly when viewer.js response is HTML (SPA fallback)', async () => {
    const gallery = makeGallery();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<!DOCTYPE html><html><body>Not found</body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    )));

    await expect(
      buildExportBundle({
        gallery,
        artworkUrls: makeArtworkUrls(gallery),
        viewerScriptUrl: 'https://example.com/assets/viewer.js',
      })
    ).rejects.toThrow(/viewer\.js response looks like HTML/);
  });

  it('throws loudly when viewer.js response starts with < (HTML body check)', async () => {
    const gallery = makeGallery();
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('viewer.js')) {
        // text/javascript but body is HTML — simulates misconfigured server
        return new Response('<!DOCTYPE html>', {
          status: 200,
          headers: { 'Content-Type': 'text/javascript' },
        });
      }
      return new Response(DUMMY_IMAGE_BYTES.buffer as ArrayBuffer, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }));

    await expect(
      buildExportBundle({
        gallery,
        artworkUrls: makeArtworkUrls(gallery),
        viewerScriptUrl: 'https://example.com/assets/viewer.js',
      })
    ).rejects.toThrow(/viewer\.js response looks like HTML/);
  });

  // -------------------------------------------------------------------------
  // Fail loudly: image fetch failure
  // -------------------------------------------------------------------------

  it('throws loudly when an image fetch fails', async () => {
    const gallery = makeGallery();
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('viewer.js')) {
        return new Response(DUMMY_JS, {
          status: 200,
          headers: { 'Content-Type': 'text/javascript' },
        });
      }
      // All image fetches fail
      return new Response('Not Found', { status: 404 });
    }));

    await expect(
      buildExportBundle({
        gallery,
        artworkUrls: makeArtworkUrls(gallery),
        viewerScriptUrl: 'https://example.com/assets/viewer.js',
      })
    ).rejects.toThrow(/Failed to fetch image for artwork/);
  });

  // -------------------------------------------------------------------------
  // Demo-mode export: artwork URL sourced from imagePath fetch
  // -------------------------------------------------------------------------

  it('packages an artwork whose URL was fetched from imagePath (demo-mode flow)', async () => {
    // Simulate what the app.ts export handler does for demo mode:
    // artworkUrls is pre-filled by fetching each artwork's imagePath,
    // then passed to buildExportBundle as a normal blob: URL entry.
    const gallery = makeGallery();
    // Override aw-01 to use a demo imagePath (no uploaded blob URL exists)
    const demoGallery = {
      ...gallery,
      artworks: gallery.artworks.map((aw, i) =>
        i === 0 ? { ...aw, imagePath: 'demo/vangogh-wheatfield.jpg', aspectRatio: 1.256 } : aw
      ),
    };
    // Simulate the app prefetching imagePath → blob: URL
    const artworkUrls = new Map(demoGallery.artworks.map((aw) => [
      aw.id,
      `blob:${aw.id}`, // stub blob: URL (fetch mock returns fake image bytes for any URL)
    ]));
    vi.stubGlobal('fetch', makeFetch());

    const { blob } = await buildExportBundle({
      gallery: demoGallery,
      artworkUrls,
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
    });

    const zip = await JSZip.loadAsync(blob);
    const galleryJson = JSON.parse(await zip.file('gallery.json')!.async('string')) as {
      artworks: Array<{ id: string; imagePath: string; aspectRatio?: number }>;
    };
    const aw01 = galleryJson.artworks.find((a) => a.id === 'aw-01');
    // imagePath must be remapped to images/ (not the original demo/ path)
    expect(aw01?.imagePath).toMatch(/^images\//);
    // The image file must actually exist in the zip
    expect(zip.file(aw01!.imagePath)).not.toBeNull();
    // aspectRatio must be preserved
    expect(aw01?.aspectRatio).toBe(1.256);
  });

  // -------------------------------------------------------------------------
  // totalBytes (replaces defunct coreBytes)
  // -------------------------------------------------------------------------

  it('returns totalBytes > 0', async () => {
    const gallery = makeGallery();
    vi.stubGlobal('fetch', makeFetch());

    const { totalBytes } = await buildExportBundle({
      gallery,
      artworkUrls: makeArtworkUrls(gallery),
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
    });

    expect(totalBytes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Publish guide
// ---------------------------------------------------------------------------

describe('publish guide', () => {
  it('includes PUBLISH.md in the zip with the gallery title and both hosting routes', async () => {
    const gallery = makeGallery();
    const artworkUrls = makeArtworkUrls(gallery);
    vi.stubGlobal('fetch', makeFetch());

    const { blob } = await buildExportBundle({
      gallery,
      artworkUrls,
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
    });

    const zip = await JSZip.loadAsync(blob);
    const guide = zip.file('PUBLISH.md');
    expect(guide).not.toBeNull();
    const text = await guide!.async('string');
    expect(text).toContain(gallery.title);
    expect(text).toContain('netlify.com/drop');
    expect(text).toContain('GitHub Pages');
  });

  it('buildPublishGuide names the zip contents and the ownership promise', () => {
    const text = buildPublishGuide('My Show');
    expect(text).toContain('# Publish "My Show"');
    expect(text).toContain('gallery.json');
    expect(text).toContain('assets/viewer.js');
    expect(text).toContain('no lock-in');
  });
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes & < > " \'', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
    expect(escapeHtml('1 + 1 = 2')).toBe('1 + 1 = 2');
  });
});

// ---------------------------------------------------------------------------
// buildIndexHtml
// ---------------------------------------------------------------------------

describe('buildIndexHtml', () => {
  it('includes ./assets/viewer.js reference', () => {
    const html = buildIndexHtml('My Gallery');
    expect(html).toContain('./assets/viewer.js');
  });

  it('escapes HTML characters in the title', () => {
    const html = buildIndexHtml('<script>alert("xss")</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('emits description, author, favicon link and OG/Twitter tags from options', () => {
    const html = buildIndexHtml({
      title: 'Late Works',
      description: 'A quiet room of final paintings.',
      authorName: 'Jane Artist',
      authorUrl: 'https://jane.example',
      faviconPath: 'favicon.png',
      ogImagePath: 'images/aw-01.jpg',
    });
    expect(html).toContain('<meta name="description" content="A quiet room of final paintings." />');
    expect(html).toContain('<meta name="author" content="Jane Artist" />');
    expect(html).toContain('<link rel="icon" type="image/png" href="./favicon.png" />');
    expect(html).toContain('<meta property="og:title" content="Late Works" />');
    expect(html).toContain('<meta property="og:image" content="./images/aw-01.jpg" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<link rel="author" href="https://jane.example" />');
  });

  it('omits favicon/description/author tags when not provided', () => {
    const html = buildIndexHtml('Bare Gallery');
    expect(html).not.toContain('rel="icon"');
    expect(html).not.toContain('name="description"');
    expect(html).not.toContain('name="author"');
    // Falls back to a plain summary card with no share image
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
  });

  it('drops an unsafe (non-http) author URL', () => {
    const html = buildIndexHtml({
      title: 'X',
      authorUrl: 'javascript:alert(1)',
    });
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('rel="author"');
  });
});

// ---------------------------------------------------------------------------
// buildExportBundle — branding (favicon + meta)
// ---------------------------------------------------------------------------

describe('buildExportBundle branding', () => {
  it('packages favicon file and links it from index.html', async () => {
    const gallery = makeGallery();
    vi.stubGlobal('fetch', makeFetch());

    const { blob } = await buildExportBundle({
      gallery,
      artworkUrls: makeArtworkUrls(gallery),
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
      faviconUrl: 'https://example.com/favicon.png',
    });

    const zip = await JSZip.loadAsync(blob);
    expect(zip.file('favicon.png')).not.toBeNull();
    const html = await zip.file('index.html')!.async('string');
    expect(html).toContain('rel="icon"');
    expect(html).toContain('href="./favicon.png"');
  });

  it('uses the first artwork as the og:image', async () => {
    const gallery = makeGallery();
    vi.stubGlobal('fetch', makeFetch());

    const { blob } = await buildExportBundle({
      gallery,
      artworkUrls: makeArtworkUrls(gallery),
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
    });

    const zip = await JSZip.loadAsync(blob);
    const html = await zip.file('index.html')!.async('string');
    const firstId = gallery.artworks[0].id;
    expect(html).toContain(`<meta property="og:image" content="./images/${firstId}`);
  });

  it('bakes gallery.branding.description into the meta description', async () => {
    const gallery: Gallery = {
      ...makeGallery(),
      branding: { description: 'Ten works on migration and memory.', authorName: 'H. Lin' },
    };
    vi.stubGlobal('fetch', makeFetch());

    const { blob } = await buildExportBundle({
      gallery,
      artworkUrls: makeArtworkUrls(gallery),
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
    });

    const zip = await JSZip.loadAsync(blob);
    const html = await zip.file('index.html')!.async('string');
    expect(html).toContain('Ten works on migration and memory.');
    expect(html).toContain('<meta name="author" content="H. Lin" />');
  });

  it('throws loudly when the favicon fetch fails', async () => {
    const gallery = makeGallery();
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('viewer.js')) {
        return new Response(DUMMY_JS, { status: 200, headers: { 'Content-Type': 'text/javascript' } });
      }
      if (urlStr.includes('favicon')) {
        return new Response('nope', { status: 404 });
      }
      return new Response(DUMMY_IMAGE_BYTES.buffer as ArrayBuffer, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }));

    await expect(
      buildExportBundle({
        gallery,
        artworkUrls: makeArtworkUrls(gallery),
        viewerScriptUrl: 'https://example.com/assets/viewer.js',
        faviconUrl: 'https://example.com/favicon.png',
      })
    ).rejects.toThrow(/Failed to fetch favicon/);
  });
});

// ---------------------------------------------------------------------------
// buildExportBundle — artist portrait
// ---------------------------------------------------------------------------

describe('buildExportBundle artist portrait', () => {
  function galleryWithArtist(portraitPath?: string): Gallery {
    return {
      ...makeGallery(),
      artist: {
        name: 'Jane Artist',
        statement: 'Quiet interiors.',
        portraitPath, // e.g. a session blob: URL before export
        links: [{ label: 'Web', url: 'https://jane.example' }],
      },
    };
  }

  it('packages the portrait and rewrites artist.portraitPath to images/portrait.*', async () => {
    const gallery = galleryWithArtist('blob:session-portrait');
    vi.stubGlobal('fetch', makeFetch());

    const { blob } = await buildExportBundle({
      gallery,
      artworkUrls: makeArtworkUrls(gallery),
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
      portraitUrl: 'blob:session-portrait',
    });

    const zip = await JSZip.loadAsync(blob);
    const galleryJson = JSON.parse(await zip.file('gallery.json')!.async('string'));
    expect(galleryJson.artist.portraitPath).toMatch(/^images\/portrait\./);
    expect(zip.file(galleryJson.artist.portraitPath)).not.toBeNull();
    // The session blob: URL must not leak into the exported gallery.json
    expect(galleryJson.artist.portraitPath).not.toMatch(/^blob:/);
    expect(galleryJson.artist.name).toBe('Jane Artist');
  });

  it('leaves portraitPath unset when artist has no portrait (monogram fallback)', async () => {
    const gallery = galleryWithArtist(undefined);
    vi.stubGlobal('fetch', makeFetch());

    const { blob } = await buildExportBundle({
      gallery,
      artworkUrls: makeArtworkUrls(gallery),
      viewerScriptUrl: 'https://example.com/assets/viewer.js',
      // no portraitUrl
    });

    const zip = await JSZip.loadAsync(blob);
    const galleryJson = JSON.parse(await zip.file('gallery.json')!.async('string'));
    expect(galleryJson.artist.name).toBe('Jane Artist');
    expect(galleryJson.artist.portraitPath).toBeUndefined();
    expect(zip.file('images/portrait.jpg')).toBeNull();
  });

  it('throws loudly when the portrait fetch fails', async () => {
    const gallery = galleryWithArtist('blob:session-portrait');
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('viewer.js')) {
        return new Response(DUMMY_JS, { status: 200, headers: { 'Content-Type': 'text/javascript' } });
      }
      if (urlStr.includes('portrait')) {
        return new Response('nope', { status: 404 });
      }
      return new Response(DUMMY_IMAGE_BYTES.buffer as ArrayBuffer, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }));

    await expect(
      buildExportBundle({
        gallery,
        artworkUrls: makeArtworkUrls(gallery),
        viewerScriptUrl: 'https://example.com/assets/viewer.js',
        portraitUrl: 'blob:session-portrait',
      })
    ).rejects.toThrow(/Failed to fetch artist portrait/);
  });
});

// ---------------------------------------------------------------------------
// downloadZip
// ---------------------------------------------------------------------------

describe('downloadZip', () => {
  it('triggers a download by creating an anchor and clicking it', () => {
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

// ---------------------------------------------------------------------------
// slugifyTitle — export filename from the exhibition title
// ---------------------------------------------------------------------------

import { slugifyTitle } from '../export/bundler';

describe('slugifyTitle', () => {
  it('slugs a latin title', () => {
    expect(slugifyTitle('Quiet Forms')).toBe('quiet-forms');
    expect(slugifyTitle('  Water & Light: A Study  ')).toBe('water-light-a-study');
  });

  it('keeps CJK characters and strips filename-illegal ones', () => {
    expect(slugifyTitle('靜物與光')).toBe('靜物與光');
    expect(slugifyTitle('a/b\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });

  it('falls back when the title slugs to nothing', () => {
    expect(slugifyTitle('')).toBe('openhall-export');
    expect(slugifyTitle('???')).toBe('openhall-export');
  });

  it('caps length at 60 characters', () => {
    expect(slugifyTitle('x'.repeat(200)).length).toBe(60);
  });
});
