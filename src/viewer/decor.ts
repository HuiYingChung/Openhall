/**
 * decor.ts — Per-style procedural decoration builders.
 *
 * Each of the four style presets gets its own design language for frames,
 * light fixtures, ceiling wiring (tracks / exposed conduit), baseboards,
 * and benches. The style family is derived from
 * the room's wall material (resolveStyleFamily), so NO gallery.json schema
 * change is needed — old exports and the demo gallery pick this up as-is.
 *
 * Pure spec functions (frameBarSpecs, DECOR_PARAMS, resolveStyleFamily) are
 * separated from the Three.js builders so they can be unit-tested without a
 * WebGL context. Everything is procedural geometry — no external assets.
 */

import * as THREE from 'three';
import type { Room } from '../schema/gallery.schema';
import type { AABB } from './collision';

// ---------------------------------------------------------------------------
// Style family resolution (pure)
// ---------------------------------------------------------------------------

export type StyleFamily = 'white-cube' | 'industrial' | 'warm-wood' | 'dark-dramatic';

/** Derive the decoration style family from a room's wall material. */
export function resolveStyleFamily(wallMaterial: string): StyleFamily {
  switch (wallMaterial) {
    case 'concrete':
    case 'brick':
      return 'industrial';
    case 'dark-wood':
      return 'warm-wood';
    case 'black-plaster':
      return 'dark-dramatic';
    case 'white-plaster':
    default:
      return 'white-cube';
  }
}

// ---------------------------------------------------------------------------
// Decoration parameters (pure data — single source of truth per family)
// ---------------------------------------------------------------------------

export interface DecorParams {
  frame: {
    /** Bar thickness (m) */
    thickness: number;
    /** How far the frame protrudes from the wall (m) */
    depth: number;
    color: number;
    roughness: number;
    metalness: number;
    /** Optional inner accent lip (e.g. gold on dark-dramatic) */
    innerLip?: { color: number; roughness: number; metalness: number };
  };
  baseboard: {
    height: number;
    depth: number;
    color: number;
    roughness: number;
    metalness: number;
    /** Optional thin metallic trim strip along the top edge */
    goldTrim?: { color: number; roughness: number; metalness: number };
  };
  fixture: {
    /** 'spot' = ceiling spot with stem; 'picture-light' = brass tube above the frame */
    kind: 'spot' | 'picture-light';
    color: number;
    roughness: number;
    metalness: number;
    headRadius: number;
    headLength: number;
  };
  /**
   * Ceiling wiring for the spot fixtures — per-style design language.
   * 'track': slim mounting rail the spots hang from (white-cube: flush,
   *          ceiling-toned; dark-dramatic: thin matte-black theatre rail).
   * 'pipe':  exposed metal conduit run with junction boxes + a wall feed
   *          (the industrial signature look).
   * 'none':  no ceiling run (warm-wood picture lights are wall-mounted and
   *          wired in-wall, as in real classic galleries).
   */
  conduit:
    | { kind: 'none' }
    | { kind: 'track'; width: number; height: number; color: number; roughness: number; metalness: number }
    | { kind: 'pipe'; radius: number; color: number; roughness: number; metalness: number };
  /** Ceiling color (per style — industrial charcoal, dramatic near-black, …) */
  ceilingColor: number;
  /**
   * Physical light budget for the style: multipliers applied on top of the
   * room's authored ambientIntensity so every style is readable while keeping
   * its mood (dark-dramatic stays darkest but never illegible).
   */
  light: {
    /** Per-room ceiling point light intensity (physical units, decay 2) */
    pointIntensity: number;
    /** Artwork spotlight intensity (physical units, decay 2) */
    spotIntensity: number;
  };
  bench: {
    kind: 'slab' | 'steel-wood' | 'wood' | 'upholstered';
    topColor: number;
    topRoughness: number;
    topMetalness: number;
    legColor: number;
    legRoughness: number;
    legMetalness: number;
  };
}

