/**
 * app.ts — Main application controller.
 * Manages the state machine: settings → upload → generating → viewer → labels
 *
 * Renders the UI chrome (settings, upload, progress, label editor) over the
 * Three.js canvas. The canvas itself is always present; only the UI overlay changes.
 */

import * as THREE from 'three';
import { GallerySchema } from '../schema/gallery.schema';
import { buildScene, disposeScene } from '../viewer/room-builder';
import { FirstPersonControls } from '../viewer/controls';
import { ArtworkInteractions } from '../viewer/interactions';
import { GalleryTour } from '../viewer/tour';
import { mountHintOverlay, mountHintOverlayTouchFallback, mountRelockOverlay, shouldShowRelockOverlay, fadeThroughBlack, fadeInFromBlack } from './overlay';
import { showToast, buildErrorCard, showFieldError, translateError, type ErrorAction } from './feedback';
import { createGenerationView, buildFloorPlanSvg } from './generation-view';
import { escapeHtml } from './escape-html';
import { sanitizePlacements } from './placement-sanity';
import { resizeToDataUrl, createDisplayObjectUrl, generateFaviconDataUrl } from './image-utils';
import {
  WatsonxProvider,
  loadWatsonxSettings,
  saveWatsonxSettings,
} from '../ai/watsonx';
import {
  OpenAICompatProvider,
  loadOpenAISettings,
  saveOpenAISettings,
} from '../ai/openai-compat';
import type { AIProvider, UploadedArtwork, StylePreset } from '../ai/provider';
import { STYLE_PRESETS as PRESETS } from '../ai/provider';
import type { WorkAnalysis } from '../schema/analysis.schema';
import type { Gallery } from '../schema/gallery.schema';

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

type AppState = 'settings' | 'upload' | 'generating' | 'viewer' | 'labels';

export interface AppData {
  artworks: UploadedArtwork[];
  userBrief: string;
  preset: StylePreset;
  analyses: WorkAnalysis[];
  gallery: Gallery | null;
  /**
   * Artist-uploaded custom favicon as a data URL. When set, it overrides the
   * auto-generated (first-artwork) favicon at export time. Not persisted into
   * gallery.json — lives only for the session.
   */
  customFaviconDataUrl?: string | null;
  /**
   * Identity/branding entered on the upload screen, injected into the gallery
   * after generation (no AI needed). Editable again on the review screen.
   */
  identity?: {
    title?: string;
    description?: string;
    artistName?: string;
    artistStatement?: string;
    /** Blob object URL for the portrait — used live and for export packaging. */
    portraitObjectUrl?: string | null;
    links: { label: string; url: string }[];
  };
  /**
   * Fingerprint of the AI inputs (artwork ids + brief + preset) captured when
   * `gallery` was last generated. Lets us skip re-calling the AI (and re-billing)
   * when the user returns to a gallery whose AI inputs haven't changed.
   */
  lastGenKey?: string;
  /**
   * The AI curator's one-sentence intent from the last curation run. Session
   * only (not in gallery.json) — surfaces on the review screen and seeds the
   * gallery description when the artist hasn't written one.
   */
  curatorNote?: string;
}

/**
 * Fingerprint of the inputs that require an AI call to (re)generate a gallery.
 * Provider identity (and the OpenAI model) is part of the fingerprint —
 * switching the AI in Settings must invalidate the cache, otherwise the
 * "Continue (no AI)" path silently reuses the old provider's gallery.
 */
export function aiInputKey(data: AppData): string {
  const ids = data.artworks.map((a) => a.id).sort().join(',');
  const provider = localStorage.getItem('openhall_provider') ?? '';
  const model = provider === 'openai' ? (loadOpenAISettings()?.model ?? '') : '';
  return `${ids}|${data.userBrief.trim()}|${data.preset}|${provider}:${model}`;
}

/**
 * Normalise a user-entered link. Accepts full URLs and bare domains — prepends
 * https:// when the scheme is missing (so "instagram.com/jane" still works).
 * Returns '' when the text isn't a usable web address.
 */
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  // Bare domain-like text (has a dot, no spaces) → assume https.
  if (/^[^\s./]+\.[^\s]+$/.test(s)) return `https://${s}`;
  return '';
}

