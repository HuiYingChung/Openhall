// @vitest-environment jsdom
/**
 * interactions.test.ts — Unit tests for ArtworkInteractions.close()
 *
 * Verifies Bug 3 fix: close() correctly resets inspecting + dollyActive state
 * flags so a tour can start cleanly even if an inspect panel is open or a
 * dolly animation is in flight.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { ArtworkInteractions } from './interactions';
import type { Gallery } from '../schema/gallery.schema';
import { GallerySchema } from '../schema/gallery.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGallery(): Gallery {
  return GallerySchema.parse({
    version: '1.0',
    title: 'Interactions Test Gallery',
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
    tour: [],
  });
}

function makeInteractions() {
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  const scene = new THREE.Scene();
  const onInspectOpen = vi.fn();
  const onInspectClose = vi.fn();
  const getIsLocked = vi.fn(() => true);

  const interactions = new ArtworkInteractions({
    camera,
    scene,
    artworkMeshes: new Map(),
    gallery: makeGallery(),
    onInspectOpen,
    onInspectClose,
    getIsLocked,
  });

  return { interactions, onInspectOpen, onInspectClose };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ArtworkInteractions.close()', () => {
  afterEach(() => {
    // Remove any DOM elements created by ArtworkInteractions
    document.querySelectorAll('#oh-crosshair, #oh-info-panel').forEach((el) => el.remove());
  });

  it('is a no-op when nothing is open', () => {
    const { interactions, onInspectClose } = makeInteractions();
    expect(() => interactions.close()).not.toThrow();
    expect(onInspectClose).not.toHaveBeenCalled();
    expect(interactions.isInspecting).toBe(false);
    interactions.dispose();
  });

  it('closes the panel and resets isInspecting when inspecting', () => {
    const { interactions, onInspectClose } = makeInteractions();

    // Simulate an open panel by directly manipulating private state via casting
    // (we need to drive the state machine to the inspecting=true branch without
    // a real DOM click, so we exercise the internal method via a protected path).
    // We cast to any to access private members — this is intentional in a test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const priv = interactions as any;
    priv.inspecting = true;
    priv.infoPanel.style.display = 'block';

    expect(interactions.isInspecting).toBe(true);
    interactions.close();
    expect(interactions.isInspecting).toBe(false);
    expect(onInspectClose).toHaveBeenCalledTimes(1);
    interactions.dispose();
  });

  it('cancels an in-progress dolly and resets isInspecting', () => {
    const { interactions, onInspectClose } = makeInteractions();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const priv = interactions as any;
    priv.dollyActive = true;

    expect(interactions.isInspecting).toBe(true);
    interactions.close();
    expect(interactions.isInspecting).toBe(false);
    expect(onInspectClose).toHaveBeenCalledTimes(1);
    interactions.dispose();
  });

  it('is idempotent — calling twice does not double-fire onInspectClose', () => {
    const { interactions, onInspectClose } = makeInteractions();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const priv = interactions as any;
    priv.inspecting = true;
    priv.infoPanel.style.display = 'block';

    interactions.close();
    interactions.close(); // second call — nothing to close
    expect(onInspectClose).toHaveBeenCalledTimes(1);
    interactions.dispose();
  });
});