export const DECOR_PARAMS: Record<StyleFamily, DecorParams> = {
  'white-cube': {
    frame: { thickness: 0.035, depth: 0.05, color: 0x111111, roughness: 0.6, metalness: 0.2 },
    baseboard: { height: 0.05, depth: 0.012, color: 0x151515, roughness: 0.9, metalness: 0 },
    fixture: { kind: 'spot', color: 0xf2f2f2, roughness: 0.5, metalness: 0.3, headRadius: 0.04, headLength: 0.14 },
    conduit: { kind: 'track', width: 0.06, height: 0.028, color: 0xe8e3dd, roughness: 0.6, metalness: 0.2 },
    ceilingColor: 0xf5f0eb,
    light: { pointIntensity: 22, spotIntensity: 26 },
    bench: { kind: 'slab', topColor: 0xf2f0ec, topRoughness: 0.65, topMetalness: 0, legColor: 0xf2f0ec, legRoughness: 0.65, legMetalness: 0 },
  },
  industrial: {
    frame: { thickness: 0.08, depth: 0.045, color: 0x3c3c3c, roughness: 0.45, metalness: 0.75 },
    baseboard: { height: 0.14, depth: 0.02, color: 0x2b2b2b, roughness: 0.5, metalness: 0.6 },
    fixture: { kind: 'spot', color: 0x1f1f1f, roughness: 0.4, metalness: 0.7, headRadius: 0.06, headLength: 0.18 },
    conduit: { kind: 'pipe', radius: 0.021, color: 0x232323, roughness: 0.35, metalness: 0.8 },
    ceilingColor: 0x2b2d30,
    light: { pointIntensity: 16, spotIntensity: 30 },
    bench: { kind: 'steel-wood', topColor: 0x8a6a45, topRoughness: 0.6, topMetalness: 0, legColor: 0x2a2a2a, legRoughness: 0.45, legMetalness: 0.7 },
  },
  'warm-wood': {
    frame: { thickness: 0.06, depth: 0.07, color: 0x8a5a2b, roughness: 0.55, metalness: 0 },
    baseboard: { height: 0.11, depth: 0.018, color: 0x5a3c22, roughness: 0.6, metalness: 0 },
    fixture: { kind: 'picture-light', color: 0xb08d57, roughness: 0.35, metalness: 0.8, headRadius: 0.025, headLength: 0.5 },
    conduit: { kind: 'none' },
    ceilingColor: 0x2e2117,
    light: { pointIntensity: 20, spotIntensity: 24 },
    bench: { kind: 'wood', topColor: 0x9c6b3f, topRoughness: 0.5, topMetalness: 0, legColor: 0x7a5330, legRoughness: 0.55, legMetalness: 0 },
  },
  'dark-dramatic': {
    frame: {
      thickness: 0.07, depth: 0.06, color: 0x141414, roughness: 0.5, metalness: 0.3,
      innerLip: { color: 0xc9a227, roughness: 0.3, metalness: 0.85 },
    },
    baseboard: {
      height: 0.13, depth: 0.02, color: 0x0f0f0f, roughness: 0.7, metalness: 0.2,
      goldTrim: { color: 0xc9a227, roughness: 0.3, metalness: 0.85 },
    },
    fixture: { kind: 'spot', color: 0x0c0c0c, roughness: 0.5, metalness: 0.5, headRadius: 0.035, headLength: 0.22 },
    conduit: { kind: 'track', width: 0.045, height: 0.024, color: 0x0e0e0e, roughness: 0.5, metalness: 0.4 },
    ceilingColor: 0x0a0a0a,
    light: { pointIntensity: 7, spotIntensity: 38 },
    bench: { kind: 'upholstered', topColor: 0x3a2430, topRoughness: 0.95, topMetalness: 0, legColor: 0x0c0c0c, legRoughness: 0.5, legMetalness: 0.4 },
  },
};

// ---------------------------------------------------------------------------
// Frame bar geometry specs (pure — unit-testable)
// ---------------------------------------------------------------------------

