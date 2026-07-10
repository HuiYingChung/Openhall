import { describe, expect, it } from 'vitest';
import type { WorkAnalysis } from '../../schema/analysis.schema';
import { serializeCurationAnalyses } from './curate.prompt';

describe('serializeCurationAnalyses', () => {
  it('keeps visual analysis but excludes editable title suggestions', () => {
    const analyses: WorkAnalysis[] = [
      {
        artworkId: 'aw-01',
        suggestedTitle: 'A Name That May Be Replaced',
        style: 'abstract',
        palette: ['#112233'],
        subject: 'interlocking forms',
        mood: 'tense',
        description: 'Angular forms meet at the centre.',
      },
    ];

    const parsed = JSON.parse(serializeCurationAnalyses(analyses));
    expect(parsed[0]).not.toHaveProperty('suggestedTitle');
    expect(parsed[0].subject).toBe('interlocking forms');
  });
});
