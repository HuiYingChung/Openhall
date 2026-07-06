/**
 * interactions.ts — Artwork hover highlight and click-to-inspect.
 *
 * While pointer-locked:
 *   - Raycasts from screen centre each frame; hovering an artwork adds a
 *     subtle emissive highlight and shows a small crosshair dot.
 *   - Clicking the hovered artwork triggers a smooth dolly (camera moves 2 m
 *     in front of the artwork over ~0.6 s, ease-out) and opens an info panel.
 *   - Esc or clicking the close button dismisses the panel and returns controls.
 *
 * Framework-free vanilla TS + Three.js per AGENTS.md rule 2.
 */

import * as THREE from 'three';
import type { Gallery } from '../schema/gallery.schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InteractionOptions {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  /** Map from artworkId → artwork canvas Mesh (from BuildResult). */
  artworkMeshes: Map<string, THREE.Mesh>;
  gallery: Gallery;
  /** Called when inspect panel opens (disables WASD/look). */
  onInspectOpen: () => void;
  /** Called when inspect panel closes (re-enables WASD/look). */
  onInspectClose: () => void;
  /** Whether pointer is currently locked. */
  getIsLocked: () => boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HIGHLIGHT_EMISSIVE = new THREE.Color(0x888888);
const HIGHLIGHT_EMISSIVE_OFF = new THREE.Color(0x000000);
const DOLLY_DISTANCE = 2.0; // metres in front of artwork
const DOLLY_DURATION = 0.6; // seconds
const EYE_HEIGHT = 1.6;

// ---------------------------------------------------------------------------
// CrosshairDot — a small fixed dot in the centre of the screen
// ---------------------------------------------------------------------------

function createCrosshairDot(): HTMLElement {
  const dot = document.createElement('div');
  dot.id = 'oh-crosshair';
  dot.style.cssText = `
    position:fixed;
    left:50%;top:50%;
    transform:translate(-50%,-50%);
    width:6px;height:6px;
    border-radius:50%;
    background:rgba(255,255,255,0.85);
    pointer-events:none;
    z-index:200;
    display:none;
  `;
  document.body.appendChild(dot);
  return dot;
}

// ---------------------------------------------------------------------------
// Info panel
// ---------------------------------------------------------------------------

function createInfoPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'oh-info-panel';
  panel.style.cssText = `
    position:fixed;
    bottom:2rem;left:50%;
    transform:translateX(-50%);
    background:rgba(0,0,0,0.82);
    border:1px solid rgba(255,255,255,0.12);
    border-radius:12px;
    padding:1.25rem 1.5rem;
    color:#f0ece6;
    font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
    max-width:min(520px,88vw);
    min-width:240px;
    z-index:300;
    display:none;
    backdrop-filter:blur(6px);
  `;
  document.body.appendChild(panel);
  return panel;
}

// ---------------------------------------------------------------------------
// ArtworkInteractions class
// ---------------------------------------------------------------------------

export class ArtworkInteractions {
  private raycaster = new THREE.Raycaster();
  private screenCentre = new THREE.Vector2(0, 0); // NDC centre
  private hoveredMesh: THREE.Mesh | null = null;
  private crosshair: HTMLElement;
  private infoPanel: HTMLElement;
  private inspecting = false;
  private dollyActive = false;
  private dollyFrom = new THREE.Vector3();
  private dollyTo = new THREE.Vector3();
  private dollyFromQuat = new THREE.Quaternion();
  private dollyToQuat = new THREE.Quaternion();
  private dollyElapsed = 0;
  private boundClick: () => void;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private opts: InteractionOptions;

  constructor(opts: InteractionOptions) {
    this.opts = opts;
    this.crosshair = createCrosshairDot();
    this.infoPanel = createInfoPanel();

    this.boundClick = this.onClick.bind(this);
    this.boundKeyDown = this.onKeyDown.bind(this);
    document.addEventListener('click', this.boundClick);
    document.addEventListener('keydown', this.boundKeyDown);
  }

  /**
   * Call once per frame (before renderer.render).
   * @param delta Seconds since last frame.
   */
  update(delta: number): void {
    // --- Dolly animation ---
    if (this.dollyActive) {
      this.dollyElapsed += delta;
      const t = Math.min(this.dollyElapsed / DOLLY_DURATION, 1);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      this.opts.camera.position.lerpVectors(this.dollyFrom, this.dollyTo, ease);
      this.opts.camera.position.y = EYE_HEIGHT;
      this.opts.camera.quaternion.slerpQuaternions(this.dollyFromQuat, this.dollyToQuat, ease);
      if (t >= 1) {
        this.dollyActive = false;
        this.showInfoPanel();
      }
      return; // skip raycast during dolly
    }

    if (this.inspecting) return;
    if (!this.opts.getIsLocked()) {
      this.clearHighlight();
      this.crosshair.style.display = 'none';
      return;
    }

    // Show crosshair while locked
    this.crosshair.style.display = 'block';

    // Raycast from screen centre
    this.raycaster.setFromCamera(this.screenCentre, this.opts.camera);
    const meshes = Array.from(this.opts.artworkMeshes.values());
    const hits = this.raycaster.intersectObjects(meshes, false);

    const hit = hits.length > 0 ? (hits[0].object as THREE.Mesh) : null;

    if (hit !== this.hoveredMesh) {
      this.clearHighlight();
      if (hit) {
        this.hoveredMesh = hit;
        const mat = hit.material as THREE.MeshStandardMaterial;
        mat.emissive = HIGHLIGHT_EMISSIVE;
        mat.emissiveIntensity = 0.18;
      }
    }
  }