export interface BarSpec {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Compute the 4 bars of a rectangular frame around a canvas of size cw × ch.
 * Top/bottom bars span the full outer width; left/right bars fill between them.
 * All bars share depth d and are centred at z.
 */
export function frameBarSpecs(cw: number, ch: number, t: number, d: number, z = 0): BarSpec[] {
  return [
    { w: cw + 2 * t, h: t, d, x: 0, y: ch / 2 + t / 2, z }, // top
    { w: cw + 2 * t, h: t, d, x: 0, y: -(ch / 2 + t / 2), z }, // bottom
    { w: t, h: ch, d, x: -(cw / 2 + t / 2), y: 0, z }, // left
    { w: t, h: ch, d, x: cw / 2 + t / 2, y: 0, z }, // right
  ];
}

// ---------------------------------------------------------------------------
// Three.js builders
// ---------------------------------------------------------------------------

function stdMat(color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

/**
 * Add a 3D frame (4 bars + optional inner lip) around a canvas of cw × ch
 * to the artwork group. Replaces the old flat frame plane.
 */
export function buildFrame(group: THREE.Group, family: StyleFamily, cw: number, ch: number): void {
  const p = DECOR_PARAMS[family].frame;
  const mat = stdMat(p.color, p.roughness, p.metalness);
  for (const bar of frameBarSpecs(cw, ch, p.thickness, p.depth, p.depth / 2)) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bar.w, bar.h, bar.d), mat);
    mesh.position.set(bar.x, bar.y, bar.z);
    group.add(mesh);
  }
  if (p.innerLip) {
    const lipT = p.thickness / 3;
    const lipMat = stdMat(p.innerLip.color, p.innerLip.roughness, p.innerLip.metalness);
    for (const bar of frameBarSpecs(cw, ch, lipT, p.depth * 0.5, p.depth * 0.25)) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(bar.w, bar.h, bar.d), lipMat);
      mesh.position.set(bar.x, bar.y, bar.z);
      group.add(mesh);
    }
  }
  // Backing panel behind the canvas (hides the wall gap inside the bars)
  const backing = new THREE.Mesh(
    new THREE.PlaneGeometry(cw + 2 * p.thickness, ch + 2 * p.thickness),
    stdMat(0x0e0c0a, 0.8, 0)
  );
  backing.position.z = 0.001;
  group.add(backing);
}

/**
 * Warm-wood only: brass picture light mounted above the frame.
 * Added in the artwork group's local space (call from buildArtworkPlane).
 */
export function buildPictureLight(group: THREE.Group, family: StyleFamily, cw: number, ch: number): void {
  const p = DECOR_PARAMS[family].fixture;
  const mat = stdMat(p.color, p.roughness, p.metalness);
  const tubeLen = Math.min(cw * 0.7, p.headLength * 2);
  // Horizontal tube above the frame
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(p.headRadius, p.headRadius, tubeLen, 12), mat);
  tube.rotation.z = Math.PI / 2;
  tube.position.set(0, ch / 2 + 0.16, 0.14);
  group.add(tube);
  // Emissive strip on the underside — the tube visibly glows
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(tubeLen * 0.85, 0.008, 0.018),
    new THREE.MeshStandardMaterial({
      color: 0xfff4e0,
      emissive: 0xffdf9e,
      emissiveIntensity: 1.6,
      roughness: 1,
    })
  );
  strip.position.set(0, ch / 2 + 0.16 - p.headRadius - 0.002, 0.14);
  group.add(strip);
  // Two arms connecting tube to the wall
  const armGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 8);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, mat);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(side * tubeLen * 0.35, ch / 2 + 0.18, 0.07);
    group.add(arm);
  }
}

/**
 * Physical ceiling spot fixture above an artwork, mounted ~1 m out from the
 * wall and angled at the piece like a real gallery spot.
 * Construction: ceiling mount disc → arm → head group (can + dark front rim
 * + emissive lens that visibly glows). Purely cosmetic — the actual
 * THREE.SpotLight is added by the caller at the same position.
 */
