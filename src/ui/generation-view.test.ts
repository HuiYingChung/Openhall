// @vitest-environment jsdom
/**
 * generation-view.test.ts — floor plan geometry + generation stage behavior.
 */

import { describe, it, expect } from 'vitest';
import { buildFloorPlanSvg, computeRoomOrigins, createGenerationView } from './generation-view';
import { GallerySchema } from '../schema/gallery.schema';
import type { Gallery } from '../schema/gallery.schema';
import type { UploadedArtwork } from '../ai/provider';
import type { WorkAnalysis, CurationPlan } from '../schema/analysis.schema';

function makeGallery(): Gallery {
  return GallerySchema.parse({
    version: '1.0',
    title: 'Plan Test',
    rooms: [
      {
        id: 'room-a', width: 10, depth: 8, height: 3.5,
        surfaces: { wall: 'white-plaster', floor: 'light-wood', accentColor: '#c0a070' },
        lighting: { ambientIntensity: 0.4, temperature: 'neutral', artworkSpotlights: false },
        doorways: [{ targetRoomId: 'room-b', wall: 'e', offsetFromCenter: 0, width: 2, height: 2.4 }],
      },
      {
        id: 'room-b', width: 6, depth: 6, height: 3.5,
        surfaces: { wall: 'white-plaster', floor: 'light-wood', accentColor: '#c0a070' },
        lighting: { ambientIntensity: 0.4, temperature: 'neutral', artworkSpotlights: false },
        doorways: [],
      },
    ],
    artworks: [
      { id: 'aw-01', title: 'One', medium: 'Oil', label: 'L1', imagePath: 'images/aw-01.jpg' },
      { id: 'aw-02', title: 'Two', medium: 'Oil', label: 'L2', imagePath: 'images/aw-02.jpg' },
    ],
    placements: [
      { artworkId: 'aw-01', roomId: 'room-a', wall: 'n', offsetFromCenter: 0, hangingHeight: 1.5, displayWidth: 1.2 },
      { artworkId: 'aw-02', roomId: 'room-b', wall: 's', offsetFromCenter: 1, hangingHeight: 1.5, displayWidth: 1.2 },
    ],
    tour: [
      { position: { x: 3, y: 1.6, z: 3 }, lookAt: { x: 5, y: 1.6, z: 0 }, artworkId: 'aw-01' },
      { position: { x: 12, y: 1.6, z: 3 }, lookAt: { x: 13, y: 1.6, z: 6 }, artworkId: 'aw-02' },
    ],
  });
}

describe('computeRoomOrigins', () => {
  it('lays rooms in a row along +X, matching room-builder', () => {
    const origins = computeRoomOrigins(makeGallery());
    expect(origins.get('room-a')).toEqual({ x: 0, z: 0 });
    expect(origins.get('room-b')).toEqual({ x: 10, z: 0 });
  });
});

describe('buildFloorPlanSvg', () => {
  it('draws one outline per room plus captions', () => {
    const svg = buildFloorPlanSvg(makeGallery());
    expect(svg.match(/<rect/g)!.length).toBe(2);
    expect(svg).toContain('Room 1');
    expect(svg).toContain('Room 2');
  });

  it('draws an artwork tick per placement in the accent color', () => {
    const svg = buildFloorPlanSvg(makeGallery());
    expect(svg.match(/oh-plan-art/g)!.length).toBe(2);
  });

  it('draws the tour path through waypoint world coordinates', () => {
    const svg = buildFloorPlanSvg(makeGallery());
    // waypoint (3,3) → viewBox (14 + 30, 14 + 30)
    expect(svg).toContain('<polyline points="44,44 134,44"');
  });

  it('places the second room artwork tick using the second room origin', () => {
    const svg = buildFloorPlanSvg(makeGallery());
    // aw-02: room-b (origin x=10), wall s (y = 14 + 6*10 = 74),
    // centre x = 14 + (10 + 3 + 1) * 10 = 154, half tick 6 → x1=148
    expect(svg).toContain('x1="148" y1="74" x2="160" y2="74"');
  });

  it('omits the tour polyline when there are fewer than two waypoints', () => {
    const gallery = makeGallery();
    gallery.tour = [];
    const svg = buildFloorPlanSvg(gallery);
    expect(svg).not.toContain('polyline');
  });
});

