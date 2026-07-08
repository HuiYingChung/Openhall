/**
 * overlay.test.ts — Unit tests for shouldShowRelockOverlay.
 * The pointer-lock rearm decision is pure and fully testable without a DOM.
 */

import { describe, it, expect } from 'vitest';
import { shouldShowRelockOverlay } from './overlay';

describe('shouldShowRelockOverlay', () => {
  it('returns show-overlay when nothing suppresses', () => {
    expect(shouldShowRelockOverlay({ tourActive: false, suppress: false, inspecting: false }))
      .toBe('show-overlay');
  });

  it('returns stay-armed when tour is active', () => {
    expect(shouldShowRelockOverlay({ tourActive: true, suppress: false, inspecting: false }))
      .toBe('stay-armed');
  });

  it('returns clear-suppress when suppress flag is set (tour not active)', () => {
    expect(shouldShowRelockOverlay({ tourActive: false, suppress: true, inspecting: false }))
      .toBe('clear-suppress');
  });

  it('tour takes priority over suppress flag', () => {
    expect(shouldShowRelockOverlay({ tourActive: true, suppress: true, inspecting: false }))
      .toBe('stay-armed');
  });

  it('returns stay-armed when inspect panel is open', () => {
    expect(shouldShowRelockOverlay({ tourActive: false, suppress: false, inspecting: true }))
      .toBe('stay-armed');
  });

  it('tour takes priority over inspecting', () => {
    expect(shouldShowRelockOverlay({ tourActive: true, suppress: false, inspecting: true }))
      .toBe('stay-armed');
  });

  it('suppress takes priority over inspecting', () => {
    // suppress is checked before inspecting
    expect(shouldShowRelockOverlay({ tourActive: false, suppress: true, inspecting: true }))
      .toBe('clear-suppress');
  });
});

// ---------------------------------------------------------------------------
// brandingLines — entry overlay leads with the exhibition, not the tool
// ---------------------------------------------------------------------------

import { brandingLines } from './overlay';

describe('brandingLines', () => {
  it('leads with the gallery title and artist name when present', () => {
    expect(brandingLines({ title: 'Quiet Forms', artistName: 'Jane Doe' }))
      .toEqual({ title: 'Quiet Forms', subtitle: 'Jane Doe' });
  });

  it('falls back to Openhall branding when absent or blank', () => {
    expect(brandingLines(undefined))
      .toEqual({ title: 'Openhall', subtitle: 'AI-generated 3D Gallery' });
    expect(brandingLines({ title: '   ', artistName: '' }))
      .toEqual({ title: 'Openhall', subtitle: 'AI-generated 3D Gallery' });
  });

  it('mixes fallbacks per field', () => {
    expect(brandingLines({ title: 'Quiet Forms' }).subtitle).toBe('AI-generated 3D Gallery');
    expect(brandingLines({ artistName: 'Jane' }).title).toBe('Openhall');
  });
});
