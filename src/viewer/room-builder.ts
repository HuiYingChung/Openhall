/**
 * room-builder.ts — Procedural Three.js scene builder.
 * Consumes a validated Gallery object and produces all geometry/materials.
 * No imported 3D models — everything is procedural.
 * Framework-free vanilla TS per AGENTS.md rule 2.
 */

import * as THREE from 'three';
import type { Gallery, Room, Placement, Artwork, Doorway, Artist } from '../schema/gallery.schema';
import { buildWallAABBs, type AABB, type DoorwayCut } from './collision';
import {
  resolveStyleFamily,
  DECOR_PARAMS,
  buildFrame,
  buildPictureLight,
  buildSpotFixture,
  buildConduitRun,
  buildBaseboardSegment,
  buildBench,
  buildFloorMaterial,
  makeStudioEnvTexture,
  pickEntranceWall,
  buildFakeEntrance,
  pickArtistSlot,
  makeMonogramTexture,
  makeArtistWallTexture,
  type StyleFamily,
} from './decor';

/** Opposite wall mapping — used to mirror a doorway into the target room. */
const OPPOSITE_WALL: Record<string, 'n' | 's' | 'e' | 'w'> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
};

// ---------------------------------------------------------------------------
// Material presets
// ---------------------------------------------------------------------------

const WALL_COLORS: Record<string, number> = {
  // Soft gallery white (not paper-white) so the walls don't clip to a blown-out
  // glare under the ambient + point-grid lighting.
  'white-plaster': 0xe4ded5,
  concrete: 0x9a9a9a,
  'dark-wood': 0x3d2b1f,
  brick: 0x8b4c39,
  'black-plaster': 0x1a1a1a,
};

const FLOOR_COLORS: Record<string, number> = {
  'light-wood': 0xc8a96e,
  'dark-wood': 0x3d2b1f,
  'polished-concrete': 0xb0b0b0,
  marble: 0xe8e4de,
  'raw-concrete': 0x888888,
};

/** Approximate CIE color temperature → THREE.Color */
function temperatureColor(temp: 'warm' | 'neutral' | 'cold'): THREE.Color {
  switch (temp) {
    case 'warm':
      return new THREE.Color(1.0, 0.85, 0.65);
    case 'cold':
      return new THREE.Color(0.75, 0.88, 1.0);
    default:
      return new THREE.Color(1.0, 1.0, 1.0);
  }
}

// ---------------------------------------------------------------------------
// Build result
// ---------------------------------------------------------------------------

export interface RoomLayout {
  /** World-space origin (min-X, min-Z corner) of the room */
  originX: number;
  originZ: number;
  roomId: string;
  /** Wall AABBs for collision detection (doorways already carved) */
  wallAABBs: AABB[];
}

export interface BuildResult {
  scene: THREE.Scene;
  roomLayouts: RoomLayout[];
  /** Map from artwork id → world-space centre of the artwork plane */
  artworkPositions: Map<string, THREE.Vector3>;
  /**
   * Map from artwork id → the canvas Mesh child (for raycasting in Week 3).
   * Each mesh has userData.artworkId set.
   */
  artworkMeshes: Map<string, THREE.Mesh>;
}

/**
 * Dispose all geometries, materials, and textures in a scene to prevent
 * memory leaks when rebuilding (e.g. on gallery regeneration).
 */
export function disposeScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      // Dispose all map textures defined on the material
      const stdMat = mat as THREE.MeshStandardMaterial;
      stdMat.map?.dispose();
      stdMat.emissiveMap?.dispose();
      stdMat.normalMap?.dispose();
      stdMat.roughnessMap?.dispose();
      stdMat.metalnessMap?.dispose();
      mat.dispose();
    }
  });
  // Dispose the scene's environment map when it is an owned texture.
  // buildScene() creates a PMREMGenerator-derived texture via makeStudioEnvTexture()
  // and assigns it to scene.environment — it is not shared and must be released here.
  if (scene.environment instanceof THREE.Texture) {
    scene.environment.dispose();
    scene.environment = null;
  }
  // Remove all children so the scene is empty
  while (scene.children.length > 0) scene.remove(scene.children[0]);
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * @param gallery     Validated gallery object.
 * @param aspectRatios Optional map of artworkId → real aspect ratio (width/height).
 *                     When provided, artwork planes use the real ratio instead of 0.75.
 */
