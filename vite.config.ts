import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Newest mtime (ms) of any non-test .ts file under dir, recursively. */
function newestSourceMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSourceMtime(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

/**
 * Dev-only endpoint /__viewer-freshness: compares the newest src mtime with
 * viewer.meta.json's builtAt, so the export guard can warn precisely when the
 * packaged viewer.js is older than the sources (the stale-viewer footgun),
 * instead of guessing by age.
 */
function viewerFreshnessEndpoint(): Plugin {
  return {
    name: 'viewer-freshness',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__viewer-freshness', (_req, res) => {
        try {
          const newestSrcAt = newestSourceMtime(resolve(__dirname, 'src'));
          const metaPath = resolve(__dirname, 'public/assets/viewer.meta.json');
          let builtAt = 0;
          if (existsSync(metaPath)) {
            const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { builtAt?: string };
            builtAt = new Date(meta.builtAt ?? 0).getTime();
          }
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ stale: builtAt === 0 || newestSrcAt > builtAt, newestSrcAt, builtAt }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

export default defineConfig({
  root: resolve(__dirname),
  publicDir: resolve(__dirname, 'public'),
  base: './',
  plugins: [viewerFreshnessEndpoint()],
  build: {
    outDir: resolve(__dirname, 'dist'),
  },
});

// The viewer-only export build is invoked separately:
//   npx vite build --config vite.viewer.config.ts
// See vite.viewer.config.ts
