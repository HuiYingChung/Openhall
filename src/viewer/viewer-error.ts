/** Render an exported-viewer boot failure without interpreting error text as HTML. */
export function renderViewerBootError(root: HTMLElement, error: unknown): void {
  const card = document.createElement('div');
  card.style.cssText = 'color:#f00;font-family:monospace;padding:2rem;';

  const heading = document.createElement('h2');
  heading.textContent = 'Failed to load gallery';

  const detail = document.createElement('pre');
  detail.textContent = String(error);

  card.append(heading, detail);
  root.replaceChildren(card);
}