export function buildScene(
  gallery: Gallery,
  aspectRatios?: Map<string, number>
): BuildResult {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  const roomLayouts: RoomLayout[] = [];
  const artworkPositions = new Map<string, THREE.Vector3>();
  const artworkMeshes = new Map<string, THREE.Mesh>();

  // Artwork lookup map
  const artworkMap = new Map<string, Artwork>();
  for (const aw of gallery.artworks) artworkMap.set(aw.id, aw);

  // -------------------------------------------------------------------------
  // Layout rooms in a row along the +X axis
  // -------------------------------------------------------------------------
  let cursorX = 0;
  const roomOrigins = new Map<string, { x: number; z: number }>();

  for (const room of gallery.rooms) {
    roomOrigins.set(room.id, { x: cursorX, z: 0 });
    cursorX += room.width;
  }

  // -------------------------------------------------------------------------
  // Build inbound-doorway map: for each room, collect all doorways declared
  // by *other* rooms that target it.  These openings need to be mirrored onto
  // the receiving room's opposite wall.  The offsetFromCenter must be
  // re-expressed relative to the *target* room's wall centre, not the source's.
  // -------------------------------------------------------------------------
  const inboundDoorways = new Map<string, Doorway[]>();
  for (const room of gallery.rooms) {
    const srcOrigin = roomOrigins.get(room.id)!;
    for (const d of room.doorways) {
      const targetRoom = gallery.rooms.find((r) => r.id === d.targetRoomId);
      const targetOrigin = roomOrigins.get(d.targetRoomId);
      if (!targetRoom || !targetOrigin) continue;

      // Compute the world-space centre of the doorway opening.
      // For N/S doorways the offset is along X; for E/W it's along Z.
      // In our linear layout rooms are adjacent on X, so shared walls are E/W.
      let worldOffset: number;
      if (d.wall === 'e' || d.wall === 'w') {
        // offset is along Z axis
        const srcCZ = srcOrigin.z + room.depth / 2;
        const worldZ = srcCZ + d.offsetFromCenter;
        const tgtCZ = targetOrigin.z + targetRoom.depth / 2;
        worldOffset = worldZ - tgtCZ;
      } else {
        // N/S: offset is along X axis
        const srcCX = srcOrigin.x + room.width / 2;
        const worldX = srcCX + d.offsetFromCenter;
        const tgtCX = targetOrigin.x + targetRoom.width / 2;
        worldOffset = worldX - tgtCX;
      }

      const existing = inboundDoorways.get(d.targetRoomId) ?? [];
      existing.push({
        ...d,
        wall: OPPOSITE_WALL[d.wall],
        offsetFromCenter: worldOffset,
      });
      inboundDoorways.set(d.targetRoomId, existing);
    }
  }

  // -------------------------------------------------------------------------
  // Add one global ambient + hemisphere light (scene-wide, not per-room).
  // Intensity is the average of all rooms' ambientIntensity values.
  // -------------------------------------------------------------------------
  const avgAmbient =
    gallery.rooms.reduce((sum, r) => sum + r.lighting.ambientIntensity, 0) /
    gallery.rooms.length;
  // Use the first room's temperature for the global lights; individual rooms
  // tune appearance via their own point lights.
  const globalTempColor = temperatureColor(gallery.rooms[0].lighting.temperature);
  scene.add(new THREE.AmbientLight(globalTempColor, avgAmbient * 1.2));
  scene.add(new THREE.HemisphereLight(globalTempColor, new THREE.Color(0x222222), 0.45));

  // Image-based lighting: procedural studio env map so glossy floors, metal
  // frames and fixtures reflect something physically plausible (with ACES
  // tone mapping set on the renderer).
  const envTex = makeStudioEnvTexture();
  if (envTex) {
    scene.environment = envTex;
    scene.environmentIntensity = 0.5;
  }

  for (const room of gallery.rooms) {
    const origin = roomOrigins.get(room.id)!;

    // Combine own doorways + mirrored inbound doorways for this room
    const allDoorwayCuts: DoorwayCut[] = [
      ...room.doorways.map((d) => ({
        wall: d.wall,
        offsetFromCenter: d.offsetFromCenter,
        width: d.width,
      })),
      ...(inboundDoorways.get(room.id) ?? []).map((d) => ({
        wall: d.wall,
        offsetFromCenter: d.offsetFromCenter,
        width: d.width,
      })),
    ];

    const wallAABBs = buildWallAABBs(
      origin.x,
      origin.z,
      room.width,
      room.depth,
      allDoorwayCuts
    );

    const benchAABB = buildRoom(scene, room, origin.x, origin.z, inboundDoorways.get(room.id) ?? []);
    if (benchAABB) wallAABBs.push(benchAABB);

    roomLayouts.push({
      originX: origin.x,
      originZ: origin.z,
      roomId: room.id,
      wallAABBs,
    });
  }

  // -------------------------------------------------------------------------
  // Fake entrance portal on the first room — purely visual (makes the space
  // read as a real venue). Picks a wall with no doorway and no artwork.
  // -------------------------------------------------------------------------
  {
    const entryRoom = gallery.rooms[0];
    const entryOrigin = roomOrigins.get(entryRoom.id)!;
    const doorwayWalls = new Set<string>();
    for (const d of entryRoom.doorways) doorwayWalls.add(d.wall);
    for (const d of inboundDoorways.get(entryRoom.id) ?? []) doorwayWalls.add(d.wall);
    const artworkOffsets = new Map<string, number[]>();
    for (const pl of gallery.placements) {
      if (pl.roomId !== entryRoom.id) continue;
      const arr = artworkOffsets.get(pl.wall) ?? [];
      arr.push(pl.offsetFromCenter);
      artworkOffsets.set(pl.wall, arr);
    }
    const entrancePick = pickEntranceWall(entryRoom, doorwayWalls, artworkOffsets);
    if (entrancePick) {
      buildFakeEntrance(
        scene,
        resolveStyleFamily(entryRoom.surfaces.wall),
        entryRoom,
        entryOrigin.x,
        entryOrigin.z,
        entrancePick.side,
        entrancePick.offset
      );
    }

    // Artist wall — vinyl wall text on a free wall of the first room.
    // When no artist is present, purge any stale artist waypoint that a
    // previous build might have added (artist removed → rebuild → idempotent).
    if (gallery.artist) {
      const slot = pickArtistSlot(entryRoom, doorwayWalls, artworkOffsets, entrancePick);
      if (slot) {
        const { group, mesh, worldPos, normal } = buildArtistPlaque(
          gallery.artist, entryRoom, entryOrigin, slot.side, slot.offset
        );
        scene.add(group);
        artworkMeshes.set(ARTIST_MESH_ID, mesh);
        artworkPositions.set(ARTIST_MESH_ID, worldPos);

        // A soft wash so the wall text reads even in dim styles.
        const washColor = temperatureColor(entryRoom.lighting.temperature);
        const wash = new THREE.SpotLight(washColor, 6, 6.5, Math.PI / 5.5, 0.6, 2);
        wash.position.copy(worldPos).addScaledVector(normal, 1.1);
        wash.position.y = entryRoom.height - 0.3;
        wash.target.position.copy(worldPos);
        scene.add(wash);
        scene.add(wash.target);

        // Make the artist wall the opening stop of the guided tour.
        // Remove any existing artist waypoint before (re)inserting — makes
        // repeated buildScene calls idempotent.
        const artistWpIdx = gallery.tour.findIndex((w) => w.artworkId === ARTIST_MESH_ID);
        if (artistWpIdx !== -1) gallery.tour.splice(artistWpIdx, 1);
        const stand = worldPos.clone().addScaledVector(normal, 2.0);
        stand.y = 1.6;
        gallery.tour.unshift({
          artworkId: ARTIST_MESH_ID,
          position: { x: stand.x, y: stand.y, z: stand.z },
          lookAt: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
          label: `Welcome — ${gallery.artist.name}`,
        });
      }
    } else {
      // No artist: ensure no stale artist waypoint survives a cached-gallery rebuild
      const staleIdx = gallery.tour.findIndex((w) => w.artworkId === ARTIST_MESH_ID);
      if (staleIdx !== -1) gallery.tour.splice(staleIdx, 1);
    }
  }

  // -------------------------------------------------------------------------
  // Place artwork meshes
  // -------------------------------------------------------------------------
  // Spot fixtures on the same wall share one ceiling wiring run (track or
  // exposed conduit, per style family) — collected here, built after the loop.
  interface FixtureRun {
    family: StyleFamily;
    positions: number[];
    fixed: number;
    alongX: boolean;
    ceilingY: number;
    wallCoord: number;
  }
  const fixtureRuns = new Map<string, FixtureRun>();

  for (const placement of gallery.placements) {
    const artwork = artworkMap.get(placement.artworkId);
    if (!artwork) continue;
    const origin = roomOrigins.get(placement.roomId);
    if (!origin) continue;

    const room = gallery.rooms.find((r) => r.id === placement.roomId);
    if (!room) continue;

    const aspectRatio = aspectRatios?.get(artwork.id);
    const { group, canvasMesh, worldPos } = buildArtworkPlane(
      artwork, placement, room, origin, aspectRatio
    );
    scene.add(group);
    artworkPositions.set(artwork.id, worldPos);
    artworkMeshes.set(artwork.id, canvasMesh);

    // Per-artwork spotlight (if enabled for the room), mounted ~1 m out from
    // the wall and angled at the piece like a real gallery fixture.
    if (room.lighting.artworkSpotlights) {
      const SPOT_OUT = 1.0;
      const nx = placement.wall === 'w' ? 1 : placement.wall === 'e' ? -1 : 0;
      const nz = placement.wall === 'n' ? 1 : placement.wall === 's' ? -1 : 0;
      const fx = worldPos.x + nx * SPOT_OUT;
      const fz = worldPos.z + nz * SPOT_OUT;
      const aim = worldPos.clone(); // worldPos.y is already the hanging height

      const fam = resolveStyleFamily(room.surfaces.wall);
      const spotColor = temperatureColor(room.lighting.temperature);
      // Physical light units (decay 2) — intensity per style family
      const spot = new THREE.SpotLight(
        spotColor, DECOR_PARAMS[fam].light.spotIntensity, 7, Math.PI / 6.5, 0.45, 2
      );
      spot.position.set(fx, room.height - 0.2, fz);
      spot.target.position.copy(aim);
      scene.add(spot);
      scene.add(spot.target);
      // Physical fixture mesh for the spotlight (cosmetic, per style family)
      buildSpotFixture(scene, fam, fx, fz, room.height, aim);

      // Register the fixture on its wall's shared ceiling wiring run
      const alongX = placement.wall === 'n' || placement.wall === 's';
      const wallCoord =
        placement.wall === 'n' ? origin.z
        : placement.wall === 's' ? origin.z + room.depth
        : placement.wall === 'w' ? origin.x
        : origin.x + room.width;
      const runKey = `${placement.roomId}:${placement.wall}`;
      const run = fixtureRuns.get(runKey) ?? {
        family: fam,
        positions: [],
        fixed: alongX ? fz : fx,
        alongX,
        ceilingY: room.height,
        wallCoord,
      };
      run.positions.push(alongX ? fx : fz);
      fixtureRuns.set(runKey, run);
    }
  }

  // Ceiling wiring — one run per wall that has spot fixtures
  for (const run of fixtureRuns.values()) {
    buildConduitRun(
      scene, run.family, run.positions, run.fixed, run.alongX, run.ceilingY, run.wallCoord
    );
  }

  return { scene, roomLayouts, artworkPositions, artworkMeshes };
}

