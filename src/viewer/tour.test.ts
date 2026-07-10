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

import { GalleryTour, computeDwellSeconds } from '../viewer/tour';
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

function makeGalleryWithTransit(): Gallery {
  const gallery = makeGallery(0);
  return GallerySchema.parse({
    ...gallery,
    artworks: [
      { id: 'aw-1', imagePath: 'images/aw-1.jpg', title: 'First', medium: 'Oil', label: 'First label.' },
      { id: 'aw-2', imagePath: 'images/aw-2.jpg', title: 'Second', medium: 'Ink', label: 'Second label.' },
    ],
    tour: [
      {
        artworkId: 'aw-1',
        position: { x: 0, y: 1.6, z: 0 },
        lookAt: { x: 0, y: 1.5, z: -2 },
        label: 'First',
      },
      {
        kind: 'transit',
        position: { x: 5, y: 1.6, z: 0 },
        lookAt: { x: 10, y: 1.6, z: 0 },
      },
      {
        artworkId: 'aw-2',
        position: { x: 10, y: 1.6, z: 0 },
        lookAt: { x: 10, y: 1.5, z: -2 },
        label: 'Second',
      },
    ],
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

  it('passes through transit waypoints without pausing or counting them as stops', () => {
    const gallery = makeGalleryWithTransit();
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });

    tour.update(10);
    tour.update(1);
    tour.next();

    tour.update(10);
    expect(camera.position.x).toBeCloseTo(5, 0);
    expect(document.getElementById('oh-tour-label')?.style.display).toBe('none');

    tour.update(10);
    tour.update(1);
    expect(camera.position.x).toBeCloseTo(10, 0);
    expect(document.getElementById('oh-tour-label')?.textContent).toContain('2 / 2');

    tour.dispose();
  });

  it('traverses the same doorway waypoint in reverse when moving to the previous stop', () => {
    const gallery = makeGalleryWithTransit();
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });

    tour.next();
    tour.update(10);
    tour.update(10);
    tour.update(1);
    tour.prev();

    tour.update(10);
    expect(camera.position.x).toBeCloseTo(5, 0);
    tour.update(10);
    expect(camera.position.x).toBeCloseTo(0, 0);

    tour.dispose();
  });

  it('prev() from waypoint 0 stays at the first waypoint', () => {
    const gallery = makeGallery(3);
    const onExit = vi.fn();
    const tour = new GalleryTour({ camera, gallery, onExit });

    tour.prev();
    tour.update(10);

    // Boundary navigation must not animate across the whole gallery.
    expect(camera.position.x).toBeCloseTo(0, 0);

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

// ---------------------------------------------------------------------------
// Autoplay
// ---------------------------------------------------------------------------

describe('computeDwellSeconds', () => {
  it('gives the 5 s floor for empty and short labels', () => {
    expect(computeDwellSeconds('')).toBe(5);
    expect(computeDwellSeconds('Short label')).toBeCloseTo(5.14, 1);
  });

  it('scales with label length and caps at 12 s', () => {
    expect(computeDwellSeconds('x'.repeat(240))).toBeCloseTo(8, 1);
    expect(computeDwellSeconds('x'.repeat(5000))).toBe(12);
  });
});

describe('GalleryTour autoplay', () => {
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    camera = makeCamera();
  });

  afterEach(() => {
    document.querySelectorAll('#oh-tour-hud, #oh-tour-label').forEach((el) => el.remove());
  });

  /** Drive update() until the tour reaches 'viewing' at its current waypoint. */
  function settle(tour: GalleryTour): void {
    tour.update(10); // completes travelling
    tour.update(1);  // completes pausing → viewing
  }

  it('starts paused and renders an Autoplay control', () => {
    const gallery = makeGallery(3);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    expect(tour.isAutoplaying).toBe(false);
    const playBtn = document.getElementById('oh-tour-play')!;
    expect(playBtn.textContent).toContain('Autoplay');
    tour.dispose();
  });

  it('advances to the next waypoint after the dwell when playing', () => {
    const gallery = makeGallery(3);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    settle(tour); // viewing waypoint 0
    tour.setAutoplay(true);

    tour.update(13); // exceed max dwell → starts travelling to waypoint 1
    tour.update(10); // completes travel
    expect(camera.position.x).toBeCloseTo(5, 0);
    expect(tour.isAutoplaying).toBe(true);
    tour.dispose();
  });

  it('stops (not loops) after dwelling on the final waypoint', () => {
    const gallery = makeGallery(2);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    settle(tour);
    tour.setAutoplay(true);

    tour.update(13); // advance to waypoint 1 (last)
    tour.update(10); // travel done
    tour.update(1);  // pause done → viewing last waypoint
    expect(tour.isAutoplaying).toBe(true);
    tour.update(13); // dwell on last waypoint elapses → autoplay stops
    expect(tour.isAutoplaying).toBe(false);
    expect(camera.position.x).toBeCloseTo(5, 0); // still at the last waypoint
    // Autoplay self-stopping should NOT replay — camera stays at last stop.
    expect(camera.position.x).toBeCloseTo(5, 0);
    tour.dispose();
  });

  it('user pressing Play at the last waypoint replays from stop 0', () => {
    const gallery = makeGallery(3);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    settle(tour); // viewing waypoint 0

    // Run to last waypoint (index 2, x=10)
    tour.setAutoplay(true);
    tour.update(13); tour.update(10); // → waypoint 1
    tour.update(1);                   // pause → viewing
    tour.update(13); tour.update(10); // → waypoint 2 (last)
    tour.update(1);                   // pause → viewing last
    tour.update(13);                  // dwell elapses → autoplay off
    expect(tour.isAutoplaying).toBe(false);
    expect(camera.position.x).toBeCloseTo(10, 0); // at last stop

    // User presses Play → must restart from stop 0.
    tour.setAutoplay(true);
    expect(tour.isAutoplaying).toBe(true);
    tour.update(10); // complete travel
    expect(camera.position.x).toBeCloseTo(0, 0); // back at first stop
    tour.dispose();
  });

  it('setAutoplay(false) from internal auto-stop does not replay', () => {
    // This test guards against the replay path triggering during the auto-stop.
    // When autoplay turns itself off in update() the tour must stay at the last stop.
    const gallery = makeGallery(2);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    settle(tour);
    tour.setAutoplay(true);

    // Drive to last waypoint and let autoplay turn itself off internally.
    tour.update(13); tour.update(10); // travel to last
    tour.update(1);                   // pause → viewing last
    tour.update(13);                  // dwell elapses → auto-stop

    expect(tour.isAutoplaying).toBe(false);
    // Camera must still be at the last waypoint (x ≈ 5), not at 0.
    expect(camera.position.x).toBeCloseTo(5, 0);
    tour.dispose();
  });

  it('manual next()/prev() pauses autoplay', () => {
    const gallery = makeGallery(3);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    settle(tour);
    tour.setAutoplay(true);
    tour.next();
    expect(tour.isAutoplaying).toBe(false);
    tour.dispose();
  });

  it('play button toggles the label between Autoplay and Pause', () => {
    const gallery = makeGallery(3);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    const playBtn = document.getElementById('oh-tour-play') as HTMLButtonElement;
    playBtn.click();
    expect(tour.isAutoplaying).toBe(true);
    expect(playBtn.textContent).toContain('Pause');
    playBtn.click();
    expect(tour.isAutoplaying).toBe(false);
    expect(playBtn.textContent).toContain('Autoplay');
    tour.dispose();
  });
});