  private clearHighlight(): void {
    if (this.hoveredMesh) {
      const mat = this.hoveredMesh.material as THREE.MeshStandardMaterial;
      mat.emissive = HIGHLIGHT_EMISSIVE_OFF;
      mat.emissiveIntensity = 0;
      this.hoveredMesh = null;
    }
  }

  private onClick(): void {
    if (!this.opts.getIsLocked()) return;
    if (this.inspecting || this.dollyActive) return;
    if (!this.hoveredMesh) return;

    const artworkId = this.hoveredMesh.userData['artworkId'] as string | undefined;
    if (!artworkId) return;

    this.startDolly(artworkId);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Escape' && this.inspecting) {
      this.closePanel();
    }
  }

  private startDolly(artworkId: string): void {
    // Find the artwork's world position from scene (the group position)
    const mesh = this.opts.artworkMeshes.get(artworkId);
    if (!mesh) return;

    // Compute world position and face normal of the artwork
    const worldPos = new THREE.Vector3();
    mesh.getWorldPosition(worldPos);

    // Compute the forward direction of the artwork (its -Z in world space)
    // Artworks face +Z in local space; apply the group's world rotation.
    const worldNormal = new THREE.Vector3(0, 0, 1);
    if (mesh.parent) {
      worldNormal.applyQuaternion(mesh.parent.getWorldQuaternion(new THREE.Quaternion()));
    }

    // Dolly target: 2 m in front of the artwork
    const target = worldPos.clone().addScaledVector(worldNormal, DOLLY_DISTANCE);
    target.y = EYE_HEIGHT;

    // Compute target quaternion (looking at the artwork from target position)
    const lookDir = worldPos.clone().sub(target);
    lookDir.y = 0;
    lookDir.normalize();
    const targetQuat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      lookDir
    );

    this.dollyFrom.copy(this.opts.camera.position);
    this.dollyTo.copy(target);
    this.dollyFromQuat.copy(this.opts.camera.quaternion);
    this.dollyToQuat.copy(targetQuat);
    this.dollyElapsed = 0;
    this.dollyActive = true;

    // Disable movement during dolly
    this.opts.onInspectOpen();
    // Store which artwork we're inspecting
    this.currentArtworkId = artworkId;
  }

  private currentArtworkId: string | null = null;

  private showInfoPanel(): void {
    if (!this.currentArtworkId) return;
    const aw = this.opts.gallery.artworks.find((a) => a.id === this.currentArtworkId);
    if (!aw) return;

    this.inspecting = true;
    this.clearHighlight();

    const yearStr = aw.year != null ? `, ${aw.year}` : '';
    const medStr = aw.medium ? `<p style="color:#aaa;font-size:0.82rem;margin:0.15rem 0 0.75rem;">${aw.medium}${yearStr}</p>` : '';
    const statStr = aw.artistStatement
      ? `<p style="color:#888;font-size:0.8rem;margin:0.75rem 0 0;font-style:italic;">"${aw.artistStatement}"</p>`
      : '';

    this.infoPanel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;">
        <div style="flex:1;min-width:0;">
          <p style="font-size:1.05rem;font-weight:700;margin:0;">${aw.title || 'Untitled'}</p>
          ${medStr}
          <p style="font-size:0.88rem;line-height:1.55;margin:0;">${aw.label}</p>
          ${statStr}
        </div>
        <button id="oh-close-inspect" style="
          flex-shrink:0;background:none;border:1px solid rgba(255,255,255,0.25);
          color:#f0ece6;border-radius:6px;padding:0.3rem 0.6rem;cursor:pointer;
          font-size:0.8rem;white-space:nowrap;">✕ Close</button>
      </div>
      <p style="font-size:0.72rem;color:#555;margin:0.75rem 0 0;">Press <kbd style="background:#222;border:1px solid #444;border-radius:3px;padding:1px 4px;">Esc</kbd> to close</p>
    `;
    this.infoPanel.style.display = 'block';

    this.infoPanel.querySelector('#oh-close-inspect')!.addEventListener('click', () => {
      this.closePanel();
    });
  }

  private closePanel(): void {
    this.infoPanel.style.display = 'none';
    this.infoPanel.innerHTML = '';
    this.inspecting = false;
    this.currentArtworkId = null;
    this.opts.onInspectClose();
  }

  /** True while the inspect panel is open or dolly is active (movement should be suppressed). */
  get isInspecting(): boolean {
    return this.inspecting || this.dollyActive;
  }

  /** Replace gallery/meshes after a scene rebuild. */
  reset(gallery: Gallery, artworkMeshes: Map<string, THREE.Mesh>): void {
    this.closePanel();
    this.clearHighlight();
    this.opts.gallery = gallery;
    this.opts.artworkMeshes = artworkMeshes;
  }

  /** Clean up DOM elements and event listeners. */
  dispose(): void {
    document.removeEventListener('click', this.boundClick);
    document.removeEventListener('keydown', this.boundKeyDown);
    if (this.crosshair.parentNode) this.crosshair.parentNode.removeChild(this.crosshair);
    if (this.infoPanel.parentNode) this.infoPanel.parentNode.removeChild(this.infoPanel);
  }
}
