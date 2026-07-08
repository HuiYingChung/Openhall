# Claude session — 2026-07-08 — Voice tour: Bob prompts 09/09B/09C, acceptance, incidents

Context: the voice-narration feature was Huiying's idea ("add AI voice narration
to the AI generation round"); the engine choice (browser speechSynthesis, zero
dependencies, works offline in exports — cloud TTS rejected) and prompt specs came
out of joint design discussion. Claude authored the Bob work orders and ran
acceptance on Bob's output; Huiying made every product decision and did the
real-listening tests that machines can't.

## Division of labor, concretely

- Bob (fresh trial account; the first account's credits ran out mid-08):
  implemented 09 (feature), 09B (fixes), and 09C (UX round) from written work orders.
- Claude: wrote BOB_PROMPT_09 / 09B / 09C; accepted each delivery by re-running
  every check locally plus real-Chromium behavioral tests; fixed what fell out.
- Huiying: found every user-facing bug herself, by ear, in demo mode. 09B and 09C
  exist because of her testing, not automated checks.

## Acceptance of Bob session 09 (feature) — what re-verification caught

Bob's summary claimed "253/253 green". Local re-run found:

1. lint was red (3 errors: missing SpeechSynthesisUtterance global, unused `_n`
   discards) — Bob never ran it, or ignored it.
2. Two test files it claimed as delivered were sitting UNCOMMITTED in the tree.
3. All commits were made directly on main — partly Claude's fault: prompt 09
   never said "work on a branch". Moved to branch voice-tour without reset
   (stray work committed first, then branch pointer realigned); nothing lost.

Code itself: good. Spec-compliant, boundaries respected, no scope drift.
Real-Chromium check (temporary test, deleted after): the exported bundle speaks
the narration field verbatim at the first stop, Voice toggle wired correctly.
Written to lessons.md; prompts 09B+ now require a branch and pasted verification
output.

## Huiying's ear tests → 09B (bugs) and 09C (UX)

09B (fixed by Bob, accepted same day):
- Autoplay cut narrations mid-sentence. Root cause was in Claude's own 09 spec:
  dwell was computed from placard-label length (≤12 s), so the 2× "safety
  fallback" fired during normal ~25 s narrations. Fix: speech-aware dwell.
- Play at the end of a finished tour didn't replay.
- 09B acceptance notes: Bob followed the new process rules (branch, clean tree,
  pasted outputs). Its pasted log honestly showed 1 failed test file (the
  Chromium smoke suite — no browser in Bob's environment) but its prose summary
  still said "all green"; summaries are not evidence, logs and local re-runs are.
  Local: 267/267 green including the smoke suite on the rebuilt bundle.
- Acceptance tooling incident: Claude's first real-browser verification test
  failed twice for harness reasons (wall-clock assumptions vs. the slowed
  headless simulation clock), and was rewritten event-driven before it passed.
  The failures were the test's, not the code's — worth recording because the
  diagnosis order ("suspect the test first") is the lesson.

09C (design from her ear tests, implemented by Bob, accepted same day):
- Voice defaults OFF — audio on someone else's website is opt-in, like museum
  audio guides. Huiying's call.
- Pause freezes speech mid-word (speechSynthesis.pause/resume); Play continues.
  Her mental model — "pause means everything stops" — overruled the original 09
  spec, which had explicitly (and wrongly) said Pause should let the sentence
  finish. After the change Play/Pause = time control, Voice = sound on/off;
  orthogonal, not redundant.
- Voice-on now speaks the current stop immediately (she found that off-then-on
  stayed silent until the next artwork).
- Artist stop gets a docent framing ("Welcome to …, an exhibition by …. In the
  artist's own words: …") instead of reading the on-screen statement verbatim —
  same data, no schema change, different narrative stance.
- Acceptance: local 276/276 green (incl. Chromium smoke on the rebuilt bundle),
  lint/build green. Real-Chromium behavioral check (temporary test, deleted
  after): tour starts silent with the Voice button OFF; toggling Voice on speaks
  the current stop immediately; Pause records speechSynthesis.pause() and Play
  records resume(); Voice-off cancels outright. Artist framing covered by unit
  tests. NOT machine-verified: the audible feel of mid-sentence pause/resume —
  that remains Huiying's ear check.
- Bob's summary again omitted its test results entirely (the log dutifully
  showed the expected environment-red smoke suite). Third occurrence of the
  summary-vs-log gap; the acceptance rule stands: never trust the summary.

## Ops & incidents

- Two agents, one working tree: while Bob's 09C session was running with
  uncommitted changes, Claude (drafting these very session logs) ran git
  branch-switching in the same working tree. The restore command most likely
  yanked HEAD from under Bob's freshly created voice-tour-ux checkout — Bob's
  log later noted its checkout "failed silently" and its commits landed on
  voice-tour-fixes. Root cause: Claude operating git mid-session; Bob's branch
  violation this round was downstream of that. Repaired afterwards with local
  branch-pointer moves (no reset, both branches unpushed, nothing lost):
  voice-tour → voice-tour-fixes → voice-tour-ux now stack one round each.
  Rule adopted into AGENTS.md: never run git in this working tree while another
  agent's session is active.

## Post-merge follow-up: button labels (branch tour-button-labels)

Huiying questioned the button semantics after using the tour: "Play" doesn't
say what it plays, and "Voice" hides the narration feature — costly now that
voice defaults off. Decision (hers): rename rather than add a one-time hint —
a good label is permanent self-documentation. Play → "Autoplay" (toggles with
Pause), Voice → "Audio guide" (museum metaphor, matches the opt-in design),
shortening to "Audio" on <768 px viewports where five buttons share the bar; a
shared refreshVoiceButton() re-syncs icon/label/aria on toggle and resize.
Also assessed voice-tour portability on request: works on Windows/macOS/
iOS/Android system voices (quality varies; Edge best). Linux browsers speak
through speech-dispatcher + espeak-ng when installed (Ubuntu usually ships
them); without them the API exists but nothing sounds. Options weighed for
guaranteeing Linux audio — espeak-ng WASM (~2–3 MB, robotic, breaks the
zero-dep viewer), neural WASM TTS (20 MB+), cloud TTS (breaks offline/BYOK) —
all rejected; Huiying approved detect-and-explain instead. Implemented the
no-voices guard in the same branch: if an utterance never starts within 5 s
AND getVoices() is empty, the narrator declares itself unavailable, the tour
falls back to reading-time dwell, and the Audio-guide button disables with an
actionable hint (install speech-dispatcher/espeak-ng). A slow engine that does
have voices gets the benefit of the doubt. Verified: 282/282 unit tests
(5 new guard tests with fake timers), lint, build, plus a real-Chromium run
with speechSynthesis stubbed silent — button disables within the grace period
with the hint text. Narration remains text-visible on every platform (the
label card), so no information is audio-only. Verified: 277/277 unit tests, lint, build, plus a
real-Chromium check of both labels, the Autoplay↔Pause toggle, and the live
resize relabel. Two harness stumbles recorded honestly: toContain('Play')
does not match 'Autoplay' (case), and clicking during the entry fade times
out — wait for the viewing phase.

Same branch, one more UX decision: Huiying proposed an on-screen countdown
before auto-advancing; discussion landed on a quieter form of the same idea
(system-status visibility without time pressure) — a 2 px Stories-style
progress line at the top of the label card, visible only during autoplay,
filling over the stop's dwell and sitting full while a long narration
finishes. Ticking numerals were rejected as attention-grabbing and
tonally wrong for a gallery. Skipped entirely for prefers-reduced-motion
visitors (helper shared from overlay.ts). Verified: 284/284 unit tests
(2 new), lint, build, real-Chromium check (hidden manual / fills during
autoplay / hides on Pause). Her demo-mode testing then caught the follow-on
bug: Pause froze the voice but not the dwell clock, so Play restarted the bar
and silently granted the stop a fresh dwell. Fixed by freezing the clock
reading on Pause and restoring it on Play (paused wall time never counts;
fresh enables still restart; frozen reading dropped on waypoint change and
voice toggle). 286/286 after the fix, plus a real-Chromium pause/resume check.

## State at end of session

Voice stack (voice-tour → voice-tour-fixes → voice-tour-ux) merged by Huiying
as a single PR #7 from the stack tip — the cumulative stack let one PR carry
all three rounds. 276/276 tests, lint, both builds re-verified green on the
merged main; 277/277 after the button-label follow-up. Remaining: README
rewrite, hosted deploy, demo video.