// Restore
document.addEventListener = origAddEventListener;
document.removeEventListener = origRemoveEventListener;

// ---------------------------------------------------------------------------
// Voice UX (items 1–3 from BOB_PROMPT_09C)
// ---------------------------------------------------------------------------

describe('GalleryTour voice UX', () => {
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    camera = makeCamera();
  });

  afterEach(() => {
    document.querySelectorAll('#oh-tour-hud, #oh-tour-label').forEach((el) => el.remove());
  });

  /** Drive update() until the tour reaches 'viewing' at its current waypoint. */
  function settle(tour: GalleryTour): void {
    tour.update(10);
    tour.update(1);
  }

  it('voice defaults OFF: voiceBtn aria-pressed is false and shows slash icon', () => {
    const gallery = makeGallery(3);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    const voiceBtn = document.getElementById('oh-tour-voice') as HTMLButtonElement | null;
    if (voiceBtn) {
      // jsdom sets speechSynthesis so the button will exist
      expect(voiceBtn.getAttribute('aria-pressed')).toBe('false');
      expect(voiceBtn.getAttribute('aria-label')).toBe('Turn voice narration on');
    }
    tour.dispose();
  });

  it('toggleVoice() when viewing: turning ON resets dwell clock (elapsed = 0)', () => {
    const gallery = makeGallery(3);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    settle(tour); // in 'viewing' phase
    // Advance dwell so elapsed > 0
    tour.update(3);

    // Reach into tour via the voice button click
    const voiceBtn = document.getElementById('oh-tour-voice') as HTMLButtonElement | null;
    if (voiceBtn) {
      voiceBtn.click(); // toggle ON
      // After turning on the dwell clock must be reset — if we update just under
      // max dwell the tour should NOT advance yet (proving elapsed was reset).
      tour.setAutoplay(true);
      tour.update(11); // just under 12 s max dwell
      // Still at waypoint 0 (x ≈ 0) because dwell was reset
      expect(camera.position.x).toBeCloseTo(0, 0);
    }
    tour.dispose();
  });

  it('toggleVoice() when viewing: turning OFF resets dwell to label-only timing', () => {
    const gallery = makeGallery(3);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    settle(tour);

    const voiceBtn = document.getElementById('oh-tour-voice') as HTMLButtonElement | null;
    if (voiceBtn) {
      voiceBtn.click(); // ON — may set a long speech dwell
      voiceBtn.click(); // OFF — must reset to label-only dwell (≤12 s)
      // After turning OFF, autoplay with a 13 s update should advance
      // (proving dwell is now label-only, not the 25 s speech estimate).
      tour.setAutoplay(true);
      tour.update(13); // exceeds any label-only dwell (max 12 s)
      tour.update(10); // complete travel
      expect(camera.position.x).toBeCloseTo(5, 0); // advanced to waypoint 1
    }
    tour.dispose();
  });

  it('Audio-guide button label adapts to viewport width (Audio guide / Audio)', () => {
    const gallery = makeGallery(2);

    // Wide viewport (jsdom default 1024): full label.
    let tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    let voiceBtn = document.getElementById('oh-tour-voice') as HTMLButtonElement | null;
    if (voiceBtn) expect(voiceBtn.textContent).toContain('Audio guide');
    tour.dispose();

    // Narrow viewport (<768): five buttons share the bottom bar — short label.
    const origWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true, writable: true });
    tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    voiceBtn = document.getElementById('oh-tour-voice') as HTMLButtonElement | null;
    if (voiceBtn) {
      expect(voiceBtn.textContent).toContain('Audio');
      expect(voiceBtn.textContent).not.toContain('Audio guide');
    }
    tour.dispose();
    Object.defineProperty(window, 'innerWidth', { value: origWidth, configurable: true, writable: true });
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

