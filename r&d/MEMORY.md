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
- **Research:** complete. Six docs in `research/`; see the summaries below.
- **Footage:** sources verified in `sources/sample-footage.md`; nothing downloaded yet.
- **First case study:** `case-studies/redassay-attest/`, a v1 → v2 launch film made by bay's agent. The
  v2 export and a 35.7 min recording of bay doing it are in `~/Movies/`.
- **Next:** plan phases 1–2. Fetch footage for the first comparison set, and write briefs from
  `research/entertaining-editing.md` + `research/golden-ratio.md`.

## In progress

(2026-09-28)
- [x] podclip audit → `research/podclip.md` + audit §8 (usable with corrections: refuse single-camera switching; don't compare search_footage scores; onset-to-cut 0.30 s; early cut 0.10 s).
- [x] three.js research → `research/threejs.md` + audit §9. It confirmed the `.brf` worker could reach the GPU; fixed in 734dccf (OffscreenCanvas removed, mutation-proven).
- [x] Layout modes "Resolve" | "AI" (⌘⇧A, top-bar switch), merged 39d3be0 after review fixes (e2ce94a). Verified in the app: one viewer canvas across switches, the timeline drawer, Escape, the draft surviving a switch, the viewer drawing (mean RGB 73.6 at 3 s).
- [x] Podcast tools, merged 6d341db after review fixes (set_item_enabled, remove_silences, switch_speakers, level_voices, sync_angles, detect_footage_mode, `podcast` skill, @shared/footage-mode). Branch `worktree-agent-a2ad3d827cca8c94a`. Review fixes in progress: re-check the timeline after analysis, the J/L stand-in for switched sound, detach refusals, and palette buttons in the AI layout.
- [x] 3D text `<scene3d>/<text3d>` in `.brf`, merged 97f5662; `test/app/scene3d.mjs` passes 12/12 in the app (three + opentype.js + Inter, rendered by the engine; the worker stays GPU-free). Branch `worktree-agent-a6a5b05b656fa532b`. Review fixes in progress: probe glyphs in write_brf, unit geometry + scale, forceContextLoss. The in-app probe is `test/app/scene3d.mjs`.
- [ ] Masking (text behind the subject): masking-researcher → `research/masking.md`, then the auditor. Model licences: MODNet, BiRefNet, BEN2, MediaPipe and SAM2/EdgeTAM are OK; RVM, RMBG and MatAnyone are excluded.
- [ ] Informative raw clips → `sources/informative-clips.md` (agent running).
- [x] News explainer ready on /compare (addc160): 44.9 s, graphics timed to her words, mastered −14.1 LUFS. The before was built from the project file's spans. The push was denied, so the owner pushes `rnd/entertaining-edits` for the Vercel Preview.
- [x] AI layout's empty chat now shows the footage palette (44ee50c, verified in the app). The Changes card names rewritten motion graphics (a2144da).
- [x] Export loudness memory merged 3cbb65d. Verified live over MCP: mastered → remembered on the next call (−14.3 by independent ffmpeg); "off" → −34.3 LUFS with a warning naming the fix.
- [x] Composition guides without remote GSAP; write_composition refuses a remote script (9980a4f). GSAP not shipped: licence clause on visual animation tools.
- [x] Masking merged (b9a851f, 75e34ed): put_behind_subject via Apple Vision (JXA, ~10 ms/frame in Vision, ~11 MB/min cache). test/app/mask.mjs passes 27/27 in the app on a pillarboxed vertical clip and a 16:9 clip, preview and export, with controls. MODNet fallback not built.
- [x] Podcast clip on /compare (dc89e0d): Frisian conversation, CC BY-SA, $3.38 run. Gaps: level_voices is capped at +6 dB clip gain; the stock lower third's subtitle has low contrast; an unused asset was left in the pool.
- Flaky: src/main/generate/speech-adapters.test.ts (Gemini sample rate) failed once under full-suite load, passes alone.
- [ ] GSAP-from-CDN in the composition guide (audit §9): blocked by the sandbox; fix the guide.

- [~] talk-to-short (clip 1): **paused by owner** 2026-09-27, mid-edit. The project "raylib talk to short" is saved in bay with 12 segments (48.8 s); the speaker layer is not built yet.
- [x] perry film study → `research/perry-film-motion.md`.
- [x] Attest v3 exported (52.4 s); review notes in `case-studies/redassay-attest/README.md`. Recorded 9 new takes (`tools/takes-v3.js`: product framed right, left scrim, 1.5× cursor, button press); brief `case-studies/redassay-attest/prompt-v3.md` (bar-clocked, perry motion rules, left-text layout, two review passes); bay run in progress, recorded to `~/Movies/bay-release/bay-agent-run-attest-v3.mp4`. Coordinator.
- [x] Raw vertical talking-head footage → `sources/raw-talking-head.md`.
  - **15 vertical clips with confirmed speech**, all on Wikimedia Commons, plus 6 horizontal clips that crop to 9:16.
  - **Top 3:** the selfie "Candidate statement" (pause-heavy, CC BY-SA), "Daniel speaking English" (CC BY-SA), and "James, Yorkshire English" (CC0).
  - **Stock sites are the wrong place to look:** Pexels and Mixkit "talking to camera" clips ship with **no audio stream** (14 of 14 probed).
  - Share-alike passes to our edits, and the people on camera keep their publicity rights.
  - Hindi needs a bigger whisper model than bay's default `base`.
- [x] Attest v4 (the owner's review of v3) → v4-final exported:
  - Fixes: clicks off target, animation stuck, UI tilted where text should read.
  - New look: white, premium, glass, and perry-smooth.
  - Built `tools/render-frames.mjs`, which renders deterministically on a virtual clock with motion-blur sub-frames. macOS has no BeginFrameControl, so each step is virtual-time advance + a screenshot.
  - `film.js`: the cursor tracks its target live; `theme('light')`; `glass()` (quick-liquid refraction, injected via `tools/quick-liquid-inject.mjs`).
  - `takes-v4.js`: all shots flat, a fog materialize for the reveal.
  - Rendering 9 takes at 2880×1620.

## Research summaries

- **`research/editing-styles.md`** covers 19 editing styles with pacing, techniques, the raw footage each needs, bay fit, and a draft skill for each. **Use only with `research/audit.md` corrections:** 9 claims are wrong and 12 unsourced, 6 skill parameters are invalid, and 1 URL is dead. Best bay fit: Hormozi-style retention talking-head, news lower-thirds, kinetic type, luxury/minimal, UGC ad. Top gaps: no SFX/music library, no speed ramps, no motion blur, masks or face reframing.
- **`research/hypit.md`** covers hypit-ai/hypit. Its licence is a modified Apache 2.0 that forbids commercial redistribution, so **ideas only, no code, text or assets**. It proposes a style catalog, previews rendered by bay's own engine, and style-from-reference analysis (coarse→fine, measured by code). The audit rated it trustworthy.
- **`sources/style-clips.md`** has one verified raw clip for each of 12 style needs (licence + audio checked). Gaps: a travel pile with real sound, podcast licence pending, BY-SA tutorials, identifiable UGC creators.
- **`research/audit.md`** is the independent audit of the above, with the required corrections before implementation.

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
- **`research/github-repos.md`** covers 30+ repos, with licence, stars and last push from the GitHub API.
  - **auto-editor** (Unlicense) defaults are ready to port to a silence detector feeding `remove_range`:
    threshold 0.04 (~−28 dBFS), 0.2 s margin, drop silences under 0.2 s and sounds under 0.1 s.
  - **AutoFlip** reframing scores faces over bodies over objects, holds still under a 0.5 motion
    threshold, and otherwise pans on a smooth path.
  - **OpenShorts** stacks two speakers and puts the captions on the seam.
  - **BeatSync-Engine** sets cut rate from music energy and song sections.
  - **Remotion's TikTok template** shows captions in 1200 ms word pages.
  - **Biggest gap:** bay has no reframing, speaker tracking or diarization.
- **`research/entertaining-editing.md`** has 24 sources and a 23-line checklist for bay's agent, mapped to
  its tools. Each rule is marked with its evidence strength.
  - **Hook:** the promise within 3 s on shorts. Long-form is judged by 30 s retention.
  - **Shot length:** the average shot has fallen from ~10 s to under 4 s. No talking-head shot over 6 s
    long-form or 3 s short-form without a change. Hide jump cuts with alternating +10–15% punch-ins or
    B-roll.
  - **Re-hooks:** a visual reset every 10–20 s in minute one, then every 25–40 s; a re-hook every 2–3 min.
  - **Captions:** shorts show 1–3 words at a time, ≤5–10 words/s, inside the safe zone. Long-form uses
    ≤42 characters per line, 2 lines, ≤17 characters/s.
  - **Audio:** duck music 15–25 dB under speech, SFX at −10 to −20 dB, master to −14 LUFS.
  - The "cut every 0.5–1 s" claims are unsourced blog lore.
- **`research/golden-ratio.md`**:
  - **Verdict:** φ is a *house style*, not a proven gain. No study shows it beats thirds, centring or
    nearby ratios, Fechner's result doesn't replicate reliably, and Stieger & Swami 2015 found people
    preferred symmetric framing.
  - **Spec:**
    - Grid lines on 1920×1080 at x 733.4 / 1186.6 and y 412.5 / 667.5 (swap the axes for 1080×1920).
    - Type scale 24 → 39 → 63 → 102 → 165 → 266 px.
    - Animation and stagger durations at 30 fps: 3/5/8/13/21/34/55/89 frames.
    - The payoff at 61.8% of runtime: 37.1 s of 60 s, 27.8 s of 45 s.
    - Music under speech at −20 dB (WCAG 1.4.7; φ gives no audio basis).
  - It includes a paste-able brief block for bay's agent.

## Decisions

- **2026-09-28, owner:** no agency or organisation footage (NASA, NOAA, ESO or similar) on /compare or in shipped style tiles. Use only plain raw videos like the owner's example selfie (a raw talking head filmed by an ordinary person), and podcasts. The news explainer was reverted (e7f3ad5); `sources/informative-clips.md` is superseded. The edit stays in ~/Movies/bay-rnd/news/ for private testing only.

- 2026-09-28: **The owner: do not publish the Attest (RedAssay) film** anywhere: not on the website, not as a style preview shipped in bay. Its footage stays internal. The product-launch-film style needs other, publishable footage for its preview; until then it shows the neutral tile.

- 2026-09-27: **Focus is the launch film** (the owner). The target raw footage for future clips is **unedited vertical selfie talking-head video** (like the owner's reference Reel), not conference talks.
- 2026-09-27: **Attest v3 look = perry's system.** Cuts on bar lines only; masked word rise [.165,.84,.44,1] with the whip exit [.72,0,.18,1]; one spring (420/32); text in a left column, product on the right; red rationed to one word. The footage bakes the right framing and a black left scrim.

- 2026-09-27: **bay's Claude agent loads the skills a task needs on its own** (commit e4b793d). The prompt lists every skill with its description. New `launch-film` skill; `short-form` gained retention rules. Both carry the φ house style. **Verified live:** for the raylib brief, which named no skill, the agent loaded `short-form` and `highlights` and said why.
- 2026-09-27: The owner's rule for all clips: **every edit happens in bay, by bay's agent.** We watch the input, output and edits, then fix bay (skills, tools, prompt) where the agent falls short.

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

- **2026-09-28** (coordinator):
  - **Promo edits made by bay's agent** (runs recorded in `~/Movies/bay-release/run-*.mp4`, transcripts in `clips/<slug>/`):
    - retention short: 46.5 s, −14.2 LUFS
    - kinetic type: 18.6 s, re-exported mastered at −14.2
    - luxury/minimal: 20 s; the agent dropped a branded clip
  - All three are ready on website `/compare` (entries plus CREDITS). The news explainer waits on the NASA download.
  - The first parallel download produced a corrupt file (a short range part), so `pget.sh` now verifies part sizes.
  - **Preview tiles verified in the app:**
    - A `search_styles` card renders tiles with posters over `bay://style-preview` and a "Use this style" button.
    - retention, kinetic and luxury media serve 200; news returns 404 (neutral tile); a traversal probe returns 400.
    - Previews are made by `tools/make-style-preview.sh`.
  - **The owner:** the Attest film is not to be published anywhere.

- **2026-09-27** (coordinator):
  - **Style catalog merged** (4adf2c0; the review's should-fixes are in 3b3717a).
  - **In-app check:**
    - With no tool or skill named, bay's agent called `search_styles` then `read_style` and picked "Retention talking-head short" over UGC ad and launch film.
    - It kept the rule-of-thumb labels and stated its gaps (no SFX library, no keyword recolour).
    - `write_style` from the in-app agent raised the native dialog "Save the editing style …?" showing the id, the title and the first 6 steps, with Cancel / Save style. It is left open for the owner, since global keystrokes are forbidden.
  - **Next:** style previews in the agent panel. For each built-in style, a raw clip (`sources/style-clips.md`) is edited in bay by its agent, then exported as a short before/after loop shipped in app resources. `search_styles` returns the preview, the tool card renders tiles, and a freshness test guards them.

- **2026-09-27** (coordinator):
  - **Attest v4 exported:** `~/Movies/redassay-launch/RedAssay-launch-film-v4-final.mp4`, 52.4 s, −14.0 LUFS. White canvas, glass card, dark ink, one red word, all straight. The takes are rendered deterministically (`v4b`, with timeline-sync), and the run is recorded in `~/Movies/bay-release/bay-agent-run-attest-v4.mp4`.
  - **Incident:** I truncated a take bay was reading, which ruined one export. The rule is now in `tools/README.md`.
  - **`<glass>` in `.brf`** is merged (882a742). An independent review found 3 should-fixes, all fixed in a7bde5b.
  - **In-app probe** (scratch project, a policies take under a thick pane, frame 120, export on vs off):
    - Texture inside the pane went 1.38 → 0.33.
    - Outside the pane it stayed 2.23 → 2.23; mean |Δ| was 0.000 far away and 0.127 at the edge.
    - Preview matched export visually.

- **2026-09-27** (coordinator):
  - Skills auto-load and the launch-film skill are shipped, tested, mutation-checked and rebuilt into the running app.
  - Downloaded raylib (FOSDEM, CC BY) and started clip 1 in bay.
  - Saved `research/music-video-prompt.md` (the owner's PDF).
  - Launched the perry film study.
  - **bay gap seen:** `transcribe` output for a 25 min talk is too big for the agent to read, so it fell back to `find_highlights`. Candidate fix: a paginated or ranged transcript read.

- **2026-09-27** (coordinator):
  - Created `r&d/` on `rnd/entertaining-edits`.
  - Saved the footage sources, the Apple and motion research, the recording tools, and the Attest case
    study (prompts, lessons, marks).
  - Launched 4 parallel researchers (GitHub repos, retention-editing blogs, golden ratio, website/deploy).
    The website plan is saved; the other three are pending.
- **2026-09-27** (coordinator): all four researchers are back.
  - Saved `github-repos.md`, `entertaining-editing.md` and `golden-ratio.md`, and summarised them above.
  - Next: pick footage for `plan.md`'s first set, and write `clips/<slug>/brief.md` from the retention
    checklist + the φ brief block.
  - Candidate feature work surfaced: a silence detector using auto-editor's defaults; reframing/speaker
    tracking.
- **2026-09-28** (coordinator): OffscreenCanvas lockdown fix; AI layout merged and verified in the app; podcast and 3D branches reviewed (no blockers; fixes sent back); news job started.
- **2026-09-28** (coordinator): podcast + 3D merged and verified in the app; news explainer on /compare; found the empty-palette and unmastered-re-export gaps from real runs.
- **2026-09-28** (coordinator): /compare sync fixed for all entries (44ec441; before-from-project.py, player holds one clock, drift 10–16 ms). The explainer with an HTML-canvas drawboard replaces retention-short (f1def82). Its second run cost $11.89 from 176 track_export polls, so the progress tools now wait (waitSeconds, default 30, cap 120; export_timeline wait:true). Merged 6aaf1b4 and verified live: one call returned at done after 15.1 s.
- **2026-09-28** (coordinator): export_timeline now returns only once the export is done (f42139b; ceiling 30 min, all client timeouts raised to 33 min). Verified with bay's own agent: "export the whole timeline" took 1 export_timeline call and 0 track_export calls, $0.42 for the turn (it was 176 polls and $11.89). The explainer on /compare is clipped to the board ±4 s (33f54b4). Probe tip: after a bay restart the editor tab id changes; select it by the title "bay", not t1.
- **2026-09-28** (coordinator): mask-3d on /compare (c1089db): a 3D fly-through title plus put_behind_subject words, $1.33 + $2.10. The cut-out now follows its clip's zoom, crop, keyframes and grade at draw time, and finds the clip even when it is switched off (8a03eb9). mask.mjs passes 42/42 in the app, including a 1.15× punch-in after the cut-out (IoU 97.4%). The Sage launch film is in progress (the sage-takes agent is recording against the mock at localhost:1420; naming rules: "Halo", never "notch", never perry or notchview); it replaces kinetic-type.
