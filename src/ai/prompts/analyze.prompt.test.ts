import { describe, expect, it } from 'vitest';
import { buildAnalyzePrompt } from './analyze.prompt';

describe('buildAnalyzePrompt', () => {
  it('requests a short grounded title without asking the model to infer medium', () => {
    const prompt = buildAnalyzePrompt('aw-01');

    expect(prompt).toContain('"suggestedTitle"');
    expect(prompt).toMatch(/concise|short/i);
    expect(prompt).toMatch(/based only on what you see|grounded/i);
    expect(prompt).toMatch(/never.*Untitled/i);
    expect(prompt).toMatch(/do not infer.*medium/i);
  });
});
