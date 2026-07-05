/**
 * provider.test.ts — Unit tests for generateValidated and extractJSON.
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
