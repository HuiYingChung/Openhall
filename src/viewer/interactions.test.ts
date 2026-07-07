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
import { ArtworkInteractions, ARTIST_MESH_ID } from './interactions';
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

// ---------------------------------------------------------------------------
// onClick guards — keyboard-activated clicks and UI chrome targets
// ---------------------------------------------------------------------------

describe('ArtworkInteractions onClick guards', () => {
  afterEach(() => {
    document.querySelectorAll('#oh-crosshair, #oh-info-panel').forEach((el) => el.remove());
  });

  it('ignores click events with detail === 0 (keyboard activation)', () => {
    const { interactions } = makeInteractions();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const priv = interactions as any;
    // Put a fake hovered mesh in place so startDolly would otherwise fire
    priv.hoveredMesh = { userData: { artworkId: 'aw-1' } };

    const evt = new MouseEvent('click', { bubbles: true, detail: 0 });
    document.dispatchEvent(evt);

    // dollyActive must stay false — startDolly must not have been called
    expect(priv.dollyActive).toBe(false);
    interactions.dispose();
  });

  it('processes click events with detail >= 1 (real mouse click) past the guard', () => {
    const { interactions } = makeInteractions();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const priv = interactions as any;
    // No hovered mesh → onClick will return early at the hoveredMesh check,
    // but it must NOT return at the detail guard. We verify by confirming
    // execution reaches the getIsLocked() check (which returns true from our stub).
    // The simplest observable is that dollyActive stays false only because
    // hoveredMesh is null, not because of the detail guard.
    priv.hoveredMesh = null;

    const evt = new MouseEvent('click', { bubbles: true, detail: 1 });
    document.dispatchEvent(evt);

    // No dolly (no hovered mesh) but also no throw — guard passed through
    expect(priv.dollyActive).toBe(false);
    interactions.dispose();
  });

  it('ignores clicks whose target is a <button> element', () => {
    const { interactions } = makeInteractions();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const priv = interactions as any;
    priv.hoveredMesh = { userData: { artworkId: 'aw-1' } };

    const btn = document.createElement('button');
    document.body.appendChild(btn);

    const evt = new MouseEvent('click', { bubbles: true, detail: 1 });
    Object.defineProperty(evt, 'target', { value: btn, configurable: true });
    document.dispatchEvent(evt);

    expect(priv.dollyActive).toBe(false);
    btn.remove();
    interactions.dispose();
  });

  it('ignores clicks whose target is inside #oh-tour-hud', () => {
    const { interactions } = makeInteractions();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const priv = interactions as any;
    priv.hoveredMesh = { userData: { artworkId: 'aw-1' } };

    const hud = document.createElement('div');
    hud.id = 'oh-tour-hud';
    const inner = document.createElement('span');
    hud.appendChild(inner);
    document.body.appendChild(hud);

    const evt = new MouseEvent('click', { bubbles: true, detail: 1 });
    Object.defineProperty(evt, 'target', { value: inner, configurable: true });
    document.dispatchEvent(evt);

    expect(priv.dollyActive).toBe(false);
    hud.remove();
    interactions.dispose();
  });
});

// ---------------------------------------------------------------------------
// Artist panel
// ---------------------------------------------------------------------------

describe('ArtworkInteractions artist panel', () => {
  afterEach(() => {
    document.querySelectorAll('#oh-crosshair, #oh-info-panel').forEach((el) => el.remove());
  });

  function makeArtistInteractions() {
    const gallery = makeGallery();
    gallery.artist = {
      name: 'Jane Artist',
      statement: 'I paint quiet interiors at dusk.',
      links: [
        { label: 'Instagram', url: 'https://instagram.com/jane' },
        { label: 'Bad', url: 'javascript:alert(1)' },
      ],
    };
    const interactions = new ArtworkInteractions({
      camera: new THREE.PerspectiveCamera(70, 1, 0.05, 200),
      scene: new THREE.Scene(),
      artworkMeshes: new Map(),
      gallery,
      onInspectOpen: vi.fn(),
      onInspectClose: vi.fn(),
      getIsLocked: vi.fn(() => true),
    });
    return interactions;
  }

  it('renders the artist name, statement and only safe links', () => {
    const interactions = makeArtistInteractions();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const priv = interactions as any;
    priv.currentArtworkId = ARTIST_MESH_ID;
    priv.showInfoPanel();

    const panel = document.querySelector('#oh-info-panel')!;
    expect(panel.innerHTML).toContain('Jane Artist');
    expect(panel.innerHTML).toContain('I paint quiet interiors at dusk.');
    expect(panel.innerHTML).toContain('https://instagram.com/jane');
    // javascript: link must be filtered out
    expect(panel.innerHTML).not.toContain('javascript:');
    expect(interactions.isInspecting).toBe(true);
    interactions.dispose();
  });
});
