/**
 * viewer-entry.ts — Standalone viewer entry point for the export bundle.
 *
 * This file is the entry point for the viewer-only Vite build target.
 * It expects gallery.json and artwork images to be co-located in the zip,
 * and renders the full walkable gallery with interactions + tour.
 *
 * No AI code, no settings UI, no API keys — zero deps except Three.js.
 */

import * as THREE from 'three';
import { GallerySchema } from '../schema/gallery.schema';
import { buildScene } from './room-builder';
import { FirstPersonControls } from './controls';
import { ArtworkInteractions } from './interactions';
import { GalleryTour } from './tour';
import { mountHintOverlay, mountRelockOverlay } from '../ui/overlay';

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

  // Build scene
  const { scene, roomLayouts, artworkMeshes } = buildScene(gallery);
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
    onInspectOpen: () => {},
    onInspectClose: () => { controls.lock(); },
    getIsLocked: () => controls.isLocked,
  });

  // Tour button
  let tour: GalleryTour | null = null;
  if (gallery.tour.length) {
    const tourBtn = document.createElement('button');
    tourBtn.textContent = '🎯 Tour';
    tourBtn.style.cssText = `
      position:fixed;top:1rem;right:1rem;z-index:200;
      background:rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.25);
      color:#f0ece6;padding:0.45rem 0.9rem;border-radius:8px;
      font-size:0.88rem;cursor:pointer;
      font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
    `;
    tourBtn.addEventListener('click', () => {
      controls.pointerLock.unlock();
      tourBtn.remove();
      tour = new GalleryTour({
        camera,
        gallery,
        onExit: (pos) => {
          tour = null;
          camera.position.copy(pos);
          camera.position.y = 1.6;
          controls.lock();
        },
      });
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

  // Wire Esc → relock
  function wireRelock() {
    const onUnlock = () => {
      controls.pointerLock.removeEventListener('unlock', onUnlock);
      if (tour) return; // tour handles its own Esc
      const { dismiss } = mountRelockOverlay(() => controls.lock());
      const onRelock = () => {
        controls.pointerLock.removeEventListener('lock', onRelock);
        dismiss();
        wireRelock();
      };
      controls.pointerLock.addEventListener('lock', onRelock);
    };
    controls.pointerLock.addEventListener('unlock', onUnlock);
  }

  // Show entry overlay
  const { dismiss } = mountHintOverlay(() => controls.lock());
  const onLock = () => {
    controls.pointerLock.removeEventListener('lock', onLock);
    dismiss();
    wireRelock();
  };
  controls.pointerLock.addEventListener('lock', onLock);
}

bootViewer().catch((e) => {
  document.body.innerHTML = `<div style="color:#f00;font-family:monospace;padding:2rem;">
    <h2>Failed to load gallery</h2><pre>${String(e)}</pre>
  </div>`;
});
