/**
 * bundler.ts — Export the gallery as a self-contained static site zip.
 *
 * Produces openhall-export.zip containing:
 *   index.html       — standalone viewer using the pre-built viewer JS
 *   gallery.json     — validated gallery data (with aspectRatio per artwork)
 *   images/          — artwork images (blob: URLs fetched and stored)
 *   assets/          — viewer JS bundle fetched from /assets/viewer.js
 *   PUBLISH.md       — "publish in minutes" guide (Netlify Drop / GitHub Pages)
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
  /**
   * Optional favicon image URL (blob:, data:, or same-origin path). Packaged
   * as favicon.<ext> and referenced from index.html. If omitted, no favicon
   * link is emitted. The app auto-generates one from the first artwork when
   * the artist hasn't uploaded a custom icon.
   */
  faviconUrl?: string;
  /**
   * Optional artist portrait image URL (blob:, data:, or same-origin path).
   * Packaged as images/portrait.<ext> and written into gallery.artist.portraitPath
   * so the exported viewer renders the plaque. Ignored when the gallery has no artist.
   */
  portraitUrl?: string;
  onProgress?: (msg: string, pct: number) => void;
}

export interface BundleResult {
  /** The generated zip blob. */
  blob: Blob;
  /** Total compressed size in bytes. */
  totalBytes: number;
}