// ---------------------------------------------------------------------------
// Room geometry
// ---------------------------------------------------------------------------

function buildRoom(
  scene: THREE.Scene,
  room: Room,
  originX: number,
  originZ: number,
  /** Doorways declared by other rooms that open into this one (already wall-flipped). */
  inboundDoorways: Doorway[]
): AABB | null {
  const { width, depth, height, surfaces, lighting } = room;
  const family = resolveStyleFamily(surfaces.wall);
  const wallColor = WALL_COLORS[surfaces.wall] ?? 0xf5f0eb;
  const floorColor = FLOOR_COLORS[surfaces.floor] ?? 0xc8a96e;
  const tempColor = temperatureColor(lighting.temperature);

  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.9 });
  // Ceiling color is a style-family decision (industrial charcoal, dramatic near-black)
  const ceilMat = new THREE.MeshStandardMaterial({
    color: DECOR_PARAMS[family].ceilingColor,
    roughness: 0.92,
  });
  // Per-material procedural texture + finish (polished concrete is glossy, etc.)
  const floorMat = buildFloorMaterial(surfaces.floor, floorColor, width, depth);

  const cx = originX + width / 2;
  const cz = originZ + depth / 2;

  // --- Floor ---
  const floorGeo = new THREE.PlaneGeometry(width, depth);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  scene.add(floor);

  // --- Ceiling ---
  const ceilGeo = new THREE.PlaneGeometry(width, depth);
  const ceil = new THREE.Mesh(ceilGeo, ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, height, cz);
  scene.add(ceil);

  // --- Walls: own doorways + mirrored inbound doorways both carved out ---
  buildWallPanels(scene, room, originX, originZ, wallMat, inboundDoorways, family);

  // --- Ceiling point lights: grid so large rooms have no dark corners.
  // Physical units (decay 2); intensity scales with the style's light budget
  // and the room's authored ambientIntensity so each style keeps its mood. ---
  const budget = DECOR_PARAMS[family].light;
  const nxL = Math.max(1, Math.round(width / 6));
  const nzL = Math.max(1, Math.round(depth / 6));
  const pointIntensity = budget.pointIntensity * lighting.ambientIntensity * 2;
  for (let ix = 0; ix < nxL; ix++) {
    for (let iz = 0; iz < nzL; iz++) {
      const lx = originX + ((ix + 0.5) * width) / nxL;
      const lz = originZ + ((iz + 0.5) * depth) / nzL;
      const pl = new THREE.PointLight(tempColor, pointIntensity, width * 1.5, 2);
      pl.position.set(lx, height - 0.3, lz);
      scene.add(pl);
    }
  }

  // --- Bench (per style family; returns collision AABB or null) ---
  return buildBench(scene, family, room, originX, originZ);
}

