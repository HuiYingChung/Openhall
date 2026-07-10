import { describe, expect, it } from 'vitest';
import type { UploadedArtwork } from '../provider';
import type { WorkAnalysis } from '../../schema/analysis.schema';
import { buildLabelsPrompt } from './labels.prompt';

const analyses: WorkAnalysis[] = [
  {
    artworkId: 'aw-01',
    suggestedTitle: 'Quiet Water',
    style: 'photography',
    palette: ['#112233'],
    subject: 'water',
    mood: 'still',
    description: 'A still body of water.',
  },
  {
    artworkId: 'aw-02',
    suggestedTitle: 'Red Line',
    style: 'drawing',
    palette: ['#aa0000'],
    subject: 'line',
    mood: 'tense',
    description: 'A red line crosses the paper.',
  },
];

function upload(id: string, title: string, medium: string): UploadedArtwork {
  return {
    id,
    filename: `${id}.jpg`,
    analysisDataUrl: '',
    displayObjectUrl: '',
    aspectRatio: 1,
    title,
    medium,
  };
}

describe('buildLabelsPrompt', () => {
  it('uses valid JSON and keeps editable metadata out of generated prose', () => {
    const prompt = buildLabelsPrompt(
      [upload('aw-01', 'Water "Study"\nII', ''), upload('aw-02', 'Red Line', 'Ink on paper')],
      analyses,
      'A study of restraint.'
    );
    const artworkJson = prompt.match(/ARTWORKS:\n([\s\S]*?)\n\nFor each artwork/)?.[1];
    expect(artworkJson).toBeDefined();
    const artworks = JSON.parse(artworkJson!) as Array<Record<string, unknown>>;

    expect(artworks[0].id).toBe('aw-01');
    expect(artworks[0]).not.toHaveProperty('title');
    expect(artworks[0]).not.toHaveProperty('medium');
    expect(artworks[1]).not.toHaveProperty('medium');
    expect(prompt).not.toContain('Water "Study"');
    expect(prompt).not.toContain('Ink on paper');
    expect(prompt).not.toContain('Unknown medium');
    expect(prompt).toMatch(/do not infer.*medium/i);
    expect(prompt).toMatch(/title, medium, and year.*intentionally omitted/i);
  });
});
