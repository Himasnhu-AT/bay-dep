# Plan: entertaining edits → website comparisons → deploy

Goal: show what bay's agent can do by publishing **before/after pairs**: raw footage beside bay's edit,
with the exact prompt and the tools that ran. Every edit should follow the retention rules in
`research/entertaining-editing.md` and the φ spec in `research/golden-ratio.md`.

## Phases

| # | Phase | Output | Status |
|---|---|---|---|
| 0 | Research | `research/*.md` | done (2026-09-27); see MEMORY.md for summaries |
| 1 | Pick and fetch footage | `clips/<slug>/SOURCE.md` (URL, licence, credit, local path); media in `~/Movies/bay-rnd/<slug>/raw/` | next |
| 2 | Write briefs | `clips/<slug>/brief.md`: the paste-able bay prompt, built from the checklist + φ spec | next |
| 3 | Edit in bay | bay project + export in `~/Movies/bay-rnd/<slug>/`; `clips/<slug>/RESULT.md`: what the agent did, its report, issues, tool log | — |
| 4 | Review | frame grid + listen; score against the checklist; iterate once | — |
| 5 | Website `/compare` | generic `BeforeAfter`, `src/lib/comparisons.ts`, `src/app/compare/page.tsx`, encoded media in `website/public/compare/<slug>/` | — (plan in `research/website-comparison-plan.md`) |
| 6 | Deploy | branch push → Vercel Preview → PR into `main` → Production. **The owner merges.** | — |

## First comparison set (proposed)

One pair per capability, so the page proves breadth.

| Slug | Footage (see `sources/sample-footage.md`) | Edit | bay tools on show |
|---|---|---|---|
| `talk-to-short` | FOSDEM talk (≈10 min) | 45 s vertical short: hook, cuts, word subtitles, zooms, graphics band | transcribe, remove_range, set_canvas, add_subtitles, write_brf, edit_item keyframes |
| `interview-cleanup` | NASA Artemis II interview | Best take per question, pauses out, B-roll cutaways | transcribe, remove_range, search_footage, place_asset |
| `broll-to-story` | Pexels Basel Apple Log set | 30 s city film on the beat, graded | index/search_footage, detect_beats, grade + LUT, transitions |
| `beat-cut` | Mixkit action clips + track | 20 s beat-synced cut | detect_beats, split/trim, add_transition |
| `launch-film` | our Attest takes | v1 → v2 launch film (not raw → edit, but plain brief → researched brief) | the whole pipeline |

## Rules

- **Only real runs.** Every "after" is a real bay export. Keep the `.bay`, the agent transcript and the
  tool log (website policy: nothing may claim behaviour bay doesn't have).
- **Keep licences.** Credits go in `clips/<slug>/SOURCE.md` and later in `website/CREDITS.md`; share-alike
  sources make the edit share-alike.
- **Keep media out of git**, except the final web encodes (≤ 8 MB each, AV1 + H.264, 720p).
