# Openhall — 4-Week Roadmap (July 2026)

July challenge deadline: **July 31, 2026 at 11:59 PM ET** ([official challenge page](https://aibuilderschallenge-bob.bemyapp.com/)). Status snapshot: **July 10, 2026**.

Checkboxes describe the current, evidence-backed state of the repository. They are not the untouched original schedule.

## Release blockers

- [ ] Make the GitHub repository public.
- [ ] Publish a hosted, keyless demo and add its link near the top of the README.
- [ ] Add one strong screenshot or short GIF to the README.
- [ ] Record the submission video.
- [ ] Complete the required IBM SkillsBuild activity and re-check the official submission rules.

## Week 1 (Jul 6–12) — Foundation and hardening

Goal: establish the complete technical foundation and verify the critical paths.

- [x] Vite + TypeScript + Three.js repository with linting and tests.
- [x] IBM Bob/BobShell work orders and committed session evidence.
- [x] Zod schemas for `gallery.json` and transient AI outputs.
- [x] Procedural rooms, artwork placement, lighting, and materials.
- [x] Pointer Lock WASD controls, mouse-look, AABB wall collision, and controls overlay.
- [x] Upload preprocessing and metadata editing for up to 10 works.
- [x] BYOK settings, watsonx provider, OpenAI-compatible provider, and localStorage cleanup.
- [x] Stateless Cloudflare relay for watsonx IAM and ML browser requests.
- [x] Deterministic room chain, doorway-aware tour routing, and placement sanity.
- [x] Real export integration test and headless Chromium smoke test.
- [x] Credential-sentinel export test and external-network request guard.

**Milestone reached:** the repository contains a feature-complete, automated-test-covered MVP implementation. Fresh live-provider runs, external artist testing, device/browser checks, and manual publishing remain release-validation work.

## Week 2 (Jul 13–19) — Real provider and artist testing

Goal: validate the finished pipeline outside the developer's existing setup.

- [ ] Run a fresh 1–10 artwork watsonx generation with current paid credentials.
- [ ] Run the OpenAI-compatible route with a current vision-capable model.
- [ ] Test malformed-output retry and friendly failure UX against a live provider.
- [ ] Ask at least two artists or art students to complete the flow without coaching.
- [ ] Fix only reproducible onboarding or gallery-blocking issues found in those sessions.
- [ ] Manually publish the current export through Netlify Drop and GitHub Pages.

**Milestone:** a new user can generate and publish a personal gallery without developer intervention.

## Week 3 (Jul 20–26) — Judge-facing packaging

Goal: make the project understandable and usable within the first minute.

- [x] README problem, solution, architecture, setup, security, limitations, and Bob story.
- [x] Current PRODUCT_PLAN, ROADMAP, and AGENTS architecture agree with the implementation.
- [ ] Make the repository public and confirm all README/CI links work while signed out.
- [ ] Deploy the Openhall app with demo mode as the default judge path.
- [ ] Add a top-fold screenshot or GIF and a clear **Try demo** link.
- [ ] Run Chrome and Edge desktop smoke tests.
- [ ] Run iOS Safari and Android Chrome tour/export smoke tests.
- [ ] Perform a final accessibility and keyboard pass.

**Milestone:** a judge can understand the value, open the demo, walk the gallery, and inspect evidence without cloning the repository.

## Week 4 (Jul 27–31) — Submission

Goal: submit before the final day.

- [ ] Complete the required IBM SkillsBuild Bob learning activity and retain the team's completion evidence.
- [ ] Record a public demo video of up to three minutes: problem → generation evidence → walkthrough → export → ownership.
- [ ] Verify no credentials, private URLs, uploaded user images, or generated zips are tracked.
- [ ] Confirm the latest CI run is green on the public repository.
- [ ] Complete the project description and all platform submission fields.
- [ ] Re-read the official rules for video length, licensing, IBM technology, and team requirements.
- [ ] Submit by July 29–30, leaving one day of buffer.

## MVP scope guard

Do not add accounts, hosted persistence, multiplayer, VR/WebXR, video or imported 3D artworks, payments, managed public AI usage, or one-click deployment APIs before submission. The non-negotiable pitch remains:

1. Live BYOK generation from the artist's artworks.
2. A walkable and guided 3D exhibition.
3. A self-contained export the artist owns.
4. A keyless prebuilt demo for judges.

## Submission checklist

- [ ] Public GitHub repository
- [ ] Hosted keyless demo
- [ ] README screenshot/GIF and demo link
- [ ] Demo video
- [ ] SkillsBuild completion
- [ ] Project description and team registration
- [ ] Final rules review
- [ ] Green CI on the submitted commit
