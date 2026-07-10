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
  /** Spoken-style narration for tour mode (distinct from placard label, ~60 words max) */
  narration: z.string().max(600).optional(),
  /**
   * Image aspect ratio (width / height). Written by the bundler so the
   * export viewer can size artwork planes correctly without re-reading the image.
   */
  aspectRatio: z.number().positive().optional(),
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
// Branding — artist identity baked into the exported site
// ---------------------------------------------------------------------------

/**
 * Optional artist/branding metadata. Drives the exported index.html's
 * <meta> description, author, and Open Graph / Twitter share tags so a
 * self-hosted gallery reads like the artist's own site. The favicon itself
 * is packaged at export time as a separate file, not stored here.
 */
export const BrandingSchema = z.object({
  /** One-sentence gallery description for <meta name="description"> + OG. */
  description: z.string().optional(),
  /** Artist / studio name for <meta name="author"> + OG. */
  authorName: z.string().optional(),
  /** Artist's personal link (portfolio, socials). Only emitted if http(s). */
  authorUrl: z.string().optional(),
});
export type Branding = z.infer<typeof BrandingSchema>;

// ---------------------------------------------------------------------------
// Artist — in-world presence (rendered as a clickable plaque on a wall)
// ---------------------------------------------------------------------------

/** A labelled outbound link shown in the artist panel (e.g. Instagram). */
export const ArtistLinkSchema = z.object({
  label: z.string(),
  url: z.string(),
});
export type ArtistLink = z.infer<typeof ArtistLinkSchema>;

/**
 * Optional artist presence. When set, the viewer renders a framed portrait
 * plaque on a free wall of the first room; clicking it opens a panel with the
 * name, statement, and links. Also used as the guided tour's opening stop.
 */
export const ArtistSchema = z.object({
  name: z.string(),
  /** Short bio / artist statement (a few sentences). */
  statement: z.string().optional(),
  /**
   * Relative path to the portrait image (e.g. "images/portrait.jpg"), packaged
   * at export like artwork images. Optional — a monogram is drawn when absent.
   */
  portraitPath: z.string().optional(),
  /** Outbound links (portfolio, socials). Capped to keep the panel tidy. */
  links: z.array(ArtistLinkSchema).max(6).default([]),
});
export type Artist = z.infer<typeof ArtistSchema>;

// ---------------------------------------------------------------------------
// Top-level Gallery
// ---------------------------------------------------------------------------

const _GalleryBaseSchema = z.object({
  /** Schema version for future migrations */
  version: z.literal('1.0'),
  title: z.string(),
  /** Capped at 4 rooms for ≤10 artworks per AGENTS.md rule 6 */
  rooms: z.array(RoomSchema).min(1).max(4),
  artworks: z.array(ArtworkSchema),
  placements: z.array(PlacementSchema),
  /** Ordered waypoints for guided tour mode */
  tour: z.array(TourWaypointSchema).default([]),
  /** Optional artist branding for the exported site (favicon/meta/OG). */
  branding: BrandingSchema.optional(),
  /** Optional in-world artist presence (portrait plaque + panel + tour intro). */
  artist: ArtistSchema.optional(),
});

/** Reserved tour-waypoint artworkId used for the artist intro stop. */
export const ARTIST_TOUR_ID = '__artist__';

/**
 * GallerySchema — validated gallery.json structure with internal integrity.
 *
 * Internal integrity checks (on top of field shapes):
 *   - Room ids are unique.
 *   - Artwork ids are unique.
 *   - Every placement references an existing room and an existing artwork.
 *   - No artwork has more than one placement.
 *   - Every tour waypoint with an artworkId references an existing artwork id,
 *     with the single exception of the reserved ARTIST_TOUR_ID which is valid
 *     only when gallery.artist is present.
 */
export const GallerySchema = _GalleryBaseSchema.superRefine((g, ctx) => {
  const roomIds = new Set(g.rooms.map((r) => r.id));
  const artworkIds = new Set(g.artworks.map((a) => a.id));

  // Unique room ids
  if (roomIds.size !== g.rooms.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rooms'], message: 'room ids must be unique.' });
  }
  // Unique artwork ids
  if (artworkIds.size !== g.artworks.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['artworks'], message: 'artwork ids must be unique.' });
  }

  // Placements reference existing rooms and artworks
  const placedArtworkIds = new Set<string>();
  for (let i = 0; i < g.placements.length; i++) {
    const p = g.placements[i];
    if (!roomIds.has(p.roomId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['placements', i, 'roomId'], message: `placement references unknown roomId "${p.roomId}".` });
    }
    if (!artworkIds.has(p.artworkId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['placements', i, 'artworkId'], message: `placement references unknown artworkId "${p.artworkId}".` });
    }
    if (placedArtworkIds.has(p.artworkId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['placements', i, 'artworkId'], message: `artwork "${p.artworkId}" has more than one placement.` });
    }
    placedArtworkIds.add(p.artworkId);
  }

  // Tour waypoints: artworkId must reference a known artwork or the reserved artist id
  for (let i = 0; i < g.tour.length; i++) {
    const wp = g.tour[i];
    if (wp.artworkId === undefined) continue;
    if (wp.artworkId === ARTIST_TOUR_ID) {
      // Valid only when artist is present
      if (!g.artist) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tour', i, 'artworkId'], message: `reserved artist tour waypoint "${ARTIST_TOUR_ID}" requires gallery.artist to be present.` });
      }
      continue;
    }
    if (!artworkIds.has(wp.artworkId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tour', i, 'artworkId'], message: `tour waypoint references unknown artworkId "${wp.artworkId}".` });
    }
  }
});

export type Gallery = z.infer<typeof GallerySchema>;
