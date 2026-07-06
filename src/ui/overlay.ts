/**
 * overlay.ts — Controls hint overlay and re-lock overlay.
 * mountHintOverlay: shown on first entry, calls onEnter() when clicked.
 * mountHintOverlayTouchFallback: touch/no-pointer-lock variant with "Start Tour" CTA.
 * mountRelockOverlay: shown after Esc; clicking re-locks the pointer.
 * shouldShowRelockOverlay: pure decision function — unit-testable.
 */

// ---------------------------------------------------------------------------
// Pure decision function for onUnlock handlers
// ---------------------------------------------------------------------------

/**
 * Decides what an onUnlock handler should do.
 *
 * @returns
 *   'stay-armed'   — keep the listener registered, do nothing else
 *   'clear-suppress' — was a deliberate suppress, clear the flag and stay armed
 *   'show-overlay' — remove the listener and mount the Paused overlay
 */
export type RelockDecision = 'stay-armed' | 'clear-suppress' | 'show-overlay';

export function shouldShowRelockOverlay(opts: {
  tourActive: boolean;
  suppress: boolean;
  inspecting: boolean;
}): RelockDecision {
  if (opts.tourActive) return 'stay-armed';
  if (opts.suppress) return 'clear-suppress';
  if (opts.inspecting) return 'stay-armed';
  return 'show-overlay';
}

function buildHintHtml(showClose: boolean): string {
  const closeBtn = showClose ? `
    <button id="oh-overlay-close" style="
      position:absolute;top:1rem;right:1rem;
      background:none;border:none;color:#aaa;
      font-size:1.5rem;line-height:1;cursor:pointer;padding:0.25rem 0.5rem;
    " aria-label="Close">&times;</button>
  ` : '';
  return `
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
    ${closeBtn}
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
    <p style="margin:0 0 0.4rem;font-size:0.85rem;color:#888;">
      Arrow keys also work for movement
    </p>
    <p style="margin:0 0 2rem;font-size:0.85rem;color:#888;">
      Press <kbd style="background:#333;border-radius:4px;padding:0.1em 0.4em;font-family:inherit;">Esc</kbd> anytime to pause or exit
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
}

/**
 * Build RELOCK_HTML — if onExitToMenu is provided, append the "Create your
 * own gallery" button so the demo visitor has a clear next step.
 */
function buildRelockHtml(showExitBtn: boolean): string {
  const exitBtn = showExitBtn ? `
    <button id="oh-relock-exit-btn" style="
      margin-top:1.5rem;
      padding:0.6rem 1.6rem;
      font-size:0.9rem;
      background:#fff;
      color:#111;
      border:none;
      border-radius:8px;
      cursor:pointer;
      font-weight:600;
      font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
    ">Create your own gallery &rarr;</button>
  ` : '';
  return `
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
      <p style="font-size:0.9rem;color:#aaa;margin:0;">Click anywhere to continue walking</p>
      <p style="font-size:0.75rem;color:#666;margin:0.5rem 0 0;">(if nothing happens, click again)</p>
      ${exitBtn}
    </div>
  `;
}

export function mountHintOverlay(
  onEnter: () => void,
  onClose?: () => void
): { dismiss: () => void } {
  const container = document.createElement('div');
  container.innerHTML = buildHintHtml(!!onClose);
  document.body.appendChild(container);

  const btn = container.querySelector('#oh-enter-btn') as HTMLButtonElement;
  btn.addEventListener('click', () => {
    onEnter();
  });

  function dismiss(): void {
    if (container.parentNode) container.parentNode.removeChild(container);
  }

  if (onClose) {
    const closeBtn = container.querySelector('#oh-overlay-close');
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
      onClose();
    });
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
 *
 * Browsers enforce a ~1–2 s pointer-lock cooldown after Esc; if the first
 * requestPointerLock() is rejected, we auto-retry once after 1.5 s so the
 * user doesn't get stuck on a silent failure.
 */
export function mountRelockOverlay(
  onEnter: () => void,
  onExitToMenu?: () => void
): { dismiss: () => void } {
  const container = document.createElement('div');
  container.innerHTML = buildRelockHtml(!!onExitToMenu);
  document.body.appendChild(container);

  // One-retry: if pointerlockerror fires (browser cooldown), retry after 1.5 s
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const onPointerLockError = () => {
    if (retryTimer !== null) return; // already queued
    retryTimer = setTimeout(() => {
      retryTimer = null;
      onEnter();
    }, 1500);
  };
  document.addEventListener('pointerlockerror', onPointerLockError);

  // "Create your own gallery" exit button — stops propagation so it doesn't
  // also trigger the container click (which would attempt to re-lock).
  if (onExitToMenu) {
    const exitBtn = container.querySelector('#oh-relock-exit-btn');
    if (exitBtn) {
      exitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismiss();
        onExitToMenu();
      });
    }
  }

  container.addEventListener('click', () => {
    onEnter();
  });

  function dismiss(): void {
    if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
    document.removeEventListener('pointerlockerror', onPointerLockError);
    if (container.parentNode) container.parentNode.removeChild(container);
  }

  return { dismiss };
}
