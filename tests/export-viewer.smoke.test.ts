/**
 * export-viewer.smoke.test.ts — The exported bundle boots in a real browser.
 *
 * Automates the manual "unzip → serve → open" verification: build the real
 * export zip, unzip it to a temp dir, serve it, and load it in headless
 * Chromium. Passing means what the artist downloads actually runs — the same
 * guarantee as a manual Netlify Drop test, on every `npm test`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { buildRealExportZip, startStaticServer, type StaticServer } from './export-harness';

let unzipDir: string;
let server: StaticServer;
let browser: Browser;
let page: Page;
let galleryTitle: string;
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
const badResponses: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  // 1. Real export zip → unzipped static site in a temp dir
  const { zip, gallery } = await buildRealExportZip();
  // Exercise the new optional-medium contract against the real pre-built
  // standalone viewer. A stale viewer bundle with the old schema will fail boot.
  const exportedGallery = JSON.parse(await zip.file('gallery.json')!.async('string'));
  delete exportedGallery.artworks[0].medium;
  zip.file('gallery.json', JSON.stringify(exportedGallery, null, 2));
  galleryTitle = gallery.title;
  unzipDir = mkdtempSync(join(tmpdir(), 'openhall-e2e-'));
  for (const [relPath, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const dest = resolve(unzipDir, relPath);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, await file.async('nodebuffer'));
  }

  // 2. Serve it and open it in a real browser
  server = await startStaticServer(unzipDir);
  try {
    browser = await chromium.launch();
  } catch (e) {
    throw new Error(
      `Could not launch Chromium — run 'npx playwright install chromium' once. Original error: ${String(e)}`
    );
  }
  page = await browser.newPage();
  const allowedOrigin = new URL(server.baseUrl).origin;
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== allowedOrigin) {
      externalRequests.push(`${request.method()} ${request.url()}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', (res) => {
    if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`);
  });
  await page.goto(server.baseUrl, { waitUntil: 'load' });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (unzipDir) rmSync(unzipDir, { recursive: true, force: true });
});

describe('exported bundle in headless Chromium', () => {
  it('boots the viewer: canvas appears and no failure screen', async () => {
    await page.waitForSelector('canvas', { timeout: 30_000 });
    const failureText = await page.locator('body').textContent();
    expect(failureText ?? '').not.toContain('Failed to load gallery');
  }, 40_000);

  it('shows the entry overlay with the exhibition title', async () => {
    await page.waitForSelector(`text=${galleryTitle}`, { timeout: 15_000 });
  }, 20_000);

  it('loaded every asset it asked for (no 404s inside the bundle)', () => {
    expect(badResponses).toEqual([]);
  });

  it('makes no HTTP requests outside the exported static site', () => {
    expect(externalRequests).toEqual([]);
  });

  it('threw no page errors and logged no console errors', () => {
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
