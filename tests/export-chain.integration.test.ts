/**
 * export-chain.integration.test.ts — The REAL export chain, no mocks.
 *
 * Why this exists: the Week 3 report (docs/test-reports/WEEK3_TEST_REPORT.md)
 * found that all export-chain failures lived in the fetch / cross-file
 * integration layer that unit tests mock away. This suite runs the actual
 * buildExportBundle against a real HTTP server serving the real pre-built
 * viewer.js and the real demo images, then verifies the zip byte-for-byte.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type JSZip from 'jszip';
import { buildRealExportZip, publicDir, type RealExportResult } from './export-harness';

let result: RealExportResult;

beforeAll(async () => {
  result = await buildRealExportZip();
}, 60_000);

function entry(path: string): JSZip.JSZipObject {
  const file = result.zip.file(path);
  expect(file, `zip entry '${path}' exists`).toBeTruthy();
  return file as JSZip.JSZipObject;
}

describe('export chain (real bundler, real viewer.js, real images)', () => {
  it('ships the exact pre-built viewer.js, not HTML and not a stub', async () => {
    const viewerJs = await entry('assets/viewer.js').async('string');
    expect(viewerJs.trimStart().startsWith('<')).toBe(false);
    expect(viewerJs.length).toBeGreaterThan(100_000); // Three.js is bundled in
    expect(viewerJs).toBe(result.sourceViewerJs); // byte-identical to what build:viewer produced
  });

  it('writes a gallery.json that passes the real zod schema', async () => {
    const raw = JSON.parse(await entry('gallery.json').async('string'));
    // Re-validate with the same schema the viewer boot uses
    const { GallerySchema } = await import('../src/schema/gallery.schema');
    const parsed = GallerySchema.safeParse(raw);
    expect(parsed.success, parsed.success ? '' : parsed.error.message).toBe(true);
  });

  it('rewrites every imagePath into the zip and every artwork keeps a valid aspectRatio', async () => {
    const gallery = JSON.parse(await entry('gallery.json').async('string'));
    for (const aw of gallery.artworks) {
      expect(aw.imagePath, `artwork ${aw.id} imagePath is bundled`).toMatch(/^images\//);
      entry(aw.imagePath);
      expect(aw.aspectRatio, `artwork ${aw.id} aspectRatio`).toBeGreaterThan(0);
    }
  });

  it('packages artwork images byte-for-byte (fetch round-trip loses nothing)', async () => {
    const gallery = JSON.parse(await entry('gallery.json').async('string'));
    for (const [i, aw] of gallery.artworks.entries()) {
      const bundled = await entry(aw.imagePath).async('uint8array');
      const source = readFileSync(resolve(publicDir, result.gallery.artworks[i].imagePath));
      expect(bundled.length, `artwork ${aw.id} image size`).toBe(source.length);
      expect(Buffer.from(bundled).equals(source), `artwork ${aw.id} image bytes intact`).toBe(true);
    }
  });

  it('emits an index.html whose references all resolve inside the zip', async () => {
    const html = await entry('index.html').async('string');
    const refs = [...html.matchAll(/(?:src|href|content)="\.\/([^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) entry(ref);
    expect(html).toContain(`<title>${result.gallery.title.replace(/&/g, '&amp;')}</title>`);
  });

  it('includes the publish guide', async () => {
    const guide = await entry('PUBLISH.md').async('string');
    expect(guide).toContain('Netlify');
    expect(guide).toContain(result.gallery.title);
  });

  it('stays under the 5 MB budget excluding artwork images (AGENTS.md rule)', async () => {
    let nonImageBytes = 0;
    for (const [path, file] of Object.entries(result.zip.files)) {
      if (file.dir || path.startsWith('images/')) continue;
      nonImageBytes += (await file.async('uint8array')).length;
    }
    expect(nonImageBytes).toBeLessThan(5 * 1024 * 1024);
  });
});