export function buildSpotFixture(
  scene: THREE.Scene,
  family: StyleFamily,
  fixtureX: number,
  fixtureZ: number,
  ceilingY: number,
  aimAt: THREE.Vector3
): void {
  const p = DECOR_PARAMS[family].fixture;
  if (p.kind !== 'spot') return;
  const mat = stdMat(p.color, p.roughness, p.metalness);
  const armLen = family === 'industrial' ? 0.3 : 0.2;

  // Ceiling mount disc
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 12), mat);
  mount.position.set(fixtureX, ceilingY - 0.01, fixtureZ);
  scene.add(mount);

  // Arm down from the mount
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, armLen, 8), mat);
  arm.position.set(fixtureX, ceilingY - 0.02 - armLen / 2, fixtureZ);
  scene.add(arm);

  // Head group — +Z axis aims at the artwork via lookAt
  const head = new THREE.Group();
  const canGeo = new THREE.CylinderGeometry(p.headRadius, p.headRadius * 0.9, p.headLength, 14);
  canGeo.rotateX(Math.PI / 2);
  head.add(new THREE.Mesh(canGeo, mat));

  // Dark front rim — defines the silhouette even on white ceilings
  const rimGeo = new THREE.CylinderGeometry(p.headRadius * 1.08, p.headRadius * 1.08, 0.02, 14);
  rimGeo.rotateX(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, stdMat(0x1c1c1c, 0.4, 0.6));
  rim.position.z = p.headLength / 2 - 0.005;
  head.add(rim);

  // Emissive lens — makes the fixture read as a light source
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(p.headRadius * 0.7, 14),
    new THREE.MeshStandardMaterial({
      color: 0xfff4e0,
      emissive: 0xffe8c4,
      emissiveIntensity: 1.8,
      roughness: 1,
    })
  );
  lens.position.z = p.headLength / 2 + 0.006;
  head.add(lens);

  head.position.set(fixtureX, ceilingY - 0.02 - armLen - p.headRadius * 0.4, fixtureZ);
  head.lookAt(aimAt);
  scene.add(head);
}

export interface ConduitRunSpec {
  /** Run extent along the wall axis (world coords on that axis) */
  start: number;
  end: number;
}

/**
 * Extent of the ceiling wiring run serving a set of fixtures at `positions`
 * (world coords along the wall axis). The run overshoots the outermost
 * fixtures by `margin` so no head sits at the very end of the rail.
 * Pure — unit-testable.
 */
export function conduitRunSpec(positions: number[], margin = 0.35): ConduitRunSpec | null {
  if (positions.length === 0) return null;
  return { start: Math.min(...positions) - margin, end: Math.max(...positions) + margin };
}

/**
 * Ceiling wiring run for one wall's spot fixtures, per style family.
 * `positions` = fixture coords along the run axis (the fixture line sits
 * ~1 m out from the wall); `fixed` = constant coord on the other horizontal
 * axis; `wallCoord` = the wall's own `fixed`-axis coordinate (used for the
 * industrial feed pipe back to the wall).
 */
export function buildConduitRun(
  scene: THREE.Scene,
  family: StyleFamily,
  positions: number[],
  fixed: number,
  alongX: boolean,
  ceilingY: number,
  wallCoord: number
): void {
  const p = DECOR_PARAMS[family].conduit;
  if (p.kind === 'none') return;
  const spec = conduitRunSpec(positions);
  if (!spec) return;
  const len = spec.end - spec.start;
  const mid = (spec.start + spec.end) / 2;
  const mat = stdMat(p.color, p.roughness, p.metalness);

  if (p.kind === 'track') {
    // Slim rail flush with the ceiling — spots read as track-mounted
    const geo = alongX
      ? new THREE.BoxGeometry(len, p.height, p.width)
      : new THREE.BoxGeometry(p.width, p.height, len);
    const rail = new THREE.Mesh(geo, mat);
    rail.position.set(alongX ? mid : fixed, ceilingY - p.height / 2, alongX ? fixed : mid);
    scene.add(rail);
    return;
  }

  // 'pipe' — exposed conduit: run + junction box per fixture + wall feed
  const y = ceilingY - p.radius - 0.004;
  const run = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius, len, 10), mat);
  if (alongX) run.rotation.z = Math.PI / 2;
  else run.rotation.x = Math.PI / 2;
  run.position.set(alongX ? mid : fixed, y, alongX ? fixed : mid);
  scene.add(run);

  // Junction box under the ceiling at each fixture position
  const boxGeo = new THREE.BoxGeometry(0.1, 0.055, 0.1);
  for (const pos of positions) {
    const box = new THREE.Mesh(boxGeo, mat);
    box.position.set(alongX ? pos : fixed, ceilingY - 0.0275, alongX ? fixed : pos);
    scene.add(box);
  }

  // Feed pipe from the wall to the start of the run (perpendicular)
  const feedLen = Math.abs(fixed - wallCoord);
  if (feedLen > 0.05) {
    const feed = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius, feedLen, 10), mat);
    const feedMid = (fixed + wallCoord) / 2;
    if (alongX) {
      feed.rotation.x = Math.PI / 2; // feed runs along Z
      feed.position.set(spec.start + 0.1, y, feedMid);
    } else {
      feed.rotation.z = Math.PI / 2; // feed runs along X
      feed.position.set(feedMid, y, spec.start + 0.1);
    }
    scene.add(feed);
  }
}

