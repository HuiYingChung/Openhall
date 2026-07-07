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
import { mountHintOverlay, mountHintOverlayTouchFallback, mountRelockOverlay, shouldShowRelockOverlay } from './overlay';
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

interface AppData {
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

  /** HUD button shared style. */
  const HUD_BTN_CSS = `
    background:rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.25);
    color:#f0ece6;padding:0.45rem 0.9rem;border-radius:8px;
    font-size:0.88rem;cursor:pointer;
    font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
    display:inline-flex;align-items:center;
  `;

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
    // ← Menu button — always shown
    if (!document.getElementById('oh-menu-btn')) {
      const menuBtn = document.createElement('button');
      menuBtn.id = 'oh-menu-btn';
      menuBtn.innerHTML = `${svgArrowLeft()}Menu`;
      menuBtn.style.cssText = HUD_BTN_CSS;
      menuBtn.addEventListener('click', () => exitToMenu());
      ensureHudLeft().appendChild(menuBtn);
    }

    // Export button
    if (!document.getElementById('oh-export-btn')) {
      const expBtn = document.createElement('button');
      expBtn.id = 'oh-export-btn';
      expBtn.innerHTML = `${svgDownload()}Export`;
      expBtn.style.cssText = HUD_BTN_CSS;
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

          const { buildExportBundle, downloadZip } = await import('../export/bundler');
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

          // Both dev and prod fetch from /assets/viewer.js (pre-built from public/).
          // Run 'npm run build:viewer' once before testing export locally.
          const viewerScriptUrl = '/assets/viewer.js';
          const { blob } = await buildExportBundle({
            gallery: data.gallery,
            artworkUrls,
            aspectRatios,
            viewerScriptUrl,
            faviconUrl,
            onProgress: (msg, pct) => { expBtn.innerHTML = `${msg} ${pct}%`; },
          });
          downloadZip(blob);
        } catch (e) {
          alert(`Export failed: ${String(e)}`);
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
    btn.style.cssText = `position:fixed;top:1rem;right:1rem;z-index:200;${HUD_BTN_CSS}`;
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
          camera.position.copy(pos);
          camera.position.y = 1.6;
          // Re-lock pointer for free walk
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
    btn.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:200;
      background:rgba(0,0,0,0.85);border:1px solid rgba(255,255,255,0.3);
      color:#f0ece6;padding:0.75rem 2rem;border-radius:8px;
      font-size:1rem;cursor:pointer;font-weight:600;
      font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
      display:inline-flex;align-items:center;
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
          camera.position.copy(pos);
          camera.position.y = 1.6;
          mountTourStartOverlay(gallery);
        },
      });
    });
    document.body.appendChild(btn);
  }

  /** Demo mode: load the sample gallery + build scene + enter viewer (no key needed).
   *  Reachable from both the Settings screen and the upload/home screen. */
  function startDemo(): void {
          loadDemoGallery(data).then((gallery) => {
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
              // Show hint overlay then enter viewer.
              // onLock declared before mountHintOverlay so the onClose closure can reference it.
              let onLock: () => void;
              const { dismiss } = mountHintOverlay(() => controls!.lock(), () => {
                // × button: abort demo entry — tear down the built demo scene and
                // return to the menu (overlay already dismissed by mountHintOverlay).
                controls!.pointerLock.removeEventListener('lock', onLock);
                exitToMenu();
              });
              onLock = () => {
                controls!.pointerLock.removeEventListener('lock', onLock);
                dismiss();
                setState('viewer');
              };
              controls!.pointerLock.addEventListener('lock', onLock);
            } else {
              // Touch/no-pointer-lock: go straight to tour via Start Tour overlay
              setState('viewer');
              if (gallery.tour.length) {
                const { dismiss } = mountHintOverlayTouchFallback(() => {
                  dismiss();
                  tour = new GalleryTour({
                    camera,
                    gallery,
                    getArtworkMesh: (id) => interactions?.getMesh(id),
                    onExit: (pos) => {
                      tour = null;
                      camera.position.copy(pos);
                      camera.position.y = 1.6;
                      // Re-show Start Tour button (can't re-lock on touch)
                      mountTourStartOverlay(gallery);
                    },
                  });
                });
              }
            }
          }).catch((e) => alert(`Demo mode failed: ${String(e)}`));
  }

  function setState(state: AppState) {
    ui.innerHTML = '';
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
        (err) => { alert(`Generation failed:\n${err}`); setState('upload'); }); break;
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
    <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.88);z-index:50;font-family:-apple-system,'Segoe UI',system-ui,sans-serif;color:#f0ece6;">
      <div style="background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:2rem;width:min(480px,90vw);max-height:90vh;overflow-y:auto;">
        <h2 style="margin:0 0 0.25rem;font-size:1.4rem;">API Settings</h2>
        <p style="color:#888;font-size:0.85rem;margin:0 0 1.5rem;">Keys are stored in your browser only and never sent anywhere except directly to the AI provider.</p>

        <label style="display:block;margin-bottom:0.5rem;font-size:0.9rem;">Provider</label>
        <select id="oh-provider" style="width:100%;padding:0.5rem;background:#111;color:#f0ece6;border:1px solid #444;border-radius:6px;margin-bottom:1rem;">
          <option value="watsonx" ${providerDefault === 'watsonx' ? 'selected' : ''}>IBM watsonx.ai (Granite + Llama Vision)</option>
          <option value="openai" ${providerDefault === 'openai' ? 'selected' : ''}>OpenAI-compatible (OpenAI, Together, etc.)</option>
        </select>

        <div id="oh-watsonx-fields" style="display:${providerDefault === 'watsonx' ? 'block' : 'none'}">
          <label style="display:block;margin-bottom:0.25rem;font-size:0.85rem;">IBM Cloud API Key</label>
          <input id="oh-wx-key" type="password" placeholder="ApiKey-..."
            style="width:100%;padding:0.5rem;background:#111;color:#f0ece6;border:1px solid #444;border-radius:6px;margin-bottom:0.75rem;box-sizing:border-box;" />
          <label style="display:block;margin-bottom:0.25rem;font-size:0.85rem;">watsonx Project ID (UUID)</label>
          <input id="oh-wx-project" type="text" placeholder="xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx"
            style="width:100%;padding:0.5rem;background:#111;color:#f0ece6;border:1px solid #444;border-radius:6px;margin-bottom:0.75rem;box-sizing:border-box;" />
          <label style="display:block;margin-bottom:0.25rem;font-size:0.85rem;">Token Worker URL <span style="color:#888;">(leave blank if deploying locally)</span></label>
          <input id="oh-wx-worker" type="text" placeholder="https://your-worker.workers.dev"
            style="width:100%;padding:0.5rem;background:#111;color:#f0ece6;border:1px solid #444;border-radius:6px;margin-bottom:0.75rem;box-sizing:border-box;" />
          <p style="font-size:0.75rem;color:#666;margin:0 0 1rem;">
            The token worker proxies IBM IAM authentication (required for browser use).<br>
            Deploy <code>worker/token-exchange.ts</code> to Cloudflare Workers — it's free.
          </p>
        </div>

        <div id="oh-openai-fields" style="display:${providerDefault === 'openai' ? 'block' : 'none'}">
          <label style="display:block;margin-bottom:0.25rem;font-size:0.85rem;">API Key</label>
          <input id="oh-oai-key" type="password" placeholder="sk-..."
            style="width:100%;padding:0.5rem;background:#111;color:#f0ece6;border:1px solid #444;border-radius:6px;margin-bottom:0.75rem;box-sizing:border-box;" />
          <label style="display:block;margin-bottom:0.25rem;font-size:0.85rem;">Base URL</label>
          <input id="oh-oai-url" type="text" placeholder="https://api.openai.com/v1"
            style="width:100%;padding:0.5rem;background:#111;color:#f0ece6;border:1px solid #444;border-radius:6px;margin-bottom:0.75rem;box-sizing:border-box;" />
          <label style="display:block;margin-bottom:0.25rem;font-size:0.85rem;">Model</label>
          <input id="oh-oai-model" type="text" placeholder="gpt-4o"
            style="width:100%;padding:0.5rem;background:#111;color:#f0ece6;border:1px solid #444;border-radius:6px;margin-bottom:1rem;box-sizing:border-box;" />
        </div>

        <div style="display:flex;gap:0.75rem;">
          ${onCancel ? `<button id="oh-cancel-settings" style="flex:0 0 auto;padding:0.7rem 1.2rem;background:none;border:1px solid #444;color:#aaa;border-radius:8px;font-size:1rem;cursor:pointer;">Cancel</button>` : ''}
          <button id="oh-save-settings" style="flex:1;padding:0.7rem;background:#fff;color:#111;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;">Save & Continue</button>
        </div>
        <p style="font-size:0.75rem;color:#555;margin:1rem 0 0;text-align:center;">No key? Try the <button id="oh-demo-btn" style="background:none;border:none;color:#888;text-decoration:underline;cursor:pointer;font-size:0.75rem;">demo mode</button> instead.</p>
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
    if (providerSel.value === 'watsonx') {
      const key = (container.querySelector('#oh-wx-key') as HTMLInputElement).value.trim();
      const proj = (container.querySelector('#oh-wx-project') as HTMLInputElement).value.trim();
      const worker = (container.querySelector('#oh-wx-worker') as HTMLInputElement).value.trim();
      if (!key || !proj) { alert('API key and Project ID are required for watsonx.'); return; }
      saveWatsonxSettings({ apiKey: key, projectId: proj, wxUrl: 'https://us-south.ml.cloud.ibm.com', tokenWorkerUrl: worker });
    } else {
      const key = (container.querySelector('#oh-oai-key') as HTMLInputElement).value.trim();
      const url = (container.querySelector('#oh-oai-url') as HTMLInputElement).value.trim();
      const model = (container.querySelector('#oh-oai-model') as HTMLInputElement).value.trim();
      if (!key) { alert('API key is required.'); return; }
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
  data.gallery = result.data;
  data.artworks = [];
  return result.data;
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
  container.innerHTML = `
    <div style="position:fixed;inset:0;display:flex;flex-direction:column;
      background:#0d0d0d;z-index:50;font-family:-apple-system,'Segoe UI',system-ui,sans-serif;color:#f0ece6;overflow-y:auto;">
      <div style="max-width:760px;margin:0 auto;padding:2rem;width:100%;box-sizing:border-box;">

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
          <h1 style="margin:0;font-size:1.6rem;font-weight:700;">Openhall</h1>
          <button id="oh-to-settings" style="background:none;border:1px solid #444;color:#aaa;padding:0.4rem 0.8rem;border-radius:6px;cursor:pointer;font-size:0.85rem;">Settings</button>
        </div>

        <p style="color:#aaa;font-size:0.92rem;margin:0 0 0.8rem;">Turn up to 10 artworks into a walkable 3D gallery — fully AI-generated, exportable as a website you own.</p>
        <div style="display:flex;flex-wrap:wrap;gap:0.35rem 1.2rem;margin-bottom:0.6rem;color:#888;font-size:0.8rem;">
          <span><span style="color:#ddd;font-weight:600;">1</span> · Upload your artworks</span>
          <span><span style="color:#ddd;font-weight:600;">2</span> · Describe the show and pick a style</span>
          <span><span style="color:#ddd;font-weight:600;">3</span> · AI designs the gallery</span>
          <span><span style="color:#ddd;font-weight:600;">4</span> · Walk through it, then export</span>
        </div>
        <p style="color:#888;font-size:0.8rem;margin:0 0 1.5rem;">
          First time here? Add your AI API key via the <span style="color:#ccc;">Settings</span> button (top right) —
          or <button id="oh-home-demo" style="background:none;border:none;color:#ccc;text-decoration:underline;cursor:pointer;font-size:0.8rem;padding:0;">view the demo gallery</button> first, no key needed.
        </p>

        <div id="oh-dropzone" style="border:2px dashed #444;border-radius:12px;padding:3rem 1rem;text-align:center;cursor:pointer;transition:border-color 0.2s;margin-bottom:1rem;">
          <p style="font-size:1.1rem;margin:0 0 0.5rem;">Drop artworks here, or click to browse</p>
          <p style="color:#666;font-size:0.85rem;margin:0;">Up to 10 images · JPEG, PNG, WebP</p>
          <input id="oh-file-input" type="file" multiple accept="image/jpeg,image/png,image/webp" style="display:none;" />
        </div>

        <div id="oh-thumbnail-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:1rem;margin-bottom:1.5rem;"></div>

        <label style="display:block;font-size:0.9rem;margin-bottom:0.2rem;">Describe your exhibition in one sentence</label>
        <p style="font-size:0.75rem;color:#777;margin:0 0 0.5rem;">This shapes how your works are grouped into rooms, the tour order, and the tone of the wall labels.</p>
        <textarea id="oh-brief" rows="2" placeholder="e.g. A series of abstract landscapes exploring the tension between the natural world and urban decay"
          style="width:100%;padding:0.6rem;background:#111;color:#f0ece6;border:1px solid #444;border-radius:8px;font-size:0.95rem;resize:vertical;margin-bottom:1rem;box-sizing:border-box;">${data.userBrief}</textarea>

        <label style="display:block;font-size:0.9rem;margin-bottom:0.5rem;">Gallery style</label>
        <div id="oh-presets" style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.5rem;margin-bottom:1.5rem;"></div>

        <button id="oh-generate-btn" style="width:100%;padding:0.85rem;background:#fff;color:#111;border:none;border-radius:8px;font-size:1rem;font-weight:700;cursor:pointer;opacity:0.4;" disabled>
          Generate Gallery →
        </button>
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

  // Preset buttons
  const presetKeys = Object.keys(PRESETS) as StylePreset[];
  for (const key of presetKeys) {
    const btn = document.createElement('button');
    btn.dataset['preset'] = key;
    btn.style.cssText = `padding:0.6rem 0.75rem;background:${data.preset === key ? '#fff' : '#1a1a1a'};color:${data.preset === key ? '#111' : '#f0ece6'};border:1px solid #444;border-radius:8px;cursor:pointer;text-align:left;font-size:0.85rem;`;
    btn.innerHTML = `<strong>${PRESETS[key].label}</strong><br><span style="color:#888;font-size:0.75rem;">${PRESETS[key].description}</span>`;
    btn.addEventListener('click', () => {
      data.preset = key;
      presetsEl.querySelectorAll('button').forEach((b) => {
        const isSelected = (b as HTMLButtonElement).dataset['preset'] === key;
        b.style.background = isSelected ? '#fff' : '#1a1a1a';
        b.style.color = isSelected ? '#111' : '#f0ece6';
      });
    });
    presetsEl.appendChild(btn);
  }

  // Brief
  briefInput.addEventListener('input', () => { data.userBrief = briefInput.value; });

  // File handling
  function updateGenerateBtn() {
    const ready = data.artworks.length > 0 && data.artworks.length <= 10;
    generateBtn.disabled = !ready;
    generateBtn.style.opacity = ready ? '1' : '0.4';
  }

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
    updateGenerateBtn();
  }

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = '#aaa'; });
  dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = '#444'; });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '#444';
    handleFiles(e.dataTransfer?.files ?? null);
  });
  fileInput.addEventListener('change', () => handleFiles(fileInput.files));

  // Re-render existing artworks
  for (const aw of data.artworks) addThumbnail(thumbnailGrid, aw, data);
  updateGenerateBtn();

  generateBtn.addEventListener('click', () => {
    data.userBrief = briefInput.value.trim();
    if (!data.userBrief) { alert('Please add a one-sentence description of your exhibition.'); return; }
    onGenerate();
  });
}

