/**
 * provider.test.ts — Unit tests for generateValidated, extractJSON, and
 * composeGalleryFromPlan progress events.
 */

import { describe, it, expect, vi } from 'vitest';
import { generateValidated, extractJSON } from '../ai/provider';
import { z } from 'zod';

const SimpleSchema = z.object({ value: z.string(), count: z.number() });

describe('extractJSON', () => {
  it('returns plain JSON unchanged', () => {
    const input = '{"a":1}';
    expect(extractJSON(input)).toBe('{"a":1}');
  });

  it('strips markdown ```json fences', () => {
    const input = '```json\n{"a":1}\n```';
    expect(extractJSON(input)).toBe('{"a":1}');
  });

  it('strips plain ``` fences', () => {
    const input = '```\n{"a":1}\n```';
    expect(extractJSON(input)).toBe('{"a":1}');
  });

  it('extracts JSON from surrounding prose', () => {
    const input = 'Here is the JSON: {"a":1} enjoy!';
    expect(extractJSON(input)).toBe('{"a":1}');
  });
});

describe('generateValidated', () => {
  it('returns parsed data on first success', async () => {
    const llm = vi.fn().mockResolvedValue('{"value":"hello","count":3}');
    const result = await generateValidated(llm, SimpleSchema);
    expect(result).toEqual({ value: 'hello', count: 3 });
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('retries when JSON is invalid, succeeds on second attempt', async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce('{"value":"ok","count":1}');
    const result = await generateValidated(llm, SimpleSchema);
    expect(result).toEqual({ value: 'ok', count: 1 });
    expect(llm).toHaveBeenCalledTimes(2);
    // Second call should include error context
    expect(llm.mock.calls[1][0]).toContain('could not be parsed as JSON');
  });

  it('retries when schema validation fails, succeeds on second attempt', async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce('{"value":"hello","count":"not-a-number"}')
      .mockResolvedValueOnce('{"value":"hello","count":5}');
    const result = await generateValidated(llm, SimpleSchema);
    expect(result).toEqual({ value: 'hello', count: 5 });
    expect(llm).toHaveBeenCalledTimes(2);
    expect(llm.mock.calls[1][0]).toContain('failed validation');
  });

  it('throws after all retries are exhausted', async () => {
    const llm = vi.fn().mockResolvedValue('{"value":"hello"}'); // missing count
    await expect(generateValidated(llm, SimpleSchema, 1)).rejects.toThrow('generateValidated');
    expect(llm).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  it('passes empty extraContext on first call', async () => {
    const llm = vi.fn().mockResolvedValue('{"value":"x","count":0}');
    await generateValidated(llm, SimpleSchema);
    expect(llm.mock.calls[0][0]).toBe('');
  });
});

// ---------------------------------------------------------------------------
// composeGalleryFromPlan — shared composition used by every provider
// ---------------------------------------------------------------------------

import { composeGalleryFromPlan } from './provider';
import type { UploadedArtwork } from './provider';
import type { CurationPlan, WorkAnalysis } from '../schema/analysis.schema';

function makeUpload(id: string): UploadedArtwork {
  return {
    id, filename: `${id}.jpg`, analysisDataUrl: '', displayObjectUrl: '',
    aspectRatio: 1, title: `Title ${id}`, medium: 'Oil',
  };
}

const COMPOSE_ARTWORKS = [makeUpload('aw-01'), makeUpload('aw-02')];

const COMPOSE_ANALYSES: WorkAnalysis[] = COMPOSE_ARTWORKS.map((a) => ({
  artworkId: a.id, style: 'abstract', palette: ['#112233'],
  subject: 'forms', mood: 'calm', description: 'A work.',
}));

const COMPOSE_PLAN: CurationPlan = {
  roomCount: 1,
  rooms: [{ roomId: 'room-1', theme: 'Quiet forms', artworkIds: ['aw-01', 'aw-02'] }],
  placements: [
    { artworkId: 'aw-01', roomId: 'room-1', wall: 'n', offsetFromCenter: -2 },
    { artworkId: 'aw-02', roomId: 'room-1', wall: 's', offsetFromCenter: 2 },
  ],
  tourOrder: ['aw-01', 'aw-02'],
  curatorNote: 'A meditation on quiet forms.',
};

describe('composeGalleryFromPlan', () => {
  it('LLM writes only title + labels; geometry comes from the assembler', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce('"Quiet Forms"') // title call
      .mockResolvedValueOnce(JSON.stringify([ // one label batch (2 works ≤ 3)
        { artworkId: 'aw-01', label: 'Label one.', narration: 'Narration one.' },
        { artworkId: 'aw-02', label: 'Label two.', artistStatement: 'A note.' },
      ]));

    const gallery = await composeGalleryFromPlan(
      generate, COMPOSE_ARTWORKS, COMPOSE_ANALYSES, COMPOSE_PLAN, 'white-cube'
    );

    expect(generate).toHaveBeenCalledTimes(2); // no whole-gallery JSON call
    expect(gallery.title).toBe('Quiet Forms');
    expect(gallery.rooms.length).toBe(1);
    expect(gallery.placements.length).toBe(2);
    expect(gallery.tour.length).toBeGreaterThan(0);
    const aw1 = gallery.artworks.find((a) => a.id === 'aw-01')!;
    const aw2 = gallery.artworks.find((a) => a.id === 'aw-02')!;
    expect(aw1.label).toBe('Label one.');
    expect(aw1.narration).toBe('Narration one.');
    expect(aw2.artistStatement).toBe('A note.');
    expect(aw2.narration).toBeUndefined(); // model omitted it — graceful degradation
  });

  it('falls back to placeholder label + default title when the model is unhelpful', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce('   ') // empty title
      .mockResolvedValueOnce(JSON.stringify([
        { artworkId: 'aw-01', label: 'Only one label.' },
      ]));

    const gallery = await composeGalleryFromPlan(
      generate, COMPOSE_ARTWORKS, COMPOSE_ANALYSES, COMPOSE_PLAN, 'white-cube'
    );

    expect(gallery.title).toBe('New Exhibition');
    const aw2 = gallery.artworks.find((a) => a.id === 'aw-02')!;
    expect(aw2.label).toBe('No label available.');
  });

  it('batches labels in groups of three (narration doubles token budget)', async () => {
    const many = Array.from({ length: 6 }, (_, i) => makeUpload(`aw-0${i + 1}`));
    const manyAnalyses = many.map((a) => ({
      artworkId: a.id, style: 's', palette: ['#000000'],
      subject: 'x', mood: 'm', description: 'd',
    }));
    const plan: CurationPlan = {
      roomCount: 1,
      rooms: [{ roomId: 'room-1', theme: 'All', artworkIds: many.map((a) => a.id) }],
      placements: many.map((a, i) => ({
        artworkId: a.id, roomId: 'room-1',
        wall: (['n', 's', 'e', 'w'] as const)[i % 4], offsetFromCenter: 0,
      })),
      tourOrder: many.map((a) => a.id),
      curatorNote: 'All together.',
    };
    const labelsFor = (ids: string[]) =>
      JSON.stringify(ids.map((id) => ({ artworkId: id, label: `A wall label for ${id}.`, narration: `Narration for ${id}.` })));
    const generate = vi.fn()
      .mockResolvedValueOnce('Six Works')
      .mockResolvedValueOnce(labelsFor(many.slice(0, 3).map((a) => a.id)))
      .mockResolvedValueOnce(labelsFor(many.slice(3, 6).map((a) => a.id)));

    const gallery = await composeGalleryFromPlan(generate, many, manyAnalyses, plan, 'white-cube');

    expect(generate).toHaveBeenCalledTimes(3); // title + 2 label batches of 3
    expect(gallery.artworks.every((a) => a.label.startsWith('A wall label for aw-'))).toBe(true);
  });
});