/**
 * Baseboard segment along the bottom of one wall panel.
 * Same footprint as the panel (so doorway gaps are respected), pushed slightly
 * into the room along the wall normal derived from rotY.
 */
export function buildBaseboardSegment(
  scene: THREE.Scene,
  family: StyleFamily,
  panelW: number,
  x: number,
  z: number,
  rotY: number | undefined
): void {
  const p = DECOR_PARAMS[family].baseboard;
  const mat = stdMat(p.color, p.roughness, p.metalness);
  const rot = rotY ?? 0;
  // Wall normal (into the room): n(rotY 0)→+Z, s(π)→−Z, w(π/2)→+X, e(−π/2)→−X
  const nx = Math.sin(rot);
  const nz = Math.cos(rot);

  const board = new THREE.Mesh(new THREE.BoxGeometry(panelW, p.height, p.depth), mat);
  board.position.set(x + nx * (p.depth / 2), p.height / 2, z + nz * (p.depth / 2));
  board.rotation.y = rot;
  scene.add(board);

  if (p.goldTrim) {
    const trimMat = stdMat(p.goldTrim.color, p.goldTrim.roughness, p.goldTrim.metalness);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(panelW, 0.015, p.depth + 0.004), trimMat);
    trim.position.set(x + nx * (p.depth / 2), p.height + 0.0075, z + nz * (p.depth / 2));
    trim.rotation.y = rot;
    scene.add(trim);
  }
}

// ---------------------------------------------------------------------------
// Fake entrance portal — purely visual, makes the hall read as a real venue
// ---------------------------------------------------------------------------

export type WallSide = 'n' | 's' | 'e' | 'w';

/**
 * Pick a wall of the room for the fake entrance (centred, ~1.9 m wide).
 * A wall qualifies when it has no doorway, is ≥ 4 m long, and every artwork
 * on it sits at least CLEARANCE from the wall centre (art and portal can
 * share a long wall). Preference order keeps the portal on the "outside"
 * end of the linear room chain. Pure — unit-testable.
 */
export function pickEntranceWall(
  room: Room,
  doorwayWalls: Set<string>,
  artworkOffsets: Map<string, number[]>
): WallSide | null {
  const order: WallSide[] = ['w', 's', 'n', 'e'];
  const CLEARANCE = 2.2;
  for (const side of order) {
    if (doorwayWalls.has(side)) continue;
    const len = side === 'n' || side === 's' ? room.width : room.depth;
    if (len < 4) continue;
    const offs = artworkOffsets.get(side) ?? [];
    if (offs.some((o) => Math.abs(o) < CLEARANCE)) continue;
    return side;
  }
  return null;
}

const ENTRANCE_DOOR_COLORS: Record<StyleFamily, { leaf: number; handle: number }> = {
  'white-cube': { leaf: 0x2e2e2e, handle: 0xd8d8d8 },
  industrial: { leaf: 0x3a3a3a, handle: 0xb8b8b8 },
  'warm-wood': { leaf: 0x6a4a2c, handle: 0xb08d57 },
  'dark-dramatic': { leaf: 0x101010, handle: 0xc9a227 },
};

