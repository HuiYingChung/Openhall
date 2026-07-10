// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderViewerBootError } from './viewer-error';

describe('renderViewerBootError', () => {
  it('renders an untrusted error as text instead of executable markup', () => {
    const root = document.createElement('main');
    const payload = '</pre><img src=x onerror="globalThis.pwned=true">';

    renderViewerBootError(root, payload);

    expect(root.textContent).toContain(payload);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('pre')?.textContent).toBe(payload);
  });
});