/** Human-readable label derived from a URL host (drops the leading www.). */
function urlHost(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

/** Normalise + de-junk the artist link rows into valid {label,url} entries. */
export function cleanArtistLinks(
  rows: { label: string; url: string }[]
): { label: string; url: string }[] {
  return rows
    .map((l) => ({ label: l.label.trim(), url: normalizeUrl(l.url) }))
    .filter((l) => l.url)
    .map((l) => ({ label: l.label || urlHost(l.url), url: l.url }));
}

/**
 * Fold the artist's identity/branding drafts into the gallery object. Pure data
 * work — no AI. The artist name/links also seed the export branding (author),
 * and set up the in-world artist plaque. Called before every scene build so
 * edits made on the upload/review screens take effect on the next build.
 */
function applyIdentity(gallery: Gallery, data: AppData): void {
  const idv = data.identity;
  if (!idv) return;

  if (idv.title) gallery.title = idv.title;

  const links = cleanArtistLinks(idv.links);
  const branding = { ...(gallery.branding ?? {}) };
  if (idv.description) branding.description = idv.description;
  if (idv.artistName) branding.authorName = idv.artistName;
  if (links[0]) branding.authorUrl = links[0].url;
  if (Object.keys(branding).length) gallery.branding = branding;

  if (idv.artistName) {
    gallery.artist = {
      name: idv.artistName,
      statement: idv.artistStatement,
      portraitPath: idv.portraitObjectUrl ?? undefined,
      links,
    };
  } else {
    gallery.artist = undefined;
  }
}

// ---------------------------------------------------------------------------
// Testable helper — extracted so Bug A regression can be unit-tested
// ---------------------------------------------------------------------------

/**
 * Apply the result of the generating stage: store the scene and controls
 * into the mutable refs provided by bootApp.
 *
 * Extracted as a named export so it can be unit-tested independently of the
 * DOM-heavy bootApp. The render loop reads `sceneRef.current` every frame,
 * so updating it here is what makes the gallery visible.
 */
export function applyGeneratingResult(
  sceneRef: { current: THREE.Scene },
  controlsRef: { current: FirstPersonControls | null },
  scene: THREE.Scene,
  newControls: FirstPersonControls
): void {
  sceneRef.current = scene;
  controlsRef.current = newControls;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export function bootApp(): void {
  // Create persistent canvas
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100vw', height: '100vh',
  });

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /** True when pointer lock is available (false on iOS Safari). */
  function supportsPointerLock(): boolean {
    return 'pointerLockElement' in document;
  }

  // Render loop
  const clock = new THREE.Clock();
  let controls: FirstPersonControls | null = null;
  let interactions: ArtworkInteractions | null = null;
  let tour: GalleryTour | null = null;
  let suppressNextRelock = false; // set true when we deliberately unlock for inspect panel
  // Bug 2: track the currently-mounted relock overlay's dismiss so the tour-start
  // handler can clear the Paused filter before the tour begins.
  let activeRelockDismiss: (() => void) | null = null;
  let currentScene: THREE.Scene = new THREE.Scene();
  currentScene.background = new THREE.Color(0x111111);

  function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    if (tour) {
      tour.update(delta);
    } else {
      if (!interactions?.isInspecting) {
        controls?.update(delta);
      }
      interactions?.update(delta);
    }
    renderer.render(currentScene, camera);
  }
  animate();

  // App data
  const data: AppData = {
    artworks: [],
    userBrief: '',
    preset: 'white-cube',
    analyses: [],
    gallery: null,
  };

  // UI container
  const ui = document.createElement('div');
  ui.id = 'oh-ui';
  document.body.appendChild(ui);

  // ---------------------------------------------------------------------------
  // Inline SVG icon helpers — 16 px, stroke="currentColor", fill="none"
  // ---------------------------------------------------------------------------

  /** Download arrow (⬇) */
  function svgDownload(): string {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;" aria-hidden="true"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M2 12h12"/></svg>`;
  }

  /** Route/pin glyph (🎯) */
  function svgTour(): string {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;" aria-hidden="true"><circle cx="8" cy="6.5" r="2.5"/><path d="M8 14C8 14 2.5 10 2.5 6.5a5.5 5.5 0 0 1 11 0C13.5 10 8 14 8 14z"/></svg>`;
  }

  /** Left arrow (← Menu) */
  function svgArrowLeft(): string {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;" aria-hidden="true"><path d="M10 13L4 8l6-5"/></svg>`;
  }

  // ---------------------------------------------------------------------------
  // Exit-to-menu: full teardown → setState(upload or settings)
  // ---------------------------------------------------------------------------

  /**
   * Tear down the active viewer session and return to the upload/settings screen.
   * Called from both the "← Menu" HUD button and the "Create your own gallery"
   * button inside the Paused overlay. No-op if no viewer session is running.
   */
  function exitToMenu(): void {
    // Restore the default browser-tab title on leaving the gallery.
    document.title = 'Openhall — AI 3D Gallery';
    // Dismiss any lingering Paused overlay
    if (activeRelockDismiss) { activeRelockDismiss(); activeRelockDismiss = null; }
    // Dispose the tour (removes HUD)
    if (tour) { tour.dispose(); tour = null; }
    // Dispose interactions (removes DOM elements + Three.js objects)
    interactions?.dispose(); interactions = null;
    // Unlock and dispose controls
    if (controls?.isLocked) controls.pointerLock.unlock();
    controls?.dispose(); controls = null;
    // Dispose the Three.js scene (geometries, materials, textures)
    disposeScene(currentScene);
    currentScene = new THREE.Scene();
    currentScene.background = new THREE.Color(0x111111);
    // Remove viewer HUD buttons (container removes its children too)
    document.getElementById('oh-hud-left')?.remove();
    document.getElementById('oh-export-btn')?.remove();
    document.getElementById('oh-menu-btn')?.remove();
    if (tourBtn) { tourBtn.remove(); tourBtn = null; }
    document.getElementById('oh-touch-tour-btn')?.remove();
    document.getElementById('oh-crosshair')?.remove();
    // Reset suppressNextRelock so the next session starts clean
    suppressNextRelock = false;
    // Navigate: go to upload if there is a stored key, settings otherwise
    const hasKey = !!(loadWatsonxSettings()?.apiKey || loadOpenAISettings()?.apiKey);
    setState(hasKey ? 'upload' : 'settings');
  }

  // ---------------------------------------------------------------------------
  // Viewer HUD buttons
  // ---------------------------------------------------------------------------

  // Tour HUD button and Export button (shown when in viewer state)
  let tourBtn: HTMLElement | null = null;

  /** Re-mount the tour button (no-op if it already exists or no waypoints). */
  function remountTourBtn(gallery: Gallery): void {
    if (!gallery.tour.length) return;
    if (tourBtn) return;
    showViewerButtons(gallery);
  }

  /** HUD button shared class (see ui.css). */
  const HUD_BTN_CLASS = 'oh-btn oh-btn--hud';

  /** Top-left HUD container — flex row so buttons never overlap. */
  function ensureHudLeft(): HTMLElement {
    let c = document.getElementById('oh-hud-left');
    if (!c) {
      c = document.createElement('div');
      c.id = 'oh-hud-left';
      c.style.cssText = 'position:fixed;top:1rem;left:1rem;z-index:200;display:flex;gap:0.5rem;';
      document.body.appendChild(c);
    }
    return c;
  }

  function showViewerButtons(gallery: Gallery): void {
    // Reflect the gallery title in the browser tab live (matches the exported
    // site's <title>), so it's visible without exporting.
    document.title = gallery.title?.trim() ? gallery.title : 'Openhall — AI 3D Gallery';

    // ← Menu button — always shown
    if (!document.getElementById('oh-menu-btn')) {
      const menuBtn = document.createElement('button');
      menuBtn.id = 'oh-menu-btn';
      menuBtn.innerHTML = `${svgArrowLeft()}Menu`;
      menuBtn.className = HUD_BTN_CLASS;
      menuBtn.addEventListener('click', () => exitToMenu());
      ensureHudLeft().appendChild(menuBtn);
    }

    // Export button
    if (!document.getElementById('oh-export-btn')) {
      const expBtn = document.createElement('button');
      expBtn.id = 'oh-export-btn';
      expBtn.innerHTML = `${svgDownload()}Export`;
      expBtn.className = HUD_BTN_CLASS;
      expBtn.addEventListener('click', async () => {
        if (!data.gallery) return;
        expBtn.disabled = true;
        expBtn.innerHTML = 'Building…';
        try {
          // Dev-only staleness guard. Preferred: the /__viewer-freshness dev
          // endpoint compares src mtimes against viewer.meta.json's builtAt —
          // catches "source edited after the build" precisely (the age check
          // below missed exactly that case). Fallback: age heuristic.
          if (import.meta.env.DEV) {
            let warning: string | null = null;
            try {
              const fres = await fetch('/__viewer-freshness');
              if (!fres.ok) throw new Error(`HTTP ${fres.status}`);
              const fresh = await fres.json() as { stale?: boolean; builtAt?: number };
              if (!fresh.builtAt) {
                warning = 'viewer.js has never been built — restart npm run dev.';
              } else if (fresh.stale) {
                warning = 'Source files changed AFTER viewer.js was built — the export would ship a stale engine. Restart npm run dev to rebuild.';
              }
            } catch {
              // Endpoint unavailable — fall back to the age heuristic
              try {
                const metaRes = await fetch('/assets/viewer.meta.json');
                if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`);
                const meta = await metaRes.json() as { builtAt?: string };
                if (!meta.builtAt) throw new Error('no builtAt');
                const ageMs = Date.now() - new Date(meta.builtAt).getTime();
                const ageH = Math.round(ageMs / 36e5);
                if (ageMs > 24 * 60 * 60 * 1000) {
                  warning = `viewer.js was built ${ageH}h ago — source may have changed.`;
                }
              } catch {
                warning = 'viewer.meta.json is missing — viewer.js may be stale.';
              }
            }
            if (warning) {
              const proceed = confirm(
                `${warning}\nExport anyway? (run npm run build:viewer to refresh)`
              );
              if (!proceed) {
                expBtn.disabled = false;
                expBtn.innerHTML = `${svgDownload()}Export`;
                return;
              }
            }
          }

          const { buildExportBundle, downloadZip, slugifyTitle } = await import('../export/bundler');
          const artworkUrls = new Map(data.artworks.map((a) => [a.id, a.displayObjectUrl]));
          const aspectRatios = new Map(data.artworks.map((a) => [a.id, a.aspectRatio]));

          // Demo mode: data.artworks is empty, so artworkUrls has no entries.
          // For any artwork without an entry, fetch its imagePath (same-origin) and
          // create a blob: URL so the bundler can package it.
          const demoFetches: Promise<void>[] = [];
          for (const aw of data.gallery.artworks) {
            if (!artworkUrls.has(aw.id) && aw.imagePath && !aw.imagePath.startsWith('placeholder:')) {
              demoFetches.push(
                fetch(aw.imagePath).then(async (res) => {
                  if (!res.ok) throw new Error(`Failed to fetch demo image '${aw.imagePath}': HTTP ${res.status}`);
                  const blob = await res.blob();
                  artworkUrls.set(aw.id, URL.createObjectURL(blob));
                  if (aw.aspectRatio) aspectRatios.set(aw.id, aw.aspectRatio);
                })
              );
            }
          }
          if (demoFetches.length > 0) {
            expBtn.innerHTML = 'Fetching demo images…';
            await Promise.all(demoFetches);
          }

          // Favicon: custom upload wins; otherwise auto-generate a square icon
          // from the first artwork. Failure here must not block the export.
          let faviconUrl: string | undefined = data.customFaviconDataUrl ?? undefined;
          if (!faviconUrl) {
            const firstId = data.gallery.artworks[0]?.id;
            const firstUrl = firstId ? artworkUrls.get(firstId) : undefined;
            if (firstUrl) {
              try {
                faviconUrl = await generateFaviconDataUrl(firstUrl);
              } catch {
                faviconUrl = undefined; // ship without a favicon rather than fail
              }
            }
          }

          // Artist portrait: the live gallery holds a blob:/same-origin URL in
          // artist.portraitPath; hand it to the bundler to package (it rewrites
          // the path to images/portrait.*). Undefined when there's no portrait.
          const portraitUrl = data.gallery.artist?.portraitPath || undefined;

          // Both dev and prod fetch from /assets/viewer.js (pre-built from public/).
          // Run 'npm run build:viewer' once before testing export locally.
          const viewerScriptUrl = '/assets/viewer.js';
          const { blob } = await buildExportBundle({
            gallery: data.gallery,
            artworkUrls,
            aspectRatios,
            viewerScriptUrl,
            faviconUrl,
            portraitUrl,
            onProgress: (msg, pct) => { expBtn.innerHTML = `${msg} ${pct}%`; },
          });
          const zipName = `${slugifyTitle(data.gallery.title)}.zip`;
          downloadZip(blob, zipName);
          mountExportSuccess(blob.size, zipName);
        } catch (e) {
          showToast({
            message: `Export failed: ${String(e).slice(0, 140)}`,
            tone: 'error',
            actionLabel: 'Retry',
            onAction: () => expBtn.click(),
          });
        } finally {
          expBtn.disabled = false;
          expBtn.innerHTML = `${svgDownload()}Export`;
        }
      });
      ensureHudLeft().appendChild(expBtn);
    }

    // Tour button — only if tour waypoints exist
    if (!gallery.tour.length) return;
    if (tourBtn) return;
    const btn = document.createElement('button');
    btn.id = 'oh-tour-btn';
    btn.innerHTML = `${svgTour()}Tour`;
    btn.className = HUD_BTN_CLASS;
    btn.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:200;';
    btn.addEventListener('click', () => {
      if (!data.gallery) return;
      // Bug 2: dismiss any lingering Paused overlay before the tour begins
      if (activeRelockDismiss) { activeRelockDismiss(); activeRelockDismiss = null; }
      // Bug 3: close any open inspect panel / in-progress dolly
      interactions?.close();
      // Suppress relock overlay — this unlock is intentional (tour is starting)
      if (controls?.isLocked) suppressNextRelock = true;
      controls?.pointerLock.unlock();
      tour = new GalleryTour({
        camera,
        gallery: data.gallery,
        getArtworkMesh: (id) => interactions?.getMesh(id),
        onExit: (pos) => {
          tour = null;
          // Fade hides the teleport + eye-height snap back to free walk.
          fadeThroughBlack(() => {
            camera.position.copy(pos);
            camera.position.y = 1.6;
          });
          // Re-lock pointer for free walk (still within the click's
          // transient user activation — must not wait for the fade).
          if (controls) controls.lock();
          // Bug 1: re-mount the Tour button (desktop path)
          remountTourBtn(data.gallery!);
        },
      });
      if (tourBtn) { tourBtn.remove(); tourBtn = null; }
    });
    document.body.appendChild(btn);
    tourBtn = btn;
  }

  /** Show a persistent "Start Tour" button for touch devices (no pointer lock). */
  function mountTourStartOverlay(gallery: Gallery) {
    const existing = document.getElementById('oh-touch-tour-btn');
    if (existing) return;
    const btn = document.createElement('button');
    btn.id = 'oh-touch-tour-btn';
    btn.innerHTML = `${svgTour()}Start Tour`;
    btn.className = HUD_BTN_CLASS;
    btn.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:200;
      background:rgba(0,0,0,0.85);border-color:rgba(255,255,255,0.3);
      padding:0.75rem 2rem;font-size:1rem;font-weight:600;
    `;
    btn.addEventListener('click', () => {
      btn.remove();
      if (!data.gallery) return;
      // Bug 2: dismiss any lingering Paused overlay
      if (activeRelockDismiss) { activeRelockDismiss(); activeRelockDismiss = null; }
      // Bug 3: close any open inspect panel / in-progress dolly
      interactions?.close();
      tour = new GalleryTour({
        camera,
        gallery,
        getArtworkMesh: (id) => interactions?.getMesh(id),
        onExit: (pos) => {
          tour = null;
          fadeThroughBlack(() => {
            camera.position.copy(pos);
            camera.position.y = 1.6;
          });
          mountTourStartOverlay(gallery);
        },
      });
    });
    document.body.appendChild(btn);
  }

  /** Demo mode: load the sample gallery + build scene + enter viewer (no key needed).
   *  Reachable from both the Settings screen and the upload/home screen. */
  function startDemo(): void {
          // Local loads are near-instant, but on a hosted instance the sample
          // images travel the network — never leave a click unanswered.
          const loading = showToast({ message: 'Loading demo gallery…', tone: 'info', duration: 0 });
          loadDemoGallery(data).then((gallery) => {
            loading.dismiss();
            const { scene, roomLayouts, artworkMeshes } = buildScene(gallery);
            const allAABBs = roomLayouts.flatMap((r) => r.wallAABBs);
            controls?.dispose();
            const demoControls = new FirstPersonControls(camera, document.body);
            demoControls.setWalls(allAABBs);
            const firstLayout = roomLayouts[0];
            demoControls.teleport(firstLayout.originX + 3, firstLayout.originZ + 3);
            currentScene = scene;
            controls = demoControls;

            interactions?.dispose();
            interactions = new ArtworkInteractions({
              camera,
              scene,
              artworkMeshes,
              gallery,
              onInspectOpen: () => {
                // Unlock pointer on dolly so the Close button is visible and clickable
                if (controls?.isLocked) {
                  suppressNextRelock = true;
                  controls.pointerLock.unlock();
                }
              },
              onInspectClose: () => {
                if (supportsPointerLock()) controls?.lock();
              },
              getIsLocked: () => controls?.isLocked ?? false,
            });

            function wireRelockDemo() {
              const onUnlock = () => {
                const decision = shouldShowRelockOverlay({
                  tourActive: !!tour,
                  suppress: suppressNextRelock,
                  inspecting: !!interactions?.isInspecting,
                });
                if (decision === 'clear-suppress') { suppressNextRelock = false; return; }
                if (decision === 'stay-armed') return;
                // decision === 'show-overlay'
                controls!.pointerLock.removeEventListener('unlock', onUnlock);
                const { dismiss } = mountRelockOverlay(() => controls!.lock(), exitToMenu);
                // Bug 2: track so the tour-start handler can dismiss it
                activeRelockDismiss = dismiss;
                const onRelock = () => {
                  controls!.pointerLock.removeEventListener('lock', onRelock);
                  activeRelockDismiss = null;
                  dismiss();
                  wireRelockDemo();
                };
                controls!.pointerLock.addEventListener('lock', onRelock);
              };
              controls!.pointerLock.addEventListener('unlock', onUnlock);
            }

            if (supportsPointerLock()) {
              wireRelockDemo();
              // The demo scene is already rendering behind — clear the setup
              // screen and stepper so the overlay's translucency previews the
              // gallery instead of double-exposing a leftover form.
              ui.innerHTML = '';
              renderStepper('viewer'); // removes the stepper
              // Show hint overlay then enter viewer.
              // onLock declared before mountHintOverlay so the onClose closure can reference it.
              let onLock: () => void;
              const { dismiss } = mountHintOverlay(() => controls!.lock(), () => {
                // × button: abort demo entry — tear down the built demo scene and
                // return to the menu (overlay already dismissed by mountHintOverlay).
                controls!.pointerLock.removeEventListener('lock', onLock);
                exitToMenu();
              }, { title: gallery.title, artistName: gallery.artist?.name });
              onLock = () => {
                controls!.pointerLock.removeEventListener('lock', onLock);
                dismiss();
                fadeInFromBlack();
                setState('viewer');
              };
              controls!.pointerLock.addEventListener('lock', onLock);
            } else {
              // Touch/no-pointer-lock: go straight to tour via Start Tour overlay
              setState('viewer');
              if (gallery.tour.length) {
                const { dismiss } = mountHintOverlayTouchFallback(() => {
                  dismiss();
                  fadeInFromBlack();
                  tour = new GalleryTour({
                    camera,
                    gallery,
                    getArtworkMesh: (id) => interactions?.getMesh(id),
                    onExit: (pos) => {
                      tour = null;
                      fadeThroughBlack(() => {
                        camera.position.copy(pos);
                        camera.position.y = 1.6;
                      });
                      // Re-show Start Tour button (can't re-lock on touch)
                      mountTourStartOverlay(gallery);
                    },
                  });
                }, { title: gallery.title, artistName: gallery.artist?.name });
              }
            }
          }).catch((e) => {
            loading.dismiss();
            showToast({
              message: `Demo mode failed to load: ${String(e).slice(0, 120)}`,
              tone: 'error',
              actionLabel: 'Retry',
              onAction: () => startDemo(),
            });
          });
  }

  /**
   * Non-clickable progress indicator across the setup funnel. Persisted on
   * document.body (survives ui.innerHTML resets) and hidden inside the viewer
   * to keep the 3D space immersive.
   */
  function renderStepper(state: AppState): void {
    const steps: { key: AppState; label: string }[] = [
      { key: 'settings', label: 'Settings' },
      { key: 'upload', label: 'Upload' },
      { key: 'generating', label: 'Generate' },
      { key: 'labels', label: 'Review' },
      { key: 'viewer', label: 'Gallery' },
    ];
    let el = document.getElementById('oh-stepper');
    if (state === 'viewer') { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'oh-stepper';
      el.style.cssText =
        "position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:60;pointer-events:none;" +
        "display:flex;gap:0.85rem;align-items:center;padding:0.4rem 1rem;background:rgba(13,13,13,0.72);" +
        "backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.08);border-top:none;" +
        "border-radius:0 0 10px 10px;font-family:-apple-system,'Segoe UI',system-ui,sans-serif;";
      document.body.appendChild(el);
    }
    const activeIdx = steps.findIndex((s) => s.key === state);
    el.innerHTML = steps
      .map((s, i) => {
        const active = i === activeIdx;
        const done = i < activeIdx;
        const color = active ? '#fff' : done ? '#8a8f98' : '#5a5a5a';
        const dot = active ? '#fff' : done ? '#6a9a6a' : '#3a3a3a';
        return `<span style="display:flex;align-items:center;gap:0.35rem;color:${color};font-size:0.72rem;font-weight:${active ? 700 : 400};white-space:nowrap;">
          <span style="width:7px;height:7px;border-radius:50%;background:${dot};"></span>${s.label}
        </span>`;
      })
      .join('');
  }

  function setState(state: AppState) {
    ui.innerHTML = '';
    renderStepper(state);
    switch (state) {
      case 'settings': {
        const hasKey = !!(loadWatsonxSettings()?.apiKey || loadOpenAISettings()?.apiKey);
        renderSettings(ui, data, () => setState('upload'), startDemo, hasKey ? () => setState('upload') : undefined);
        break;
      }

      case 'upload': renderUpload(ui, data, () => setState('generating'), () => setState('settings'), startDemo); break;
      case 'generating': renderGenerating(ui, data, camera,
        (s, newControls, gallery, artworkMeshes) => {
          // Dispose old scene first to prevent geometry/texture leaks on regeneration.
          disposeScene(currentScene);
          currentScene = s;
          controls = newControls;

          // Set up / replace artwork interactions
          interactions?.dispose();
          interactions = new ArtworkInteractions({
            camera,
            scene: s,
            artworkMeshes,
            gallery,
            onInspectOpen: () => {
              // Unlock pointer on dolly so the Close button is visible and clickable
              if (controls?.isLocked) {
                suppressNextRelock = true;
                controls.pointerLock.unlock();
              }
            },
            onInspectClose: () => {
              if (supportsPointerLock()) controls?.lock();
            },
            getIsLocked: () => controls?.isLocked ?? false,
          });

          // Wire Esc → relock. Re-registers after each cycle so
          // repeated Esc → click → Esc sequences all work.
          // Three.js EventDispatcher has no { once } option — we remove manually.
          function wireRelock() {
            const onUnlock = () => {
              const decision = shouldShowRelockOverlay({
                tourActive: !!tour,
                suppress: suppressNextRelock,
                inspecting: !!interactions?.isInspecting,
              });
              if (decision === 'clear-suppress') { suppressNextRelock = false; return; }
              if (decision === 'stay-armed') return;
              // decision === 'show-overlay'
              controls!.pointerLock.removeEventListener('unlock', onUnlock);
              const { dismiss } = mountRelockOverlay(() => controls!.lock(), exitToMenu);
              // Bug 2: track so the tour-start handler can dismiss it
              activeRelockDismiss = dismiss;
              const onRelock = () => {
                controls!.pointerLock.removeEventListener('lock', onRelock);
                activeRelockDismiss = null;
                dismiss();
                wireRelock(); // re-arm for next Esc
              };
              controls!.pointerLock.addEventListener('lock', onRelock);
            };
            controls!.pointerLock.addEventListener('unlock', onUnlock);
          }
          if (supportsPointerLock()) wireRelock();

          setState('labels');
        },
        (err) => {
          // Failure keeps the user on a recoverable error screen instead of
          // bouncing to upload — uploads/brief live in `data` and are kept.
          const t = translateError(err);
          const actionDefs: Record<ErrorAction, { label: string; primary?: boolean; onClick: () => void }> = {
            retry: { label: 'Try again', primary: true, onClick: () => setState('generating') },
            settings: { label: 'Open settings', onClick: () => setState('settings') },
            back: { label: 'Back to edit', onClick: () => setState('upload') },
          };
          ui.innerHTML = '';
          const screen = document.createElement('div');
          screen.className = 'oh-screen oh-screen--center';
          const card = buildErrorCard({
            title: t.title,
            hint: t.hint,
            detail: t.detail,
            actions: t.actions.map((a) => actionDefs[a]),
          });
          screen.appendChild(card);
          ui.appendChild(screen);
          card.focus();
        }); break;
      case 'viewer': {
        // Remove UI overlay and show viewer HUD buttons
        ui.innerHTML = '';
        if (data.gallery) showViewerButtons(data.gallery);
        break;
      }
      case 'labels': renderLabels(ui, data, () => setState('viewer'), () => controls, exitToMenu); break;
    }
  }

  // Check if settings exist — if not, go to settings first
  const hasWatsonx = !!loadWatsonxSettings()?.apiKey;
  const hasOpenAI = !!loadOpenAISettings()?.apiKey;
  setState(hasWatsonx || hasOpenAI ? 'upload' : 'settings');
}

// ---------------------------------------------------------------------------
// Export success panel — the "owned by artists" handoff
// ---------------------------------------------------------------------------

/**
 * Shown right after the export zip download starts. Tells the artist what
 * they just received and gives the fastest verified path to a live site
 * (dragging the zip onto Netlify Drop). The zip itself carries PUBLISH.md
 * with the full instructions. App chrome only — never part of the export.
 */
function mountExportSuccess(zipBytes: number, zipName = 'openhall-export.zip'): void {
  document.getElementById('oh-export-success')?.remove();
  const sizeMb = (zipBytes / 1048576).toFixed(1);
  const wrap = document.createElement('div');
  wrap.id = 'oh-export-success';
  wrap.className = 'oh-screen oh-screen--center';
  wrap.style.zIndex = '300';
  wrap.innerHTML = `
    <div class="oh-panel" role="dialog" aria-labelledby="oh-export-success-title" style="max-width:440px;">
      <h2 id="oh-export-success-title" style="margin:0 0 0.35rem;font-size:1.25rem;">Your gallery is downloading</h2>
      <p style="color:var(--oh-ink-muted);font-size:0.85rem;margin:0 0 1rem;">
        <strong style="color:var(--oh-ink);">${escapeHtml(zipName)}</strong> (${sizeMb} MB) is a complete
        website you own — no Openhall account, no subscription, no lock-in.
      </p>
      <div style="background:var(--oh-field);border:1px solid var(--oh-border);border-radius:8px;padding:0.8rem 0.95rem;margin:0 0 0.9rem;">
        <p style="margin:0 0 0.35rem;font-size:0.88rem;font-weight:600;">Get it live in minutes</p>
        <p style="margin:0;font-size:0.82rem;color:var(--oh-ink-dim);line-height:1.55;">
          Sign in to <strong>Netlify Drop</strong> (free account), then drag the
          zip file onto the page — no unzipping needed. You'll get a shareable
          URL right away.
        </p>
      </div>
      <div style="display:flex;gap:0.6rem;margin:0 0 0.85rem;">
        <a href="https://app.netlify.com/drop" target="_blank" rel="noopener"
          class="oh-btn oh-btn--primary" style="flex:1;text-align:center;text-decoration:none;display:inline-block;box-sizing:border-box;">Open Netlify Drop</a>
        <button id="oh-export-success-done" class="oh-btn oh-btn--ghost" style="flex:0 0 auto;">Done</button>
      </div>
      <p class="oh-help" style="margin:0;">
        Prefer GitHub Pages or your own host? The zip includes
        <strong style="color:var(--oh-ink-muted);">PUBLISH.md</strong> with step-by-step instructions.
      </p>
    </div>`;
  document.body.appendChild(wrap);
  const done = wrap.querySelector('#oh-export-success-done') as HTMLButtonElement;
  done.addEventListener('click', () => wrap.remove());
  wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
  done.focus();
}

// ---------------------------------------------------------------------------
// Module-level inline SVG icons (14 px, stroke=currentColor) — used by the
// setup screens. Site rule: never emoji / emoji-rendered glyphs (✓ ⚠️ etc.).
// ---------------------------------------------------------------------------

/** Check mark — success/cache-hit hints. */
function svgCheck(): string {
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;" aria-hidden="true"><path d="M2.5 8.5l3.5 3.5 7-8"/></svg>`;
}

/** Warning triangle — cost/credit hints. */
function svgWarn(): string {
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;" aria-hidden="true"><path d="M8 2.2L14.8 13.4H1.2L8 2.2z"/><path d="M8 6.5v3.2"/><circle cx="8" cy="11.6" r="0.4" fill="currentColor"/></svg>`;
}

/** Openhall wordmark — arch glyph + text. App chrome only (not the export bundle). */
function wordmark(sizeRem = 1.6): string {
  const px = Math.round(sizeRem * 16);
  return `<span class="oh-wordmark"><svg width="${px}" height="${px}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.45"/><path d="M10 24 V14 a6 6 0 0 1 12 0 V24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="8" y1="24" x2="24" y2="24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><span style="font-size:${sizeRem}rem;font-weight:700;letter-spacing:0.01em;">Openhall</span></span>`;
}

// ---------------------------------------------------------------------------
// Settings screen
// ---------------------------------------------------------------------------

function renderSettings(
  container: HTMLElement,
  _data: AppData,
  onDone: () => void,
  onDemo: () => void,
  onCancel?: () => void
): void {
  const wx = loadWatsonxSettings();
  const oai = loadOpenAISettings();
  const storedProvider = localStorage.getItem('openhall_provider');
  const providerDefault =
    storedProvider === 'watsonx' || storedProvider === 'openai'
      ? storedProvider
      : wx?.apiKey
        ? 'watsonx'
        : 'openai';

  container.innerHTML = `
    <div class="oh-screen oh-screen--center">
      <div class="oh-panel">
        <h2 style="margin:0 0 0.25rem;font-size:1.4rem;">API Settings</h2>
        <p style="color:var(--oh-ink-muted);font-size:0.85rem;margin:0 0 1.5rem;">Keys are stored in your browser only and never sent anywhere except directly to the AI provider.</p>

        <label class="oh-label" style="font-size:0.9rem;margin-bottom:0.5rem;">Provider</label>
        <select id="oh-provider" class="oh-field" style="margin-bottom:1rem;">
          <option value="watsonx" ${providerDefault === 'watsonx' ? 'selected' : ''}>IBM watsonx.ai (Granite + Llama Vision)</option>
          <option value="openai" ${providerDefault === 'openai' ? 'selected' : ''}>OpenAI-compatible (OpenAI, Together, etc.)</option>
        </select>

        <div id="oh-watsonx-fields" style="display:${providerDefault === 'watsonx' ? 'block' : 'none'}">
          <label class="oh-label">IBM Cloud API Key</label>
          <input id="oh-wx-key" class="oh-field" type="password" placeholder="ApiKey-..." style="margin-bottom:0.75rem;" />
          <label class="oh-label">watsonx Project ID (UUID)</label>
          <input id="oh-wx-project" class="oh-field" type="text" placeholder="xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx" style="margin-bottom:0.75rem;" />
          <label class="oh-label">Token Worker URL <span style="color:var(--oh-ink-muted);">(leave blank if deploying locally)</span></label>
          <input id="oh-wx-worker" class="oh-field" type="text" placeholder="https://your-worker.workers.dev" style="margin-bottom:0.75rem;" />
          <p class="oh-help" style="margin:0 0 1rem;">
            The token worker proxies IBM IAM authentication (required for browser use).<br>
            Deploy <code>worker/token-exchange.ts</code> to Cloudflare Workers — it's free.
          </p>
        </div>

        <div id="oh-openai-fields" style="display:${providerDefault === 'openai' ? 'block' : 'none'}">
          <label class="oh-label">API Key</label>
          <input id="oh-oai-key" class="oh-field" type="password" placeholder="sk-..." style="margin-bottom:0.75rem;" />
          <label class="oh-label">Base URL</label>
          <input id="oh-oai-url" class="oh-field" type="text" placeholder="https://api.openai.com/v1" style="margin-bottom:0.75rem;" />
          <label class="oh-label">Model</label>
          <input id="oh-oai-model" class="oh-field" type="text" placeholder="gpt-4o" style="margin-bottom:0.35rem;" />
          <p class="oh-help" style="margin:0 0 1rem;">Must support image input (vision) — gpt-4o is a safe default. Text-only models will fail at artwork analysis.</p>
        </div>

        <p id="oh-settings-error" class="oh-field-error" style="display:none;margin:0 0 0.75rem;" role="alert"></p>
        <div style="display:flex;gap:0.75rem;">
          ${onCancel ? `<button id="oh-cancel-settings" class="oh-btn oh-btn--ghost" style="flex:0 0 auto;padding:0.7rem 1.2rem;font-size:1rem;">Cancel</button>` : ''}
          <button id="oh-save-settings" class="oh-btn oh-btn--primary" style="flex:1;padding:0.7rem;font-size:1rem;">Save & Continue</button>
        </div>
        <p style="font-size:0.75rem;color:#555;margin:1rem 0 0;text-align:center;">No key? Try the <button id="oh-demo-btn" class="oh-btn--link" style="color:var(--oh-ink-muted);font-size:0.75rem;">demo mode</button> instead.</p>
      </div>
    </div>`;

  const providerSel = container.querySelector('#oh-provider') as HTMLSelectElement;
  const wxFields = container.querySelector('#oh-watsonx-fields') as HTMLElement;
  const oaiFields = container.querySelector('#oh-openai-fields') as HTMLElement;

  // Set field values via .value assignment (safe with special characters in keys)
  (container.querySelector('#oh-wx-key') as HTMLInputElement).value = wx?.apiKey ?? '';
  (container.querySelector('#oh-wx-project') as HTMLInputElement).value = wx?.projectId ?? '';
  (container.querySelector('#oh-wx-worker') as HTMLInputElement).value = wx?.tokenWorkerUrl ?? '';
  (container.querySelector('#oh-oai-key') as HTMLInputElement).value = oai?.apiKey ?? '';
  (container.querySelector('#oh-oai-url') as HTMLInputElement).value = oai?.baseUrl ?? 'https://api.openai.com/v1';
  (container.querySelector('#oh-oai-model') as HTMLInputElement).value = oai?.model ?? 'gpt-4o';

  providerSel.addEventListener('change', () => {
    wxFields.style.display = providerSel.value === 'watsonx' ? 'block' : 'none';
    oaiFields.style.display = providerSel.value === 'openai' ? 'block' : 'none';
  });

  container.querySelector('#oh-save-settings')!.addEventListener('click', () => {
    const errEl = container.querySelector('#oh-settings-error') as HTMLElement;
    if (providerSel.value === 'watsonx') {
      const keyEl = container.querySelector('#oh-wx-key') as HTMLInputElement;
      const projEl = container.querySelector('#oh-wx-project') as HTMLInputElement;
      const key = keyEl.value.trim();
      const proj = projEl.value.trim();
      const worker = (container.querySelector('#oh-wx-worker') as HTMLInputElement).value.trim();
      if (!key || !proj) {
        const missing = [!key ? keyEl : null, !proj ? projEl : null].filter(Boolean) as HTMLElement[];
        showFieldError(errEl, 'API key and Project ID are required for watsonx.', missing);
        return;
      }
      saveWatsonxSettings({ apiKey: key, projectId: proj, wxUrl: 'https://us-south.ml.cloud.ibm.com', tokenWorkerUrl: worker });
    } else {
      const keyEl = container.querySelector('#oh-oai-key') as HTMLInputElement;
      const key = keyEl.value.trim();
      const url = (container.querySelector('#oh-oai-url') as HTMLInputElement).value.trim();
      const model = (container.querySelector('#oh-oai-model') as HTMLInputElement).value.trim();
      if (!key) {
        showFieldError(errEl, 'API key is required.', [keyEl]);
        return;
      }
      saveOpenAISettings({
        apiKey: key,
        baseUrl: (url || 'https://api.openai.com/v1').replace(/\/+$/, ''),
        model: model || 'gpt-4o',
      });
    }
    localStorage.setItem('openhall_provider', providerSel.value);
    onDone();
  });

  if (onCancel) {
    container.querySelector('#oh-cancel-settings')?.addEventListener('click', () => {
      onCancel!();
    });
  }

  container.querySelector('#oh-demo-btn')!.addEventListener('click', () => {
    onDemo();
  });
}

async function loadDemoGallery(data: AppData): Promise<Gallery> {
  // DEMO FALLBACK: load pre-generated sample gallery
  const { default: sampleGallery } = await import('../demo/sample-gallery.json');
  const result = GallerySchema.safeParse(sampleGallery);
  if (!result.success) throw new Error('Demo gallery schema invalid');
  const gallery = result.data;

  // Attach a sample artist so the demo showcases the in-world artist wall.
  // Injected at runtime (not in sample-gallery.json) to keep test fixtures clean.
  if (!gallery.artist) {
    gallery.artist = {
      name: 'Camille Aurnette',
      statement:
        'A fictional curator-artist created to demo Openhall. This wall is generated from your name, statement, and links — click it, or start the tour, to see how visitors meet the artist.',
      links: [
        { label: 'Website', url: 'https://example.com' },
        { label: 'Instagram', url: 'https://instagram.com' },
      ],
    };
  }

  data.gallery = gallery;
  data.artworks = [];
  return gallery;
}

// ---------------------------------------------------------------------------
// Upload screen
// ---------------------------------------------------------------------------

function renderUpload(
  container: HTMLElement,
  data: AppData,
  onGenerate: () => void,
  onSettings: () => void,
  onDemo: () => void
): void {
  const idv = (data.identity ??= { links: [] });
  const linkRows = [0, 1, 2]
    .map((i) => {
      const l = idv.links[i] ?? { label: '', url: '' };
      return `<div style="display:flex;gap:0.5rem;margin-bottom:0.4rem;">
        <input data-link-idx="${i}" data-link-field="label" class="oh-field" type="text" value="${escapeHtml(l.label)}" placeholder="Label (e.g. Instagram)" aria-label="Link label"
          style="flex:1;min-width:0;padding:0.45rem;font-size:0.85rem;">
        <input data-link-idx="${i}" data-link-field="url" class="oh-field" type="url" value="${escapeHtml(l.url)}" placeholder="https://…" aria-label="Link URL"
          style="flex:1.4;min-width:0;padding:0.45rem;font-size:0.85rem;">
      </div>`;
    })
    .join('');
  container.innerHTML = `
    <div class="oh-screen">
      <div style="max-width:760px;margin:0 auto;padding:2rem;width:100%;box-sizing:border-box;">

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
          <h1 style="margin:0;font-size:1.6rem;line-height:1;">${wordmark(1.6)}</h1>
          <button id="oh-to-settings" class="oh-btn oh-btn--ghost" style="padding:0.4rem 0.8rem;font-size:0.85rem;">Settings</button>
        </div>

        <p style="color:var(--oh-ink-dim);font-size:0.92rem;margin:0 0 0.8rem;">Turn up to 10 artworks into a walkable 3D gallery — fully AI-generated, exportable as a website you own.</p>
        <div style="display:flex;flex-wrap:wrap;gap:0.35rem 1.2rem;margin-bottom:0.6rem;color:var(--oh-ink-muted);font-size:0.8rem;">
          <span><span style="color:#ddd;font-weight:600;">1</span> · Upload your artworks</span>
          <span><span style="color:#ddd;font-weight:600;">2</span> · Describe the show and pick a style</span>
          <span><span style="color:#ddd;font-weight:600;">3</span> · AI designs the gallery</span>
          <span><span style="color:#ddd;font-weight:600;">4</span> · Walk through it, then export</span>
        </div>
        <p style="color:var(--oh-ink-muted);font-size:0.8rem;margin:0 0 1.5rem;">
          First time here? Add your AI API key via the <span style="color:#ccc;">Settings</span> button (top right) —
          or <button id="oh-home-demo" class="oh-btn--link" style="font-size:0.8rem;">view the demo gallery</button> first, no key needed.
        </p>

        <div id="oh-dropzone" class="oh-dropzone" style="margin-bottom:1rem;">
          <p style="font-size:1.1rem;margin:0 0 0.5rem;">Drop artworks here, or click to browse</p>
          <p style="color:var(--oh-ink-faint);font-size:0.85rem;margin:0;">Up to 10 images · JPEG, PNG, WebP</p>
          <input id="oh-file-input" type="file" multiple accept="image/jpeg,image/png,image/webp" style="display:none;" />
        </div>

        <div id="oh-thumbnail-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:1rem;margin-bottom:1.5rem;"></div>

        <label class="oh-label" style="font-size:0.9rem;margin-bottom:0.2rem;">Describe your exhibition in one sentence</label>
        <p class="oh-help" style="color:#777;margin:0 0 0.5rem;">This shapes how your works are grouped into rooms, the tour order, and the tone of the wall labels.</p>
        <textarea id="oh-brief" class="oh-field" rows="2" placeholder="e.g. A series of abstract landscapes exploring the tension between the natural world and urban decay"
          style="padding:0.6rem;font-size:0.95rem;margin-bottom:1rem;">${data.userBrief}</textarea>
        <p id="oh-brief-error" class="oh-field-error" style="display:none;margin:-0.6rem 0 1rem;" role="alert"></p>

        <label class="oh-label" style="font-size:0.9rem;margin-bottom:0.5rem;">Gallery style</label>
        <div id="oh-presets" style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.5rem;margin-bottom:1.5rem;"></div>

        <details style="margin-bottom:1.5rem;border:1px solid #2a2a2a;border-radius:10px;padding:0.5rem 1rem 0.25rem;">
          <summary style="cursor:pointer;font-size:0.95rem;font-weight:600;padding:0.35rem 0;">About you &amp; your gallery <span style="color:#777;font-weight:400;">(optional)</span></summary>
          <p class="oh-help" style="color:#777;margin:0.25rem 0 0.9rem;">Sets your gallery's title, share preview, browser icon, and an in-world artist wall visitors can click. You can review and change all of this before entering.</p>

          <label class="oh-label" style="font-size:0.82rem;color:#bbb;">Gallery title</label>
          <input id="oh-id-title" class="oh-field" type="text" value="${escapeHtml(idv.title ?? '')}" placeholder="Leave blank to let AI name it" aria-label="Gallery title"
            style="margin-bottom:0.75rem;">

          <label class="oh-label" style="font-size:0.82rem;color:#bbb;">One-line description</label>
          <textarea id="oh-id-desc" class="oh-field" rows="2" placeholder="Shown in the browser tab and when your gallery is shared" aria-label="Gallery description"
            style="margin-bottom:0.75rem;">${escapeHtml(idv.description ?? '')}</textarea>

          <div style="display:flex;gap:0.55rem;align-items:center;flex-wrap:wrap;margin-bottom:0.9rem;">
            <img id="oh-id-favicon-preview" alt="" style="width:36px;height:36px;border-radius:8px;border:1px solid var(--oh-border);object-fit:cover;background:var(--oh-panel);">
            <label id="oh-id-favicon-label" for="oh-id-favicon" class="oh-toggle">Upload favicon</label>
            <button id="oh-id-favicon-reset" type="button" class="oh-toggle">Auto from artwork</button>
            <span id="oh-id-favicon-status" style="font-size:0.75rem;color:#8a8f98;"></span>
            <input id="oh-id-favicon" type="file" accept="image/*" style="display:none;">
          </div>

          <div style="height:1px;background:#2a2a2a;margin:0.5rem 0 0.9rem;"></div>

          <label class="oh-label" style="font-size:0.82rem;color:#bbb;">Your name / studio</label>
          <input id="oh-id-name" class="oh-field" type="text" maxlength="80" value="${escapeHtml(idv.artistName ?? '')}" placeholder="Shown on a clickable artist wall in the gallery" aria-label="Artist name"
            style="margin-bottom:0.75rem;">

          <label class="oh-label" style="font-size:0.82rem;color:#bbb;">Short statement / bio</label>
          <textarea id="oh-id-statement" class="oh-field" rows="3" maxlength="400" placeholder="A few sentences about you or this body of work (the wall shows a preview; the full text appears when visitors click it)" aria-label="Artist statement"
            style="margin-bottom:0.75rem;">${escapeHtml(idv.artistStatement ?? '')}</textarea>

          <div style="display:flex;gap:0.55rem;align-items:center;flex-wrap:wrap;margin-bottom:0.9rem;">
            <img id="oh-id-portrait-preview" alt="" style="width:44px;height:44px;border-radius:50%;border:1px solid var(--oh-border);object-fit:cover;background:var(--oh-panel);">
            <label id="oh-id-portrait-label" for="oh-id-portrait" class="oh-toggle">Upload portrait</label>
            <button id="oh-id-portrait-reset" type="button" class="oh-toggle">Use initials</button>
            <span id="oh-id-portrait-status" style="font-size:0.75rem;color:#8a8f98;"></span>
            <input id="oh-id-portrait" type="file" accept="image/*" style="display:none;">
          </div>

          <label class="oh-label" style="font-size:0.82rem;color:#bbb;margin-bottom:0.35rem;">Links</label>
          ${linkRows}
        </details>

        <button id="oh-generate-btn" class="oh-btn oh-btn--primary" style="width:100%;padding:0.85rem;font-size:1rem;font-weight:700;" disabled>
          Generate Gallery →
        </button>
        <p id="oh-gen-hint" style="font-size:0.78rem;margin:0.5rem 0 0;text-align:center;"></p>
      </div>
    </div>`;

  const dropzone = container.querySelector('#oh-dropzone') as HTMLElement;
  const fileInput = container.querySelector('#oh-file-input') as HTMLInputElement;
  const thumbnailGrid = container.querySelector('#oh-thumbnail-grid') as HTMLElement;
  const generateBtn = container.querySelector('#oh-generate-btn') as HTMLButtonElement;
  const briefInput = container.querySelector('#oh-brief') as HTMLTextAreaElement;
  const presetsEl = container.querySelector('#oh-presets') as HTMLElement;

  container.querySelector('#oh-to-settings')!.addEventListener('click', onSettings);
  container.querySelector('#oh-home-demo')!.addEventListener('click', onDemo);

  // Set by the two-step-confirm wiring below; lets input changes cancel a
  // pending "click again to confirm" state (the AI key just changed).
  let disarmOnInputChange: () => void = () => {};

  // Preset buttons
  const presetKeys = Object.keys(PRESETS) as StylePreset[];
  for (const key of presetKeys) {
    const btn = document.createElement('button');
    btn.dataset['preset'] = key;
    btn.className = `oh-preset${data.preset === key ? ' is-selected' : ''}`;
    btn.innerHTML = `<strong>${PRESETS[key].label}</strong><br><span class="oh-preset-desc">${PRESETS[key].description}</span>`;
    btn.addEventListener('click', () => {
      data.preset = key;
      presetsEl.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('is-selected', (b as HTMLButtonElement).dataset['preset'] === key);
      });
      disarmOnInputChange(); // style is part of the AI key → refresh hint + cancel arm
    });
    presetsEl.appendChild(btn);
  }

  // Brief
  briefInput.addEventListener('input', () => { data.userBrief = briefInput.value; disarmOnInputChange(); });

  // File handling
  const genHint = container.querySelector('#oh-gen-hint') as HTMLElement;
  function updateGenerateBtn() {
    const ready = data.artworks.length > 0 && data.artworks.length <= 10;
    generateBtn.disabled = !ready;
    // Cache state drives both the button label and the cost hint below it.
    const cached = !!data.gallery && data.lastGenKey === aiInputKey(data);
    const hadGallery = !!data.gallery;
    generateBtn.textContent = cached ? 'Continue → (no AI, no cost)' : 'Generate Gallery →';
    if (cached) {
      genHint.innerHTML = `${svgCheck()}Same artworks, description &amp; style — continues with no new AI call.`;
      genHint.className = 'oh-hint--ok';
    } else if (hadGallery) {
      // They already had a gallery and changed the artworks/description/style/provider.
      genHint.innerHTML = `${svgWarn()}You changed the artworks, description, style, or AI provider — this re-runs the AI and may use API credits.`;
      genHint.className = 'oh-hint--warn';
    } else if (ready) {
      // First generation — also calls the AI, so warn just as clearly.
      genHint.innerHTML = `${svgWarn()}This runs the AI to build your gallery and may use API credits.`;
      genHint.className = 'oh-hint--warn';
    } else {
      genHint.textContent = '';
    }
  }

  // --- Identity / branding wiring ---
  const favPrev = container.querySelector('#oh-id-favicon-preview') as HTMLImageElement;
  const portPrev = container.querySelector('#oh-id-portrait-preview') as HTMLImageElement;
  const favInput = container.querySelector('#oh-id-favicon') as HTMLInputElement;
  const portInput = container.querySelector('#oh-id-portrait') as HTMLInputElement;
  const favLabel = container.querySelector('#oh-id-favicon-label') as HTMLElement;
  const favReset = container.querySelector('#oh-id-favicon-reset') as HTMLElement;
  const favStatus = container.querySelector('#oh-id-favicon-status') as HTMLElement;
  const portLabel = container.querySelector('#oh-id-portrait-label') as HTMLElement;
  const portReset = container.querySelector('#oh-id-portrait-reset') as HTMLElement;
  const portStatus = container.querySelector('#oh-id-portrait-status') as HTMLElement;

  // Toggle styling so the currently-selected source is obviously highlighted.
  const setToggle = (uploaded: boolean, uploadEl: HTMLElement, resetEl: HTMLElement) => {
    uploadEl.classList.toggle('is-active', uploaded);
    resetEl.classList.toggle('is-active', !uploaded);
  };

  // Small initials avatar for the portrait preview when "Use initials" is active.
  const initialsDataUrl = (name: string): string => {
    const s = 88;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#3a3a3a';
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); ctx.fill();
    const initials = (name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
    ctx.fillStyle = '#e6e6e6';
    ctx.font = '700 40px -apple-system, "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, s / 2, s / 2 + 3);
    return c.toDataURL('image/png');
  };

  const refreshFav = () => {
    const uploaded = !!data.customFaviconDataUrl;
    favPrev.src = data.customFaviconDataUrl ?? (data.artworks[0]?.displayObjectUrl ?? '');
    setToggle(uploaded, favLabel, favReset);
    favStatus.textContent = uploaded
      ? 'Current: your icon'
      : data.artworks.length
        ? 'Current: auto (first artwork)'
        : 'Current: auto (add an artwork first)';
  };
  const refreshPort = () => {
    const uploaded = !!idv.portraitObjectUrl;
    portPrev.src = uploaded ? idv.portraitObjectUrl! : initialsDataUrl(idv.artistName ?? '');
    setToggle(uploaded, portLabel, portReset);
    portStatus.textContent = uploaded ? 'Current: your photo' : 'Current: initials';
  };
  refreshFav();
  refreshPort();

  container.querySelector('#oh-id-title')!.addEventListener('input', (e) => {
    idv.title = (e.target as HTMLInputElement).value || undefined;
  });
  container.querySelector('#oh-id-desc')!.addEventListener('input', (e) => {
    idv.description = (e.target as HTMLTextAreaElement).value || undefined;
  });
  container.querySelector('#oh-id-name')!.addEventListener('input', (e) => {
    idv.artistName = (e.target as HTMLInputElement).value || undefined;
    if (!idv.portraitObjectUrl) refreshPort(); // keep the initials preview in sync
  });
  container.querySelector('#oh-id-statement')!.addEventListener('input', (e) => {
    idv.artistStatement = (e.target as HTMLTextAreaElement).value || undefined;
  });
  for (const inp of Array.from(container.querySelectorAll('[data-link-idx]'))) {
    inp.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      const i = Number(el.dataset['linkIdx']);
      const field = el.dataset['linkField'] as 'label' | 'url';
      const cur = idv.links[i] ?? { label: '', url: '' };
      idv.links[i] = { ...cur, [field]: el.value };
    });
  }
  favInput.addEventListener('change', async () => {
    const file = favInput.files?.[0];
    if (!file) return;
    try {
      data.customFaviconDataUrl = await generateFaviconDataUrl(URL.createObjectURL(file));
      refreshFav();
    } catch { showToast({ message: 'Could not read that image. Try a PNG or JPG.', tone: 'error', duration: 6000 }); }
  });
  favReset.addEventListener('click', () => {
    data.customFaviconDataUrl = null;
    favInput.value = '';
    refreshFav();
  });
  portInput.addEventListener('change', () => {
    const file = portInput.files?.[0];
    if (!file) return;
    idv.portraitObjectUrl = createDisplayObjectUrl(file);
    refreshPort();
  });
  portReset.addEventListener('click', () => {
    idv.portraitObjectUrl = null;
    portInput.value = '';
    refreshPort();
  });

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remaining = 10 - data.artworks.length;
    const toProcess = Array.from(files).slice(0, remaining);

    for (const file of toProcess) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) continue;
      const { dataUrl: analysisDataUrl, width, height } = await resizeToDataUrl(file, 1024);
      const displayObjectUrl = createDisplayObjectUrl(file);
      const id = `aw-${String(data.artworks.length + 1).padStart(2, '0')}`;
      const artwork: UploadedArtwork = {
        id, filename: file.name, analysisDataUrl, displayObjectUrl,
        aspectRatio: width / height, title: '', medium: '', year: undefined,
      };
      data.artworks.push(artwork);
      addThumbnail(thumbnailGrid, artwork, data);
    }
    disarmOnInputChange(); // refreshes label/hint + cancels a pending confirm
    refreshFav(); // the auto favicon derives from the first artwork
  }

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('is-dragover'); });
  dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('is-dragover'); });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    handleFiles(e.dataTransfer?.files ?? null);
  });
  fileInput.addEventListener('change', () => handleFiles(fileInput.files));

  // Re-render existing artworks
  for (const aw of data.artworks) addThumbnail(thumbnailGrid, aw, data);
  updateGenerateBtn();

  // Two-step confirm — guards ONLY the billable path (a real AI call). The
  // cached "Continue" path is free, so it stays a single click.
  let armed = false;
  let armTimer: ReturnType<typeof setTimeout> | undefined;
  function disarmGenerate() {
    if (armTimer) { clearTimeout(armTimer); armTimer = undefined; }
    armed = false;
    generateBtn.classList.remove('oh-btn--armed');
    updateGenerateBtn(); // refreshes label + cost hint
  }
  // Expose so the input handlers can cancel a stale armed state.
  disarmOnInputChange = disarmGenerate;

  generateBtn.addEventListener('click', () => {
    data.userBrief = briefInput.value.trim();
    if (!data.userBrief) {
      const errEl = container.querySelector('#oh-brief-error') as HTMLElement;
      showFieldError(errEl, 'Add a one-sentence description of your exhibition.', [briefInput]);
      briefInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    const willCallAI = !(data.gallery && data.lastGenKey === aiInputKey(data));
    if (willCallAI && !armed) {
      // First click arms; a second click within the window confirms.
      armed = true;
      generateBtn.innerHTML = `${svgWarn()}Click again to confirm — this uses API credits`;
      generateBtn.classList.add('oh-btn--armed');
      armTimer = setTimeout(disarmGenerate, 4500);
      return;
    }
    disarmGenerate();
    onGenerate();
  });
}