function addThumbnail(grid: HTMLElement, artwork: UploadedArtwork, data: AppData): void {
  const card = document.createElement('div');
  card.style.cssText = 'background:#1a1a1a;border-radius:8px;overflow:hidden;border:1px solid #333;';
  card.innerHTML = `
    <div style="position:relative;">
      <img src="${artwork.displayObjectUrl}" style="width:100%;height:100px;object-fit:cover;display:block;" />
      <button data-remove="${escapeHtml(artwork.id)}" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.75rem;padding:2px 6px;">✕</button>
    </div>
    <div style="padding:0.4rem;">
      <input data-field="title" data-id="${escapeHtml(artwork.id)}" placeholder="Title" value="${escapeHtml(artwork.title)}"
        style="width:100%;background:#111;color:#f0ece6;border:1px solid #333;border-radius:4px;padding:3px 6px;font-size:0.75rem;margin-bottom:3px;box-sizing:border-box;" />
      <input data-field="medium" data-id="${escapeHtml(artwork.id)}" placeholder="Medium" value="${escapeHtml(artwork.medium)}"
        style="width:100%;background:#111;color:#f0ece6;border:1px solid #333;border-radius:4px;padding:3px 6px;font-size:0.75rem;margin-bottom:3px;box-sizing:border-box;" />
      <input data-field="year" data-id="${escapeHtml(artwork.id)}" placeholder="Year" type="number" value="${escapeHtml(String(artwork.year ?? ''))}"
        style="width:100%;background:#111;color:#f0ece6;border:1px solid #333;border-radius:4px;padding:3px 6px;font-size:0.75rem;box-sizing:border-box;" />
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
  onError: (msg: string) => void
): void {
  container.innerHTML = `
    <div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.9);z-index:50;font-family:-apple-system,'Segoe UI',system-ui,sans-serif;color:#f0ece6;">
      <p id="oh-progress-msg" style="font-size:1.1rem;margin:0 0 1rem;">Initialising AI…</p>
      <div style="width:280px;height:4px;background:#333;border-radius:2px;">
        <div id="oh-progress-bar" style="height:100%;background:#fff;border-radius:2px;width:0%;transition:width 0.4s;"></div>
      </div>
    </div>`;

  const msg = container.querySelector('#oh-progress-msg') as HTMLElement;
  const bar = container.querySelector('#oh-progress-bar') as HTMLElement;

  function setProgress(text: string, pct: number) {
    msg.textContent = text;
    bar.style.width = `${pct}%`;
  }

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
      // Stage 1: vision analysis
      const analyses: WorkAnalysis[] = [];
      for (let i = 0; i < data.artworks.length; i++) {
        setProgress(`Analysing artwork ${i + 1} of ${data.artworks.length}…`, 5 + (i / data.artworks.length) * 40);
        const analysis = await provider.analyzeArtwork(data.artworks[i]);
        analyses.push(analysis);
      }
      data.analyses = analyses;

      // Stage 2: curation
      setProgress('Curating exhibition…', 50);
      const plan = await provider.curate(analyses, data.userBrief);

      // Stage 3: gallery generation
      setProgress('Designing gallery…', 65);
      const rawGallery = await provider.generateGallery(data.artworks, analyses, plan, data.preset);

      // Sanity pass
      setProgress('Verifying layout…', 85);
      const gallery = sanitizePlacements(rawGallery);
      data.gallery = gallery;

      // Patch imagePaths to use display object URLs
      const urlMap = new Map(data.artworks.map((a) => [a.id, a.displayObjectUrl]));
      gallery.artworks = gallery.artworks.map((aw) => ({
        ...aw,
        imagePath: urlMap.get(aw.id) ?? aw.imagePath,
      }));

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
      await new Promise((r) => setTimeout(r, 400));

      onDone(scene, newControls, gallery, artworkMeshes);
    } catch (e) {
      onError(String(e));
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
  const bTitle = data.gallery!.title ?? '';
  const bDesc = branding.description ?? '';
  const bAuthor = branding.authorName ?? '';
  const bUrl = branding.authorUrl ?? '';
  const inputStyle =
    'width:100%;padding:0.5rem;background:#111;color:#f0ece6;border:1px solid #333;border-radius:6px;font-size:0.9rem;box-sizing:border-box;';

  container.innerHTML = `
    <div style="position:fixed;inset:0;display:flex;flex-direction:column;
      background:#0d0d0d;z-index:50;font-family:-apple-system,'Segoe UI',system-ui,sans-serif;color:#f0ece6;overflow-y:auto;">
      <div style="max-width:640px;margin:0 auto;padding:2rem;width:100%;box-sizing:border-box;">
        <h2 style="margin:0 0 0.5rem;font-size:1.3rem;">Gallery Details</h2>
        <p style="color:#888;font-size:0.85rem;margin:0 0 1rem;">These become your exported site's title, description, share preview, and browser icon — so it reads like your own site.</p>
        <div style="display:flex;flex-direction:column;gap:0.6rem;margin:0 0 1.25rem;">
          <input id="oh-brand-title" type="text" value="${escapeHtml(bTitle)}" placeholder="Gallery title" aria-label="Gallery title"
            style="${inputStyle}font-weight:600;">
          <textarea id="oh-brand-desc" rows="2" placeholder="One-sentence description (shown in browser + when shared on social)" aria-label="Gallery description"
            style="${inputStyle}resize:vertical;">${escapeHtml(bDesc)}</textarea>
          <div style="display:flex;gap:0.5rem;">
            <input id="oh-brand-author" type="text" value="${escapeHtml(bAuthor)}" placeholder="Your name / studio" aria-label="Artist name"
              style="${inputStyle}flex:1;">
            <input id="oh-brand-url" type="url" value="${escapeHtml(bUrl)}" placeholder="https://your-link.com" aria-label="Artist link"
              style="${inputStyle}flex:1;">
          </div>
          <div style="display:flex;align-items:center;gap:0.75rem;margin-top:0.25rem;">
            <img id="oh-favicon-preview" alt="favicon preview" style="width:40px;height:40px;border-radius:8px;border:1px solid #333;object-fit:cover;background:#1a1a1a;">
            <div style="flex:1;min-width:0;">
              <label for="oh-favicon-input" style="display:inline-block;padding:0.45rem 0.8rem;background:#1a1a1a;border:1px solid #444;border-radius:6px;font-size:0.8rem;cursor:pointer;">Upload custom icon</label>
              <button id="oh-favicon-reset" type="button" style="margin-left:0.5rem;padding:0.45rem 0.7rem;background:none;border:1px solid #333;color:#888;border-radius:6px;font-size:0.8rem;cursor:pointer;">Use first artwork</button>
              <input id="oh-favicon-input" type="file" accept="image/*" style="display:none;">
              <p style="font-size:0.72rem;color:#666;margin:0.35rem 0 0;">Browser-tab icon. Defaults to a square crop of your first artwork.</p>
            </div>
          </div>
        </div>
        <h2 style="margin:0 0 0.5rem;font-size:1.3rem;">Review Wall Labels</h2>
        <p style="color:#888;font-size:0.85rem;margin:0 0 1.5rem;">Edit any title, medium, or label text before entering the gallery. Changes are saved automatically.</p>
        <div id="oh-labels-list"></div>
        <div style="display:flex;gap:0.75rem;margin-top:1rem;">
          <button id="oh-back-labels" style="flex:0 0 auto;padding:0.85rem 1.2rem;background:none;border:1px solid #444;color:#aaa;border-radius:8px;font-size:1rem;cursor:pointer;">&larr; Back to edit</button>
          <button id="oh-enter-gallery" style="flex:1;padding:0.85rem;background:#fff;color:#111;border:none;border-radius:8px;font-size:1rem;font-weight:700;cursor:pointer;">
            Enter Gallery →
          </button>
        </div>
        <p style="font-size:0.75rem;color:#666;margin:0.5rem 0 0;">Back keeps your uploads and details, but you'll need to generate again.</p>
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
    branding.authorName = (e.target as HTMLInputElement).value || undefined;
  });
  container.querySelector('#oh-brand-url')!.addEventListener('input', (e) => {
    branding.authorUrl = (e.target as HTMLInputElement).value || undefined;
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
      alert('Could not read that image. Try a PNG or JPG.');
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
        ? `<img src="${escapeHtml(thumbSrc)}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid #333;flex-shrink:0;background:#1a1a1a;">`
        : '<div style="width:72px;height:72px;border-radius:6px;border:1px solid #333;background:#1a1a1a;flex-shrink:0;"></div>'}
      <div style="flex:1;min-width:0;">
        <div style="display:flex;gap:0.5rem;margin:0 0 0.35rem;">
          <input data-id="${escapeHtml(aw.id)}" data-field="title" type="text"
            value="${escapeHtml(titleValue)}" placeholder="Untitled" aria-label="Artwork title"
            style="flex:1.4;min-width:0;padding:0.4rem 0.5rem;background:#111;color:#f0ece6;border:1px solid #333;border-radius:6px;font-size:0.9rem;font-weight:600;box-sizing:border-box;">
          <input data-id="${escapeHtml(aw.id)}" data-field="medium" type="text"
            value="${escapeHtml(mediumValue)}" placeholder="Medium (e.g. Oil on canvas)" aria-label="Artwork medium"
            style="flex:1;min-width:0;padding:0.4rem 0.5rem;background:#111;color:#999;border:1px solid #2a2a2a;border-radius:6px;font-size:0.85rem;box-sizing:border-box;">
        </div>
        <textarea data-id="${escapeHtml(aw.id)}" rows="3" aria-label="Wall label text"
          style="width:100%;padding:0.5rem;background:#111;color:#f0ece6;border:1px solid #333;border-radius:6px;font-size:0.85rem;resize:vertical;box-sizing:border-box;">${escapeHtml(aw.label)}</textarea>
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

    // Show hint overlay; dismiss only once pointer lock actually succeeds.
    // Three.js EventDispatcher has no { once } option — we remove manually.
    // onLock declared before mountHintOverlay so the onClose closure can reference it.
    let onLock: () => void;
    const { dismiss } = mountHintOverlay(() => {
      c.lock();
    }, () => {
      // × button: overlay already dismissed by mountHintOverlay — labels screen reappears
      c.pointerLock.removeEventListener('lock', onLock);
    });

    onLock = () => {
      c.pointerLock.removeEventListener('lock', onLock);
      dismiss();
      onEnterViewer();
    };
    c.pointerLock.addEventListener('lock', onLock);
  });
}