export async function buildExportBundle(opts: BundleOptions): Promise<BundleResult> {
  const { gallery, artworkUrls, viewerScriptUrl, aspectRatios, faviconUrl, portraitUrl, onProgress } = opts;
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

  // --- 2b. Artist portrait ---
  let portraitPathInZip: string | undefined;
  if (gallery.artist && portraitUrl) {
    progress('Packaging portrait…', 60);
    const pRes = await fetch(portraitUrl);
    if (!pRes.ok) {
      throw new Error(`Failed to fetch artist portrait: HTTP ${pRes.status} from ${portraitUrl}`);
    }
    const pMime = pRes.headers.get('content-type') ?? 'image/jpeg';
    portraitPathInZip = `images/portrait${extensionFromMime(pMime)}`;
    zip.file(portraitPathInZip, await pRes.arrayBuffer());
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
    // Rewrite the artist's portrait to its packaged relative path (drop the
    // session blob: URL). Leave portraitPath unset when no portrait was packaged.
    artist: gallery.artist
      ? { ...gallery.artist, portraitPath: portraitPathInZip ?? undefined }
      : undefined,
  };
  zip.file('gallery.json', JSON.stringify(exportGallery, null, 2));

  // --- 4. Favicon ---
  let faviconPath: string | undefined;
  if (faviconUrl) {
    progress('Packaging favicon…', 63);
    const favRes = await fetch(faviconUrl);
    if (!favRes.ok) {
      throw new Error(`Failed to fetch favicon: HTTP ${favRes.status} from ${faviconUrl}`);
    }
    const favMime = favRes.headers.get('content-type') ?? 'image/png';
    const favExt = extensionFromMime(favMime);
    faviconPath = `favicon${favExt}`;
    zip.file(faviconPath, await favRes.arrayBuffer());
  }

  // --- 5. index.html ---
  progress('Writing index.html…', 65);
  // Use the first artwork as the social share (Open Graph) image.
  const firstArtworkId = gallery.artworks[0]?.id;
  const ogImagePath = firstArtworkId ? imageMap.get(firstArtworkId) : undefined;
  const html = buildIndexHtml({
    title: gallery.title,
    description: gallery.branding?.description,
    authorName: gallery.branding?.authorName,
    authorUrl: gallery.branding?.authorUrl,
    faviconPath,
    ogImagePath,
  });
  zip.file('index.html', html);

  // --- 5b. Publish guide ---
  zip.file('PUBLISH.md', buildPublishGuide(gallery.title));

  // --- 6. Generate zip ---
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

export interface IndexHtmlOptions {
  title: string;
  /** <meta name="description"> + og/twitter description. */
  description?: string;
  /** <meta name="author"> + og article author. */
  authorName?: string;
  /** Artist link — only emitted if it's an http(s) URL. */
  authorUrl?: string;
  /** Relative path to the favicon inside the bundle (e.g. "favicon.png"). */
  faviconPath?: string;
  /** Relative path to the social-share image (e.g. "images/aw-01.jpg"). */
  ogImagePath?: string;
}

/**
 * Build the exported index.html.
 * Accepts a plain title (legacy) or a full branding options object so the
 * self-hosted gallery carries a favicon, description, and social-share tags.
 */
export function buildIndexHtml(opts: IndexHtmlOptions | string): string {
  const o: IndexHtmlOptions = typeof opts === 'string' ? { title: opts } : opts;
  const safeTitle = escapeHtml(o.title);
  const head: string[] = [
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `<title>${safeTitle}</title>`,
  ];

  if (o.faviconPath) {
    const type = o.faviconPath.endsWith('.png') ? 'image/png'
      : o.faviconPath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    head.push(`<link rel="icon" type="${type}" href="./${escapeHtml(o.faviconPath)}" />`);
  }
  if (o.description) {
    head.push(`<meta name="description" content="${escapeHtml(o.description)}" />`);
  }
  if (o.authorName) {
    head.push(`<meta name="author" content="${escapeHtml(o.authorName)}" />`);
  }

  // Open Graph + Twitter card for rich link previews when the gallery is shared.
  head.push(`<meta property="og:title" content="${safeTitle}" />`);
  head.push('<meta property="og:type" content="website" />');
  if (o.description) {
    head.push(`<meta property="og:description" content="${escapeHtml(o.description)}" />`);
  }
  if (o.ogImagePath) {
    head.push(`<meta property="og:image" content="./${escapeHtml(o.ogImagePath)}" />`);
    head.push('<meta name="twitter:card" content="summary_large_image" />');
    head.push(`<meta name="twitter:image" content="./${escapeHtml(o.ogImagePath)}" />`);
  } else {
    head.push('<meta name="twitter:card" content="summary" />');
  }
  head.push(`<meta name="twitter:title" content="${safeTitle}" />`);
  if (o.description) {
    head.push(`<meta name="twitter:description" content="${escapeHtml(o.description)}" />`);
  }
  // Only surface the artist link if it's a safe http(s) URL.
  if (o.authorUrl && /^https?:\/\//i.test(o.authorUrl)) {
    head.push(`<link rel="author" href="${escapeHtml(o.authorUrl)}" />`);
  }

  const headHtml = head.map((line) => `    ${line}`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
${headHtml}
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

/**
 * The publish guide shipped inside every export zip. Plain markdown, readable
 * on GitHub and in any text editor. The Netlify Drop zip-as-is path is the
 * headline because it is the fastest verified route to a live URL.
 */
export function buildPublishGuide(galleryTitle: string): string {
  return `# Publish "${galleryTitle}" — your gallery, your site

This folder is a complete static website. It has no server code, no
database, and no dependency on Openhall — host it anywhere, forever.

## Fastest: Netlify Drop (minutes, free)

1. Open https://app.netlify.com/drop and sign in — creating a free
   Netlify account takes a moment if you don't have one.
2. Drag this whole zip file (or this unzipped folder) onto the page.
3. That's it — Netlify gives you a live URL to share.

From your Netlify dashboard you can set a custom name
(yourname.netlify.app) or connect your own domain.

## Also free: GitHub Pages

1. Create a new repository on https://github.com and upload the
   contents of this folder (unzipped).
2. In the repository: Settings → Pages → set Source to
   "Deploy from a branch", pick your main branch, folder "/ (root)".
3. Your gallery appears at https://<username>.github.io/<repo>/ after
   a minute or two.

## Test locally first (optional)

Because browsers restrict file:// pages, open the folder with any
static server instead of double-clicking index.html. If you have
Node.js: run \`npx serve\` inside this folder and open the printed URL.

## What's in here

- index.html — entry page with your title, description, and share preview
- gallery.json — your rooms, artwork placements, labels, and tour
- images/ — your artworks
- assets/viewer.js — the 3D viewer engine (self-contained)

Made with Openhall. The gallery is yours — no subscription, no lock-in.
`;
}

export { escapeHtml } from '../ui/escape-html';

function extensionFromMime(mime: string): string {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return '.jpg';
}
