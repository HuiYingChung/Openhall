# Claude session — 2026-07-08 — CI workflow

Context: rational end-of-day review found `.github/workflows/` empty — 311
tests with no independent verification a judge can see. Huiying asked what CI
is, approved after the explanation. One deliverable: a GitHub Actions workflow
running the exact chain used locally all day.

## What was added

`.github/workflows/ci.yml` — on push to main and on PRs: Node 20, `npm ci`,
Playwright Chromium (`--with-deps`), `npm run build` FIRST (a fresh clone has
no pre-built viewer.js and the smoke tests boot the real bundle), `npm test`,
`npm run lint`.

## Verification

GitHub Actions can't run locally, so the fresh-clone path was rehearsed
instead: cloned the branch to a scratch directory, `npm ci` from the lockfile,
build, test, lint — 311/311 and lint clean on the clean copy. Honest limit:
the rehearsal ran on Windows; the ubuntu runner is proven by the first real
run on GitHub after push — watch the Actions tab on the PR.

README badge intentionally NOT added here — the README has its own scheduled
rewrite; the badge goes in then
(`![CI](https://github.com/HuiYingChung/Openhall/actions/workflows/ci.yml/badge.svg)`).

## Also worth recording (same evening, chat review)

The four-question self-audit that led here: product complete per the AGENTS.md
definition of done; experience polished but tested by exactly one user (a
one-hour zero-guidance session with a real artist remains the highest-value
open check); AI's role is strongest argued by where it ISN'T used (deterministic
geometry born from the PR #2 failure); the submission package — deploy, video,
SkillsBuild — is what stands between the project and the judges seeing it.