// ---------------------------------------------------------------------------
// Wall panel builder — renders each wall as one or more flat panels leaving
// doorway gaps (no CSG needed, just adjacent quads).
// ---------------------------------------------------------------------------

function buildWallPanels(
  scene: THREE.Scene,
  room: Room,
  originX: number,
  originZ: number,
  mat: THREE.Material,
  /** Inbound doorways already mirrored to this room's wall sides. */
  inboundDoorways: Doorway[] = [],
  family: StyleFamily = 'white-cube'
): void {
  const { width, depth, height, doorways } = room;
  const cx = originX + width / 2;
  const cz = originZ + depth / 2;

  type WallSide = 'n' | 's' | 'e' | 'w';

  // Combine own + inbound doorways, then group by wall side
  const allDoorways = [...doorways, ...inboundDoorways];
  const doorsBySide = new Map<WallSide, typeof allDoorways>();
  for (const d of allDoorways) {
    const arr = doorsBySide.get(d.wall as WallSide) ?? [];
    arr.push(d);
    doorsBySide.set(d.wall as WallSide, arr);
  }

  // Helper: segment list along a wall of length `wallLen`, cut by doorways
  function getSegments(wallLen: number, wallDoors: typeof allDoorways): Array<[number, number]> {
    let segs: Array<[number, number]> = [[0, wallLen]];
    for (const d of wallDoors) {
      const centre = wallLen / 2 + d.offsetFromCenter;
      const lo = centre - d.width / 2;
      const hi = centre + d.width / 2;
      segs = segs.flatMap(([a, b]) => {
        const clo = Math.max(a, lo);
        const chi = Math.min(b, hi);
        if (clo >= chi) return [[a, b]];
        const result: Array<[number, number]> = [];
        if (a < clo) result.push([a, clo]);
        if (chi < b) result.push([chi, b]);
        return result;
      });
    }
    return segs;
  }

  interface PanelDef {
    w: number;
    h: number;
    x: number;
    y: number;
    z: number;
    rotY?: number;
  }

  const panels: PanelDef[] = [];

  // North wall (z = originZ), faces south (+Z direction), panels along X
  {
    const wallDoors = doorsBySide.get('n') ?? [];
    for (const [lo, hi] of getSegments(width, wallDoors)) {
      const panelW = hi - lo;
      const panelX = originX + lo + panelW / 2;
      // For each segment, we may need a full-height panel and possibly a transom above the door
      // (for simplicity, segments are just the uncut parts)
      const fullH = height;
      panels.push({ w: panelW, h: fullH, x: panelX, y: fullH / 2, z: originZ });
    }
    // Transoms above doorways
    for (const d of wallDoors) {
      const dCentre = cx + d.offsetFromCenter;
      const transomH = height - d.height;
      if (transomH > 0.01) {
        panels.push({ w: d.width, h: transomH, x: dCentre, y: d.height + transomH / 2, z: originZ });
      }
    }
  }

  // South wall (z = originZ + depth)
  {
    const wallDoors = doorsBySide.get('s') ?? [];
    for (const [lo, hi] of getSegments(width, wallDoors)) {
      const panelW = hi - lo;
      const panelX = originX + lo + panelW / 2;
      panels.push({ w: panelW, h: height, x: panelX, y: height / 2, z: originZ + depth, rotY: Math.PI });
    }
    for (const d of wallDoors) {
      const dCentre = cx + d.offsetFromCenter;
      const transomH = height - d.height;
      if (transomH > 0.01) {
        panels.push({ w: d.width, h: transomH, x: dCentre, y: d.height + transomH / 2, z: originZ + depth, rotY: Math.PI });
      }
    }
  }

  // West wall (x = originX), panels along Z
  {
    const wallDoors = doorsBySide.get('w') ?? [];
    for (const [lo, hi] of getSegments(depth, wallDoors)) {
      const panelD = hi - lo;
      const panelZ = originZ + lo + panelD / 2;
      panels.push({ w: panelD, h: height, x: originX, y: height / 2, z: panelZ, rotY: Math.PI / 2 });
    }
    for (const d of wallDoors) {
      const dCentre = cz + d.offsetFromCenter;
      const transomH = height - d.height;
      if (transomH > 0.01) {
        panels.push({ w: d.width, h: transomH, x: originX, y: d.height + transomH / 2, z: dCentre, rotY: Math.PI / 2 });
      }
    }
  }

  // East wall (x = originX + width)
  {
    const wallDoors = doorsBySide.get('e') ?? [];
    for (const [lo, hi] of getSegments(depth, wallDoors)) {
      const panelD = hi - lo;
      const panelZ = originZ + lo + panelD / 2;
      panels.push({ w: panelD, h: height, x: originX + width, y: height / 2, z: panelZ, rotY: -Math.PI / 2 });
    }
    for (const d of wallDoors) {
      const dCentre = cz + d.offsetFromCenter;
      const transomH = height - d.height;
      if (transomH > 0.01) {
        panels.push({ w: d.width, h: transomH, x: originX + width, y: d.height + transomH / 2, z: dCentre, rotY: -Math.PI / 2 });
      }
    }
  }

  for (const p of panels) {
    const geo = new THREE.PlaneGeometry(p.w, p.h);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, p.y, p.z);
    if (p.rotY !== undefined) mesh.rotation.y = p.rotY;
    mesh.receiveShadow = true;
    scene.add(mesh);
    // Baseboard along floor-touching panels only (transoms above doorways
    // have y > h/2, so they're skipped and doorway gaps stay open).
    if (Math.abs(p.y - p.h / 2) < 1e-6) {
      buildBaseboardSegment(scene, family, p.w, p.x, p.z, p.rotY);
    }
  }
}