/**
 * Build the fake entrance: dark recess + closed double doors + jambs/lintel
 * + handles + a soft glowing plate above. Flush with the wall — collision is
 * already handled by the wall AABB, so visitors can't walk "through" it.
 */
export function buildFakeEntrance(
  scene: THREE.Scene,
  family: StyleFamily,
  room: Room,
  originX: number,
  originZ: number,
  side: WallSide
): void {
  const p = DECOR_PARAMS[family];
  const colors = ENTRANCE_DOOR_COLORS[family];
  const g = new THREE.Group();

  // Dark recess (reads as a vestibule beyond the doors)
  const recess = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 2.35),
    stdMat(0x0a0a0a, 1, 0)
  );
  recess.position.set(0, 1.175, 0.005);
  g.add(recess);

  // Double door leaves with a thin centre gap
  const leafMat = stdMat(colors.leaf, 0.55, family === 'industrial' ? 0.6 : 0.15);
  for (const dir of [-1, 1]) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.78, 2.16, 0.045), leafMat);
    leaf.position.set(dir * 0.405, 1.08, 0.035);
    g.add(leaf);
  }

  // Handles — vertical bars near the centre gap
  const handleMat = stdMat(colors.handle, 0.3, 0.85);
  for (const dir of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 10), handleMat);
    handle.position.set(dir * 0.09, 1.05, 0.075);
    g.add(handle);
  }

  // Jambs + lintel, in the family's frame material
  const frameMat = stdMat(p.frame.color, p.frame.roughness, p.frame.metalness);
  for (const dir of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.42, 0.14), frameMat);
    jamb.position.set(dir * 0.91, 1.21, 0.03);
    g.add(jamb);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.14, 0.14), frameMat);
  lintel.position.set(0, 2.49, 0.03);
  g.add(lintel);

  // Soft glowing plate above the lintel — entrance light
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.09, 0.05),
    new THREE.MeshStandardMaterial({
      color: 0xfff4e0,
      emissive: 0xffedca,
      emissiveIntensity: 0.9,
      roughness: 1,
    })
  );
  glow.position.set(0, 2.63, 0.05);
  g.add(glow);

  // Place on the chosen wall, centred, facing into the room
  const cx = originX + room.width / 2;
  const cz = originZ + room.depth / 2;
  const inset = 0.03;
  switch (side) {
    case 'n':
      g.position.set(cx, 0, originZ + inset);
      g.rotation.y = 0;
      break;
    case 's':
      g.position.set(cx, 0, originZ + room.depth - inset);
      g.rotation.y = Math.PI;
      break;
    case 'w':
      g.position.set(originX + inset, 0, cz);
      g.rotation.y = Math.PI / 2;
      break;
    case 'e':
      g.position.set(originX + room.width - inset, 0, cz);
      g.rotation.y = -Math.PI / 2;
      break;
  }
  scene.add(g);
}

// ---------------------------------------------------------------------------
// Floors — per-material procedural texture + finish (reflectivity)
// ---------------------------------------------------------------------------

export interface FloorFinish {
  /** MeshStandardMaterial roughness — lower = shinier */
  roughness: number;
  metalness: number;
  /** Texture tile size in metres (repeat = roomSize / tileMetres) */
  tileMetres: number;
}

export const FLOOR_FINISH: Record<string, FloorFinish> = {
  'light-wood': { roughness: 0.65, metalness: 0, tileMetres: 4 },
  'dark-wood': { roughness: 0.5, metalness: 0, tileMetres: 4 },
  'polished-concrete': { roughness: 0.28, metalness: 0.05, tileMetres: 6 },
  'raw-concrete': { roughness: 0.92, metalness: 0, tileMetres: 6 },
  marble: { roughness: 0.35, metalness: 0, tileMetres: 5 },
};

const DEFAULT_FINISH: FloorFinish = { roughness: 0.8, metalness: 0, tileMetres: 4 };

