/**
 * narration.ts — Spoken narration for tour mode.
 *
 * TourNarrator: thin wrapper around the browser's speechSynthesis API.
 * pickNarrationText: pure helper that decides what text to speak at each stop.
 * computeDwellSeconds: reading-time estimate for autoplay dwell (moved here
 *   from tour.ts to avoid an import cycle; re-exported from tour.ts for
 *   backwards-compatible external imports).
 * estimateSpeechSeconds: speech-duration estimate used by computeStopDwell.
 * computeStopDwell: speech-aware dwell that prevents mid-sentence advances.
 *
 * Framework-free vanilla TS per AGENTS.md rule 2. Zero dependencies.
 */

import type { Gallery, TourWaypoint } from '../schema/gallery.schema';
import { ARTIST_MESH_ID } from './interactions';

// ---------------------------------------------------------------------------
// Dwell / speech duration helpers — pure, unit-testable
// ---------------------------------------------------------------------------

// Constants mirrored from tour.ts so narration.ts stays self-contained.
const AUTOPLAY_DWELL_MIN = 5;  // seconds
const AUTOPLAY_DWELL_MAX = 12; // seconds

/**
 * Reading time for a wall label, tuned for autoplay: 5 s base plus one second
 * per 80 characters of label text, capped at 12 s. Pure — unit-tested.
 */
export function computeDwellSeconds(labelText: string): number {
  const readSeconds = 5 + labelText.length / 80;
  return Math.min(AUTOPLAY_DWELL_MAX, Math.max(AUTOPLAY_DWELL_MIN, readSeconds));
}

/**
 * Estimate how long the browser will take to speak `text` at a typical
 * English speech rate (≈150 wpm ≈ 12 characters/second).
 * Clamped to [5, 30] seconds. Pure — unit-tested.
 */
export function estimateSpeechSeconds(text: string): number {
  return Math.min(30, Math.max(5, text.length / 12));
}

/**
 * Speech-aware dwell for a tour stop.
 *
 * - When `spokenText` is empty (voice off or nothing to speak), returns the
 *   plain reading-time dwell so silent stops aren't stuck waiting 25+ seconds.
 * - When voice is on with text, returns the MAX of the label reading time and
 *   the estimated speech duration so the label is always readable AND the
 *   narration always finishes before `canAutoAdvance` can fire.
 *
 * Pure — unit-tested.
 */
export function computeStopDwell(labelText: string, spokenText: string): number {
  if (!spokenText) return computeDwellSeconds(labelText);
  return Math.max(computeDwellSeconds(labelText), estimateSpeechSeconds(spokenText));
}

// ---------------------------------------------------------------------------
// TourNarrator
// ---------------------------------------------------------------------------

export class TourNarrator {
  /** True if speechSynthesis is present in window (voices may still be loading). */
  get isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /**
   * Speak `text`. Calls `onEnd` when the utterance finishes or is cancelled.
   * Cancels any current utterance before starting the new one.
   */
  speak(text: string, onEnd?: () => void): void {
    if (!this.isSupported || !text) {
      onEnd?.();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (onEnd) {
      utterance.onend = () => onEnd();
      utterance.onerror = () => onEnd();
    }
    window.speechSynthesis.speak(utterance);
  }

  /** Cancel any in-progress utterance. */
  cancel(): void {
    if (this.isSupported) {
      window.speechSynthesis.cancel();
    }
  }

  /** Whether the browser is currently speaking. */
  get isSpeaking(): boolean {
    return this.isSupported && window.speechSynthesis.speaking;
  }
}

// ---------------------------------------------------------------------------
// pickNarrationText — pure, unit-testable
// ---------------------------------------------------------------------------

/**
 * Choose the text to speak at a tour stop.
 *
 * Fallback chain:
 *   - Artist stop (artworkId === ARTIST_MESH_ID):
 *       artist.statement ?? ''
 *   - Artwork stop:
 *       artwork.narration ?? artwork.label ?? ''
 *   - Unknown artworkId or no artworkId:
 *       ''  (skip speech)
 *
 * An empty string return means "skip speech for this stop".
 */
export function pickNarrationText(wp: TourWaypoint, gallery: Gallery): string {
  if (!wp.artworkId) return '';

  if (wp.artworkId === ARTIST_MESH_ID) {
    return gallery.artist?.statement ?? '';
  }

  const artwork = gallery.artworks.find((a) => a.id === wp.artworkId);
  if (!artwork) return '';

  return artwork.narration ?? artwork.label ?? '';
}

// ---------------------------------------------------------------------------
// canAutoAdvance — pure, unit-testable
// ---------------------------------------------------------------------------

/**
 * Decide whether autoplay may advance to the next stop.
 *
 * Rules:
 * - Advance when BOTH the dwell time has elapsed AND the browser is not speaking.
 * - Safety fallback: if dwellElapsed >= 2× the nominal dwell, advance regardless
 *   of speaking (handles browsers that never fire an end event).
 *
 * @param dwellElapsed   Seconds spent in the 'viewing' phase at this stop.
 * @param nominalDwell   The computeDwellSeconds result for this stop.
 * @param speaking       Whether speechSynthesis is currently speaking.
 */
export function canAutoAdvance(
  dwellElapsed: number,
  nominalDwell: number,
  speaking: boolean
): boolean {
  if (dwellElapsed >= 2 * nominalDwell) return true; // safety fallback
  return dwellElapsed >= nominalDwell && !speaking;
}
