import { escapeHtml } from '../ui/escape-html';

/**
 * tour.ts — Guided gallery tour mode.
 *
 * The tour follows gallery.json tour waypoints in sequence:
 *   - Camera smoothly moves to each waypoint position and looks at lookAt.
 *   - Pauses at each waypoint, showing the artwork label.
 *   - Next / Prev / Exit controls are shown as a fixed HUD.
 *
 * Touch/mobile fallback:
 *   - On touch devices (no pointer-lock support) tour is the primary navigation.
 *   - Simple drag-to-look while paused at a waypoint.
 *   - Tour never crashes or traps the user.
 *
 * Framework-free vanilla TS + Three.js per AGENTS.md rule 2.
 */

import * as THREE from 'three';
import type { TourWaypoint, Gallery } from '../schema/gallery.schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TourOptions {
  camera: THREE.PerspectiveCamera;
  gallery: Gallery;
  /** Called when tour exits to return control to free walk. */
  onExit: (position: THREE.Vector3) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRAVEL_DURATION = 1.4; // seconds per waypoint travel
const PAUSE_DURATION = 0.8; // seconds to wait after arrival before showing label
const EYE_HEIGHT = 1.6;

// ---------------------------------------------------------------------------
// HUD creation helpers
// ---------------------------------------------------------------------------

function createTourHud(): HTMLElement {
  const hud = document.createElement('div');
  hud.id = 'oh-tour-hud';
  hud.style.cssText = `
    position:fixed;
    bottom:2rem;left:50%;
    transform:translateX(-50%);
    display:flex;flex-direction:column;align-items:center;gap:0.75rem;
    z-index:300;
    font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
    pointer-events:none;
  `;
  document.body.appendChild(hud);
  return hud;
}

function createLabelBox(): HTMLElement {
  const box = document.createElement('div');
  box.id = 'oh-tour-label';
  box.style.cssText = `
    background:rgba(0,0,0,0.8);
    border:1px solid rgba(255,255,255,0.12);
    border-radius:10px;
    padding:0.9rem 1.25rem;
    color:#f0ece6;
    max-width:min(440px,80vw);
    text-align:center;
    display:none;
    backdrop-filter:blur(4px);
  `;
  return box;
}

