/**
 * viewer-entry.ts — Standalone viewer entry point for the export bundle.
 *
 * This file is the entry point for the viewer-only Vite build target.
 * It expects gallery.json and artwork images to be co-located in the zip,
 * and renders the full walkable gallery with interactions + tour.
 *
 * No AI code, no settings UI, no API keys — zero deps except Three.js.
 *
 * Dev note: run `npm run build:viewer` once before testing export locally.
 * Both dev and prod fetch /assets/viewer.js from the pre-built file in public/.
 */

import * as THREE from 'three';
import { GallerySchema } from '../schema/gallery.schema';
import { buildScene } from './room-builder';
import { FirstPersonControls } from './controls';
import { ArtworkInteractions } from './interactions';
import { GalleryTour } from './tour';
import { mountHintOverlay, mountHintOverlayTouchFallback, mountRelockOverlay, shouldShowRelockOverlay } from '../ui/overlay';

/** True when pointer lock is available (false on iOS Safari). */
function supportsPointerLock(): boolean {
  return 'pointerLockElement' in document;
}

async function bootViewer() {
  // Load gallery.json from the same directory
  const res = await fetch('./gallery.json');
  if (!res.ok) throw new Error(`Failed to load gallery.json: ${res.status}`);
  const raw = await res.json();
  const result = GallerySchema.safeParse(raw);
  if (!result.success) throw new Error(`gallery.json schema error: ${result.error.message}`);
  const gallery = result.data;

  // Create canvas
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
  });

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.05,
    200
  );
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Build aspect map from gallery.json (written by bundler)
  const aspectMap = new Map<string, number>();
  for (const aw of gallery.artworks) {
    if (aw.aspectRatio != null) {
      aspectMap.set(aw.id, aw.aspectRatio);
    }
  }

  // Build scene
  const { scene, roomLayouts, artworkMeshes } = buildScene(gallery, aspectMap);
  const allAABBs = roomLayouts.flatMap((r) => r.wallAABBs);

  const controls = new FirstPersonControls(camera, document.body);
  controls.setWalls(allAABBs);
  const firstLayout = roomLayouts[0];
  controls.teleport(firstLayout.originX + 3, firstLayout.originZ + 3);

  // Interactions
  const interactions = new ArtworkInteractions({
    camera,
    scene,
    artworkMeshes,
    gallery,
    onInspectOpen: () => {
      // Unlock pointer when dolly starts so the Close button is clickable
      if (controls.isLocked) {
        suppressNextRelock = true;
        controls.pointerLock.unlock();
      }
    },
    onInspectClose: () => {
      // Re-lock pointer after the inspect panel closes (no-op on touch devices)
      if (supportsPointerLock()) controls.lock();
    },
    getIsLocked: () => controls.isLocked,
  });

  // Tour
  let tour: GalleryTour | null = null;
  // Bug 2: track the currently-mounted relock overlay dismiss so startTour can clear it
  let activeRelockDismiss: (() => void) | null = null;

  function startTour() {
    if (!gallery.tour.length) return;
    // Bug 2: dismiss any lingering Paused overlay before the tour begins
    if (activeRelockDismiss) { activeRelockDismiss(); activeRelockDismiss = null; }
    // Bug 3: close any open inspect panel / in-progress dolly
    interactions.close();
    if (controls.isLocked) controls.pointerLock.unlock();
    tour = new GalleryTour({
      camera,
      gallery,
      onExit: (pos) => {
        tour = null;
        camera.position.copy(pos);
        camera.position.y = 1.6;
        if (supportsPointerLock()) {
          controls.lock();
          // Bug 1: re-mount tour button on desktop (lock event will not remount it)
          mountTourButton();
        } else {
          // On touch devices, re-show Start Tour button instead of trying to lock
          mountTourButton();
        }
      },
    });
  }

  /** Tour pin glyph — matches app.ts svgTour() */
  function svgTour(): string {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;" aria-hidden="true"><circle cx="8" cy="6.5" r="2.5"/><path d="M8 14C8 14 2.5 10 2.5 6.5a5.5 5.5 0 0 1 11 0C13.5 10 8 14 8 14z"/></svg>`;
  }

  function mountTourButton() {
    if (!gallery.tour.length) return;
    const existing = document.getElementById('oh-tour-btn-viewer');
    if (existing) return;
    const tourBtn = document.createElement('button');
    tourBtn.id = 'oh-tour-btn-viewer';
    tourBtn.innerHTML = `${svgTour()}Tour`;
    tourBtn.style.cssText = `
      position:fixed;top:1rem;right:1rem;z-index:200;
      background:rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.25);
      color:#f0ece6;padding:0.45rem 0.9rem;border-radius:8px;
      font-size:0.88rem;cursor:pointer;
      font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
      display:inline-flex;align-items:center;
    `;
    tourBtn.addEventListener('click', () => {
      tourBtn.remove();
      startTour();
    });
    document.body.appendChild(tourBtn);
  }

  // Render loop
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    if (tour) {
      tour.update(delta);
    } else {
      if (!interactions.isInspecting) controls.update(delta);
      interactions.update(delta);
    }
    renderer.render(scene, camera);
  }
  animate();

  // Flag to suppress the relock overlay when we deliberately unlock for inspect
  let suppressNextRelock = false;

  // Wire Esc → relock (only on pointer-lock devices)
  function wireRelock() {
    const onUnlock = () => {
      const decision = shouldShowRelockOverlay({
        tourActive: !!tour,
        suppress: suppressNextRelock,
        inspecting: interactions.isInspecting,
      });
      if (decision === 'clear-suppress') { suppressNextRelock = false; return; }
      if (decision === 'stay-armed') return;
      // decision === 'show-overlay'
      controls.pointerLock.removeEventListener('unlock', onUnlock);
      const { dismiss } = mountRelockOverlay(() => controls.lock());
      // Bug 2: track so startTour can dismiss it
      activeRelockDismiss = dismiss;
      const onRelock = () => {
        controls.pointerLock.removeEventListener('lock', onRelock);
        activeRelockDismiss = null;
        dismiss();
        wireRelock();
      };
      controls.pointerLock.addEventListener('lock', onRelock);
    };
    controls.pointerLock.addEventListener('unlock', onUnlock);
  }

  if (supportsPointerLock()) {
    // Pointer-lock devices: "Click to Enter" overlay
    const { dismiss } = mountHintOverlay(() => controls.lock());
    const onLock = () => {
      controls.pointerLock.removeEventListener('lock', onLock);
      dismiss();
      wireRelock();
      // Show tour button after entry
      mountTourButton();
    };
    controls.pointerLock.addEventListener('lock', onLock);
  } else {
    // Touch/no-pointer-lock devices: go straight to tour
    const { dismiss } = mountHintOverlayTouchFallback(() => {
      dismiss();
      startTour();
    });
  }
}

bootViewer().catch((e) => {
  document.body.innerHTML = `<div style="color:#f00;font-family:monospace;padding:2rem;">
    <h2>Failed to load gallery</h2><pre>${String(e)}</pre>
  </div>`;
});
