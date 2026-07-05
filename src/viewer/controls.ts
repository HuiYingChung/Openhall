/**
 * controls.ts — First-person PointerLock camera controls with WASD movement
 * and AABB wall collision. Eye height is fixed at 1.6m (no jump/gravity).
 * Framework-free vanilla TS per AGENTS.md rule 2.
 */

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { resolveCollisions, type AABB } from './collision';

const EYE_HEIGHT = 1.6; // metres
const MOVE_SPEED = 5.0; // metres per second
const PLAYER_RADIUS = 0.3; // metres

export class FirstPersonControls {
  private controls: PointerLockControls;
  private camera: THREE.PerspectiveCamera;
  private wallAABBs: AABB[] = [];

  private keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    ArrowUp: false,
    ArrowLeft: false,
    ArrowDown: false,
    ArrowRight: false,
  };

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.controls = new PointerLockControls(camera, domElement);

    this.camera.position.set(0, EYE_HEIGHT, 0);

    this.boundKeyDown = this.onKeyDown.bind(this);
    this.boundKeyUp = this.onKeyUp.bind(this);
    document.addEventListener('keydown', this.boundKeyDown);
    document.addEventListener('keyup', this.boundKeyUp);
  }

  /** Replace the wall AABBs (called after scene rebuild). */
  setWalls(walls: AABB[]): void {
    this.wallAABBs = walls;
  }

  /** Lock pointer (called on user click). */
  lock(): void {
    this.controls.lock();
  }

  /** Return the raw PointerLockControls so the caller can listen to events. */
  get pointerLock(): PointerLockControls {
    return this.controls;
  }

  /** Return whether pointer is currently locked. */
  get isLocked(): boolean {
    return this.controls.isLocked;
  }

  /**
   * Call once per frame with delta time (seconds).
   * Returns new camera position after collision resolution.
   */
  update(delta: number): void {
    if (!this.controls.isLocked) return;

    const speed = MOVE_SPEED * delta;

    // Desired movement in camera-local XZ
    const dir = new THREE.Vector3();

    const forward =
      (this.keys.w || this.keys.ArrowUp ? 1 : 0) -
      (this.keys.s || this.keys.ArrowDown ? 1 : 0);
    const strafe =
      (this.keys.d || this.keys.ArrowRight ? 1 : 0) -
      (this.keys.a || this.keys.ArrowLeft ? 1 : 0);

    if (forward !== 0 || strafe !== 0) {
      // Get camera forward vector (flattened to XZ)
      const camFwd = new THREE.Vector3();
      this.camera.getWorldDirection(camFwd);
      camFwd.y = 0;
      camFwd.normalize();

      const camRight = new THREE.Vector3();
      camRight.crossVectors(camFwd, new THREE.Vector3(0, 1, 0)).normalize();

      dir.addScaledVector(camFwd, forward);
      dir.addScaledVector(camRight, strafe);
      if (dir.lengthSq() > 0) dir.normalize();
    }

    const px = this.camera.position.x;
    const pz = this.camera.position.z;
    const nx = px + dir.x * speed;
    const nz = pz + dir.z * speed;

    const resolved = resolveCollisions(px, pz, nx, nz, PLAYER_RADIUS, this.wallAABBs);

    this.camera.position.x = resolved.x;
    this.camera.position.z = resolved.z;
    // Keep eye height constant
    this.camera.position.y = EYE_HEIGHT;
  }

  /** Teleport the camera to a world position (used by tour mode). */
  teleport(x: number, z: number): void {
    this.camera.position.set(x, EYE_HEIGHT, z);
  }

  /** Look at a world-space target (flattened: keeps eye height). */
  lookAtPoint(target: THREE.Vector3): void {
    const flat = new THREE.Vector3(target.x, this.camera.position.y, target.z);
    this.camera.lookAt(flat);
  }

  /** Clean up event listeners. */
  dispose(): void {
    document.removeEventListener('keydown', this.boundKeyDown);
    document.removeEventListener('keyup', this.boundKeyUp);
    this.controls.dispose();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key in this.keys) {
      this.keys[e.key as keyof typeof this.keys] = true;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key in this.keys) {
      this.keys[e.key as keyof typeof this.keys] = false;
    }
  }
}
