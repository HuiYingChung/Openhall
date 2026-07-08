/**
 * export-harness.ts — Shared harness for export-chain integration tests.
 *
 * Runs the REAL export path with no mocks: a local HTTP server serves
 * public/ (the pre-built viewer.js + demo images), and buildExportBundle
 * fetches from it exactly like the browser app does.
 *
 * Lives in tests/ (not src/) on purpose: src/ has no Node types, which is
 * the guardrail that keeps viewer code browser-only.
 */

import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { buildExportBundle } from '../src/export/bundler';
import { GallerySchema, type Gallery } from '../src/schema/gallery.schema';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const publicDir = resolve(repoRoot, 'public');
export const viewerJsPath = resolve(publicDir, 'assets', 'viewer.js');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.md': 'text/markdown',
};

export interface StaticServer {
  baseUrl: string;
  close(): Promise<void>;
}

/** Serve a directory on an ephemeral port. Plain files only, no fallbacks. */
export function startStaticServer(rootDir: string): Promise<StaticServer> {
  const server: Server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const filePath = resolve(rootDir, '.' + (urlPath === '/' ? '/index.html' : urlPath));
    if (!filePath.startsWith(rootDir) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  });

  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolveServer({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** Fail loudly (not skip) when the pre-built viewer is missing — a green run must mean the real chain was exercised. */
export function assertViewerBuilt(): void {
  if (!existsSync(viewerJsPath)) {
    throw new Error(
      `public/assets/viewer.js is missing — run 'npm run build:viewer' before 'npm test'. ` +
        `The export-chain tests exercise the real viewer bundle, not a stub.`
    );
  }
}

export interface RealExportResult {
  zip: JSZip;
  totalBytes: number;
  gallery: Gallery;
  /** Raw bytes of the pre-built viewer.js that was served to the bundler. */
  sourceViewerJs: string;
}

/**
 * Run buildExportBundle for the demo gallery against a real HTTP server.
 * This is the exact code path the app's Export button triggers.
 */
export async function buildRealExportZip(): Promise<RealExportResult> {
  assertViewerBuilt();
  const gallery = GallerySchema.parse(
    JSON.parse(readFileSync(resolve(repoRoot, 'src', 'demo', 'sample-gallery.json'), 'utf8'))
  );

  const server = await startStaticServer(publicDir);
  try {
    const artworkUrls = new Map(
      gallery.artworks.map((aw) => [aw.id, `${server.baseUrl}/${aw.imagePath}`])
    );
    const aspectRatios = new Map(
      gallery.artworks.flatMap((aw) => (aw.aspectRatio != null ? [[aw.id, aw.aspectRatio] as const] : []))
    );
    const firstArtwork = gallery.artworks[0];

    const result = await buildExportBundle({
      gallery,
      artworkUrls,
      aspectRatios,
      viewerScriptUrl: `${server.baseUrl}/assets/viewer.js`,
      // The app auto-generates a favicon from the first artwork — mirror that.
      faviconUrl: firstArtwork ? `${server.baseUrl}/${firstArtwork.imagePath}` : undefined,
    });

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    return {
      zip,
      totalBytes: result.totalBytes,
      gallery,
      sourceViewerJs: readFileSync(viewerJsPath, 'utf8'),
    };
  } finally {
    await server.close();
  }
}
