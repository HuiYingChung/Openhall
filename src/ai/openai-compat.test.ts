import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatProvider, type OpenAICompatSettings } from './openai-compat';
import type { UploadedArtwork } from './provider';

const SETTINGS: OpenAICompatSettings = {
  apiKey: 'test-key',
  baseUrl: 'https://example.test/v1',
  model: 'vision-model',
};

const ARTWORK: UploadedArtwork = {
  id: 'aw-01',
  filename: 'one.jpg',
  analysisDataUrl: 'data:image/jpeg;base64,/9j/',
  displayObjectUrl: '',
  aspectRatio: 1,
  title: '',
  medium: '',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('OpenAI-compatible completion handling', () => {
  it.each(['length', 'max_tokens'])('fails fast when finish_reason is %s', async (finishReason) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: { content: '{"artworkId":"aw-01"' },
          finish_reason: finishReason,
        }],
      }),
      text: async () => '',
    } as unknown as Response);

    const provider = new OpenAICompatProvider(SETTINGS);

    await expect(provider.analyzeArtwork(ARTWORK)).rejects.toThrow(
      `OpenAI-compat output truncated (finish_reason: "${finishReason}")`
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