describe('generateValidated — onRetry callback', () => {
  it('does NOT call onRetry on the first (successful) attempt', async () => {
    const llm = vi.fn().mockResolvedValue('{"value":"x","count":1}');
    const onRetry = vi.fn();
    await generateValidated(llm, SimpleSchema, 2, onRetry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('calls onRetry exactly once on the first retry (schema failure)', async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce('{"value":"x"}') // missing count — validation fails
      .mockResolvedValueOnce('{"value":"x","count":5}');
    const onRetry = vi.fn();
    await generateValidated(llm, SimpleSchema, 2, onRetry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry on every retry attempt (not on the first try)', async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce('bad')
      .mockResolvedValueOnce('still bad')
      .mockResolvedValueOnce('{"value":"ok","count":0}');
    const onRetry = vi.fn();
    await generateValidated(llm, SimpleSchema, 3, onRetry);
    expect(onRetry).toHaveBeenCalledTimes(2); // retries 1 and 2, not the initial call
  });
});

describe('composeGalleryFromPlan — progress events', () => {
  it('emits title → labels-batch-start → labels-batch-done → assembling in order', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce('Forms')
      .mockResolvedValueOnce(JSON.stringify([
        { artworkId: 'aw-01', label: 'Label one.', narration: 'Narration one.' },
        { artworkId: 'aw-02', label: 'Label two.' },
      ]));

    const events: string[] = [];
    await composeGalleryFromPlan(
      generate, COMPOSE_ARTWORKS, COMPOSE_ANALYSES, COMPOSE_PLAN, 'white-cube',
      (evt) => events.push(evt.type)
    );

    expect(events[0]).toBe('title');
    expect(events[1]).toBe('assembling');
    expect(events[2]).toBe('labels-batch-start');
    expect(events[3]).toBe('labels-batch-done');
  });

  it('labels-batch-start carries the artwork IDs for that batch', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce('Forms')
      .mockResolvedValueOnce(JSON.stringify([
        { artworkId: 'aw-01', label: 'A label for work one.' },
        { artworkId: 'aw-02', label: 'A label for work two.' },
      ]));

    const batchStart: Array<{ artworkIds: string[]; batch: number; totalBatches: number }> = [];
    await composeGalleryFromPlan(
      generate, COMPOSE_ARTWORKS, COMPOSE_ANALYSES, COMPOSE_PLAN, 'white-cube',
      (evt) => { if (evt.type === 'labels-batch-start') batchStart.push(evt); }
    );

    expect(batchStart).toHaveLength(1);
    expect(batchStart[0].artworkIds).toEqual(['aw-01', 'aw-02']);
    expect(batchStart[0].batch).toBe(1);
    expect(batchStart[0].totalBatches).toBe(1);
  });

  it('labels-batch-done carries the real label entries returned by the model', async () => {
    const entries = [
      { artworkId: 'aw-01', label: 'Written label.', narration: 'Spoken narration.' },
      { artworkId: 'aw-02', label: 'Another label.' },
    ];
    const generate = vi.fn()
      .mockResolvedValueOnce('Forms')
      .mockResolvedValueOnce(JSON.stringify(entries));

    const doneEvents: typeof entries[] = [];
    await composeGalleryFromPlan(
      generate, COMPOSE_ARTWORKS, COMPOSE_ANALYSES, COMPOSE_PLAN, 'white-cube',
      (evt) => { if (evt.type === 'labels-batch-done') doneEvents.push(evt.entries as typeof entries); }
    );

    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0][0].label).toBe('Written label.');
    expect(doneEvents[0][0].narration).toBe('Spoken narration.');
  });

  it('emits retry event when the model output fails validation, then succeeds', async () => {
    const badEntries = [{ artworkId: 'aw-01' }]; // missing required label field
    const goodEntries = [
      { artworkId: 'aw-01', label: 'Good label.' },
      { artworkId: 'aw-02', label: 'Another good label.' },
    ];
    const generate = vi.fn()
      .mockResolvedValueOnce('Title') // title
      .mockResolvedValueOnce(JSON.stringify(badEntries)) // first labels attempt fails
      .mockResolvedValueOnce(JSON.stringify(goodEntries)); // retry succeeds

    const retryEvents: string[] = [];
    await composeGalleryFromPlan(
      generate, COMPOSE_ARTWORKS, COMPOSE_ANALYSES, COMPOSE_PLAN, 'white-cube',
      (evt) => { if (evt.type === 'retry') retryEvents.push(evt.step); }
    );

    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0]).toBe('labels');
  });
});