function addThumbnail(grid: HTMLElement, artwork: UploadedArtwork, data: AppData): void {
  const card = document.createElement('div');
  card.style.cssText = 'background:var(--oh-panel);border-radius:8px;overflow:hidden;border:1px solid var(--oh-border);';
  card.innerHTML = `
    <div style="position:relative;">
      <img src="${artwork.displayObjectUrl}" style="width:100%;height:100px;object-fit:cover;display:block;" />
      <button data-remove="${escapeHtml(artwork.id)}" aria-label="Remove artwork" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.75rem;padding:2px 6px;">✕</button>
    </div>
    <div style="padding:0.4rem;">
      <input data-field="title" data-id="${escapeHtml(artwork.id)}" class="oh-field" placeholder="Title" value="${escapeHtml(artwork.title)}" aria-label="Artwork title"
        style="border-radius:4px;padding:3px 6px;font-size:0.75rem;margin-bottom:3px;" />
      <input data-field="medium" data-id="${escapeHtml(artwork.id)}" class="oh-field" placeholder="Medium" value="${escapeHtml(artwork.medium)}" aria-label="Artwork medium"
        style="border-radius:4px;padding:3px 6px;font-size:0.75rem;margin-bottom:3px;" />
      <input data-field="year" data-id="${escapeHtml(artwork.id)}" class="oh-field" placeholder="Year" type="number" value="${escapeHtml(String(artwork.year ?? ''))}" aria-label="Artwork year"
        style="border-radius:4px;padding:3px 6px;font-size:0.75rem;" />
    </div>`;

  card.querySelector(`[data-remove="${artwork.id}"]`)!.addEventListener('click', () => {
    data.artworks = data.artworks.filter((a) => a.id !== artwork.id);
    card.remove();
  });

  card.querySelectorAll<HTMLInputElement>('[data-field]').forEach((input) => {
    input.addEventListener('input', () => {
      const field = input.dataset['field'] as 'title' | 'medium' | 'year';
      const aw = data.artworks.find((a) => a.id === input.dataset['id']);
      if (!aw) return;
      if (field === 'year') aw.year = input.value ? parseInt(input.value) : undefined;
      else aw[field] = input.value;
    });
  });

  grid.appendChild(card);
}

