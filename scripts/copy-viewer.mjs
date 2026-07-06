/**
 * copy-viewer.mjs — Copy dist-viewer/viewer.js to public/assets/viewer.js
 *
 * Run after `vite build --config vite.viewer.config.ts`.
 * This makes the pre-built viewer available in:
 *   - dev: served from /assets/viewer.js (public/)
 *   - prod: included in the Vite build output (dist/assets/viewer.js)
 *
 * The file is gitignored — regenerate with `npm run build:viewer`.
 */

import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const src = resolve(root, 'dist-viewer', 'viewer.js');
const destDir = resolve(root, 'public', 'assets');
const dest = resolve(destDir, 'viewer.js');
const metaDest = resolve(destDir, 'viewer.meta.json');

if (!existsSync(src)) {
  console.error(`ERROR: ${src} does not exist. Did the viewer build succeed?`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
writeFileSync(metaDest, JSON.stringify({ builtAt: new Date().toISOString() }));
console.log(`Copied ${src} → ${dest}`);
console.log(`Wrote ${metaDest}`);
