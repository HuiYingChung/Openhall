/**
 * main.ts — Entry point.
 * Delegates everything to app.ts (the full application controller).
 * In Week 1 demo mode (no key) the sample gallery loads automatically.
 */

import './ui/ui.css';
import { bootApp } from './ui/app';
import { saveWatsonxSettings, loadWatsonxSettings } from './ai/watsonx';

// ---------------------------------------------------------------------------
// Dev-only convenience: pre-fill browser settings from Vite env vars.
//
// Why this block is guarded by import.meta.env.DEV:
//   Vite strips dead code in production builds — import.meta.env.DEV compiles
//   to `false`, so the entire block is tree-shaken out. The VITE_* vars are
//   never embedded in production bundles (they don't exist in the build env).
//   This means the pre-fill logic is COMPLETELY INERT in any production build.
// ---------------------------------------------------------------------------
if (import.meta.env.DEV) {
  const envKey = import.meta.env.VITE_WATSONX_API_KEY as string | undefined;
  const envProject = import.meta.env.VITE_WATSONX_PROJECT_ID as string | undefined;
  const envWorker = import.meta.env.VITE_TOKEN_WORKER_URL as string | undefined;

  if (envKey && envProject && !loadWatsonxSettings()?.apiKey) {
    // Only pre-fill if localStorage has no settings yet — never overwrite
    // existing user settings.
    saveWatsonxSettings({
      apiKey: envKey,
      projectId: envProject,
      wxUrl: 'https://us-south.ml.cloud.ibm.com',
      tokenWorkerUrl: envWorker ?? 'http://localhost:8787',
    });
  }
}

bootApp();
