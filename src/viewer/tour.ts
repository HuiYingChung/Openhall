import { escapeHtml } from '../ui/escape-html';
import { prefersReducedMotion } from '../ui/overlay';
import {
  TourNarrator,
  pickNarrationText,
  canAutoAdvance,
  computeStopDwell,
} from './narration';
// Re-export so existing external imports (tour.test.ts etc.) keep working.
export { computeDwellSeconds } from './narration';

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

/** Play triangle / pause bars — inline SVG (site rule: no emoji glyphs). */
function svgPlay(): string {
  return `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:-1px;margin-right:5px;" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>`;
}
function svgPause(): string {
  return `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:-1px;margin-right:5px;" aria-hidden="true"><rect x="3.5" y="2.5" width="3.2" height="11" rx="0.8"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="0.8"/></svg>`;
}
/** Speaker icon (voice on) */
function svgVoiceOn(): string {
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;" aria-hidden="true"><path d="M1 5.5h3l4-3v11l-4-3H1z"/><path d="M11 5a4.5 4.5 0 0 1 0 6"/><path d="M12.5 3a7 7 0 0 1 0 10"/></svg>`;
}
/** Speaker with slash (voice off) */
function svgVoiceOff(): string {
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;" aria-hidden="true"><path d="M1 5.5h3l4-3v11l-4-3H1z"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`;
}