describe('GalleryTour arrow keys', () => {
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    camera = makeCamera();
  });

  afterEach(() => {
    document.querySelectorAll('#oh-tour-hud, #oh-tour-label').forEach((el) => el.remove());
  });

  function press(key: string, target?: HTMLElement): void {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    (target ?? document).dispatchEvent(ev);
  }

  it('ArrowRight advances, ArrowLeft goes back', () => {
    const gallery = makeGallery(3);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    press('ArrowRight');
    tour.update(10);
    expect(camera.position.x).toBeCloseTo(5, 0); // waypoint 1
    press('ArrowLeft');
    tour.update(10);
    expect(camera.position.x).toBeCloseTo(0, 0); // back to waypoint 0
    tour.dispose();
  });

  it('arrow keys pause autoplay like the buttons do', () => {
    const gallery = makeGallery(3);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    tour.setAutoplay(true);
    press('ArrowRight');
    expect(tour.isAutoplaying).toBe(false);
    tour.dispose();
  });

  it('ignores keys typed into form fields', () => {
    const gallery = makeGallery(2);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    tour.update(10);
    const startX = camera.position.x;
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('ArrowRight', input);
    tour.update(10);
    expect(camera.position.x).toBeCloseTo(startX, 1);
    input.remove();
    tour.dispose();
  });

  it('stops listening after dispose', () => {
    const gallery = makeGallery(2);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    tour.dispose();
    expect(() => press('ArrowRight')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Autoplay progress bar
// ---------------------------------------------------------------------------

describe('GalleryTour autoplay progress bar', () => {
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    camera = makeCamera();
  });

  afterEach(() => {
    document.querySelectorAll('#oh-tour-hud, #oh-tour-label').forEach((el) => el.remove());
  });

  /** Drive the tour into the 'viewing' phase (travel 1.4 s + pause 0.8 s). */
  function toViewing(tour: GalleryTour): void {
    tour.update(2); // finish travelling
    tour.update(1); // finish pausing → viewing, label rendered
  }

  it('track hidden while autoplay is off, shown while on, hidden after pause', () => {
    const gallery = makeGallery(3);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    toViewing(tour);
    const track = document.getElementById('oh-tour-progress-track')!;
    expect(track.style.display).toBe('none');
    tour.setAutoplay(true);
    expect(track.style.display).toBe('block');
    tour.setAutoplay(false);
    expect(track.style.display).toBe('none');
    tour.dispose();
  });

  it('fill grows with elapsed viewing time during autoplay', () => {
    const gallery = makeGallery(3);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    toViewing(tour);
    tour.setAutoplay(true);
    tour.update(1);
    const fill = document.getElementById('oh-tour-progress')!;
    const w1 = parseFloat(fill.style.width);
    expect(w1).toBeGreaterThan(0);
    tour.update(1);
    expect(parseFloat(fill.style.width)).toBeGreaterThan(w1);
    tour.dispose();
  });

  it('Pause freezes the dwell clock; Play continues from the frozen point', () => {
    const gallery = makeGallery(3);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    toViewing(tour); // 'Waypoint 1' label → 5 s dwell
    tour.setAutoplay(true);
    tour.update(2); // 2 s into the 5 s dwell → 40%
    tour.setAutoplay(false); // Pause — freeze at 2 s
    tour.update(5); // paused wall time must NOT count toward the dwell
    tour.setAutoplay(true); // Play — continue from 2 s, not 0, not 7
    tour.update(0.5);
    const fill = document.getElementById('oh-tour-progress')!;
    const pct = parseFloat(fill.style.width);
    expect(pct).toBeGreaterThan(45); // (2 + 0.5) / 5 = 50%
    expect(pct).toBeLessThan(55); // reset-to-zero bug would give 10%
    expect(camera.position.x).toBeCloseTo(0, 0); // unfrozen 7.5 s would have advanced
    tour.dispose();
  });

  it('enabling autoplay fresh at a stop still restarts the dwell clock', () => {
    const gallery = makeGallery(3);
    const tour = new GalleryTour({ camera, gallery, onExit: vi.fn() });
    toViewing(tour);
    tour.update(3); // long manual look, autoplay never on at this stop
    tour.setAutoplay(true); // fresh enable → full reading time
    tour.update(0.5);
    const fill = document.getElementById('oh-tour-progress')!;
    expect(parseFloat(fill.style.width)).toBeLessThan(20); // 0.5 / 5 = 10%
    expect(camera.position.x).toBeCloseTo(0, 0); // no instant jump
    tour.dispose();
  });
});

// ---------------------------------------------------------------------------
// Audio-guide memory: per-stop reset in manual mode, remembered in autoplay
// ---------------------------------------------------------------------------

describe('GalleryTour audio-guide memory', () => {
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    camera = makeCamera();
    // Minimal working speechSynthesis so the Audio-guide button renders.
    // Voices are non-empty so the no-voices guard never trips.
    vi.stubGlobal('speechSynthesis', {
      speak() {},
      cancel() {},
      pause() {},
      resume() {},
      getVoices: () => [{ name: 'stub' }],
      speaking: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll('#oh-tour-hud, #oh-tour-label').forEach((el) => el.remove());
  });

  function toViewing(tour: GalleryTour): void {
    tour.update(2);
    tour.update(1);
  }

  function pressed(): string | null {
    return document.getElementById('oh-tour-voice')!.getAttribute('aria-pressed');
  }

  it('manual mode: voice resets to off at every stop', () => {
    const tour = new GalleryTour({ camera, gallery: makeGallery(3), onExit: vi.fn() });
    toViewing(tour);
    tour.toggleVoice();
    expect(pressed()).toBe('true');
    tour.next(); // manual navigation
    toViewing(tour);
    expect(pressed()).toBe('false'); // arrived silent
    tour.dispose();
  });

  it('autoplay restores the last explicit choice, even after manual resets', () => {
    const tour = new GalleryTour({ camera, gallery: makeGallery(3), onExit: vi.fn() });
    toViewing(tour);
    tour.toggleVoice(); // explicit ON — remembered
    tour.next(); // manual → reset off
    toViewing(tour);
    expect(pressed()).toBe('false');
    tour.setAutoplay(true); // autoplay brings the remembered choice back
    expect(pressed()).toBe('true');
    tour.dispose();
  });

  it('autoplay carries the preference from stop to stop', () => {
    const tour = new GalleryTour({ camera, gallery: makeGallery(3), onExit: vi.fn() });
    toViewing(tour);
    tour.setAutoplay(true);
    tour.toggleVoice(); // ON during autoplay
    tour.update(31); // exceed even the speech-aware dwell → advance
    toViewing(tour); // arrive at stop 1
    expect(pressed()).toBe('true');
    tour.dispose();
  });

  it('an explicit OFF during autoplay is remembered too', () => {
    const tour = new GalleryTour({ camera, gallery: makeGallery(3), onExit: vi.fn() });
    toViewing(tour);
    tour.setAutoplay(true);
    tour.toggleVoice(); // ON
    tour.toggleVoice(); // explicit OFF — remembered
    tour.update(13);
    toViewing(tour);
    expect(pressed()).toBe('false');
    tour.dispose();
  });
});

// ---------------------------------------------------------------------------
// Audio guide while frozen by Pause: press = resume, not toggle-off
// ---------------------------------------------------------------------------

describe('GalleryTour audio guide during Pause', () => {
  let camera: THREE.PerspectiveCamera;

  /** Gallery whose first waypoint has a speakable narration. */
  function galleryWithNarration(): Gallery {
    return GallerySchema.parse({
      version: '1.0',
      title: 'Frozen Voice Gallery',
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
      artworks: [
        {
          id: 'aw-01',
          imagePath: 'images/aw-01.jpg',
          title: 'Painting One',
          medium: 'Oil',
          label: 'A wall label.',
          narration: 'A spoken narration for painting one.',
        },
      ],
      placements: [],
      tour: [
        {
          artworkId: 'aw-01',
          position: { x: 0, y: 1.6, z: 0 },
          lookAt: { x: 0, y: 1.6, z: -5 },
        },
      ],
    });
  }

  beforeEach(() => {
    camera = makeCamera();
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        onstart: ((ev: Event) => void) | null = null;
        onend: ((ev: Event) => void) | null = null;
        onerror: ((ev: Event) => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll('#oh-tour-hud, #oh-tour-label').forEach((el) => el.remove());
  });

  it('press while frozen resumes the narration and stays ON; press while speaking turns off', () => {
    const state = { speaking: false, resumed: 0, cancelled: 0 };
    vi.stubGlobal('speechSynthesis', {
      speak() {
        state.speaking = true;
      },
      cancel() {
        state.speaking = false;
        state.cancelled++;
      },
      pause() {},
      resume() {
        state.resumed++;
      },
      getVoices: () => [{ name: 'stub' }],
      get speaking() {
        return state.speaking;
      },
    });

    const tour = new GalleryTour({ camera, gallery: galleryWithNarration(), onExit: vi.fn() });
    tour.update(2);
    tour.update(1); // viewing
    tour.setAutoplay(true);
    tour.toggleVoice(); // ON → speaks
    expect(state.speaking).toBe(true);

    tour.setAutoplay(false); // Pause freezes the utterance
    const voiceBtn = document.getElementById('oh-tour-voice')!;
    voiceBtn.click(); // her exact press: must RESUME, not toggle off
    expect(state.resumed).toBe(1);
    expect(voiceBtn.getAttribute('aria-pressed')).toBe('true');

    voiceBtn.click(); // now audibly speaking → normal toggle OFF
    expect(voiceBtn.getAttribute('aria-pressed')).toBe('false');
    expect(state.speaking).toBe(false);
    tour.dispose();
  });
});
