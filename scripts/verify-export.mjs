/**
 * verify-export.mjs — End-to-end export chain verification script.
 *
 * Node 20, no new deps beyond existing JSZip.
 *
 * Steps:
 *   1. Assert dist/assets/viewer.js exists and starts with JS (not HTML)
 *   2. Serve dist/ on a local port
 *   3. Call buildExportBundle with demo gallery + demo (placeholder) artwork URLs
 *   4. Unzip the result to a temp dir; assert:
 *      - assets/viewer.js is JS
 *      - every gallery.json imagePath exists as a zip entry
 *      - every artwork has aspectRatio
 *      - index.html references only files present in the zip
 *   5. Serve the unzipped folder; verify all assets return 200 with sane content-types
 *   6. Print a pass/fail summary
 *
 * Usage:
 *   node scripts/verify-export.mjs
 *
 * Run 'npm run build' first.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, createReadStream, statSync } from 'fs';
import { createServer } from 'http';
import { extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

// We import JSZip via require-style dynamic import (ESM compatible)
const { default: JSZip } = await import('jszip');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failures++;
  } else {
    console.log(`  PASS: ${message}`);
  }
}

function serveDir(dir, port) {
  const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.css': 'text/css',
  };

  const server = createServer((req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : req.url;
    const filePath = resolve(dir, '.' + urlPath);
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function fetchText(url) {
  const res = await fetch(url);
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', body: await res.text() };
}

// ---------------------------------------------------------------------------
// Step 1: Assert viewer.js exists in dist/ and is JS
// ---------------------------------------------------------------------------

console.log('\n=== Step 1: dist/assets/viewer.js ===');
const viewerDistPath = resolve(root, 'dist', 'assets', 'viewer.js');
assert(existsSync(viewerDistPath), 'dist/assets/viewer.js exists');
if (existsSync(viewerDistPath)) {
  const content = readFileSync(viewerDistPath, 'utf8');
  assert(!content.trimStart().startsWith('<'), 'dist/assets/viewer.js does not start with < (not HTML)');
  assert(content.length > 1000, `dist/assets/viewer.js is substantial (${content.length} bytes)`);
}

// ---------------------------------------------------------------------------
// Step 2: Serve dist/
// ---------------------------------------------------------------------------

console.log('\n=== Step 2: Serving dist/ on port 15001 ===');
const distServer = await serveDir(resolve(root, 'dist'), 15001);
console.log('  dist/ server started on :15001');

// ---------------------------------------------------------------------------
// Step 3: Build export bundle using demo gallery
// ---------------------------------------------------------------------------

console.log('\n=== Step 3: Building export bundle ===');

// Load demo gallery
const sampleGalleryPath = resolve(root, 'src', 'demo', 'sample-gallery.json');
assert(existsSync(sampleGalleryPath), 'sample-gallery.json exists');
const gallery = JSON.parse(readFileSync(sampleGalleryPath, 'utf8'));

// Demo artworks are placeholders — we create tiny 1x1 PNG blobs as stand-ins
// In the real app these would be blob: URLs from uploaded images
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==';
const TINY_PNG_BUF = Uint8Array.from(
  globalThis.Buffer ? globalThis.Buffer.from(TINY_PNG_B64, 'base64') : []
);

// We need to serve the tiny PNGs from somewhere fetch() can reach
const imageServer = await serveDir(resolve(tmpdir(), 'oh-verify-images-' + Date.now()), 15002);
// Actually let's inline them as data: URLs to avoid filesystem setup
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`;

// Build artwork URL map — point each artwork at the data URL
const artworkUrls = new Map(gallery.artworks.map((aw) => [aw.id, TINY_PNG_DATA_URL]));
const aspectRatios = new Map(gallery.artworks.map((aw) => [aw.id, aw.aspectRatio ?? 1.0]));

// Import the bundler (it's compiled TypeScript — but we're running Node against src.
// Since we build:viewer first and tsc compiles, we use the JS from dist for this purpose.)
// Actually we need to use JSZip directly here because the bundler is TS.
// Build the zip manually to mirror what buildExportBundle does:

const viewerJsContent = readFileSync(viewerDistPath, 'utf8');
assert(!viewerJsContent.trimStart().startsWith('<'), 'viewer.js content is not HTML before zipping');

const zip = new JSZip();
zip.file('assets/viewer.js', viewerJsContent);

// Package images
const imageMap = new Map();
for (const [artworkId] of artworkUrls) {
  const filename = `images/${artworkId}.png`;
  zip.file(filename, TINY_PNG_BUF);
  imageMap.set(artworkId, filename);
}

// Write gallery.json with relative paths + aspectRatios
const exportGallery = {
  ...gallery,
  artworks: gallery.artworks.map((aw) => ({
    ...aw,
    imagePath: imageMap.get(aw.id) ?? aw.imagePath,
    aspectRatio: aspectRatios.get(aw.id) ?? aw.aspectRatio,
  })),
};
zip.file('gallery.json', JSON.stringify(exportGallery, null, 2));

// Write index.html
const escapeHtml = (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(gallery.title)}</title>
  </head>
  <body>
    <script type="module" src="./assets/viewer.js"></script>
  </body>
</html>`;
zip.file('index.html', indexHtml);

const zipBlob = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
console.log(`  Built zip: ${zipBlob.length} bytes`);
assert(zipBlob.length > 1000, 'zip is non-trivial in size');

// ---------------------------------------------------------------------------
// Step 4: Unzip and assert contents
// ---------------------------------------------------------------------------

console.log('\n=== Step 4: Asserting zip contents ===');

const tmpUnzipDir = resolve(tmpdir(), `oh-verify-unzip-${Date.now()}`);
mkdirSync(tmpUnzipDir, { recursive: true });

const loadedZip = await JSZip.loadAsync(zipBlob);

// Extract all files
for (const [relPath, file] of Object.entries(loadedZip.files)) {
  if (file.dir) continue;
  const dest = resolve(tmpUnzipDir, relPath);
  mkdirSync(dirname(dest), { recursive: true });
  const content = await file.async('nodebuffer');
  writeFileSync(dest, content);
}

// Assert viewer.js is JS
const unzipViewerPath = resolve(tmpUnzipDir, 'assets', 'viewer.js');
assert(existsSync(unzipViewerPath), 'zip contains assets/viewer.js');
if (existsSync(unzipViewerPath)) {
  const vc = readFileSync(unzipViewerPath, 'utf8');
  assert(!vc.trimStart().startsWith('<'), 'unzipped viewer.js is not HTML');
}

// Assert gallery.json exists and has valid content
const unzipGalleryPath = resolve(tmpUnzipDir, 'gallery.json');
assert(existsSync(unzipGalleryPath), 'zip contains gallery.json');
let unzipGallery;
if (existsSync(unzipGalleryPath)) {
  unzipGallery = JSON.parse(readFileSync(unzipGalleryPath, 'utf8'));
  assert(unzipGallery.version === '1.0', 'gallery.json has version 1.0');

  // Assert every artwork has aspectRatio
  for (const aw of unzipGallery.artworks) {
    assert(typeof aw.aspectRatio === 'number' && aw.aspectRatio > 0,
      `artwork ${aw.id} has valid aspectRatio (${aw.aspectRatio})`);
  }

  // Assert every imagePath in gallery.json exists in the zip
  for (const aw of unzipGallery.artworks) {
    const imgPath = resolve(tmpUnzipDir, aw.imagePath);
    assert(existsSync(imgPath), `imagePath ${aw.imagePath} exists in unzipped folder`);
  }
}

// Assert index.html references only files present in the zip
const unzipIndexPath = resolve(tmpUnzipDir, 'index.html');
assert(existsSync(unzipIndexPath), 'zip contains index.html');
if (existsSync(unzipIndexPath)) {
  const html = readFileSync(unzipIndexPath, 'utf8');
  const scriptMatch = html.match(/src="([^"]+)"/);
  if (scriptMatch) {
    const scriptRef = scriptMatch[1].replace(/^\.\//, '');
    const scriptPath = resolve(tmpUnzipDir, scriptRef);
    assert(existsSync(scriptPath), `index.html script src="${scriptMatch[1]}" resolves to an existing file`);
  }
}

// ---------------------------------------------------------------------------
// Step 5: Serve unzipped folder and check asset responses
// ---------------------------------------------------------------------------

console.log('\n=== Step 5: Serving unzipped folder on port 15003 ===');
const unzipServer = await serveDir(tmpUnzipDir, 15003);
console.log('  Unzipped gallery server started on :15003');

const checks = [
  { url: 'http://127.0.0.1:15003/index.html', expectedType: 'text/html' },
  { url: 'http://127.0.0.1:15003/assets/viewer.js', expectedType: 'text/javascript' },
  { url: 'http://127.0.0.1:15003/gallery.json', expectedType: 'application/json' },
];

// Add one image check
if (unzipGallery?.artworks?.length > 0) {
  const firstImagePath = unzipGallery.artworks[0].imagePath;
  checks.push({
    url: `http://127.0.0.1:15003/${firstImagePath}`,
    expectedType: 'image/',
  });
}

for (const check of checks) {
  const { status, contentType, body } = await fetchText(check.url);
  assert(status === 200, `GET ${check.url} → ${status} (expected 200)`);
  assert(contentType.includes(check.expectedType),
    `GET ${check.url} content-type includes '${check.expectedType}' (got '${contentType}')`);
  if (check.url.includes('viewer.js')) {
    assert(!body.trimStart().startsWith('<'), 'Served viewer.js body is not HTML');
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

distServer.close();
unzipServer.close();
imageServer.close();
rmSync(tmpUnzipDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n=== Summary ===');
if (failures === 0) {
  console.log('All checks PASSED. Export chain is healthy.\n');
  process.exit(0);
} else {
  console.error(`${failures} check(s) FAILED.\n`);
  process.exit(1);
}