function createButtons(
  onTogglePlay: () => void,
  onPrev: () => void,
  onNext: () => void,
  onExit: () => void,
  onToggleVoice: (() => void) | null
): { row: HTMLElement; playBtn: HTMLButtonElement; voiceBtn: HTMLButtonElement | null } {
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

  const playBtn = makeBtn('', onTogglePlay);
  playBtn.id = 'oh-tour-play';
  playBtn.innerHTML = `${svgPlay()}Autoplay`;
  playBtn.setAttribute('aria-label', 'Play tour automatically');

  let voiceBtn: HTMLButtonElement | null = null;
  if (onToggleVoice !== null) {
    voiceBtn = makeBtn('', onToggleVoice);
    voiceBtn.id = 'oh-tour-voice';
    // Initialise in OFF state — voice defaults off (opt-in). The label text
    // is width-dependent and set by refreshVoiceButton() via applyLayout().
    voiceBtn.innerHTML = `${svgVoiceOff()}Audio guide`;
    voiceBtn.setAttribute('aria-label', 'Turn voice narration on');
    voiceBtn.setAttribute('aria-pressed', 'false');
  }

  row.appendChild(playBtn);
  if (voiceBtn) row.appendChild(voiceBtn);
  row.appendChild(makeBtn('← Prev', onPrev));
  row.appendChild(makeBtn('Next →', onNext));
  row.appendChild(makeBtn('Exit Tour', onExit));
  return { row, playBtn, voiceBtn };
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
  private playBtn: HTMLButtonElement;
  private voiceBtn: HTMLButtonElement | null = null;
  private autoplay = false;
  private currentDwell = 5; // AUTOPLAY_DWELL_MIN — constant lives in narration.ts now
  private isTouch = false;
  private touchLook: TouchLook | null = null;
  private boundKeydown!: (e: KeyboardEvent) => void;
  private boundResize: () => void;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private onExitCb: (position: THREE.Vector3) => void;
  private getArtworkMesh?: (id: string) => THREE.Mesh | undefined;
  private restoreMat: (() => void) | null = null;

  private narrator: TourNarrator;
  private voiceOn = false; // initialised after isSupported check in constructor
  /**
   * The user's last EXPLICIT Audio-guide choice. Manual stops reset voiceOn
   * to off (per-artwork, museum audio-guide model); autoplay restores this
   * preference — "I said I want narration" survives quiet manual browsing.
   */
  private autoplayVoicePref = false;
  /** Set when the platform proves unable to speak (API present, no voices). */
  private voiceUnavailable = false;

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

    // Set up narrator and decide whether to show the voice button.
    // Voice defaults OFF — unexpected audio is opt-in (like a museum audio guide).
    this.narrator = new TourNarrator();
    this.narrator.onUnavailable = () => this.handleVoiceUnavailable();
    const voiceSupported = this.narrator.isSupported;
    this.voiceOn = false;

    this.hud = createTourHud();
    const { row, playBtn, voiceBtn } = createButtons(
      () => this.setAutoplay(!this.autoplay),
      () => this.prev(),
      () => this.next(),
      () => this.exit(),
      voiceSupported ? () => this.toggleVoice() : null
    );
    this.hud.appendChild(row);
    this.btns = row;
    this.playBtn = playBtn;
    this.voiceBtn = voiceBtn;

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

    // Arrow keys mirror the Prev/Next buttons (and pause autoplay like them).
    this.boundKeydown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); this.next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.prev(); }
    };
    document.addEventListener('keydown', this.boundKeydown);

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

    // The Audio-guide label is width-dependent — re-sync it with the layout.
    this.refreshVoiceButton();

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
        // Compute label + spoken text via the shared helper so the
        // lookup logic isn't duplicated between here and toggleVoice().
        const { labelText, spoken } = this.currentStopTexts(this.voiceOn);
        // Speech-aware dwell: max(readingTime, estimatedSpeechDuration).
        // When voice is off spoken is '', so it falls back to label-only timing.
        this.currentDwell = computeStopDwell(labelText, spoken);
        this.showLabel();
        // Speak narration at this stop (if voice is on and there is text).
        if (spoken) this.narrator.speak(spoken);
      }
    } else if (this.phase === 'viewing') {
      // Quiet progress line: fills over the dwell; sits full while a long
      // narration finishes (honest — "waiting for the voice", not stuck).
      if (this.autoplay && this.progressFill) {
        const pct = Math.min(100, (this.elapsed / this.currentDwell) * 100);
        this.progressFill.style.width = `${pct}%`;
      }
      // Autoplay: advance when dwell has elapsed AND voice is not still speaking.
      // canAutoAdvance enforces the combined condition with a 2× safety fallback.
      if (this.autoplay && canAutoAdvance(this.elapsed, this.currentDwell, this.narrator.isSpeaking)) {
        if (this.index >= this.waypoints.length - 1) {
          this.setAutoplay(false);
        } else {
          this.startWaypoint(this.index + 1);
        }
      }
    }
    // manual 'viewing' — waiting for user interaction; touch drag via TouchLook
  }

  /**
   * Dwell-clock reading frozen by Pause, restored by Play — so pausing
   * mid-stop continues from the same point (progress bar included) instead
   * of granting the stop a fresh full dwell. Null = nothing frozen.
   */
  private pausedDwellElapsed: number | null = null;

  /** Turn autoplay on/off and reflect the state on the Play/Pause button. */
  setAutoplay(on: boolean): void {
    this.autoplay = on;
    if (on) {
      if (this.phase === 'viewing') {
        // User turned autoplay ON at the last waypoint → replay from the start.
        // startWaypoint calls cancel(), which also clears the paused flag.
        if (this.index >= this.waypoints.length - 1 && this.waypoints.length > 1) {
          this.playBtn.innerHTML = `${svgPause()}Pause`;
          this.playBtn.setAttribute('aria-label', 'Pause automatic tour');
          this.startWaypoint(0);
          return; // startWaypoint resets elapsed; button already updated above
        }
        // Resume a paused utterance if one exists.
        if (this.narrator.isPaused) this.narrator.resume();
        // Resuming from Pause continues the dwell clock where it froze;
        // enabling autoplay fresh at a stop restarts it (so a long manual
        // look never turns Play into an instant jump to the next artwork).
        this.elapsed = this.pausedDwellElapsed ?? 0;
        this.pausedDwellElapsed = null;
        // Starting autoplay restores the user's last explicit voice choice,
        // even after manual per-stop resets silenced the toggle — speak this
        // stop right away and re-time it for the narration.
        if (this.autoplayVoicePref && !this.voiceUnavailable && !this.voiceOn) {
          this.voiceOn = true;
          const { labelText, spoken } = this.currentStopTexts(true);
          if (spoken) this.narrator.speak(spoken);
          this.currentDwell = computeStopDwell(labelText, spoken);
          this.elapsed = 0;
          this.refreshVoiceButton();
        }
      } else {
        // Travelling/pausing: apply the remembered preference; arrival at the
        // stop speaks (or not) through the normal viewing-phase flow.
        const wantVoice = this.autoplayVoicePref && !this.voiceUnavailable;
        if (wantVoice !== this.voiceOn) {
          this.voiceOn = wantVoice;
          this.refreshVoiceButton();
        }
      }
    } else {
      // Pause freezes EVERYTHING: movement (autoplay), voice mid-sentence,
      // and the dwell clock (progress bar resumes where it stopped).
      if (this.phase === 'viewing') this.pausedDwellElapsed = this.elapsed;
      if (this.narrator.isSpeaking) this.narrator.pause();
    }
    this.playBtn.innerHTML = on ? `${svgPause()}Pause` : `${svgPlay()}Autoplay`;
    this.playBtn.setAttribute(
      'aria-label',
      on ? 'Pause automatic tour' : 'Play tour automatically'
    );
    this.syncProgressTrack();
  }

  get isAutoplaying(): boolean {
    return this.autoplay;
  }

  /**
   * Texts for the currently-viewed stop — shared between `update()` and
   * `toggleVoice()` so the lookup logic is never duplicated.
   * Returns `{ labelText, spoken }` where `spoken` reflects the *requested*
   * voice state (pass the NEW voiceOn value before calling).
   */
  private currentStopTexts(voiceOn: boolean): { labelText: string; spoken: string } {
    if (!this.waypoints.length) return { labelText: '', spoken: '' };
    const wp = this.waypoints[this.index];
    const artwork = wp.artworkId
      ? this.gallery.artworks.find((a) => a.id === wp.artworkId)
      : null;
    const labelText = artwork?.label ?? wp.label ?? '';
    const spoken = voiceOn ? pickNarrationText(wp, this.gallery) : '';
    return { labelText, spoken };
  }

  /**
   * The platform proved it cannot speak (utterance never started, zero voices —
   * typical of Linux desktops without a speech engine). Silence the feature
   * honestly: voice off, dwell back to reading time, button disabled with an
   * explanation instead of a toggle that pretends to work.
   */
  private handleVoiceUnavailable(): void {
    this.voiceUnavailable = true;
    this.autoplayVoicePref = false;
    if (this.voiceOn) {
      this.voiceOn = false;
      if (this.phase === 'viewing') {
        const { labelText } = this.currentStopTexts(false);
        // Fall back from the speech-length dwell to reading time; keep the
        // already-elapsed silent seconds so the visitor isn't stuck longer.
        this.currentDwell = computeStopDwell(labelText, '');
      }
    }
    this.refreshVoiceButton();
  }

  /** Toggle voice narration on/off and update the button accordingly. */
  toggleVoice(): void {
    if (this.voiceUnavailable) return; // disabled button; belt-and-braces
    // The sound button always produces sound from silence: when voice is ON
    // but the utterance is frozen by Pause, a press resumes the narration
    // (walking stays paused) instead of switching the silent toggle off —
    // pressing again while it speaks still turns it off as usual.
    if (this.voiceOn && this.narrator.isPaused) {
      this.narrator.resume();
      return;
    }
    this.voiceOn = !this.voiceOn;
    // Every explicit toggle is the choice autoplay will remember.
    this.autoplayVoicePref = this.voiceOn;
    // Voice change re-times the current stop — a frozen dwell reading from
    // before the toggle would restore a clock that no longer applies.
    this.pausedDwellElapsed = null;

    if (this.phase === 'viewing') {
      const { labelText, spoken } = this.currentStopTexts(this.voiceOn);
      if (this.voiceOn) {
        // Turning ON mid-stop: speak the current narration from the beginning
        // and recompute dwell so autoplay never cuts it short.
        if (spoken) this.narrator.speak(spoken);
        this.currentDwell = computeStopDwell(labelText, spoken);
        this.elapsed = 0;
      } else {
        // Turning OFF mid-stop: cancel speech and fall back to reading-time dwell
        // so autoplay doesn't sit out a 25 s speech estimate on a silent stop.
        this.narrator.cancel();
        this.currentDwell = computeStopDwell(labelText, '');
        this.elapsed = 0;
      }
    } else {
      // Travelling / pausing: only update state; startWaypoint's normal flow
      // will speak (or not) when the stop enters 'viewing'.
      if (!this.voiceOn) this.narrator.cancel();
    }

    this.refreshVoiceButton();
  }

  /**
   * Sync the Audio-guide button with the current voice state and viewport:
   * icon by on/off, label text by width ("Audio guide" on desktop, "Audio"
   * in the narrow bottom-bar layout where five buttons share the row).
   */
  private refreshVoiceButton(): void {
    if (!this.voiceBtn) return;
    const label = GalleryTour.prefersTouchLayout() ? 'Audio' : 'Audio guide';
    if (this.voiceUnavailable) {
      const reason =
        'Voice narration unavailable — no speech voices found. ' +
        'On Linux, installing speech-dispatcher and espeak-ng enables them.';
      this.voiceBtn.innerHTML = `${svgVoiceOff()}${label}`;
      this.voiceBtn.disabled = true;
      this.voiceBtn.style.opacity = '0.45';
      this.voiceBtn.style.cursor = 'default';
      this.voiceBtn.setAttribute('aria-pressed', 'false');
      this.voiceBtn.setAttribute('aria-label', reason);
      this.voiceBtn.title = reason;
      return;
    }
    this.voiceBtn.innerHTML = `${this.voiceOn ? svgVoiceOn() : svgVoiceOff()}${label}`;
    this.voiceBtn.setAttribute('aria-pressed', this.voiceOn ? 'true' : 'false');
    this.voiceBtn.setAttribute(
      'aria-label',
      this.voiceOn ? 'Turn voice narration off' : 'Turn voice narration on'
    );
  }

  private startWaypoint(index: number): void {
    if (!this.waypoints.length) return;
    // A new stop gets a fresh dwell clock — drop any frozen reading.
    this.pausedDwellElapsed = null;
    // Cancel any in-progress narration when leaving a stop.
    this.narrator.cancel();
    // Per-stop voice rule: manual browsing arrives silent at every artwork
    // (audio-guide model — press to hear this one); autoplay carries the
    // user's remembered preference from stop to stop.
    const nextVoice = this.autoplay && this.autoplayVoicePref && !this.voiceUnavailable;
    if (nextVoice !== this.voiceOn) {
      this.voiceOn = nextVoice;
      this.refreshVoiceButton();
    }
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

  /** Fill element of the autoplay progress bar; re-queried on each render. */
  private progressFill: HTMLElement | null = null;

  /**
   * Quiet autoplay progress: a 2px line that fills over the stop's dwell —
   * the Stories idiom for "auto-advancing, and this is roughly when".
   * Hidden while autoplay is off; skipped entirely for reduced-motion visitors.
   */
  private progressTrackHtml(): string {
    if (prefersReducedMotion()) return '';
    return `
      <div id="oh-tour-progress-track" aria-hidden="true" style="
        height:2px;border-radius:1px;overflow:hidden;
        background:rgba(255,255,255,0.14);margin:0 0 0.6rem;display:none;">
        <div id="oh-tour-progress" style="height:100%;width:0%;background:rgba(240,236,230,0.55);"></div>
      </div>
    `;
  }

  /** Show/hide the progress track to match the autoplay state. */
  private syncProgressTrack(): void {
    const track = this.labelBox?.querySelector('#oh-tour-progress-track') as HTMLElement | null;
    if (track) track.style.display = this.autoplay ? 'block' : 'none';
  }

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
        ${this.progressTrackHtml()}
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
      this.progressFill = this.labelBox.querySelector('#oh-tour-progress');
      this.syncProgressTrack();
      return;
    }

    this.labelBox.innerHTML = `
      ${this.progressTrackHtml()}
      <div aria-hidden="true" style="width:38px;height:4px;border-radius:2px;background:rgba(255,255,255,0.28);margin:0 auto 0.65rem;"></div>
      ${title ? `<p style="font-size:1rem;font-weight:700;margin:0 0 0.1rem;">${escapeHtml(title)}</p>` : ''}
      ${bodyHtml}
      <p style="font-size:0.7rem;color:#555;margin:0.45rem 0 0;">Drag this card to move it</p>
    `;
    this.labelBox.style.display = 'block';
    this.progressFill = this.labelBox.querySelector('#oh-tour-progress');
    this.syncProgressTrack();
  }

  private hideLabel(): void {
    this.labelBox.style.display = 'none';
    this.progressFill = null;
  }

  next(): void {
    // Manual navigation means the visitor wants control — stop autoplaying.
    if (this.autoplay) this.setAutoplay(false);
    this.startWaypoint(this.index + 1);
  }

  prev(): void {
    if (this.autoplay) this.setAutoplay(false);
    this.startWaypoint(this.index - 1);
  }

  exit(): void {
    const pos = this.camera.position.clone();
    this.dispose();
    this.onExitCb(pos);
  }

  /** Clean up HUD, label box, resize + keyboard + touch listeners. */
  dispose(): void {
    this.narrator.cancel();
    this.restoreMat?.();
    this.restoreMat = null;
    document.removeEventListener('keydown', this.boundKeydown);
    window.removeEventListener('resize', this.boundResize);
    if (this.resizeTimer !== null) { clearTimeout(this.resizeTimer); this.resizeTimer = null; }
    if (this.hud.parentNode) this.hud.parentNode.removeChild(this.hud);
    if (this.labelBox.parentNode) this.labelBox.parentNode.removeChild(this.labelBox);
    this.touchLook?.dispose();
  }
}