// ---------------------------------------------------------------------------
// Generating screen
// ---------------------------------------------------------------------------

function renderGenerating(
  container: HTMLElement,
  data: AppData,
  camera: THREE.PerspectiveCamera,
  onDone: (
    scene: THREE.Scene,
    controls: FirstPersonControls,
    gallery: Gallery,
    artworkMeshes: Map<string, THREE.Mesh>
  ) => void,
  onError: (err: unknown) => void
): void {
  container.innerHTML = `
    <div class="oh-screen oh-screen--center" style="background:rgba(0,0,0,0.9);">
      <div id="oh-gen-view"></div>
    </div>`;

  const view = createGenerationView(
    container.querySelector('#oh-gen-view') as HTMLElement,
    data.artworks
  );
  const setProgress = (text: string, pct: number) => view.setStatus(text, pct);

  // Build provider — honour the explicitly chosen provider first, then fall
  // back to whichever key exists (legacy behaviour for pre-existing settings).
  let provider: AIProvider;
  const wxSettings = loadWatsonxSettings();
  const oaiSettings = loadOpenAISettings();
  const chosenProvider = localStorage.getItem('openhall_provider');
  if (chosenProvider === 'openai' && oaiSettings?.apiKey) {
    provider = new OpenAICompatProvider(oaiSettings);
  } else if (chosenProvider === 'watsonx' && wxSettings?.apiKey) {
    provider = new WatsonxProvider(wxSettings);
  } else if (wxSettings?.apiKey) {
    provider = new WatsonxProvider(wxSettings);
  } else if (oaiSettings?.apiKey) {
    provider = new OpenAICompatProvider(oaiSettings);
  } else {
    onError('No API key configured. Please go to Settings.');
    return;
  }

  (async () => {
    try {
      const key = aiInputKey(data);
      let gallery: Gallery;
      let showedPlan = false;

      if (data.gallery && data.lastGenKey === key) {
        // Cache hit — artworks/brief/style are unchanged since the last
        // generation, so skip the (billable) AI stages entirely and reuse the
        // existing gallery. Only identity edits + a free scene rebuild remain.
        setProgress('Reusing your gallery — no AI call…', 60);
        gallery = data.gallery;
      } else {
        // Stage 1: vision analysis — each returned analysis feeds the stage
        // (thumbnail lights up, palette/style/mood readout appears).
        const analyses: WorkAnalysis[] = [];
        for (let i = 0; i < data.artworks.length; i++) {
          setProgress(`Analysing artwork ${i + 1} of ${data.artworks.length}…`, 5 + (i / data.artworks.length) * 40);
          view.startArtwork(i);
          const analysis = await provider.analyzeArtwork(data.artworks[i]);
          view.finishArtwork(i, analysis);
          analyses.push(analysis);
        }
        data.analyses = analyses;

        // Stage 2: curation — thumbnails regroup into the curator's rooms
        setProgress('Curating exhibition…', 50);
        const plan = await provider.curate(analyses, data.userBrief);
        data.curatorNote = plan.curatorNote; // survives to the review screen
        view.showCuration(plan);

        // Stage 3: gallery generation
        setProgress('Designing gallery…', 65);
        const rawGallery = await provider.generateGallery(data.artworks, analyses, plan, data.preset);

        // Sanity pass — the finished layout draws itself as a floor plan
        setProgress('Verifying layout…', 85);
        gallery = sanitizePlacements(rawGallery);
        view.showFloorPlan(gallery);
        showedPlan = true;
        data.gallery = gallery;
        data.lastGenKey = key; // remember these inputs so a return trip is free
      }

      // Patch imagePaths to use display object URLs (idempotent across rebuilds)
      const urlMap = new Map(data.artworks.map((a) => [a.id, a.displayObjectUrl]));
      gallery.artworks = gallery.artworks.map((aw) => ({
        ...aw,
        imagePath: urlMap.get(aw.id) ?? aw.imagePath,
      }));

      // Apply the artist's identity/branding drafts — no AI needed, and runs on
      // both fresh and cached paths so edits take effect on the next build.
      applyIdentity(gallery, data);

      // Build scene with real textures
      setProgress('Building scene…', 92);
      const aspectMap = new Map(data.artworks.map((a) => [a.id, a.aspectRatio]));
      const { scene, roomLayouts, artworkMeshes } = buildScene(gallery, aspectMap);
      const allAABBs = roomLayouts.flatMap((r) => r.wallAABBs);

      const newControls = new FirstPersonControls(camera, document.body);
      newControls.setWalls(allAABBs);
      const firstLayout = roomLayouts[0];
      newControls.teleport(firstLayout.originX + 3, firstLayout.originZ + 3);

      setProgress('Ready!', 100);
      // Fresh generations show the floor plan here — hold long enough for
      // its draw-in animation to finish; the cached path keeps the quick beat.
      await new Promise((r) => setTimeout(r, showedPlan ? 1600 : 400));

      onDone(scene, newControls, gallery, artworkMeshes);
    } catch (e) {
      onError(e);
    }
  })();
}

