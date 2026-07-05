/**
 * analysis.schema.test.ts — Tests for WorkAnalysisSchema and CurationPlanSchema.
 */

import { describe, it, expect } from 'vitest';
import { WorkAnalysisSchema, CurationPlanSchema } from '../schema/analysis.schema';

describe('WorkAnalysisSchema', () => {
  it('accepts a valid work analysis', () => {
    const valid = {
      artworkId: 'aw-01',
      style: 'abstract expressionism',
      palette: ['#cc3333', '#336699'],
      subject: 'two figures in tension',
      mood: 'melancholic',
      description: 'A study in contrasting colours suggesting emotional conflict.',
    };
    expect(WorkAnalysisSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid palette hex', () => {
    const bad = {
      artworkId: 'aw-01',
      style: 'painting',
      palette: ['not-a-hex'],
      subject: 'landscape',
      mood: 'calm',
      description: 'A peaceful scene.',
    };
    expect(WorkAnalysisSchema.safeParse(bad).success).toBe(false);
  });
});

describe('CurationPlanSchema', () => {
  it('accepts a valid curation plan', () => {
    const valid = {
      roomCount: 2,
      rooms: [
        { roomId: 'room-1', theme: 'Tension', artworkIds: ['aw-01', 'aw-02'] },
        { roomId: 'room-2', theme: 'Resolution', artworkIds: ['aw-03'] },
      ],
      placements: [
        { artworkId: 'aw-01', roomId: 'room-1', wall: 'n', offsetFromCenter: -2 },
        { artworkId: 'aw-02', roomId: 'room-1', wall: 'n', offsetFromCenter: 2 },
        { artworkId: 'aw-03', roomId: 'room-2', wall: 'n', offsetFromCenter: 0 },
      ],
      tourOrder: ['aw-01', 'aw-02', 'aw-03'],
      curatorNote: 'A journey from tension to resolution.',
    };
    expect(CurationPlanSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects roomCount > 4', () => {
    const bad = {
      roomCount: 5,
      rooms: [],
      placements: [],
      tourOrder: [],
      curatorNote: 'Too many rooms.',
    };
    expect(CurationPlanSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects offsetFromCenter outside bounds', () => {
    const bad = {
      roomCount: 1,
      rooms: [{ roomId: 'room-1', theme: 'Test', artworkIds: ['aw-01'] }],
      placements: [
        { artworkId: 'aw-01', roomId: 'room-1', wall: 'n', offsetFromCenter: 10 }, // > 6
      ],
      tourOrder: ['aw-01'],
      curatorNote: 'Test.',
    };
    expect(CurationPlanSchema.safeParse(bad).success).toBe(false);
  });
});
