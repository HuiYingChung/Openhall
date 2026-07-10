# Codex handoff — Claude main-branch review comparison

**Date:** 2026-07-10

**Working branch:** `final-debug-hardening`

**Product-code head:** `5546873` (`fix: close final debug hardening gaps`)

**Prior session-log commit:** `9ac56ea` (`docs: record Codex final debug takeover`)

## Stop point

Today's product work is complete and verified. No product source was changed after the final debug takeover commit. This handoff records the later comparison discussion so tomorrow's session can continue without redoing the audit.

The working tree was clean before this documentation-only handoff. IBM Bob, Chromium test sessions, and the local Vite server were not running. Nothing was pushed, merged, or deployed; `main` and `origin/main` remained at `71d33ed`.

## Completed today

- Took over IBM Bob's Prompt 11 work on `final-debug-hardening` without touching `main`.
- Audited all six Bob hardening sections and added missing integration fixes.
- Fixed review identity rollback, misleading cache/cost state, cache-key ambiguity, Web Crypto fallback, favicon/display URL lifecycle, duplicate artist waypoints, and destructive demo round-trips.
- Added 16 regression tests over Bob's result.
- Final verification: 26 test files and 402/402 tests, lint clean, application/test/worker TypeScript clean, production builds clean, real exported-bundle Chromium smoke test clean.
- Ran local browser checks with a generated 4100×2100 image: bounded 2048×1049 display copy, correct two-click paid-call guard, URL revocation, same-file re-upload, demo re-entry, and upload → demo → Back preservation with zero errors in the clean browser run.
- Created `docs/codex-sessions/` and committed the full takeover record.

## Claude review baseline clarification

The creator confirmed that Claude Code reviewed `main`, not `final-debug-hardening`. Therefore the report is a useful baseline audit but is not a report against the current branch.

Items already resolved on the current branch and not to be reimplemented:

- #1 duplicate artwork IDs and incomplete AI cache identity;
- #2 demo overwriting the user's gallery/draft;
- #6 incomplete label batches silently shipping fallback labels;
- #7 Watsonx token cache not bound to credentials;
- #10a `scene.environment` texture leak.

Items that still require current-branch evidence tomorrow:

- #3 worker origin handling and the public-worker deployment model;
- #4 unescaped exported-viewer boot error;
- #5 unescaped upload brief inside the textarea;
- #8 title-generation fallback swallowing transport/auth failures;
- #9 tour/inspect/pointer-lock behavior in the exported viewer versus the live app;
- #10b per-frame scene traversal/allocation cost;
- dead `applyGeneratingResult`, `save-work.cmd`, lint enforcement, README layout claim;
- schema-valid geometry extremes, OpenAI truncation handling, and damaged-settings handling.

## Important interpretation notes

- Rejecting a disallowed HTTP `Origin` is useful browser-side defense-in-depth, but it is not authentication: a non-browser client can omit or forge `Origin`. The worker deployment topology must be understood before changing this behavior.
- AGENTS.md deliberately permits a plain-text exhibition title with a fallback. The likely correct fix for #8 is to retain fallback for an empty/invalid successful response while allowing 401, network, and other transport failures to surface.
- The live app already closes interactions before starting a tour. Claude's #9 points at `viewer-entry.ts`, so the exported runtime must be checked separately rather than assuming the app fix covers it.
- The Watsonx “no tests” statement is stale on the current branch; six token/cache/401 tests now exist. OpenAI `finish_reason` handling may still be a valid independent gap.
- Geometry and hover-performance claims should be reproduced or measured before implementation; do not refactor from static suspicion alone.

## Tomorrow's read-only audit plan

1. Confirm clean branch/head and compare each Claude location against current code rather than old line numbers.
2. Produce one evidence row per finding: current call site, current test coverage, status (`fixed`, `partial`, `present`, or `stale`), actual severity, and recommendation.
3. Check the judge-facing paths first: exported viewer error rendering, brief rendering, exported tour start, title error propagation, then worker deployment behavior.
4. Exercise schema-valid geometry edge cases and profile the hover path only after the correctness/security pass.
5. Review process/documentation items last.
6. Deliver the evidence report before changing code. Wait for creator approval on the resulting fix list, then use one focused fix and test per commit.

## Boundaries for continuation

- Do not switch branches while another agent is active.
- Do not push, merge, deploy, or publish.
- Do not call a paid Watsonx/OpenAI provider during the audit.
- Preserve the solo-project provenance: AI systems are collaboration tools, not additional human team members.
