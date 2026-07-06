import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
  },
});

// The viewer-only export build is invoked separately:
//   npx vite build --config vite.viewer.config.ts
// See vite.viewer.config.ts
