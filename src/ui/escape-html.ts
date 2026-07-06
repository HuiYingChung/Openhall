/**
 * escape-html.ts — Shared escapeHtml utility.
 * Escapes user/LLM text for safe injection into innerHTML attributes.
 * Extracted so it can be imported without pulling in the full bundler module.
 */

/** Escape user/LLM text for safe HTML injection. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}
