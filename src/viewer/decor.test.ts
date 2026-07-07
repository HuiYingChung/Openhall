/**
 * decor.test.ts — Unit tests for the per-style decoration system (pure parts).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveStyleFamily,
  DECOR_PARAMS,
  frameBarSpecs,
  conduitRunSpec,
  benchSpec,
  FLOOR_FINISH,
  buildFloorMaterial,
  pickEntranceWall,
  type StyleFamily,
} from './decor';
import type { Room } from '../schema/gallery.schema';

function makeRoom(width: number, depth: number): Room {
  return {
    id: 'room-t',
    width,
    depth,
    height: 3.5,
    surfaces: { wall: 'white-plaster', floor: 'light-wood', accentColor: '#c0a070' },
    lighting: { ambientIntensity: 0.4, temperature: 'warm', artworkSpotlights: true },
    doorways: [],
  } as Room;
}

describe('resolveStyleFamily', () => {
  it('maps each wall material to its family', () => {
    expect(resolveStyleFamily('white-plaster')).toBe('white-cube');
    expect(resolveStyleFamily('concrete')).toBe('industrial');
    expect(resolveStyleFamily('brick')).toBe('industrial');
    expect(resolveStyleFamily('dark-wood')).toBe('warm-wood');
    expect(resolveStyleFamily('black-plaster')).toBe('dark-dramatic');
  });

  it('falls back to white-cube for unknown materials', () => {
    expect(resolveStyleFamily('velvet-mystery')).toBe('white-cube');
  });
});

describe('DECOR_PARAMS', () => {
  const families: StyleFamily[] = ['white-cube', 'industrial', 'warm-wood', 'dark-dramatic'];

  it('defines all four element groups for every family', () => {
    for (const f of families) {
      const p = DECOR_PARAMS[f];
      expect(p.frame.thickness).toBeGreaterThan(0);
      expect(p.frame.depth).toBeGreaterThan(0);
      expect(p.baseboard.height).toBeGreaterThan(0);
      expect(p.fixture.headRadius).toBeGreaterThan(0);
      expect(p.bench.kind).toBeTruthy();
      expect(p.ceilingColor).toBeGreaterThanOrEqual(0);
      expect(p.light.pointIntensity).toBeGreaterThan(0);
      expect(p.light.spotIntensity).toBeGreaterThan(0);
    }
  });

  it('keeps each style\'s mood in the light budget: dramatic darkest room, strongest spots', () => {
    const dd = DECOR_PARAMS['dark-dramatic'].light;
    for (const f of families.filter((x) => x !== 'dark-dramatic')) {
      expect(dd.pointIntensity).toBeLessThan(DECOR_PARAMS[f].light.pointIntensity);
      expect(dd.spotIntensity).toBeGreaterThan(DECOR_PARAMS[f].light.spotIntensity);
    }
  });

  it('gives each family a distinct design language', () => {
    // Bench construction differs across all four
    const benchKinds = families.map((f) => DECOR_PARAMS[f].bench.kind);
    expect(new Set(benchKinds).size).toBe(4);
    // Frame colors differ across all four
    const frameColors = families.map((f) => DECOR_PARAMS[f].frame.color);
    expect(new Set(frameColors).size).toBe(4);
  });

  it('dark-dramatic has the gold accents; others do not', () => {
    expect(DECOR_PARAMS['dark-dramatic'].frame.innerLip).toBeDefined();
    expect(DECOR_PARAMS['dark-dramatic'].baseboard.goldTrim).toBeDefined();
    expect(DECOR_PARAMS['white-cube'].frame.innerLip).toBeUndefined();
    expect(DECOR_PARAMS['industrial'].baseboard.goldTrim).toBeUndefined();
  });

  it('warm-wood uses a picture light; the rest use ceiling spots', () => {
    expect(DECOR_PARAMS['warm-wood'].fixture.kind).toBe('picture-light');
    expect(DECOR_PARAMS['white-cube'].fixture.kind).toBe('spot');
    expect(DECOR_PARAMS['industrial'].fixture.kind).toBe('spot');
    expect(DECOR_PARAMS['dark-dramatic'].fixture.kind).toBe('spot');
  });
});

describe('conduit (ceiling wiring per style)', () => {
  it('every family declares a conduit design matching its language', () => {
    expect(DECOR_PARAMS['white-cube'].conduit.kind).toBe('track');
    expect(DECOR_PARAMS['industrial'].conduit.kind).toBe('pipe');
    // Picture lights are wall-mounted and wired in-wall — no ceiling run
    expect(DECOR_PARAMS['warm-wood'].conduit.kind).toBe('none');
    expect(DECOR_PARAMS['dark-dramatic'].conduit.kind).toBe('track');
  });

  it('dark-dramatic track is slimmer and darker than white-cube', () => {
    const wc = DECOR_PARAMS['white-cube'].conduit;
    const dd = DECOR_PARAMS['dark-dramatic'].conduit;
    if (wc.kind !== 'track' || dd.kind !== 'track') throw new Error('expected tracks');
    expect(dd.width).toBeLessThan(wc.width);
    expect(dd.color).toBeLessThan(wc.color);
  });

  it('conduitRunSpec spans the fixtures with margin overshoot', () => {
    const spec = conduitRunSpec([2, 5, 3.5], 0.35)!;
    expect(spec.start).toBeCloseTo(1.65);
    expect(spec.end).toBeCloseTo(5.35);
  });

  it('single fixture still gets a short run; no fixtures, no run', () => {
    const spec = conduitRunSpec([4], 0.35)!;
    expect(spec.end - spec.start).toBeCloseTo(0.7);
    expect(conduitRunSpec([])).toBeNull();
  });
});

describe('frameBarSpecs', () => {
  const cw = 1.2;
  const ch = 0.9;
  const t = 0.05;
  const d = 0.06;
  const bars = frameBarSpecs(cw, ch, t, d, 0.03);

  it('returns exactly 4 bars with the shared depth and z', () => {
    expect(bars).toHaveLength(4);
    for (const b of bars) {
      expect(b.d).toBe(d);
      expect(b.z).toBe(0.03);
    }
  });

  it('top/bottom bars span the full outer width', () => {
    const [top, bottom] = bars;
    expect(top.w).toBeCloseTo(cw + 2 * t);
    expect(bottom.w).toBeCloseTo(cw + 2 * t);
    expect(top.y).toBeCloseTo(ch / 2 + t / 2);
    expect(bottom.y).toBeCloseTo(-(ch / 2 + t / 2));
  });

  it('left/right bars fill the canvas height and sit outside its edges', () => {
    const [, , left, right] = bars;
    expect(left.h).toBeCloseTo(ch);
    expect(right.h).toBeCloseTo(ch);
    expect(left.x).toBeCloseTo(-(cw / 2 + t / 2));
    expect(right.x).toBeCloseTo(cw / 2 + t / 2);
  });

  it('is symmetric around the origin', () => {
    const [top, bottom, left, right] = bars;
    expect(top.y).toBeCloseTo(-bottom.y);
    expect(left.x).toBeCloseTo(-right.x);
  });
});

describe('pickEntranceWall', () => {
  const noArt = new Map<string, number[]>();

  it('prefers the west wall, centred, when free', () => {
    expect(pickEntranceWall(makeRoom(12, 10), new Set(), noArt)).toEqual({ side: 'w', offset: 0 });
  });

  it('skips walls with doorways', () => {
    expect(pickEntranceWall(makeRoom(12, 10), new Set(['w']), noArt)?.side).toBe('s');
    expect(pickEntranceWall(makeRoom(12, 10), new Set(['w', 's', 'n']), noArt)?.side).toBe('e');
  });

  it('coexists with artworks far from the wall centre (demo room-a case)', () => {
    // n wall art at ±3 m — centre is free, portal fits centred there
    const offsets = new Map<string, number[]>([
      ['w', [0]],
      ['s', [0]],
      ['n', [-3, 3]],
    ]);
    expect(pickEntranceWall(makeRoom(12, 10), new Set(['e']), offsets)).toEqual({ side: 'n', offset: 0 });
  });

  it('falls back to an off-centre gap when art blocks every wall centre', () => {
    // Regression: dark-dramatic generate run had art near all wall centres —
    // the portal must still appear, shifted into a free stretch of wall.
    const offsets = new Map<string, number[]>([['w', [1.5]], ['s', [0]], ['n', [-2.0]]]);
    const pick = pickEntranceWall(makeRoom(12, 10), new Set(['e']), offsets);
    expect(pick).not.toBeNull();
    expect(pick!.side).toBe('w'); // first wall in preference order with a gap
    // Portal (±1.2 m around the offset) must clear the artwork block at 1.5±1.1
    expect(pick!.offset + 1.2).toBeLessThanOrEqual(1.5 - 1.1 + 1e-9);
    // …and stay on the wall (w wall spans depth 10 → ±5 minus edge margin)
    expect(pick!.offset - 1.2).toBeGreaterThanOrEqual(-5 + 0.3 - 1e-9);
  });

  it('returns null only when no wall can host any gap', () => {
    // 5×5 room, art dead-centre on every wall: every gap < 2.4 m
    const offsets = new Map<string, number[]>([
      ['n', [-1.2, 1.2]], ['s', [-1.2, 1.2]], ['w', [-1.2, 1.2]], ['e', [-1.2, 1.2]],
    ]);
    expect(pickEntranceWall(makeRoom(5, 5), new Set(), offsets)).toBeNull();
  });

  it('skips walls shorter than 4 m', () => {
    expect(pickEntranceWall(makeRoom(12, 3), new Set(), noArt)?.side).toBe('s');
  });
});

describe('floor finish', () => {
  it('defines all five floor materials from the schema', () => {
    for (const m of ['light-wood', 'dark-wood', 'polished-concrete', 'raw-concrete', 'marble']) {
      expect(FLOOR_FINISH[m]).toBeDefined();
      expect(FLOOR_FINISH[m].tileMetres).toBeGreaterThan(0);
    }
  });

  it('polished concrete is the shiniest; raw concrete the most matte', () => {
    const r = Object.entries(FLOOR_FINISH).map(([k, v]) => [k, v.roughness] as const);
    const min = r.reduce((a, b) => (b[1] < a[1] ? b : a));
    const max = r.reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(min[0]).toBe('polished-concrete');
    expect(max[0]).toBe('raw-concrete');
  });

  it('buildFloorMaterial falls back gracefully without a 2D canvas', () => {
    const mat = buildFloorMaterial('polished-concrete', 0xb0b0b0, 12, 10);
    expect(mat.roughness).toBeCloseTo(FLOOR_FINISH['polished-concrete'].roughness);
    expect(mat.metalness).toBeCloseTo(FLOOR_FINISH['polished-concrete'].metalness);
    // Either a texture (browser/jsdom+canvas) or a flat color fallback — both valid
    expect(mat.map !== null || mat.color !== undefined).toBe(true);
  });

  it('unknown floor material gets the default finish without throwing', () => {
    const mat = buildFloorMaterial('lava-glass', 0xff8800, 10, 10);
    expect(mat.roughness).toBeCloseTo(0.8);
  });
});

describe('benchSpec', () => {
  it('returns null for rooms too small for a bench', () => {
    expect(benchSpec(makeRoom(5, 5), 0, 0)).toBeNull();
    expect(benchSpec(makeRoom(6, 4), 0, 0)).toBeNull();
  });

  it('runs the bench along X in a wide room, offset off the tour centre line', () => {
    const room = makeRoom(12, 10);
    const spec = benchSpec(room, 0, 0)!;
    expect(spec.rotY).toBe(0);
    expect(spec.cx).toBeCloseTo(6); // centred on X
    expect(spec.cz).toBeCloseTo(5 + 10 * 0.18); // offset along the shorter axis
    expect(spec.aabb.maxX - spec.aabb.minX).toBeCloseTo(spec.length);
    expect(spec.aabb.maxZ - spec.aabb.minZ).toBeCloseTo(spec.width);
  });

  it('runs the bench along Z in a deep room', () => {
    const room = makeRoom(10, 14);
    const spec = benchSpec(room, 20, 0)!;
    expect(spec.rotY).toBeCloseTo(Math.PI / 2);
    expect(spec.cx).toBeCloseTo(20 + 5 + 10 * 0.18); // offset along shorter axis (X)
    expect(spec.cz).toBeCloseTo(7); // centred on Z
    expect(spec.aabb.maxZ - spec.aabb.minZ).toBeCloseTo(spec.length);
    expect(spec.aabb.maxX - spec.aabb.minX).toBeCloseTo(spec.width);
  });

  it('respects world origin offsets', () => {
    const spec = benchSpec(makeRoom(12, 10), 100, 50)!;
    expect(spec.cx).toBeCloseTo(106);
    expect(spec.aabb.minX).toBeGreaterThan(100);
  });
});
