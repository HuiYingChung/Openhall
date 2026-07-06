/**
 * bundler.ts — Export the gallery as a self-contained static site zip.
 *
 * Produces openhall-export.zip containing:
 *   index.html       — standalone viewer using the pre-built viewer JS
 *   gallery.json     — validated gallery data (with aspectRatio per artwork)
 *   images/          — artwork images (blob: URLs fetched and stored)
 *   assets/          — viewer JS bundle fetched from /assets/viewer.js
 *
 * The unzipped folder runs on Netlify Drop and GitHub Pages with zero modification.
 * Bundle < 5 MB excluding artwork images.
 *
 * No AI code, no settings UI, no API keys included.
 */

import JSZip from 'jszip';
import type { Gallery, Placement } from '../schema/gallery.schema';
import { escapeHtml } from '../ui/escape-html';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BundleOptions {
  gallery: Gallery;
  /** Map of artworkId → blob: or data: URL of the artwork image. */
  artworkUrls: Map<string, string>;
  /**
   * URL of the pre-built viewer JS bundle to inline.
   * Must resolve to a real JS file — the bundler will fail loudly if it gets HTML.
   * Both dev and prod use /assets/viewer.js (pre-built, placed in public/).
   */
  viewerScriptUrl: string;
  /**
   * Optional map of artworkId → aspect ratio (width/height).
   * Written into gallery.json so the export viewer can size planes correctly.
   */
  aspectRatios?: Map<string, number>;
  onProgress?: (msg: string, pct: number) => void;
}

export interface BundleResult {
  /** The generated zip blob. */
  blob: Blob;
  /** Total compressed size in bytes. */
  totalBytes: number;
}

export async function buildExportBundle(opts: BundleOptions): Promise<BundleResult> {
  const { gallery, artworkUrls, viewerScriptUrl, aspectRatios, onProgress } = opts;
  const progress = onProgress ?? (() => {});

  const zip = new JSZip();

  // --- 1. Fetch viewer JS ---
  progress('Fetching viewer bundle…', 5);
  const viewerRes = await fetch(viewerScriptUrl);
  if (!viewerRes.ok) {
    throw new Error(`Failed to fetch viewer bundle: HTTP ${viewerRes.status} from ${viewerScriptUrl}`);
  }
  const viewerContentType = viewerRes.headers.get('content-type') ?? '';
  const viewerJs = await viewerRes.text();
  // Fail loudly if the server returned HTML (e.g. SPA fallback 200) instead of JS
  if (viewerContentType.includes('text/html') || viewerJs.trimStart().startsWith('<')) {
    throw new Error(
      `viewer.js response looks like HTML, not JavaScript. ` +
      `Run 'npm run build:viewer' first. URL: ${viewerScriptUrl}`
    );
  }
  zip.file('assets/viewer.js', viewerJs);

  // --- 2. Artwork images ---
  const imageMap = new Map<string, string>(); // artworkId → relative path in zip
  const artworkEntries = Array.from(artworkUrls.entries());
  for (let i = 0; i < artworkEntries.length; i++) {
    const [artworkId, url] = artworkEntries[i];
    progress(`Packaging image ${i + 1} of ${artworkEntries.length}…`, 10 + (i / artworkEntries.length) * 50);
    const imgRes = await fetch(url);
    if (!imgRes.ok) {
      throw new Error(`Failed to fetch image for artwork '${artworkId}': HTTP ${imgRes.status} from ${url}`);
    }
    const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
    const ext = extensionFromMime(contentType);
    const filename = `images/${artworkId}${ext}`;
    // Use arrayBuffer instead of blob — more compatible across environments
    const imgBuf = await imgRes.arrayBuffer();
    zip.file(filename, imgBuf);
    imageMap.set(artworkId, filename);
  }

  // --- 3. Patch gallery to use relative image paths + embed aspectRatio ---
  progress('Writing gallery.json…', 62);
  const exportGallery: Gallery = {
    ...gallery,
    artworks: gallery.artworks.map((aw) => ({
      ...aw,
      imagePath: imageMap.get(aw.id) ?? aw.imagePath,
      // Write aspect ratio if provided; preserve existing if already set
      aspectRatio: aspectRatios?.get(aw.id) ?? aw.aspectRatio,
    })),
    placements: gallery.placements as Placement[],
  };
  zip.file('gallery.json', JSON.stringify(exportGallery, null, 2));

  // --- 4. index.html ---
  progress('Writing index.html…', 65);
  const html = buildIndexHtml(gallery.title);
  zip.file('index.html', html);

  // --- 5. Generate zip ---
  progress('Compressing…', 70);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

  progress('Done!', 100);
  return { blob, totalBytes: blob.size };
}

/**
 * Trigger a browser download of the export zip.
 */
export function downloadZip(blob: Blob, filename = 'openhall-export.zip'): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildIndexHtml(title: string): string {
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: #000; overflow: hidden; }
      canvas { display: block; width: 100vw; height: 100vh; }
    </style>
  </head>
  <body>
    <script type="module" src="./assets/viewer.js"></script>
  </body>
</html>`;
}

export { escapeHtml } from '../ui/escape-html';

function extensionFromMime(mime: string): string {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return '.jpg';
}
