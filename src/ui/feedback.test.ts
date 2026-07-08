/**
 * feedback.test.ts — error translation table + toast/error-card DOM behavior.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { translateError, showToast, buildErrorCard, showFieldError } from './feedback';

describe('translateError', () => {
  it('maps missing-key errors to a settings-first card', () => {
    const t = translateError(new Error('No API key configured. Please go to Settings.'));
    expect(t.title).toBe('No API key configured');
    expect(t.actions).toEqual(['settings', 'back']);
  });

  it('maps 401/unauthorized to the invalid-key card with retry + settings', () => {
    const t = translateError(new Error('watsonx 401 Unauthorized — API key may be invalid or token expired'));
    expect(t.title).toBe('The AI provider rejected your API key');
    expect(t.actions).toContain('retry');
    expect(t.actions).toContain('settings');
    expect(t.detail).toContain('401');
  });

  it('maps quota/rate-limit errors', () => {
    const t = translateError(new Error('watsonx 429 Too Many Requests'));
    expect(t.title).toBe('Your AI plan hit a limit');
  });

  it('maps network failures', () => {
    const t = translateError(new TypeError('Failed to fetch'));
    expect(t.title).toBe('Connection problem');
    expect(t.actions).toContain('retry');
  });

  it('maps schema/parse failures to a retry-friendly card', () => {
    const t = translateError(new Error('Gallery schema validation failed after retry (zod)'));
    expect(t.title).toBe('The AI returned an unusable layout');
    expect(t.actions).toContain('retry');
  });

  it('falls back to a generic card that keeps all recovery paths', () => {
    const t = translateError('something exotic');
    expect(t.title).toBe('Generation stopped unexpectedly');
    expect(t.actions).toEqual(['retry', 'settings', 'back']);
    expect(t.detail).toBe('something exotic');
  });

  it('never returns an empty action list', () => {
    for (const err of ['', 'x', new Error('404 not found'), 42, null]) {
      expect(translateError(err).actions.length).toBeGreaterThan(0);
    }
  });
});

describe('showToast', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('mounts a toast with the message and an assertive live region for errors', () => {
    showToast({ message: 'Export failed', tone: 'error' });
    const root = document.getElementById('oh-toast-root')!;
    expect(root.getAttribute('aria-live')).toBe('assertive');
    expect(root.textContent).toContain('Export failed');
  });

  it('uses a polite live region for non-errors and auto-dismisses', () => {
    vi.useFakeTimers();
    showToast({ message: 'Saved', tone: 'success' });
    const root = document.getElementById('oh-toast-root')!;
    expect(root.getAttribute('aria-live')).toBe('polite');
    expect(root.querySelector('.oh-toast')).not.toBeNull();
    vi.advanceTimersByTime(4100);
    expect(root.querySelector('.oh-toast')).toBeNull();
  });

  it('keeps error toasts sticky until dismissed', () => {
    vi.useFakeTimers();
    showToast({ message: 'boom', tone: 'error' });
    vi.advanceTimersByTime(60000);
    const root = document.getElementById('oh-toast-root')!;
    expect(root.querySelector('.oh-toast')).not.toBeNull();
    (root.querySelector('.oh-toast-close') as HTMLButtonElement).click();
    expect(root.querySelector('.oh-toast')).toBeNull();
  });

  it('runs the action callback and dismisses on action click', () => {
    const onAction = vi.fn();
    showToast({ message: 'fail', tone: 'error', actionLabel: 'Retry', onAction });
    (document.querySelector('.oh-toast-action') as HTMLButtonElement).click();
    expect(onAction).toHaveBeenCalledOnce();
    expect(document.querySelector('.oh-toast')).toBeNull();
  });

  it('replaces an existing toast instead of stacking', () => {
    showToast({ message: 'first', tone: 'error' });
    showToast({ message: 'second', tone: 'error' });
    const toasts = document.querySelectorAll('.oh-toast');
    expect(toasts.length).toBe(1);
    expect(toasts[0].textContent).toContain('second');
  });
});

describe('buildErrorCard', () => {
  it('renders title, hint, actions and collapsible detail', () => {
    const onRetry = vi.fn();
    const card = buildErrorCard({
      title: 'T',
      hint: 'H',
      detail: 'raw stack',
      actions: [{ label: 'Try again', primary: true, onClick: onRetry }],
    });
    document.body.appendChild(card);
    expect(card.getAttribute('role')).toBe('alert');
    expect(card.querySelector('.oh-error-title')!.textContent).toBe('T');
    expect(card.querySelector('details')!.textContent).toContain('raw stack');
    (card.querySelector('button') as HTMLButtonElement).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('omits the detail block when no detail is given', () => {
    const card = buildErrorCard({ title: 'T', hint: 'H', actions: [] });
    expect(card.querySelector('details')).toBeNull();
  });
});

describe('showFieldError', () => {
  it('shows the message, marks fields invalid, and clears on input', () => {
    document.body.innerHTML = `
      <p id="err" style="display:none;"></p>
      <input id="a" class="oh-field">
    `;
    const errEl = document.getElementById('err')!;
    const field = document.getElementById('a') as HTMLInputElement;
    showFieldError(errEl, 'Required.', [field]);
    expect(errEl.style.display).toBe('block');
    expect(field.classList.contains('is-invalid')).toBe(true);
    field.dispatchEvent(new Event('input'));
    expect(errEl.style.display).toBe('none');
    expect(field.classList.contains('is-invalid')).toBe(false);
  });
});
