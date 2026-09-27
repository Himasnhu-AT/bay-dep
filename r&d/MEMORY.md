# r&d central memory

**This file is the shared context for everyone working in `r&d/`, people and agents alike.** Read it
first. When you finish a unit of work, add a dated entry under **Log** (newest first) and update **State**
and **Open questions**. Keep entries short, and link to files instead of copying them.

## Handoff protocol

1. **Read** this file, then `plan.md`, then the docs your task touches.
2. **Claim** a task: add `- [ ] <task> — <who>, started <date>` under **In progress**.
3. **Write outputs to files** in `r&d/`. A chat reply is not a deliverable.
4. **Finish:** tick the task, add a Log entry (what changed, where, what's next, what you could not
   verify), and update **State**.
5. **Parallel agents** each write only their own file. The coordinator merges summaries into this file,
   because concurrent edits to one file lose work.
6. **Commit** with explicit paths only (`git add "r&d/…"`, never `-A`; see root `CLAUDE.md`).

## State (2026-09-27)

- **Branch:** `rnd/entertaining-edits` (from `main` e953244).
- **Research:** all docs are in `research/`; see the summaries below.
- **Footage:** sources verified in `sources/sample-footage.md`; nothing downloaded yet.
- **First case study:** `case-studies/redassay-attest/`, a v1 → v2 launch film made by bay's agent. The
  v2 export and a 35.7 min recording of bay doing it are in `~/Movies/`.
- **Next:** plan phases 1–2. Fetch footage for the first comparison set, and write briefs from
  `research/entertaining-editing.md` + `research/golden-ratio.md`.

## In progress

- (none)

## Research summaries

- **`research/apple-launch-style.md`** is an Apple-style tone card for launch films: black void, one
  accent, Inter 600 sentence-case headlines, expo-out easing, a push-in on every shot, 200–300% UI crops,
  a focus pull, and a 60 s structure. Followed literally it came out **too plain**, so read it together
  with the motion doc below.
- **`research/motion-graphics-launch.md`** covers:
  - What makes SaaS launch films work: a magnetic bezier cursor, Z-depth/DOF isolation, continuous
    pans, time compression, tactile SFX, exponential cut acceleration, UI within 2 s.
  - bay's exact motion capabilities: clip camera is 2D only, and 3D needs compositions.
  - The workaround: bake the camera into the footage with `tools/film.js`.
- **`research/website-comparison-plan.md`** explains how the site deploys and what `/compare` should be:
  - Deploy: Vercel Git integration; a merge to `main` goes to Production (bay.everholt.com), and a
    branch push gets a Preview.
  - Media: in git as plain files (no LFS), about 1 MB per clip today.
  - Page: generalise the existing `BeforeAfter.tsx` and add `/compare`.
- **`research/github-repos.md`**: pending (parallel agent).
- **`research/entertaining-editing.md`**: pending (parallel agent).
- **`research/golden-ratio.md`**: pending (parallel agent).

## Decisions

- 2026-09-27: The product in the first case study is **RedAssay Attest**. RedAssay is the company (an
  AI pentest agent is its main product). "Attest" fits because a SOC 2 report is an attestation. Runner-up
  name: Touchstone.
- 2026-09-27: The comparison page route is `/compare` (VOICE.md: a one-word lowercase slug).
- 2026-09-27: **Media policy.** Raw and working media live outside git in `~/Movies/bay-rnd/<slug>/`.
  Only final web encodes go in `website/public/compare/<slug>/`: AV1 + H.264, 720p, ≤ 8 MB each.
- 2026-09-27: **Golden ratio.** The owner wants φ applied "in everything". It is applied as a style spec
  (proportions, type scale, timing ladders), and the research doc records honestly what the evidence
  does and doesn't support.

## Open questions

- Publishing the RedAssay Attest footage on bay's site needs the RedAssay owner's OK.
- The Vercel bandwidth plan is unknown, and it decides 720p vs 1080p on `/compare`.
- Music licence for the Attest film: the ende.app track came bundled with brag, and its terms are
  unverified. Replace it before publishing.

## Log

- **2026-09-27** (coordinator):
  - Created `r&d/` on `rnd/entertaining-edits`.
  - Saved the footage sources, the Apple and motion research, the recording tools, and the Attest case
    study (prompts, lessons, marks).
  - Launched 4 parallel researchers (GitHub repos, retention-editing blogs, golden ratio, website/deploy).
    The website plan is saved; the other three are pending.