/** Deterministic PRNG (mulberry32) so floor textures are stable across builds. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(base: THREE.Color, lightness: number): string {
  const c = base.clone().multiplyScalar(lightness);
  return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
}

function paintWood(ctx: CanvasRenderingContext2D, size: number, base: THREE.Color, rand: () => number): void {
  const plankCount = 14;
  const plankW = size / plankCount;
  for (let i = 0; i < plankCount; i++) {
    ctx.fillStyle = shade(base, 0.94 + rand() * 0.12);
    ctx.fillRect(i * plankW, 0, plankW, size);
    // Grain streaks
    ctx.strokeStyle = shade(base, 0.78);
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.09;
    for (let g = 0; g < 4; g++) {
      const x = i * plankW + rand() * plankW;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + rand() * 8 - 4, size * 0.33, x + rand() * 8 - 4, size * 0.66, x + rand() * 6 - 3, size);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Butt joints — short cross seams at random heights per plank
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = shade(base, 0.72);
    const joints = 1 + Math.floor(rand() * 2);
    for (let j = 0; j < joints; j++) {
      ctx.fillRect(i * plankW, rand() * size, plankW, 1);
    }
    ctx.globalAlpha = 1;
    // Plank seam — thin and subtle
    ctx.fillStyle = shade(base, 0.72);
    ctx.fillRect(i * plankW, 0, 1, size);
  }
}

function paintConcrete(ctx: CanvasRenderingContext2D, size: number, base: THREE.Color, rand: () => number, speckle: boolean): void {
  ctx.fillStyle = shade(base, 1);
  ctx.fillRect(0, 0, size, size);
  // Large soft blotches
  for (let i = 0; i < 22; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 30 + rand() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const l = 0.9 + rand() * 0.2;
    g.addColorStop(0, shade(base, l));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
  if (speckle) {
    for (let i = 0; i < 400; i++) {
      ctx.globalAlpha = 0.05 + rand() * 0.06;
      ctx.fillStyle = rand() > 0.5 ? shade(base, 0.6) : shade(base, 1.3);
      ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 1.5, 1 + rand() * 1.5);
    }
    ctx.globalAlpha = 1;
  }
}

function paintMarble(ctx: CanvasRenderingContext2D, size: number, base: THREE.Color, rand: () => number): void {
  ctx.fillStyle = shade(base, 1);
  ctx.fillRect(0, 0, size, size);
  // Veins
  for (let i = 0; i < 9; i++) {
    ctx.strokeStyle = shade(base, 0.7);
    ctx.lineWidth = 0.8 + rand() * 1.8;
    ctx.globalAlpha = 0.1 + rand() * 0.08;
    ctx.beginPath();
    let x = rand() * size;
    let y = 0;
    ctx.moveTo(x, y);
    while (y < size) {
      x += rand() * 60 - 30;
      y += 25 + rand() * 45;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * Paint a floor texture canvas for the given floor material.
 * Returns null when no 2D canvas is available (headless tests, SSR) —
 * callers must fall back to a flat-color material.
 */
export function makeFloorCanvas(floorMaterial: string, baseColorHex: number, size = 512): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const base = new THREE.Color(baseColorHex);
  const rand = mulberry32(0xa11ce);
  switch (floorMaterial) {
    case 'light-wood':
    case 'dark-wood':
      paintWood(ctx, size, base, rand);
      break;
    case 'polished-concrete':
      paintConcrete(ctx, size, base, rand, false);
      break;
    case 'raw-concrete':
      paintConcrete(ctx, size, base, rand, true);
      break;
    case 'marble':
      paintMarble(ctx, size, base, rand);
      break;
    default:
      ctx.fillStyle = shade(base, 1);
      ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

/**
 * Procedural studio environment map (equirect) — gives metals, glossy floors
 * and frames something real to reflect. Bright ceiling band with light-panel
 * hotspots, mid-grey walls, dark floor. Null when no canvas (headless tests).
 */
export function makeStudioEnvTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#e9e7e3');
  g.addColorStop(0.45, '#8b8b89');
  g.addColorStop(0.55, '#6b6b69');
  g.addColorStop(1, '#232323');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const x of [30, 108, 188]) ctx.fillRect(x, 8, 30, 10);
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Build the floor material for a room: procedural texture (when a canvas is
 * available) + per-material roughness/metalness so each style reflects light
 * differently (polished concrete is glossy, raw concrete is fully matte).
 */
