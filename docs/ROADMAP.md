# Openhall — 4-Week Roadmap (July 2026)

Deadline: **July 31** (submission). Today: July 5. Working weeks below.

## Week 1 (Jul 6–12) — Foundation & walkable room

Goal: walk around a hardcoded room with hardcoded artworks.

- [ ] Repo setup: Vite + TS + Three.js, ESLint/Prettier, GitHub repo public
- [ ] Install & configure IBM Bob / BobShell; commit first Bob session log
- [ ] **Freeze `gallery.json` schema** (rooms, walls, placements, lighting, labels, tour waypoints) — everything depends on this
- [ ] Procedural room builder: walls/floor/ceiling from parameters, artwork planes from placements
- [ ] PointerLockControls: WASD + mouse-look, AABB wall collision
- [ ] Controls hint overlay
- [ ] Sign up for watsonx.ai trial; verify Granite Vision + LLM API calls work (curl/Postman)

**Milestone:** demo-able walkthrough of one hardcoded gallery.

## Week 2 (Jul 13–19) — AI pipeline

Goal: upload images → AI produces a real gallery.json.

- [ ] Upload UI + client-side resize/compress (max 10 works)
- [ ] BYOK settings screen (localStorage), provider abstraction (watsonx + OpenAI-compatible)
- [ ] Token-exchange serverless worker for watsonx IAM (only if browser-direct fails)
- [ ] Vision analysis prompt → per-work JSON (style, palette, subject, mood)
- [ ] Curation prompt → grouping, ordering, wall assignment, tour path
- [ ] Text-to-gallery prompt → validated gallery parameter JSON; 4 style presets
- [ ] Wall label generation, editable in UI
- [ ] JSON schema validation + retry-on-invalid for all LLM outputs

**Milestone:** end-to-end: upload 10 images + one sentence → walkable AI-generated gallery.

## Week 3 (Jul 20–26) — Interaction, export, polish

Goal: feature-complete MVP.

- [ ] Raycast hover-highlight + click → info panel + camera dolly to viewing position
- [ ] Tour mode (waypoint navigation); touch/mobile fallback
- [ ] Export: JSZip bundle (viewer + gallery.json + images), test on Netlify Drop & GitHub Pages
- [ ] Demo mode: bundled sample artworks + pre-generated gallery.json
- [ ] Visual polish: lighting quality, frames, materials, loading states
- [ ] Deploy hosted instance (GitHub Pages / Vercel)
- [ ] Cross-browser + mobile smoke test

**Milestone:** a stranger can go from images to a published gallery without help.

## Week 4 (Jul 27–31) — Submission

Goal: submit early, not at 11:59pm.

- [ ] Each team member completes ≥1 IBM SkillsBuild Bob learning activity (**required**) — do this early in the week
- [ ] README: problem, solution, architecture diagram, screenshots, setup, Bob usage story
- [ ] Demo video (usually ~3 min — check official rules): hook → live text-to-gallery generation → walkthrough → export → "owned by artists" close
- [ ] Clean commit history; ensure BobShell logs/evidence in repo
- [ ] Submission form on platform: repo link, video, descriptions
- [ ] Buffer for bugs (aim to submit Jul 29–30)

## Cut list (if behind schedule, cut in this order)

1. Camera dolly on click (keep plain info panel)
2. OpenAI-compatible fallback provider (watsonx only)
3. Mobile tour mode (desktop-only MVP)
4. Editable labels (accept AI output as-is)

**Never cut:** text-to-gallery live generation, WASD walkthrough, export. These are the pitch.

## Submission checklist (verify against official rules)

- [ ] Public GitHub repo
- [ ] Demo video
- [ ] SkillsBuild activity completion per member
- [ ] Project description on platform
- [ ] Team registered before deadline
- [ ] Re-read official rules PDF for anything missed: video length, license requirements, IBM tech requirements
