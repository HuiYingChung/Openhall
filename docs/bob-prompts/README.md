# Bob prompts

Numbered work orders written by the team (with Claude as reviewer/planner) and
executed by IBM Bob in fresh sessions. Each prompt pairs with a session log in
`docs/bob-sessions/`. Kept as submission evidence of the Bob-driven workflow.

| Prompt | Scope |
| --- | --- |
| BOB_PROMPT_01 | Week 1 — scaffold, gallery.json schema freeze, procedural rooms, WASD controls |
| BOB_PROMPT_02 | Week 1 fixes from Claude's test report |
| BOB_PROMPT_03 | Week 2 — AI pipeline (vision analysis → curation → gallery build) |
| BOB_PROMPT_03B | E2E env plumbing (.env pre-fill, dev settings) |
| BOB_PROMPT_03C | CORS token/ML proxy worker |
| BOB_PROMPT_03D | Deterministic gallery-assembler (LLM writes labels only) |
| BOB_PROMPT_03E | Viewer entry fix |
| BOB_PROMPT_04 | Week 3 — artwork interactions + export bundle |
| BOB_PROMPT_05 | Export chain fixes (aspect-ratio round-trip, viewer.js packaging, …) |
| BOB_PROMPT_06 | Demo gallery — 8 Met CC0 impressionist works (see `src/demo/SOURCES.md`) |
| BOB_PROMPT_06B | Esc-relock listener re-arm fix |
| BOB_PROMPT_06C | Tour button/overlay UI-state fixes |
| BOB_PROMPT_06D | Keyboard-activated click guard |
| BOB_PROMPT_07 | Polish — exit-to-menu funnel, export staleness guard, SVG icons |
| BOB_PROMPT_08 | Polish — Esc hint, Settings cancel, labels back button (last session on the first trial account) |
| BOB_PROMPT_09 | AI voice narration for tour mode (speechSynthesis, AI-written docent text) |
| BOB_PROMPT_09B | Voice tour fixes — speech-aware autoplay dwell, replay via Play at tour end |
| BOB_PROMPT_09C | Voice tour UX — default off, Pause freezes speech, instant Voice toggle, docent-framed artist intro |

After the first Bob trial account's credits ran out (mid BOB_PROMPT_08 era),
interim polish was implemented directly by Claude — see `docs/claude-sessions/`.
BOB_PROMPT_09 onward runs on a fresh trial account (the officially suggested
path when free credits are exhausted).