export function buildFloorMaterial(
  floorMaterial: string,
  baseColorHex: number,
  roomWidth: number,
  roomDepth: number
): THREE.MeshStandardMaterial {
  const finish = FLOOR_FINISH[floorMaterial] ?? DEFAULT_FINISH;
  const canvas = makeFloorCanvas(floorMaterial, baseColorHex);
  if (!canvas) {
    return new THREE.MeshStandardMaterial({
      color: baseColorHex,
      roughness: finish.roughness,
      metalness: finish.metalness,
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(roomWidth / finish.tileMetres, roomDepth / finish.tileMetres);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    map: tex,
    roughness: finish.roughness,
    metalness: finish.metalness,
  });
}

// ---------------------------------------------------------------------------
// Bench (pure spec + builder)
// ---------------------------------------------------------------------------

export interface BenchSpec {
  /** Bench centre in world space */
  cx: number;
  cz: number;
  /** Footprint (m) — length runs along the room's longer axis */
  length: number;
  width: number;
  /** Rotation around Y: 0 = length along X, π/2 = length along Z */
  rotY: number;
  aabb: AABB;
}

/**
 * Compute bench placement for a room: centred, but offset along the shorter
 * axis so guided-tour camera paths through the room centre stay clear.
 * Returns null for rooms too small to fit a bench comfortably.
 */
export function benchSpec(room: Room, originX: number, originZ: number): BenchSpec | null {
  if (room.width < 6 || room.depth < 6) return null;
  const length = 1.6;
  const width = 0.45;
  const alongX = room.width >= room.depth;
  const cx = originX + room.width / 2 + (alongX ? 0 : room.width * 0.18);
  const cz = originZ + room.depth / 2 + (alongX ? room.depth * 0.18 : 0);
  const halfX = alongX ? length / 2 : width / 2;
  const halfZ = alongX ? width / 2 : length / 2;
  return {
    cx, cz, length, width,
    rotY: alongX ? 0 : Math.PI / 2,
    aabb: { minX: cx - halfX, maxX: cx + halfX, minZ: cz - halfZ, maxZ: cz + halfZ },
  };
}

/** Build the bench meshes for the family. Returns the collision AABB (or null). */
export function buildBench(
  scene: THREE.Scene,
  family: StyleFamily,
  room: Room,
  originX: number,
  originZ: number
): AABB | null {
  const spec = benchSpec(room, originX, originZ);
  if (!spec) return null;
  const p = DECOR_PARAMS[family].bench;
  const topMat = stdMat(p.topColor, p.topRoughness, p.topMetalness);
  const legMat = stdMat(p.legColor, p.legRoughness, p.legMetalness);
  const g = new THREE.Group();

  switch (p.kind) {
    case 'slab': {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(spec.length, 0.42, spec.width), topMat);
      slab.position.y = 0.21;
      g.add(slab);
      break;
    }
    case 'steel-wood': {
      const top = new THREE.Mesh(new THREE.BoxGeometry(spec.length, 0.05, spec.width), topMat);
      top.position.y = 0.42;
      g.add(top);
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, spec.width - 0.05), legMat);
        leg.position.set(side * (spec.length / 2 - 0.15), 0.2, 0);
        g.add(leg);
      }
      break;
    }
    case 'wood': {
      const top = new THREE.Mesh(new THREE.BoxGeometry(spec.length, 0.07, spec.width), topMat);
      top.position.y = 0.42;
      g.add(top);
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.39, spec.width - 0.08), legMat);
        leg.position.set(side * (spec.length / 2 - 0.18), 0.195, 0);
        g.add(leg);
      }
      break;
    }
    case 'upholstered': {
      const base = new THREE.Mesh(new THREE.BoxGeometry(spec.length - 0.1, 0.3, spec.width - 0.03), legMat);
      base.position.y = 0.15;
      g.add(base);
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(spec.length, 0.14, spec.width), topMat);
      cushion.position.y = 0.37;
      g.add(cushion);
      break;
    }
  }

  g.position.set(spec.cx, 0, spec.cz);
  g.rotation.y = spec.rotY;
  scene.add(g);
  return spec.aabb;
}
