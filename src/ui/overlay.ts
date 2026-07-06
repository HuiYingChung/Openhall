/**
 * overlay.ts — Controls hint overlay and re-lock overlay.
 * mountHintOverlay: shown on first entry, calls onEnter() when clicked.
 * mountHintOverlayTouchFallback: touch/no-pointer-lock variant with "Start Tour" CTA.
 * mountRelockOverlay: shown after Esc; clicking re-locks the pointer.
 */

const OVERLAY_HTML = `
  <div id="oh-overlay" style="
    position:fixed; inset:0;
    display:flex; flex-direction:column;
    align-items:center; justify-content:center;
    background:rgba(0,0,0,0.72);
    color:#f0ece6;
    font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
    user-select:none;
    z-index:100;
  ">
    <h1 style="font-size:2rem;font-weight:700;margin:0 0 0.25em">Openhall</h1>
    <p style="font-size:1rem;color:#aaa;margin:0 0 2rem">AI-generated 3D Gallery</p>

    <div style="
      display:grid;
      grid-template-columns:repeat(3,3rem);
      grid-template-rows:repeat(2,3rem);
      gap:0.4rem;
      margin-bottom:1.5rem;
    ">
      <div></div>
      <div style="background:#333;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;">W</div>
      <div></div>
      <div style="background:#333;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;">A</div>
      <div style="background:#333;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;">S</div>
      <div style="background:#333;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;">D</div>
    </div>

    <p style="margin:0 0 0.5rem;font-size:0.95rem;">
      <strong>WASD</strong> &nbsp;·&nbsp; <strong>Mouse</strong> to look &nbsp;·&nbsp; <strong>Click</strong> to interact
    </p>
    <p style="margin:0 0 2rem;font-size:0.85rem;color:#888;">
      Arrow keys also work for movement
    </p>

    <button id="oh-enter-btn" style="
      padding:0.75rem 2.5rem;
      font-size:1rem;
      background:#fff;
      color:#111;
      border:none;
      border-radius:8px;
      cursor:pointer;
      font-weight:600;
    ">Click to Enter</button>
  </div>
`;

const RELOCK_HTML = `
  <div id="oh-relock" style="
    position:fixed; inset:0;
    display:flex; flex-direction:column;
    align-items:center; justify-content:center;
    background:rgba(0,0,0,0.6);
    color:#f0ece6;
    font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
    user-select:none;
    z-index:100;
    cursor:pointer;
  ">
    <p style="font-size:1.2rem;margin:0 0 0.5rem;font-weight:600;">Paused</p>
    <p style="font-size:0.9rem;color:#aaa;margin:0;">Click anywhere to continue</p>
  </div>
`;

export function mountHintOverlay(onEnter: () => void): { dismiss: () => void } {
  const container = document.createElement('div');
  container.innerHTML = OVERLAY_HTML;
  document.body.appendChild(container);

  const btn = container.querySelector('#oh-enter-btn') as HTMLButtonElement;
  btn.addEventListener('click', () => {
    onEnter();
  });

  function dismiss(): void {
    if (container.parentNode) container.parentNode.removeChild(container);
  }

  return { dismiss };
}

/**
 * Touch / no-pointer-lock fallback overlay.
 * The CTA becomes "Start Tour" since free-walk requires pointer lock.
 * Calling onEnter() starts the tour and the caller should call dismiss().
 */
export function mountHintOverlayTouchFallback(onEnter: () => void): { dismiss: () => void } {
  const container = document.createElement('div');
  container.innerHTML = `
    <div id="oh-overlay" style="
      position:fixed; inset:0;
      display:flex; flex-direction:column;
      align-items:center; justify-content:center;
      background:rgba(0,0,0,0.72);
      color:#f0ece6;
      font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
      user-select:none;
      z-index:100;
    ">
      <h1 style="font-size:2rem;font-weight:700;margin:0 0 0.25em">Openhall</h1>
      <p style="font-size:1rem;color:#aaa;margin:0 0 2rem">AI-generated 3D Gallery</p>
      <p style="margin:0 0 2rem;font-size:0.95rem;text-align:center;max-width:260px;">
        Tap to take a guided tour of the gallery
      </p>
      <button id="oh-enter-btn" style="
        padding:0.75rem 2.5rem;
        font-size:1rem;
        background:#fff;
        color:#111;
        border:none;
        border-radius:8px;
        cursor:pointer;
        font-weight:600;
      ">Start Tour</button>
    </div>
  `;
  document.body.appendChild(container);

  const btn = container.querySelector('#oh-enter-btn') as HTMLButtonElement;
  btn.addEventListener('click', () => {
    onEnter();
  });

  function dismiss(): void {
    if (container.parentNode) container.parentNode.removeChild(container);
  }

  return { dismiss };
}

/**
 * Mount a minimal "click to continue" overlay after pointer unlock (Esc).
 * Removes itself when the user clicks and re-lock succeeds.
 */
export function mountRelockOverlay(onEnter: () => void): { dismiss: () => void } {
  const container = document.createElement('div');
  container.innerHTML = RELOCK_HTML;
  document.body.appendChild(container);

  container.addEventListener('click', () => {
    onEnter();
  });

  function dismiss(): void {
    if (container.parentNode) container.parentNode.removeChild(container);
  }

  return { dismiss };
}
