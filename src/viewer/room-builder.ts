/**
 * room-builder.ts — Procedural Three.js scene builder.
 * Consumes a validated Gallery object and produces all geometry/materials.
 * No imported 3D models — everything is procedural.
 * Framework-free vanilla TS per AGENTS.md rule 2.
 */

import * as THREE from 'three';
import type { Gallery, Room, Placement, Artwork, Doorway } from '../schema/gallery.schema';
import { buildWallAABBs, type AABB, type DoorwayCut } from './collision';

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
  'white-plaster': 0xf5f0eb,
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
  /** Map from artwork id → the corresponding Mesh (for raycasting) */
  artworkMeshes: Map<string, THREE.Mesh>;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildScene(gallery: Gallery): BuildResult {
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
  scene.add(new THREE.AmbientLight(globalTempColor, avgAmbient));
  scene.add(new THREE.HemisphereLight(globalTempColor, new THREE.Color(0x222222), 0.3));

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

    roomLayouts.push({
      originX: origin.x,
      originZ: origin.z,
      roomId: room.id,
      wallAABBs,
    });

    buildRoom(scene, room, origin.x, origin.z, inboundDoorways.get(room.id) ?? []);
  }

  // -------------------------------------------------------------------------
  // Place artwork meshes
  // -------------------------------------------------------------------------
  for (const placement of gallery.placements) {
    const artwork = artworkMap.get(placement.artworkId);
    if (!artwork) continue;
    const origin = roomOrigins.get(placement.roomId);
    if (!origin) continue;

    const room = gallery.rooms.find((r) => r.id === placement.roomId);
    if (!room) continue;

    const { mesh, worldPos } = buildArtworkPlane(artwork, placement, room, origin);
    scene.add(mesh);
    artworkPositions.set(artwork.id, worldPos);
    artworkMeshes.set(artwork.id, mesh);
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
): void {
  const { width, depth, height, surfaces, lighting } = room;
  const wallColor = WALL_COLORS[surfaces.wall] ?? 0xf5f0eb;
  const floorColor = FLOOR_COLORS[surfaces.floor] ?? 0xc8a96e;
  const tempColor = temperatureColor(lighting.temperature);

  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.9 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.9 });
  const floorMat = new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.8 });

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
  buildWallPanels(scene, room, originX, originZ, wallMat, inboundDoorways);

  // --- Per-room point light (fills the space; global ambient handles base level) ---
  const pointLight = new THREE.PointLight(tempColor, 0.8, room.width * 2);
  pointLight.position.set(cx, height - 0.3, cz);
  scene.add(pointLight);

  // TODO(week3): per-artwork spotlights (schema field `artworkSpotlights` respected here)
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
  inboundDoorways: Doorway[] = []
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
  }
}

// ---------------------------------------------------------------------------
// Artwork plane with frame
// ---------------------------------------------------------------------------

function buildArtworkPlane(
  artwork: Artwork,
  placement: Placement,
  room: Room,
  origin: { x: number; z: number }
): { mesh: THREE.Mesh; worldPos: THREE.Vector3 } {
  const { displayWidth, hangingHeight, wall, offsetFromCenter } = placement;

  // Assume square-ish artwork for placeholder — real aspect ratio comes from the texture
  const displayHeight = displayWidth * 0.75;
  const frameThickness = 0.04;

  // Build artwork group (frame + canvas)
  const group = new THREE.Group();

  // Canvas plane
  const canvasGeo = new THREE.PlaneGeometry(displayWidth, displayHeight);

  // Use a solid color as placeholder (real images loaded when available)
  const placeholderColor = getPlaceholderColor(artwork.imagePath);
  const canvasMat = new THREE.MeshStandardMaterial({
    color: placeholderColor,
    roughness: 0.5,
    metalness: 0.0,
  });

  const canvas = new THREE.Mesh(canvasGeo, canvasMat);
  canvas.userData['artworkId'] = artwork.id;
  group.add(canvas);

  // Frame
  const frameGeo = new THREE.PlaneGeometry(
    displayWidth + frameThickness * 2,
    displayHeight + frameThickness * 2
  );
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x1a1208,
    roughness: 0.7,
    metalness: 0.1,
  });
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.z = -0.005; // slightly behind canvas
  group.add(frame);

  // Compute world position and orientation
  const cx = origin.x + room.width / 2;
  const cz = origin.z + room.depth / 2;
  let wx = cx;
  let wz = cz;
  let rotY = 0;
  const wallInset = 0.02; // small gap to avoid z-fighting

  switch (wall) {
    case 'n':
      wz = origin.z + wallInset;
      wx = cx + offsetFromCenter;
      rotY = 0; // faces +Z (south, into room)
      break;
    case 's':
      wz = origin.z + room.depth - wallInset;
      wx = cx + offsetFromCenter;
      rotY = Math.PI; // faces -Z (north, into room)
      break;
    case 'w':
      wx = origin.x + wallInset;
      wz = cz + offsetFromCenter;
      rotY = Math.PI / 2; // faces +X (east, into room)
      break;
    case 'e':
      wx = origin.x + room.width - wallInset;
      wz = cz + offsetFromCenter;
      rotY = -Math.PI / 2; // faces -X (west, into room)
      break;
  }

  group.position.set(wx, hangingHeight, wz);
  group.rotation.y = rotY;

  // We return the canvas mesh for raycasting; userData holds artworkId
  const worldPos = new THREE.Vector3(wx, hangingHeight, wz);

  // The group itself can't be a Mesh — return canvas mesh, attach group to scene
  // We add the group as a child of a dummy mesh so the caller can add group to scene.
  // Actually, the caller will get back a Mesh — use canvas mesh as proxy.
  canvas.position.set(0, 0, 0.006); // slight forward
  group.updateMatrixWorld();

  // Return group (cast as Mesh for API compatibility) and position
  return {
    mesh: group as unknown as THREE.Mesh,
    worldPos,
  };
}

// ---------------------------------------------------------------------------
// Placeholder color utility
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
