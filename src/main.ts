/**
 * main.ts — Entry point. Wires together:
 *   - Three.js renderer + camera
 *   - Gallery schema validation
 *   - Room builder (scene)
 *   - First-person controls
 *   - Controls hint overlay
 *
 * In Week 1 this renders the hardcoded demo gallery.
 */

import * as THREE from 'three';
import { GallerySchema } from './schema/gallery.schema';
import { buildScene } from './viewer/room-builder';
import { FirstPersonControls } from './viewer/controls';
import { mountHintOverlay } from './ui/overlay';
import sampleGallery from './demo/sample-gallery.json';

// ---------------------------------------------------------------------------
// Renderer setup
// ---------------------------------------------------------------------------

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
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);

// ---------------------------------------------------------------------------
// Validate + build scene
// ---------------------------------------------------------------------------

const parseResult = GallerySchema.safeParse(sampleGallery);
if (!parseResult.success) {
  console.error('[Openhall] sample-gallery.json failed schema validation:', parseResult.error);
  throw new Error('Invalid sample gallery — see console for details.');
}

const gallery = parseResult.data;
const { scene, roomLayouts } = buildScene(gallery);

// Collect all wall AABBs from all rooms
const allWallAABBs = roomLayouts.flatMap((r) => r.wallAABBs);

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

const controls = new FirstPersonControls(camera, document.body);
controls.setWalls(allWallAABBs);

// Place camera at start of first room, slightly inside
const firstLayout = roomLayouts[0];
const startX = firstLayout.originX + firstLayout.wallAABBs.length > 0
  ? firstLayout.originX + 3
  : 0;
controls.teleport(startX, firstLayout.originZ + 3);

// ---------------------------------------------------------------------------
// Hint overlay
// ---------------------------------------------------------------------------

const { dismiss } = mountHintOverlay(() => {
  controls.lock();
});

controls.pointerLock.addEventListener('lock', () => {
  dismiss();
});

controls.pointerLock.addEventListener('unlock', () => {
  // Re-show a simpler re-lock message (just show overlay again on click)
});

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();

function animate(): void {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05); // cap at 50ms to avoid jumps
  controls.update(delta);
  renderer.render(scene, camera);
}

animate();
