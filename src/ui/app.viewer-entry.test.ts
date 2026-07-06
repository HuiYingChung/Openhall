/**
 * app.viewer-entry.test.ts — Regression tests for the viewer entry bugs
 * fixed in session 03E.
 *
 * Bug A regression: applyGeneratingResult() must write both scene and controls
 * into the provided mutable refs. The render loop reads sceneRef.current every
 * frame — if this assignment is missing the user sees an empty black scene.
 */

import { describe, it, expect, vi } from 'vitest';
import { applyGeneratingResult } from './app';
import type { FirstPersonControls } from '../viewer/controls';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Minimal FirstPersonControls stub — only the ref assignment matters here.
// Cast as unknown → FirstPersonControls so strict types don't force us to
// instantiate a real PointerLockControls (which needs a DOM).
// ---------------------------------------------------------------------------

function makeControlsStub() {
  return {
    lock: vi.fn(),
    teleport: vi.fn(),
    setWalls: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(),
    pointerLock: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    isLocked: false,
  } as unknown as FirstPersonControls;
}

// ---------------------------------------------------------------------------
// Bug A regression — scene and controls are stored in refs
// ---------------------------------------------------------------------------

describe('applyGeneratingResult (Bug A regression)', () => {
  it('updates sceneRef.current to the new scene', () => {
    const placeholder = new THREE.Scene();
    const built = new THREE.Scene();
    built.uuid = 'built-scene-uuid'; // make identity distinguishable

    const sceneRef = { current: placeholder };
    const controlsRef: { current: FirstPersonControls | null } = { current: null };
    const controls = makeControlsStub();

    applyGeneratingResult(sceneRef, controlsRef, built, controls);

    expect(sceneRef.current).toBe(built);
    expect(sceneRef.current).not.toBe(placeholder);
  });

  it('updates controlsRef.current to the new controls', () => {
    const scene = new THREE.Scene();
    const sceneRef = { current: scene };
    const controlsRef: { current: FirstPersonControls | null } = { current: null };
    const controls = makeControlsStub();

    applyGeneratingResult(sceneRef, controlsRef, scene, controls);

    expect(controlsRef.current).toBe(controls);
  });

  it('does NOT leave either ref unchanged (regression: _s was discarded, controls never set)', () => {
    // Before the fix, the generating callback used `(_s, newControls)` —
    // the scene parameter was discarded and currentScene stayed as the empty
    // placeholder. This test verifies both refs are updated.
    const placeholder = new THREE.Scene();
    const built = new THREE.Scene();
    const sceneRef = { current: placeholder };
    const controlsRef: { current: FirstPersonControls | null } = { current: null };
    const controls = makeControlsStub();

    applyGeneratingResult(sceneRef, controlsRef, built, controls);

    expect(sceneRef.current).not.toBe(placeholder);
    expect(controlsRef.current).not.toBeNull();
  });
});
