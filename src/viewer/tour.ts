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
import { wirePanelDrag, swapToUnlitMaterial, ARTIST_MESH_ID } from './interactions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TourOptions {
  camera: THREE.PerspectiveCamera;
  gallery: Gallery;
  /** Called when tour exits to return control to free walk. */
  onExit: (position: THREE.Vector3) => void;
  /**
   * Optional canvas-mesh lookup. When provided, the focused artwork is
   * rendered unlit while viewed so spotlights can't wash out the image.
   */
  getArtworkMesh?: (id: string) => THREE.Mesh | undefined;
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

/**
 * Tour label. Two layouts so it never blocks the artwork:
 * - Desktop: floating card above the buttons, draggable anywhere (shared
 *   wirePanelDrag util from interactions.ts).
 * - Touch: full-width bottom sheet, capped height, scrolls vertically —
 *   the artwork stays visible above it.
 */
function createLabelBox(isTouch: boolean): HTMLElement {
  const box = document.createElement('div');
  box.id = 'oh-tour-label';
  if (isTouch) {
    box.style.cssText = `
      position:fixed;
      left:0;right:0;bottom:0;
      background:rgba(0,0,0,0.88);
      border:1px solid rgba(255,255,255,0.12);
      border-bottom:none;
      border-radius:14px 14px 0 0;
      padding:0.9rem 1.25rem calc(1rem + env(safe-area-inset-bottom, 0px));
      color:#f0ece6;
      font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
      max-height:38vh;
      overflow-y:auto;
      text-align:left;
      display:none;
      z-index:290;
      backdrop-filter:blur(4px);
    `;
  } else {
    box.style.cssText = `
      position:fixed;
      bottom:2rem;left:2rem;
      background:rgba(0,0,0,0.8);
      border:1px solid rgba(255,255,255,0.12);
      border-radius:10px;
      padding:0.9rem 1.25rem;
      color:#f0ece6;
      font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
      max-width:min(360px,30vw);
      max-height:45vh;
      overflow-y:auto;
      text-align:left;
      display:none;
      z-index:290;
      backdrop-filter:blur(4px);
      cursor:grab;
      touch-action:none;
      pointer-events:all;
    `;
    wirePanelDrag(box);
  }
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
    // Touches that start on the label sheet, HUD, or any button belong to
    // scrolling/tapping — never to camera look.
    if (e.target instanceof HTMLElement &&
        e.target.closest('#oh-tour-label, #oh-tour-hud, button')) return;
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
  private labelBox!: HTMLElement;
  private btns: HTMLElement;
  private isTouch = false;
  private touchLook: TouchLook | null = null;
  private boundResize: () => void;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private onExitCb: (position: THREE.Vector3) => void;
  private getArtworkMesh?: (id: string) => THREE.Mesh | undefined;
  private restoreMat: (() => void) | null = null;

  private static isTouchDevice(): boolean {
    return typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }

  /**
   * Layout is purely width-based: narrow viewports (<768px) get the bottom
   * sheet + docked bar (works fine with mouse too); wide viewports get the
   * draggable floating card (drag works by touch too). Pointer type only
   * decides drag-to-look capability, never layout.
   */
  private static prefersTouchLayout(): boolean {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  }

  constructor(opts: TourOptions) {
    this.camera = opts.camera;
    this.gallery = opts.gallery;
    this.waypoints = opts.gallery.tour;
    this.onExitCb = opts.onExit;
    this.getArtworkMesh = opts.getArtworkMesh;

    this.hud = createTourHud();
    const btns = createButtons(
      () => this.prev(),
      () => this.next(),
      () => this.exit()
    );
    this.hud.appendChild(btns);
    this.btns = btns;

    // Layout (floating card vs bottom sheet) responds to live resizes and
    // device rotation — re-applied whenever the 768 px threshold is crossed.
    this.applyLayout();
    this.boundResize = () => {
      if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        if (GalleryTour.prefersTouchLayout() !== this.isTouch) this.applyLayout();
      }, 150);
    };
    window.addEventListener('resize', this.boundResize);

    // Drag-to-look is a capability, not a layout: enabled on any
    // touch-capable device (including touchscreen laptops).
    if (GalleryTour.isTouchDevice()) {
      this.touchLook = new TouchLook(this.camera);
    }

    this.startWaypoint(0);
  }

  /**
   * (Re)build the label box and HUD styles for the current viewport width.
   * Called at construction and whenever a resize crosses the 768 px threshold.
   */
  private applyLayout(): void {
    this.isTouch = GalleryTour.prefersTouchLayout();

    const wasVisible = this.labelBox ? this.labelBox.style.display === 'block' : false;
    if (this.labelBox) this.labelBox.remove();
    this.labelBox = createLabelBox(this.isTouch);
    document.body.appendChild(this.labelBox);

    if (this.isTouch) {
      // Controls dock as a full-width bar at the very bottom; the label
      // sheet sits directly above it — nothing floats over the artwork.
      this.hud.style.left = '0';
      this.hud.style.right = '0';
      this.hud.style.bottom = '0';
      this.hud.style.transform = 'none';
      this.hud.style.padding = '0.4rem 0.5rem calc(0.4rem + env(safe-area-inset-bottom, 0px))';
      this.hud.style.background = 'rgba(0,0,0,0.92)';
      this.hud.style.borderTop = '1px solid rgba(255,255,255,0.1)';
      this.btns.style.width = '100%';
      this.btns.querySelectorAll('button').forEach((b) => {
        (b as HTMLButtonElement).style.flex = '1';
        (b as HTMLButtonElement).style.padding = '0.55rem 0';
        (b as HTMLButtonElement).style.whiteSpace = 'nowrap';
      });
      this.labelBox.style.bottom = `${this.hud.offsetHeight}px`;
    } else {
      // Desktop: centred floating button row, label card bottom-left.
      this.hud.style.left = '50%';
      this.hud.style.right = 'auto';
      this.hud.style.bottom = '2rem';
      this.hud.style.transform = 'translateX(-50%)';
      this.hud.style.padding = '0';
      this.hud.style.background = 'none';
      this.hud.style.borderTop = 'none';
      this.btns.style.width = '';
      this.btns.querySelectorAll('button').forEach((b) => {
        (b as HTMLButtonElement).style.flex = '';
        (b as HTMLButtonElement).style.padding = '0.55rem 1.1rem';
        (b as HTMLButtonElement).style.whiteSpace = '';
      });
    }

    if (wasVisible && this.phase === 'viewing') this.showLabel();
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
        // Unlit swap while viewing — original colors, no spotlight washout.
        // The artist wall's transparent text material must not be swapped.
        const wp = this.waypoints[this.index];
        if (wp.artworkId && wp.artworkId !== ARTIST_MESH_ID && this.getArtworkMesh) {
          const mesh = this.getArtworkMesh(wp.artworkId);
          if (mesh) this.restoreMat = swapToUnlitMaterial(mesh);
        }
        this.showLabel();
      }
    }
    // 'viewing' — waiting for user interaction; touch drag handled by TouchLook
  }

  private startWaypoint(index: number): void {
    if (!this.waypoints.length) return;
    // Leaving the previous waypoint — restore its artwork material
    this.restoreMat?.();
    this.restoreMat = null;
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

  private sheetCollapsed = false;

  private showLabel(): void {
    const wp = this.waypoints[this.index];
    const isArtist = wp.artworkId === ARTIST_MESH_ID;
    const artist = isArtist ? this.gallery.artist : null;
    const artwork = wp.artworkId && !isArtist
      ? this.gallery.artworks.find((a) => a.id === wp.artworkId)
      : null;

    // Artist intro stop: show the artist's name + statement instead of artwork data.
    const title = artist?.name ?? artwork?.title ?? wp.label ?? '';
    const medium = artwork?.medium ?? '';
    const year = artwork?.year != null ? `, ${artwork.year}` : '';
    const label = artist?.statement ?? artwork?.label ?? '';
    const counter = `${this.index + 1} / ${this.waypoints.length}`;

    const bodyHtml = `
      ${medium ? `<p style="font-size:0.78rem;color:#aaa;margin:0.35rem 0 0.5rem;">${escapeHtml(medium)}${escapeHtml(year)}</p>` : ''}
      ${label ? `<p style="font-size:0.85rem;line-height:1.5;margin:0 0 0.5rem;">${escapeHtml(label)}</p>` : ''}
      <p style="font-size:0.72rem;color:#666;margin:0;">${escapeHtml(counter)}</p>
    `;

    if (this.isTouch) {
      // Bottom sheet with a collapse/expand toggle: minimised, only the
      // title bar remains and the artwork is fully visible.
      const chev = this.sheetCollapsed
        ? '<path d="M3 10l5-5 5 5"/>'
        : '<path d="M3 6l5 5 5-5"/>';
      // Collapsed: shrink to a slim strip (tight padding, smaller title)
      this.labelBox.style.padding = this.sheetCollapsed
        ? '0.25rem 1.25rem'
        : '0.9rem 1.25rem calc(1rem + env(safe-area-inset-bottom, 0px))';
      this.labelBox.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;">
          <p style="font-size:${this.sheetCollapsed ? '0.82rem' : '1rem'};font-weight:700;margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(title || 'Untitled')}</p>
          <button id="oh-tour-collapse" aria-label="${this.sheetCollapsed ? 'Expand label' : 'Collapse label'}" style="
            flex-shrink:0;background:none;border:none;color:#aaa;cursor:pointer;
            padding:${this.sheetCollapsed ? '0.2rem' : '0.45rem'};line-height:0;">
            <svg width="${this.sheetCollapsed ? 15 : 18}" height="${this.sheetCollapsed ? 15 : 18}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${chev}</svg>
          </button>
        </div>
        <div style="display:${this.sheetCollapsed ? 'none' : 'block'};">${bodyHtml}</div>
      `;
      this.labelBox.querySelector('#oh-tour-collapse')!.addEventListener('click', () => {
        this.sheetCollapsed = !this.sheetCollapsed;
        this.showLabel(); // re-render in the new state
      });
      this.labelBox.style.display = 'block';
      return;
    }

    this.labelBox.innerHTML = `
      <div aria-hidden="true" style="width:38px;height:4px;border-radius:2px;background:rgba(255,255,255,0.28);margin:0 auto 0.65rem;"></div>
      ${title ? `<p style="font-size:1rem;font-weight:700;margin:0 0 0.1rem;">${escapeHtml(title)}</p>` : ''}
      ${bodyHtml}
      <p style="font-size:0.7rem;color:#555;margin:0.45rem 0 0;">Drag this card to move it</p>
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

  /** Clean up HUD, label box, resize + touch listeners. */
  dispose(): void {
    this.restoreMat?.();
    this.restoreMat = null;
    window.removeEventListener('resize', this.boundResize);
    if (this.resizeTimer !== null) { clearTimeout(this.resizeTimer); this.resizeTimer = null; }
    if (this.hud.parentNode) this.hud.parentNode.removeChild(this.hud);
    if (this.labelBox.parentNode) this.labelBox.parentNode.removeChild(this.labelBox);
    this.touchLook?.dispose();
  }
}
