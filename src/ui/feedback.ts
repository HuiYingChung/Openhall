/**
 * feedback.ts — In-app feedback: toasts and blocking error cards.
 * Replaces native alert()/confirm() so failures stay inside the app's
 * visual language and always offer a next step (retry, settings, back).
 *
 * App chrome only — nothing here ships in the exported viewer bundle.
 */

// ---------------------------------------------------------------------------
// Error translation — pure and unit-testable
// ---------------------------------------------------------------------------

export type ErrorAction = 'retry' | 'settings' | 'back';

export interface TranslatedError {
  title: string;
  hint: string;
  actions: ErrorAction[];
  /** Raw error text, shown as collapsed technical detail. */
  detail: string;
}

/**
 * Map a raw pipeline/provider error onto human copy plus the actions that
 * make sense for it. The providers already throw messages with the HTTP
 * status embedded (e.g. "watsonx 401 Unauthorized — ..."), so string
 * matching is deliberate — there is no structured error type to switch on.
 */
export function translateError(err: unknown): TranslatedError {
  const raw = err instanceof Error ? err.message : String(err);

  if (/no api key configured/i.test(raw)) {
    return {
      title: 'No API key configured',
      hint: 'Add your provider key in Settings — or explore the demo gallery without one.',
      actions: ['settings', 'back'],
      detail: raw,
    };
  }
  if (/401|403|unauthorized|forbidden|invalid.*(key|token)|api key may be/i.test(raw)) {
    return {
      title: 'The AI provider rejected your API key',
      hint: 'Check your key in Settings, then try again — your artworks and description are kept.',
      actions: ['retry', 'settings', 'back'],
      detail: raw,
    };
  }
  if (/429|quota|rate limit|too many requests|insufficient|exceeded/i.test(raw)) {
    return {
      title: 'Your AI plan hit a limit',
      hint: 'The provider reports a quota or rate limit. Wait a moment or check your plan, then try again.',
      actions: ['retry', 'back'],
      detail: raw,
    };
  }
  if (/failed to fetch|network|timeout|timed out|econn|socket|load failed/i.test(raw)) {
    return {
      title: 'Connection problem',
      hint: 'Check your internet connection and try again — nothing you entered was lost.',
      actions: ['retry', 'back'],
      detail: raw,
    };
  }
  if (/schema|invalid json|parse|zod/i.test(raw)) {
    return {
      title: 'The AI returned an unusable layout',
      hint: 'This happens occasionally — running it again usually fixes it. Your artworks and description are kept.',
      actions: ['retry', 'back'],
      detail: raw,
    };
  }
  return {
    title: 'Generation stopped unexpectedly',
    hint: 'Try again — your artworks and description are kept.',
    actions: ['retry', 'settings', 'back'],
    detail: raw,
  };
}

// ---------------------------------------------------------------------------
// Toast — non-blocking notice (bottom center)
// ---------------------------------------------------------------------------

export interface ToastOptions {
  message: string;
  tone?: 'error' | 'success' | 'info';
  actionLabel?: string;
  onAction?: () => void;
  /** ms before auto-dismiss; errors default to sticky (0 = never). */
  duration?: number;
}

/** Singleton polite/assertive live region so screen readers announce toasts. */
function ensureToastRoot(assertive: boolean): HTMLElement {
  let root = document.getElementById('oh-toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'oh-toast-root';
    document.body.appendChild(root);
  }
  root.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
  root.setAttribute('role', assertive ? 'alert' : 'status');
  return root;
}

export function showToast(opts: ToastOptions): { dismiss: () => void } {
  const tone = opts.tone ?? 'info';
  const root = ensureToastRoot(tone === 'error');

  // One toast at a time — a newer message replaces the old one.
  root.innerHTML = '';
  const el = document.createElement('div');
  el.className = `oh-toast oh-toast--${tone}`;

  const msg = document.createElement('span');
  msg.className = 'oh-toast-msg';
  msg.textContent = opts.message;
  el.appendChild(msg);

  let timer: ReturnType<typeof setTimeout> | undefined;
  function dismiss(): void {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  if (opts.actionLabel && opts.onAction) {
    const action = document.createElement('button');
    action.className = 'oh-btn oh-btn--primary oh-toast-action';
    action.textContent = opts.actionLabel;
    action.addEventListener('click', () => { dismiss(); opts.onAction!(); });
    el.appendChild(action);
  }

  const close = document.createElement('button');
  close.className = 'oh-toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '✕';
  close.addEventListener('click', dismiss);
  el.appendChild(close);

  root.appendChild(el);

  const duration = opts.duration ?? (tone === 'error' ? 0 : 4000);
  if (duration > 0) timer = setTimeout(dismiss, duration);

  return { dismiss };
}

// ---------------------------------------------------------------------------
// Error card — blocking failure state (replaces a screen's content)
// ---------------------------------------------------------------------------

export interface ErrorCardOptions {
  title: string;
  hint: string;
  detail?: string;
  actions: { label: string; primary?: boolean; onClick: () => void }[];
}

/** Build the error card element. Caller decides where to mount it. */
export function buildErrorCard(opts: ErrorCardOptions): HTMLElement {
  const card = document.createElement('div');
  card.className = 'oh-error-card';
  card.setAttribute('role', 'alert');
  card.tabIndex = -1;

  const title = document.createElement('p');
  title.className = 'oh-error-title';
  title.textContent = opts.title;
  card.appendChild(title);

  const hint = document.createElement('p');
  hint.className = 'oh-error-hint';
  hint.textContent = opts.hint;
  card.appendChild(hint);

  const row = document.createElement('div');
  row.className = 'oh-error-actions';
  for (const a of opts.actions) {
    const btn = document.createElement('button');
    btn.className = a.primary ? 'oh-btn oh-btn--primary' : 'oh-btn';
    btn.textContent = a.label;
    btn.addEventListener('click', a.onClick);
    row.appendChild(btn);
  }
  card.appendChild(row);

  if (opts.detail) {
    const details = document.createElement('details');
    details.className = 'oh-error-detail';
    const summary = document.createElement('summary');
    summary.textContent = 'Technical details';
    details.appendChild(summary);
    const pre = document.createElement('p');
    pre.textContent = opts.detail;
    details.appendChild(pre);
    card.appendChild(details);
  }

  return card;
}

// ---------------------------------------------------------------------------
// Inline field validation — message next to the field, not a popup
// ---------------------------------------------------------------------------

/**
 * Show a validation message in an existing `.oh-field-error` element and mark
 * the offending fields. Clears automatically the first time any marked field
 * receives input.
 */
export function showFieldError(
  errorEl: HTMLElement,
  message: string,
  fields: HTMLElement[]
): void {
  errorEl.textContent = message;
  errorEl.style.display = 'block';
  for (const f of fields) f.classList.add('is-invalid');
  (fields[0] as HTMLInputElement | undefined)?.focus?.();

  const clear = () => {
    errorEl.style.display = 'none';
    for (const f of fields) {
      f.classList.remove('is-invalid');
      f.removeEventListener('input', clear);
    }
  };
  for (const f of fields) f.addEventListener('input', clear);
}