// ---------------------------------------------------------------------------
// Artwork plane with frame
// ---------------------------------------------------------------------------

function buildArtworkPlane(
  artwork: Artwork,
  placement: Placement,
  room: Room,
  origin: { x: number; z: number },
  /** Real aspect ratio (width/height). Falls back to 0.75 for demo placeholders. */
  aspectRatio?: number
): { group: THREE.Group; canvasMesh: THREE.Mesh; worldPos: THREE.Vector3 } {
  const { displayWidth, hangingHeight, wall, offsetFromCenter } = placement;
  const ratio = aspectRatio ?? 0.75;
  const displayHeight = displayWidth / ratio;

  const group = new THREE.Group();

  // Canvas plane — load texture for any real imagePath.
  // Only use a placeholder color for explicit "placeholder:" paths or empty strings.
  const canvasGeo = new THREE.PlaneGeometry(displayWidth, displayHeight);
  let canvasMat: THREE.MeshStandardMaterial;

  if (artwork.imagePath && !artwork.imagePath.startsWith('placeholder:')) {
    const texture = new THREE.TextureLoader().load(artwork.imagePath);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Anisotropic filtering keeps fine detail (e.g. thin black lines on white
    // works) from averaging to a white blur at a distance / grazing angle.
    texture.anisotropy = 8;
    // Matte response + almost no env reflection so bright/high-key works don't
    // blow out to a white glare while walking. A slight albedo ceiling (0.84)
    // keeps whites just under the tone-map clip so line art stays legible.
    // Inspect mode swaps to the unlit original pixels, so close-up fidelity is
    // untouched (interactions.ts swapToUnlitMaterial).
    canvasMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.92 });
    canvasMat.color.setRGB(0.84, 0.84, 0.84);
    canvasMat.envMapIntensity = 0.08;
  } else {
    // Placeholder solid color — only for explicit placeholder: paths or empty imagePath
    canvasMat = new THREE.MeshStandardMaterial({
      color: getPlaceholderColor(artwork.imagePath),
      roughness: 0.85,
    });
    canvasMat.envMapIntensity = 0.25;
  }

  const canvasMesh = new THREE.Mesh(canvasGeo, canvasMat);
  canvasMesh.userData['artworkId'] = artwork.id;
  canvasMesh.position.z = 0.006;
  group.add(canvasMesh);

  // 3D frame + (warm-wood) picture light, per style family
  const family = resolveStyleFamily(room.surfaces.wall);
  buildFrame(group, family, displayWidth, displayHeight);
  if (DECOR_PARAMS[family].fixture.kind === 'picture-light') {
    buildPictureLight(group, family, displayWidth, displayHeight);
  }

  // World position and orientation
  const cx = origin.x + room.width / 2;
  const cz = origin.z + room.depth / 2;
  let wx = cx;
  let wz = cz;
  let rotY = 0;
  const wallInset = 0.02;

  switch (wall) {
    case 'n':
      wz = origin.z + wallInset;
      wx = cx + offsetFromCenter;
      rotY = 0;
      break;
    case 's':
      wz = origin.z + room.depth - wallInset;
      wx = cx + offsetFromCenter;
      rotY = Math.PI;
      break;
    case 'w':
      wx = origin.x + wallInset;
      wz = cz + offsetFromCenter;
      rotY = Math.PI / 2;
      break;
    case 'e':
      wx = origin.x + room.width - wallInset;
      wz = cz + offsetFromCenter;
      rotY = -Math.PI / 2;
      break;
  }

  group.position.set(wx, hangingHeight, wz);
  group.rotation.y = rotY;

  return { group, canvasMesh, worldPos: new THREE.Vector3(wx, hangingHeight, wz) };
}

