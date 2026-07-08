# Claude session — 2026-07-08 — Repo cleanup + real E2E safety net for the export chain

Context: pre-flight before the next Bob round. Huiying asked for a file-structure
cleanup, then approved replacing the simulated export verification with tests
that exercise the real code path. All decisions hers; Claude implemented and
verified. Merged as PR #6.

## Repo cleanup (commit ef4d4f9, direct on main — before the branch rule existed)

- Deleted 4 stale files left by the earlier docs reorg: root PRODUCT_PLAN.md and
  ROADMAP.md (byte-identical copies of the canonical docs/ versions), the old
  docs/WEEK1_TEST_REPORT.md duplicate, and the finished one-shot organize-docs.cmd.
  Every deletion was diff-verified as a byte-identical duplicate first.
- AGENTS.md references updated to the docs/ paths. .gitignore audited: no gaps,
  nothing tracked that should be ignored, .env never committed.

## Why the E2E work happened

Two honest findings, not new ideas:

1. The Week 3 report already documented that all export-chain failures lived in
   the fetch/integration layer that unit tests mock away.
2. `scripts/verify-export.mjs` — written to close that gap — actually re-implemented
   the zip packaging instead of calling the real `buildExportBundle` (it couldn't
   import TypeScript). It verified a parallel copy that could drift and stay green.
   It also never opened a browser. Huiying's manual Netlify Drop test was the only
   real end-to-end evidence, and it expires with every code change.

## What was built (PR #6, branch e2e-export-safety-net)

- `tests/export-harness.ts` — serves public/ (real pre-built viewer.js + real demo
  images) over local HTTP and runs the REAL `buildExportBundle` against it, zero mocks.
  Kept out of src/ so viewer code stays free of Node types (that guardrail is the
  reason src/ has no Node typings).
- `tests/export-chain.integration.test.ts` (7 tests) — zip viewer.js byte-identical
  to the build output; gallery.json re-validated with the production zod schema;
  every imagePath resolves inside the zip; images byte-for-byte intact; every
  index.html reference resolves; PUBLISH.md present; the AGENTS.md "<5 MB excluding
  artwork" budget enforced as an assertion.
- `tests/export-viewer.smoke.test.ts` (4 tests) — unzips the real bundle and boots
  it in headless Chromium (Playwright): canvas renders, entry overlay shows the
  exhibition title, zero 404s inside the bundle, zero console/page errors. This is
  the manual "unzip → serve → open" check, automated into every `npm test`.
- The test was tested: sabotaging viewer.js with an injected `throw` turned the
  suite red (pageerror assertion), then green again after rebuild. Not a
  decorative always-green check.
- `scripts/verify-export.mjs` retired (git rm; history keeps it). Historical
  references to it in docs/bob-prompts/ and docs/bob-sessions/ left untouched —
  they record what was true at the time.
- Drive-by fixes, separate commits: a `no-useless-escape` in bundler.test.ts that
  was silently weakening the backslash-stripping assertion, and the missing
  HTMLImageElement eslint global.

New devDependencies: playwright, @types/node (tests/ only). Suite: 228 → 239 tests.

## Honest limits

- The smoke test proves the exported bundle boots and renders; it does not walk
  the gallery (pointer lock is unreliable headless). Walkthrough feel remains a
  human check.
- Headless software rendering runs the tour's simulation clock several times
  slower than wall time (frame delta is capped at 0.05 s) — discovered later the
  same day; timing-sensitive assertions in headless tests must be event-driven.

## State at end of session

PR #6 merged by Huiying (with the earlier missed main push folded in). 239/239
tests, lint, both builds green on main.