function createButtons(
  onPrev: () => void,
  onNext: () => void,
  onExit: () => void
): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = `
    display:flex;gap:0.6rem;pointer-events:all;
  `;

  function makeBtn(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      padding:0.55rem 1.1rem;
      background:rgba(0,0,0,0.75);
      border:1px solid rgba(255,255,255,0.3);
      color:#f0ece6;border-radius:8px;
      font-size:0.88rem;cursor:pointer;
      backdrop-filter:blur(4px);
    `;
    btn.addEventListener('click', onClick);
    return btn;
  }

  row.appendChild(makeBtn('← Prev', onPrev));
  row.appendChild(makeBtn('Next →', onNext));
  row.appendChild(makeBtn('Exit Tour', onExit));
  return row;
}

// ---------------------------------------------------------------------------
// TouchLook — simple drag-to-look while paused on mobile
// ---------------------------------------------------------------------------

class TouchLook {
  private lastX = 0;
  private lastY = 0;
  private active = false;
  private camera: THREE.PerspectiveCamera;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private boundStart: (e: TouchEvent) => void;
  private boundMove: (e: TouchEvent) => void;
  private boundEnd: () => void;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.boundStart = this.onStart.bind(this);
    this.boundMove = this.onMove.bind(this);
    this.boundEnd = this.onEnd.bind(this);
    document.addEventListener('touchstart', this.boundStart, { passive: true });
    document.addEventListener('touchmove', this.boundMove, { passive: true });
    document.addEventListener('touchend', this.boundEnd);
  }

  private onStart(e: TouchEvent): void {
    if (e.touches.length === 1) {
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
      this.active = true;
    }
  }

  private onMove(e: TouchEvent): void {
    if (!this.active || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - this.lastX;
    const dy = e.touches[0].clientY - this.lastY;
    this.lastX = e.touches[0].clientX;
    this.lastY = e.touches[0].clientY;

    this.euler.setFromQuaternion(this.camera.quaternion);
    this.euler.y -= dx * 0.003;
    this.euler.x -= dy * 0.003;
    this.euler.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);
  }

  private onEnd(): void {
    this.active = false;
  }

  dispose(): void {
    document.removeEventListener('touchstart', this.boundStart);
    document.removeEventListener('touchmove', this.boundMove);
    document.removeEventListener('touchend', this.boundEnd);
  }
}

// ---------------------------------------------------------------------------
// GalleryTour — main class
// ---------------------------------------------------------------------------

type TourPhase = 'travelling' | 'pausing' | 'viewing';

export class GalleryTour {
  private camera: THREE.PerspectiveCamera;
  private gallery: Gallery;
  private waypoints: TourWaypoint[];
  private index = 0;
  private phase: TourPhase = 'travelling';
  private elapsed = 0;

  private fromPos = new THREE.Vector3();
  private fromQuat = new THREE.Quaternion();
  private toPos = new THREE.Vector3();
  private toQuat = new THREE.Quaternion();

  private hud: HTMLElement;
  private labelBox: HTMLElement;
  private touchLook: TouchLook | null = null;
  private onExitCb: (position: THREE.Vector3) => void;

  private static isTouchDevice(): boolean {
    return typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }

  constructor(opts: TourOptions) {
    this.camera = opts.camera;
    this.gallery = opts.gallery;
    this.waypoints = opts.gallery.tour;
    this.onExitCb = opts.onExit;

    this.hud = createTourHud();
    this.labelBox = createLabelBox();
    this.hud.appendChild(this.labelBox);

    const btns = createButtons(
      () => this.prev(),
      () => this.next(),
      () => this.exit()
    );
    this.hud.appendChild(btns);

    if (GalleryTour.isTouchDevice()) {
      this.touchLook = new TouchLook(this.camera);
    }

    this.startWaypoint(0);
  }

  /** Update: call once per frame with delta seconds. */
  update(delta: number): void {
    if (!this.waypoints.length) return;

    this.elapsed += delta;

    if (this.phase === 'travelling') {
      const t = Math.min(this.elapsed / TRAVEL_DURATION, 1);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      this.camera.position.lerpVectors(this.fromPos, this.toPos, ease);
      this.camera.position.y = EYE_HEIGHT;
      this.camera.quaternion.slerpQuaternions(this.fromQuat, this.toQuat, ease);
      if (t >= 1) {
        this.phase = 'pausing';
        this.elapsed = 0;
      }
    } else if (this.phase === 'pausing') {
      if (this.elapsed >= PAUSE_DURATION) {
        this.phase = 'viewing';
        this.elapsed = 0;
        this.showLabel();
      }
    }
    // 'viewing' — waiting for user interaction; touch drag handled by TouchLook
  }

  private startWaypoint(index: number): void {
    if (!this.waypoints.length) return;
    this.index = ((index % this.waypoints.length) + this.waypoints.length) % this.waypoints.length;
    const wp = this.waypoints[this.index];

    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);

    this.toPos.set(wp.position.x, EYE_HEIGHT, wp.position.z);

    const lookAt = new THREE.Vector3(wp.lookAt.x, EYE_HEIGHT, wp.lookAt.z);
    const lookDir = lookAt.clone().sub(this.toPos).normalize();
    if (lookDir.lengthSq() < 0.0001) lookDir.set(0, 0, -1);
    this.toQuat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), lookDir);

    this.phase = 'travelling';
    this.elapsed = 0;
    this.hideLabel();
  }

  private showLabel(): void {
    const wp = this.waypoints[this.index];
    const artwork = wp.artworkId
      ? this.gallery.artworks.find((a) => a.id === wp.artworkId)
      : null;

    const title = artwork?.title ?? wp.label ?? '';
    const medium = artwork?.medium ?? '';
    const year = artwork?.year != null ? `, ${artwork.year}` : '';
    const label = artwork?.label ?? '';
    const counter = `${this.index + 1} / ${this.waypoints.length}`;

    this.labelBox.innerHTML = `
      ${title ? `<p style="font-size:1rem;font-weight:700;margin:0 0 0.1rem;">${escapeHtml(title)}</p>` : ''}
      ${medium ? `<p style="font-size:0.78rem;color:#aaa;margin:0 0 0.5rem;">${escapeHtml(medium)}${escapeHtml(year)}</p>` : ''}
      ${label ? `<p style="font-size:0.85rem;line-height:1.5;margin:0 0 0.5rem;">${escapeHtml(label)}</p>` : ''}
      <p style="font-size:0.72rem;color:#666;margin:0;">${escapeHtml(counter)}</p>
    `;
    this.labelBox.style.display = 'block';
  }

  private hideLabel(): void {
    this.labelBox.style.display = 'none';
  }

  next(): void {
    this.startWaypoint(this.index + 1);
  }

  prev(): void {
    this.startWaypoint(this.index - 1);
  }

  exit(): void {
    const pos = this.camera.position.clone();
    this.dispose();
    this.onExitCb(pos);
  }

  /** Clean up HUD, touch listeners. */
  dispose(): void {
    if (this.hud.parentNode) this.hud.parentNode.removeChild(this.hud);
    this.touchLook?.dispose();
  }
}