// ---------------------------------------------------------------------------
// Label editor
// ---------------------------------------------------------------------------

function renderLabels(
  container: HTMLElement,
  data: AppData,
  onEnterViewer: () => void,
  getControls: () => FirstPersonControls | null,
  onBack: () => void
): void {
  if (!data.gallery) { onEnterViewer(); return; }

  // Branding fields are baked into the exported site (title/meta/OG/favicon).
  const branding = (data.gallery!.branding ??= {});
  // The AI curator's note seeds the description when the artist left it
  // blank — its words then flow into the exported site's meta/share preview.
  // Fully editable below; a caption declares the provenance.
  const descSeededByCurator = !branding.description?.trim() && !!data.curatorNote?.trim();
  if (descSeededByCurator) branding.description = data.curatorNote!.trim();
  const artistObj = data.gallery!.artist;
  const bTitle = data.gallery!.title ?? '';
  const bDesc = branding.description ?? '';
  const bAuthor = branding.authorName ?? '';
  const bUrl = branding.authorUrl ?? '';
  const aStatement = artistObj?.statement ?? '';
  // Editable artist statement — only when an artist wall exists. Reads live in
  // the click panel + tour, so edits here take effect without regenerating.
  const artistReviewBlock = artistObj
    ? `<textarea id="oh-brand-statement" class="oh-field" rows="3" maxlength="400" placeholder="Artist statement (shown on your artist wall)" aria-label="Artist statement">${escapeHtml(aStatement)}</textarea>`
    : '';

  container.innerHTML = `
    <div class="oh-screen">
      <div style="max-width:640px;margin:0 auto;padding:2rem;width:100%;box-sizing:border-box;">
        <h2 style="margin:0 0 0.5rem;font-size:1.3rem;">Gallery Details</h2>
        <p style="color:var(--oh-ink-muted);font-size:0.85rem;margin:0 0 1rem;">Prefilled from what you entered — a last check before you enter. These set your exported site's title, description, share preview, browser icon${artistObj ? ', and your in-world artist wall' : ''}. Edits here are free (no AI).</p>
        <div style="display:flex;flex-direction:column;gap:0.6rem;margin:0 0 1.25rem;">
          <input id="oh-brand-title" class="oh-field" type="text" value="${escapeHtml(bTitle)}" placeholder="Gallery title" aria-label="Gallery title"
            style="font-weight:600;">
          <textarea id="oh-brand-desc" class="oh-field" rows="2" placeholder="One-sentence description (shown in browser + when shared on social)" aria-label="Gallery description">${escapeHtml(bDesc)}</textarea>
          ${descSeededByCurator ? `<p class="oh-help" style="margin:-0.25rem 0 0;">Written by your AI curator — keep it, edit it, or clear it.</p>` : ''}
          <div style="display:flex;gap:0.5rem;">
            <input id="oh-brand-author" class="oh-field" type="text" value="${escapeHtml(bAuthor)}" placeholder="Your name / studio" aria-label="Artist name"
              style="flex:1;">
            <input id="oh-brand-url" class="oh-field" type="url" value="${escapeHtml(bUrl)}" placeholder="https://your-link.com" aria-label="Artist link"
              style="flex:1;">
          </div>
          ${artistReviewBlock}
          <div style="display:flex;align-items:center;gap:0.75rem;margin-top:0.25rem;">
            <img id="oh-favicon-preview" alt="favicon preview" style="width:40px;height:40px;border-radius:8px;border:1px solid var(--oh-border);object-fit:cover;background:var(--oh-panel);">
            <div style="flex:1;min-width:0;">
              <label for="oh-favicon-input" class="oh-toggle" style="display:inline-block;">Upload custom icon</label>
              <button id="oh-favicon-reset" type="button" class="oh-toggle" style="margin-left:0.5rem;">Use first artwork</button>
              <input id="oh-favicon-input" type="file" accept="image/*" style="display:none;">
              <p style="font-size:0.72rem;color:var(--oh-ink-faint);margin:0.35rem 0 0;">Browser-tab icon. Defaults to a square crop of your first artwork.</p>
            </div>
          </div>
        </div>
        <div style="background:var(--oh-panel);border:1px solid var(--oh-border);border-radius:10px;padding:0.9rem 1rem;margin:0 0 1.25rem;">
          <p style="margin:0 0 0.6rem;font-size:0.8rem;color:var(--oh-ink-muted);">Floor plan — green marks are your works on the walls; the dashed line is the visitor tour.</p>
          <div style="background:var(--oh-bg);border-radius:8px;padding:0.75rem;">${buildFloorPlanSvg(data.gallery!)}</div>
        </div>
        <h2 style="margin:0 0 0.5rem;font-size:1.3rem;">Review Wall Labels</h2>
        <p style="color:var(--oh-ink-muted);font-size:0.85rem;margin:0 0 1.5rem;">Edit any title, medium, or label text before entering the gallery. Changes are saved automatically.</p>
        <div id="oh-labels-list"></div>
        <div style="display:flex;gap:0.75rem;margin-top:1rem;">
          <button id="oh-back-labels" class="oh-btn oh-btn--ghost" style="flex:0 0 auto;padding:0.85rem 1.2rem;font-size:1rem;">&larr; Back to edit</button>
          <button id="oh-enter-gallery" class="oh-btn oh-btn--primary" style="flex:1;padding:0.85rem;font-size:1rem;font-weight:700;">
            Enter Gallery →
          </button>
        </div>
        <p style="display:flex;gap:0.5rem;align-items:flex-start;font-size:0.75rem;color:var(--oh-warn);background:rgba(217,164,65,0.08);border:1px solid rgba(217,164,65,0.25);border-radius:8px;padding:0.6rem 0.75rem;margin:0.6rem 0 0;">
          <span aria-hidden="true" style="flex-shrink:0;margin-top:0.1rem;">${svgWarn()}</span>
          <span>Going back keeps everything you've entered. Your gallery is only re-generated — re-calling the AI, which may cost API credits — if you change your <strong>artworks, description, style, or AI provider</strong>. Editing names, labels, or branding is free.</span>
        </p>
      </div>
    </div>`;

  // --- Branding wiring ---
  const firstAw = data.gallery!.artworks[0];
  const firstThumb =
    (firstAw && data.artworks.find((a) => a.id === firstAw.id)?.displayObjectUrl) ??
    (firstAw && firstAw.imagePath && !firstAw.imagePath.startsWith('placeholder:') ? firstAw.imagePath : '');
  const faviconPreview = container.querySelector('#oh-favicon-preview') as HTMLImageElement;
  const refreshFaviconPreview = () => {
    faviconPreview.src = data.customFaviconDataUrl ?? firstThumb ?? '';
  };
  refreshFaviconPreview();

  container.querySelector('#oh-brand-title')!.addEventListener('input', (e) => {
    data.gallery!.title = (e.target as HTMLInputElement).value;
  });
  container.querySelector('#oh-brand-desc')!.addEventListener('input', (e) => {
    branding.description = (e.target as HTMLTextAreaElement).value || undefined;
  });
  container.querySelector('#oh-brand-author')!.addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value;
    branding.authorName = v || undefined;
    // Keep the in-world artist wall's name in sync (panel + tour read it live).
    if (data.gallery!.artist && v) data.gallery!.artist.name = v;
  });
  container.querySelector('#oh-brand-url')!.addEventListener('input', (e) => {
    branding.authorUrl = (e.target as HTMLInputElement).value || undefined;
  });
  container.querySelector('#oh-brand-statement')?.addEventListener('input', (e) => {
    if (data.gallery!.artist) {
      data.gallery!.artist.statement = (e.target as HTMLTextAreaElement).value || undefined;
    }
  });
  const faviconInput = container.querySelector('#oh-favicon-input') as HTMLInputElement;
  faviconInput.addEventListener('change', async () => {
    const file = faviconInput.files?.[0];
    if (!file) return;
    try {
      // Normalise any uploaded image to a square PNG so the exported icon is consistent.
      data.customFaviconDataUrl = await generateFaviconDataUrl(URL.createObjectURL(file));
      refreshFaviconPreview();
    } catch {
      showToast({ message: 'Could not read that image. Try a PNG or JPG.', tone: 'error', duration: 6000 });
    }
  });
  container.querySelector('#oh-favicon-reset')!.addEventListener('click', () => {
    data.customFaviconDataUrl = null;
    faviconInput.value = '';
    refreshFaviconPreview();
  });

  const list = container.querySelector('#oh-labels-list') as HTMLElement;
  for (const aw of data.gallery!.artworks) {
    // Thumbnail so the user can tell which artwork each label belongs to:
    // prefer the upload's display URL, fall back to the gallery imagePath.
    const thumbSrc =
      data.artworks.find((a) => a.id === aw.id)?.displayObjectUrl ??
      (aw.imagePath && !aw.imagePath.startsWith('placeholder:') ? aw.imagePath : null);
    // Don't pre-fill the assembler's sentinel defaults — an empty input with
    // a placeholder is easier to edit than text you must delete first.
    const titleValue = aw.title === 'Untitled' ? '' : (aw.title ?? '');
    const mediumValue = aw.medium === 'Unknown medium' ? '' : (aw.medium ?? '');
    const block = document.createElement('div');
    block.style.cssText = 'display:flex;gap:0.75rem;align-items:flex-start;margin-bottom:1.25rem;';
    block.innerHTML = `
      ${thumbSrc
        ? `<img src="${escapeHtml(thumbSrc)}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--oh-border);flex-shrink:0;background:var(--oh-panel);">`
        : '<div style="width:72px;height:72px;border-radius:6px;border:1px solid var(--oh-border);background:var(--oh-panel);flex-shrink:0;"></div>'}
      <div style="flex:1;min-width:0;">
        <div style="display:flex;gap:0.5rem;margin:0 0 0.35rem;">
          <input data-id="${escapeHtml(aw.id)}" data-field="title" class="oh-field" type="text"
            value="${escapeHtml(titleValue)}" placeholder="Untitled" aria-label="Artwork title"
            style="flex:1.4;min-width:0;padding:0.4rem 0.5rem;font-size:0.9rem;font-weight:600;">
          <input data-id="${escapeHtml(aw.id)}" data-field="medium" class="oh-field" type="text"
            value="${escapeHtml(mediumValue)}" placeholder="Medium (e.g. Oil on canvas)" aria-label="Artwork medium"
            style="flex:1;min-width:0;padding:0.4rem 0.5rem;font-size:0.85rem;color:#999;">
        </div>
        <textarea data-id="${escapeHtml(aw.id)}" class="oh-field" rows="3" aria-label="Wall label text"
          style="padding:0.5rem;font-size:0.85rem;">${escapeHtml(aw.label)}</textarea>
      </div>`;
    // Title + medium inputs write straight back to the gallery object —
    // inspect panel / tour read these live, so edits show up in the viewer.
    for (const input of Array.from(block.querySelectorAll('input'))) {
      input.addEventListener('input', (e) => {
        const el = e.target as HTMLInputElement;
        const galleryAw = data.gallery!.artworks.find((a) => a.id === el.dataset['id']);
        if (!galleryAw) return;
        if (el.dataset['field'] === 'title') galleryAw.title = el.value;
        else galleryAw.medium = el.value;
      });
    }
    block.querySelector('textarea')!.addEventListener('input', (e) => {
      const id = (e.target as HTMLTextAreaElement).dataset['id'];
      const galleryAw = data.gallery!.artworks.find((a) => a.id === id);
      if (galleryAw) galleryAw.label = (e.target as HTMLTextAreaElement).value;
    });
    list.appendChild(block);
  }

  container.querySelector('#oh-back-labels')!.addEventListener('click', () => {
    onBack();
  });

  container.querySelector('#oh-enter-gallery')!.addEventListener('click', () => {
    const c = getControls();
    if (!c) { onEnterViewer(); return; }

    if (!('pointerLockElement' in document)) {
      // Touch / no-pointer-lock: enter viewer directly (tour is accessible via touch UI)
      onEnterViewer();
      return;
    }

    // The generated scene is already rendering behind — clear the review
    // screen and hide the stepper so the overlay's translucency previews the
    // gallery instead of double-exposing the form. × restores the screen.
    const stepper = document.getElementById('oh-stepper');
    container.innerHTML = '';
    if (stepper) stepper.style.display = 'none';

    // Show hint overlay; dismiss only once pointer lock actually succeeds.
    // Three.js EventDispatcher has no { once } option — we remove manually.
    // onLock declared before mountHintOverlay so the onClose closure can reference it.
    let onLock: () => void;
    const { dismiss } = mountHintOverlay(() => {
      c.lock();
    }, () => {
      // × button: re-render the review screen (it was cleared above)
      c.pointerLock.removeEventListener('lock', onLock);
      if (stepper) stepper.style.display = '';
      renderLabels(container, data, onEnterViewer, getControls, onBack);
    }, {
      title: data.gallery!.title,
      artistName: data.gallery!.artist?.name ?? data.gallery!.branding?.authorName,
    });

    onLock = () => {
      c.pointerLock.removeEventListener('lock', onLock);
      dismiss();
      fadeInFromBlack();
      onEnterViewer();
    };
    c.pointerLock.addEventListener('lock', onLock);
  });
}
