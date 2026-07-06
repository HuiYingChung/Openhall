/**
 * vite.viewer.config.ts — Viewer-only build for the export bundle.
 *
 * Produces dist-viewer/assets/viewer.js — a self-contained ES module
 * that expects gallery.json and images/ to be co-located.
 *
 * Build with: npx vite build --config vite.viewer.config.ts
 */

import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: false,
  build: {
    outDir: 'dist-viewer',
    emptyOutDir: true,
    lib: {
      entry: 'src/viewer/viewer-entry.ts',
      name: 'OpenhallViewer',
      fileName: 'viewer',
      formats: ['es'],
    },
    rollupOptions: {
      // Three.js is bundled in (self-contained, no CDN dependency)
      external: [],
      output: {
        // Single flat file — easier for the zip bundler to fetch
        inlineDynamicImports: true,
      },
    },
  },
});