// ---------------------------------------------------------------------------
// Artist wall — gallery "vinyl" wall text (name + statement + links) painted
// flat on the wall, with a small circular portrait/monogram. No frame. The
// text plane is the clickable mesh (registered under the reserved id).
// ---------------------------------------------------------------------------

export const ARTIST_MESH_ID = '__artist__';

/** Dark wall families want light ink; light walls want dark ink. */
function wallInkColors(wall: string): { text: string; dark: boolean } {
  const dark = wall === 'black-plaster' || wall === 'dark-wood' || wall === 'concrete';
  return { text: dark ? '#f2efe9' : '#1b1b1b', dark };
}

function buildArtistPlaque(
  artist: Artist,
  room: Room,
  origin: { x: number; z: number },
  side: 'n' | 's' | 'e' | 'w',
  offset: number
): { group: THREE.Group; mesh: THREE.Mesh; worldPos: THREE.Vector3; normal: THREE.Vector3 } {
  const panelW = 1.65;
  const panelH = panelW * (1000 / 1400); // match makeArtistWallTexture canvas ratio
  const centreY = 1.55;
  // Reserve a left gutter (in canvas px) for the portrait; text flows right of it.
  const textLeftPx = 480;

  const group = new THREE.Group();
  const accentHex = parseInt(room.surfaces.accentColor.replace('#', ''), 16) || 0xc0a070;
  const ink = wallInkColors(room.surfaces.wall);

  // Contrast-safe accent: guarantee the eyebrow/rule/links read on either a
  // light wall (darken a pale accent) or a dark wall (lighten a dim accent).
  const accentColor = new THREE.Color(accentHex);
  const accentLum = 0.299 * accentColor.r + 0.587 * accentColor.g + 0.114 * accentColor.b;
  if (!ink.dark && accentLum > 0.45) {
    accentColor.multiplyScalar(0.42);
  } else if (ink.dark && accentLum < 0.55) {
    accentColor.lerp(new THREE.Color(0xf0d18a), 0.7); // push toward a bright warm gold
  }
  const accentStr = `#${accentColor.getHexString()}`;

  // Wall text (transparent — only the ink shows over the wall surface).
  const textTex = makeArtistWallTexture(artist, {
    textColor: ink.text,
    accent: accentStr,
    textLeftPx,
  });
  // Gentle self-illumination via emissiveMap so the lettering reads EVENLY
  // across the whole panel, independent of the single wall-wash spotlight
  // (which otherwise hotspots the centre and lets the edges fall dark). The
  // artist mesh is excluded from the hover-emissive toggle so this survives
  // (see interactions.ts).
  const mat = textTex
    ? new THREE.MeshStandardMaterial({ map: textTex, transparent: true, roughness: 0.95 })
    : new THREE.MeshStandardMaterial({ color: accentHex, transparent: true, opacity: 0.9, roughness: 0.95 });
  if (textTex) {
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveMap = textTex;
    mat.emissiveIntensity = 0.6;
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), mat);
  mesh.userData['artworkId'] = ARTIST_MESH_ID;
  mesh.position.z = 0.006;
  group.add(mesh);

  // Circular portrait (or initials monogram) in the left gutter, aligned with
  // the upper text — never overlapping the copy.
  const hasPortrait = !!artist.portraitPath && !artist.portraitPath.startsWith('placeholder:');
  const circTex = hasPortrait
    ? (() => { const t = new THREE.TextureLoader().load(artist.portraitPath!); t.colorSpace = THREE.SRGBColorSpace; return t; })()
    : makeMonogramTexture(artist.name, accentHex);
  if (circTex) {
    const r = 0.26;
    // Centre of the left gutter (canvas x 0 … pad+textLeftPx) mapped to world x.
    const textStartPx = 80 + textLeftPx;
    const gutterCentreX = -panelW / 2 + (textStartPx / 2 / 1400) * panelW;
    const circle = new THREE.Mesh(
      new THREE.CircleGeometry(r, 48),
      new THREE.MeshStandardMaterial({ map: circTex, roughness: 0.85 })
    );
    circle.position.set(gutterCentreX, panelH / 2 - r - 0.12, 0.008);
    group.add(circle);
  }

  const cx = origin.x + room.width / 2;
  const cz = origin.z + room.depth / 2;
  let wx = cx;
  let wz = cz;
  let rotY = 0;
  const normal = new THREE.Vector3();
  const inset = 0.02;
  switch (side) {
    case 'n': wz = origin.z + inset; wx = cx + offset; rotY = 0; normal.set(0, 0, 1); break;
    case 's': wz = origin.z + room.depth - inset; wx = cx + offset; rotY = Math.PI; normal.set(0, 0, -1); break;
    case 'w': wx = origin.x + inset; wz = cz + offset; rotY = Math.PI / 2; normal.set(1, 0, 0); break;
    case 'e': wx = origin.x + room.width - inset; wz = cz + offset; rotY = -Math.PI / 2; normal.set(-1, 0, 0); break;
  }
  group.position.set(wx, centreY, wz);
  group.rotation.y = rotY;

  return { group, mesh, worldPos: new THREE.Vector3(wx, centreY, wz), normal };
}

// ---------------------------------------------------------------------------
// Placeholder color utility (demo mode only)
// ---------------------------------------------------------------------------

function getPlaceholderColor(imagePath: string): number {
  if (imagePath.includes('red')) return 0xcc3333;
  if (imagePath.includes('blue')) return 0x3366cc;
  if (imagePath.includes('green')) return 0x33aa55;
  if (imagePath.includes('yellow')) return 0xddcc22;
  if (imagePath.includes('purple')) return 0x8844bb;
  if (imagePath.includes('orange')) return 0xdd7722;
  return 0x888888;
}
