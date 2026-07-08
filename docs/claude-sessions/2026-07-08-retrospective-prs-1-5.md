# Retrospective index — PRs #1–#5 (compiled 2026-07-08 from git/PR history)

Honesty note: this file was written AFTER the fact, on 2026-07-08, by walking the
merge history. It is an index, not a reconstruction of session-by-session detail —
the commits and PRs themselves are the primary evidence. Real-time logs exist from
2026-07-06 (`2026-07-06-polish-decor-lighting-ux.md`) and 2026-07-08 onward; the
sessions that produced PRs #1–#5 were not logged as they happened, which is why
this index exists. Process fixed the same day: AGENTS.md now requires a session
log from any AI agent whose session changes the repo.

Working pattern for all five PRs: Claude implemented on a branch and committed
without pushing; Huiying reviewed, pushed, and merged each PR on GitHub herself.
Design and copy decisions hers throughout.

## PR #1 — polish-round-2 (merge 1da3419)

App-chrome polish round: design tokens + component classes; alert()/confirm()
replaced with in-app feedback (toast, error card, field errors); export loop
closed (PUBLISH.md in every zip, post-download success panel); tour autoplay +
fade-through-black on tour exit; generation screen showing the AI's curatorial
decisions in three acts; Netlify Drop copy corrected (requires a free account).

## PR #2 — provider-route-fixes (merge 43026e5)

The OpenAI-compatible route was producing different (worse) geometry than the
watsonx route. Fix: both providers now share the deterministic
composeGalleryFromPlan pipeline — the LLM writes titles/labels only, geometry is
assembled deterministically. Also: provider switch invalidates the regeneration
cache (cache fingerprint includes provider+model); settings hint that the
OpenAI-compatible model must support vision.

## PR #3 — polish-round-3 (merge 5fc4971)

Review screen embeds the floor plan while editing labels; the AI curator's note
survives into the review screen and site meta (and becomes the default site
description); entry overlay leads with the exhibition identity, not the tool.

## PR #4 — feel-pass (merge ea13903)

Feel pass: entry fade, demo loading state, prefers-reduced-motion support, tour
arrow keys, export zip named after the exhibition title slug; entry overlay
fixes (previews the gallery instead of a leftover setup form; × became a
labelled back button).

## PR #5 — polish-tails (merge ad60a30)

Copy and identity tails: home intro explains who does what and why a key is
needed; the unsubstantiated "free" claim dropped and the Settings mention made a
real link; Fraunces as the display face for wordmark and headings (app chrome
only — exports stay on system faces); passive "Demo gallery" chip inside the
demo viewer.
