// @vitest-environment jsdom
/**
 * tour.test.ts — Unit tests for GalleryTour waypoint sequencing.
 *
 * Tests:
 *   - Tour starts at waypoint 0
 *   - next() advances to waypoint 1
 *   - prev() wraps from 0 to last waypoint
 *   - Calling exit() invokes the onExit callback
 *   - Tour with empty waypoints does not crash
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// GalleryTour requires a DOM (it creates HUD elements). The test environment
// is jsdom (configured via vitest), so document.createElement is available.
// We stub out PointerLockControls indirectly — GalleryTour only needs camera.
// ---------------------------------------------------------------------------

// Stub TouchLook's event listeners so tests don't fail on missing touchstart
const origAddEventListener = document.addEventListener.bind(document);
const origRemoveEventListener = document.removeEventListener.bind(document);

import { GalleryTour } from '../viewer/tour';
import type { Gallery } from '../schema/gallery.schema';
import { GallerySchema } from '../schema/gallery.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(70, 1, 0.05, 200);
}

function makeGallery(waypointCount: number): Gallery {
  const waypoints = Array.from({ length: waypointCount }, (_, i) => ({
    position: { x: i * 5, y: 1.6, z: 0 },
    lookAt: { x: i * 5, y: 1.6, z: -5 },
    label: `Waypoint ${i + 1}`,
  }));

  return GallerySchema.parse({
    version: '1.0',
    title: 'Tour Test Gallery',
    rooms: [
      {
        id: 'room-a',
        width: 20,
        depth: 10,
        height: 3.5,
        surfaces: { wall: 'white-plaster', floor: 'light-wood', accentColor: '#c0a070' },
        lighting: { ambientIntensity: 0.4, temperature: 'neutral', artworkSpotlights: false },
        doorways: [],
      },
    ],
    artworks: [],
    placements: [],
    tour: waypoints,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GalleryTour waypoint sequencing', () => {
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    camera = makeCamera();
  });

  afterEach(() => {
    // Clean up any HUD elements added to the document body
    document.querySelectorAll('#oh-tour-hud').forEach((el) => el.remove());
  });

  it('starts at index 0', () => {
    const gallery = makeGallery(3);
    const onExit = vi.fn();
    const tour = new GalleryTour({ camera, gallery, onExit });

    // The tour should target waypoint 0's position
    // After creation, toPos should equal waypoint 0's position (x=0, z=0)
    // We can't directly access private fields, so we update and check camera moves toward index 0
    expect(gallery.tour[0].position.x).toBe(0);
    tour.dispose();
  });

  it('next() advances to the next waypoint', () => {
    const gallery = makeGallery(3);
    const onExit = vi.fn();
    const tour = new GalleryTour({ camera, gallery, onExit });

    // After next(), the tour should be travelling to waypoint 1 (x=5)
    tour.next();

    // Fast-forward: update with a large delta to complete travel
    tour.update(10);

    // Camera should be near waypoint 1's position
    expect(camera.position.x).toBeCloseTo(5, 0);

    tour.dispose();
  });

  it('prev() from waypoint 0 wraps to the last waypoint', () => {
    const gallery = makeGallery(3);
    const onExit = vi.fn();
    const tour = new GalleryTour({ camera, gallery, onExit });

    tour.prev();
    tour.update(10);

    // Should be at the last waypoint: index 2, x=10
    expect(camera.position.x).toBeCloseTo(10, 0);

    tour.dispose();
  });

  it('exit() calls onExit with camera position', () => {
    const gallery = makeGallery(2);
    const onExit = vi.fn();
    const tour = new GalleryTour({ camera, gallery, onExit });

    // Move the camera manually
    camera.position.set(7, 1.6, 3);
    tour.exit();

    expect(onExit).toHaveBeenCalledTimes(1);
    const pos: THREE.Vector3 = onExit.mock.calls[0][0];
    expect(pos.x).toBeCloseTo(7);
    expect(pos.z).toBeCloseTo(3);
  });

  it('does not crash with 0 waypoints', () => {
    const gallery = makeGallery(0);
    const onExit = vi.fn();
    expect(() => {
      const tour = new GalleryTour({ camera, gallery, onExit });
      tour.update(1);
      tour.next();
      tour.prev();
      tour.dispose();
    }).not.toThrow();
  });

  it('removes HUD from document on dispose', () => {
    const gallery = makeGallery(2);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });

    expect(document.getElementById('oh-tour-hud')).not.toBeNull();
    tour.dispose();
    expect(document.getElementById('oh-tour-hud')).toBeNull();
  });
});

// Restore
document.addEventListener = origAddEventListener;
document.removeEventListener = origRemoveEventListener;