describe('createGenerationView', () => {
  function makeArtworks(n: number): UploadedArtwork[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `aw-0${i + 1}`,
      filename: `f${i}.jpg`,
      analysisDataUrl: 'data:image/jpeg;base64,x',
      displayObjectUrl: `blob:mock-${i}`,
      aspectRatio: 1,
      title: '',
      medium: '',
      year: undefined,
    }));
  }

  const ANALYSIS: WorkAnalysis = {
    artworkId: 'aw-01',
    style: 'impressionism',
    palette: ['#3e5a7a', '#9db4c8'],
    subject: 'boating scene',
    mood: 'tranquil',
    description: 'A boat.',
  };

  it('updates status text and progress bar width', () => {
    const host = document.createElement('div');
    const view = createGenerationView(host, []);
    view.setStatus('Curating exhibition…', 50);
    expect(host.querySelector('#oh-progress-msg')!.textContent).toBe('Curating exhibition…');
    expect((host.querySelector('#oh-progress-bar') as HTMLElement).style.width).toBe('50%');
  });

  it('lights thumbnails through analysing → done and shows the readout', () => {
    const host = document.createElement('div');
    const view = createGenerationView(host, makeArtworks(2));
    view.startArtwork(0);
    const thumbs = host.querySelectorAll('.oh-gen-thumb');
    expect(thumbs[0].classList.contains('is-analysing')).toBe(true);

    view.finishArtwork(0, ANALYSIS);
    expect(thumbs[0].classList.contains('is-done')).toBe(true);
    expect(thumbs[0].classList.contains('is-analysing')).toBe(false);
    const readout = host.querySelector('.oh-gen-readout')!;
    expect(readout.textContent).toContain('impressionism · boating scene · tranquil');
    expect(readout.querySelectorAll('.oh-gen-dot').length).toBe(2);
  });

  it('groups thumbnails into curated rooms with tour order and the curator note', () => {
    const host = document.createElement('div');
    const view = createGenerationView(host, makeArtworks(2));
    const plan: CurationPlan = {
      roomCount: 1,
      rooms: [{ roomId: 'room-a', theme: 'Water and light', artworkIds: ['aw-01', 'aw-02'] }],
      placements: [],
      tourOrder: ['aw-02', 'aw-01'],
      curatorNote: 'Grouped by shared horizon lines.',
    };
    view.showCuration(plan);
    expect(host.querySelector('.oh-gen-room-title')!.textContent).toBe('Water and light');
    expect(host.querySelectorAll('.oh-gen-mini').length).toBe(2);
    const orders = Array.from(host.querySelectorAll('.oh-gen-order')).map((el) => el.textContent);
    expect(orders).toEqual(['2', '1']); // aw-01 is second in tourOrder
    expect(host.querySelector('.oh-gen-note')!.textContent).toContain('Grouped by shared horizon lines.');
  });

  it('renders the floor plan SVG into the stage', () => {
    const host = document.createElement('div');
    const view = createGenerationView(host, makeArtworks(1));
    view.showFloorPlan(makeGallery());
    expect(host.querySelector('svg[aria-label="Gallery floor plan"]')).not.toBeNull();
  });

  it('escapes analysis text before injecting it', () => {
    const host = document.createElement('div');
    const view = createGenerationView(host, makeArtworks(1));
    view.startArtwork(0);
    view.finishArtwork(0, { ...ANALYSIS, style: '<img src=x onerror=alert(1)>' });
    expect(host.querySelector('.oh-gen-readout')!.innerHTML).not.toContain('<img src=x');
  });

  it('never throws on the cached path (no artworks, acts never fire)', () => {
    const host = document.createElement('div');
    const view = createGenerationView(host, []);
    expect(() => {
      view.startArtwork(0);
      view.setStatus('Reusing your gallery — no AI call…', 60);
    }).not.toThrow();
  });
});
