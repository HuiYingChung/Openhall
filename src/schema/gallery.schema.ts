/**
 * gallery.schema.ts — Single source of truth for gallery.json structure.
 * AI generates a gallery.json conforming to this schema.
 * The viewer renders it; the exporter ships it.
 * Neither AI code nor viewer code should depend on each other — only this schema.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Wall identifier — cardinal directions within a room */
export const WallSideSchema = z.enum(['n', 's', 'e', 'w']);
export type WallSide = z.infer<typeof WallSideSchema>;

/** Material presets for walls / ceiling */
export const WallMaterialSchema = z.enum([
  'white-plaster',
  'concrete',
  'dark-wood',
  'brick',
  'black-plaster',
]);
export type WallMaterial = z.infer<typeof WallMaterialSchema>;

/** Material presets for floors */
export const FloorMaterialSchema = z.enum([
  'light-wood',
  'dark-wood',
  'polished-concrete',
  'marble',
  'raw-concrete',
]);
export type FloorMaterial = z.infer<typeof FloorMaterialSchema>;

/** Lighting temperature descriptors */
export const LightTemperatureSchema = z.enum(['warm', 'neutral', 'cold']);
export type LightTemperature = z.infer<typeof LightTemperatureSchema>;

// ---------------------------------------------------------------------------
// Artwork
// ---------------------------------------------------------------------------

export const ArtworkSchema = z.object({
  /** Unique identifier, referenced by placements and tour waypoints */
  id: z.string(),
  /** Relative path to the image file (e.g. "images/01.jpg") */
  imagePath: z.string(),
  title: z.string(),
  medium: z.string(),
  year: z.number().int().optional(),
  /** AI-generated wall label text */
  label: z.string(),
  /** Optional short artist statement */
  artistStatement: z.string().optional(),
});
export type Artwork = z.infer<typeof ArtworkSchema>;

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

/** A doorway opening that connects two rooms */
export const DoorwaySchema = z.object({
  /** The room this doorway leads to */
  targetRoomId: z.string(),
  /** Which wall the doorway sits on */
  wall: WallSideSchema,
  /** Horizontal offset from wall centre (metres, 0 = centred) */
  offsetFromCenter: z.number().default(0),
  /** Doorway opening width in metres */
  width: z.number().positive().default(2.0),
  /** Doorway opening height in metres */
  height: z.number().positive().default(2.4),
});
export type Doorway = z.infer<typeof DoorwaySchema>;

/** Surface materials and accent color for a room */
export const SurfacesSchema = z.object({
  wall: WallMaterialSchema.default('white-plaster'),
  floor: FloorMaterialSchema.default('light-wood'),
  /** Accent color as CSS hex string (e.g. "#c0a070") */
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#c0a070'),
});
export type Surfaces = z.infer<typeof SurfacesSchema>;

/** Lighting configuration for a room */
export const LightingSchema = z.object({
  ambientIntensity: z.number().min(0).max(1).default(0.4),
  temperature: LightTemperatureSchema.default('neutral'),
  /** Whether to add a per-artwork spotlight above each placement */
  artworkSpotlights: z.boolean().default(true),
});
export type Lighting = z.infer<typeof LightingSchema>;

export const RoomSchema = z.object({
  id: z.string(),
  /** Width in metres (X axis) */
  width: z.number().positive(),
  /** Depth in metres (Z axis) */
  depth: z.number().positive(),
  /** Ceiling height in metres (Y axis) */
  height: z.number().positive().default(3.5),
  surfaces: SurfacesSchema,
  lighting: LightingSchema,
  /** Doorways to adjacent rooms. Each room lists doorways it "owns". */
  doorways: z.array(DoorwaySchema).default([]),
});
export type Room = z.infer<typeof RoomSchema>;

// ---------------------------------------------------------------------------
// Placement — artwork on a wall
// ---------------------------------------------------------------------------

export const PlacementSchema = z.object({
  artworkId: z.string(),
  roomId: z.string(),
  wall: WallSideSchema,
  /** Horizontal offset from wall centre (metres, 0 = centred) */
  offsetFromCenter: z.number().default(0),
  /** Height of artwork centre from floor (metres) */
  hangingHeight: z.number().positive().default(1.5),
  /** Display width in metres (height is calculated from image aspect ratio) */
  displayWidth: z.number().positive().default(1.2),
});
export type Placement = z.infer<typeof PlacementSchema>;

// ---------------------------------------------------------------------------
// Tour waypoints
// ---------------------------------------------------------------------------

export const Vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export type Vec3 = z.infer<typeof Vec3Schema>;

export const TourWaypointSchema = z.object({
  /** Optional link to an artwork (the waypoint is standing position in front of it) */
  artworkId: z.string().optional(),
  /** Camera position */
  position: Vec3Schema,
  /** World-space point the camera looks at */
  lookAt: Vec3Schema,
  /** Label shown in the guided tour UI */
  label: z.string().optional(),
});
export type TourWaypoint = z.infer<typeof TourWaypointSchema>;

// ---------------------------------------------------------------------------
// Top-level Gallery
// ---------------------------------------------------------------------------

export const GallerySchema = z.object({
  /** Schema version for future migrations */
  version: z.literal('1.0'),
  title: z.string(),
  /** Capped at 4 rooms for ≤10 artworks per AGENTS.md rule 6 */
  rooms: z.array(RoomSchema).min(1).max(4),
  artworks: z.array(ArtworkSchema),
  placements: z.array(PlacementSchema),
  /** Ordered waypoints for guided tour mode */
  tour: z.array(TourWaypointSchema).default([]),
});
export type Gallery = z.infer<typeof GallerySchema>;
