# 02 — What separates a good video from a bad one (external research, Aug 2026)

Research produced for round 3 by a web-research agent. Evidence tiers matter: **Tier A** =
standards bodies and peer-reviewed work (BBC Subtitle Guidelines, AES ducking study, Material
Design motion tokens, CVPR/ACL papers). **Tier B** = platform-published marketing science.
**Tier C** = vendor/creator-analytics blogs — unaudited; treat as priors, not ground truth.

---

## 1. Genre playbook

| Genre | Hook window & device | ASL / cut rate | Caption style | Sound design | Structure & CTA |
|---|---|---|---|---|---|
| **Short-form social** (TikTok/Reels/Shorts) | 0.5–1.5s. Median scroll-stop ~1.9s TikTok/Reels, 2.2s Shorts (C); TikTok Marketing Science: first 6s carry ~90% of ad-recall impact (B) | 1.5–3s ASL, 20–60 cuts/min entertainment; 12–25 educational | Burned-in, 70–90px on 1080×1920, karaoke highlight, 22–28 CPS | Music-forward, cut on beat, 120–140 BPM | Hook → escalate → payoff → loop. CTA verbal + text, last 2s |
| **YouTube explainer/essay** | 15–35s hook total: pattern interrupt 0–5s, payoff promise 5–15s, commitment hook 15–30s. Steepest drop s10–20 | 4–8s ASL, 8–15 cuts/min | Optional; keyword reinforcement, not full subs | VO-led, bed 15–20 dB under | Re-engagement beats at ~25% and ~65%. CTA after first payoff, never cold open |
| **Product demo / launch ad** | Product in motion by 1.5s; problem framing *after* | 2–4s ASL, 5–8s holds on the key feature moment | Feature labels, high contrast, 300–500ms ease-in | Clean VO, restrained music, UI foley | Problem → product → 3 proof beats → price/CTA. Single CTA |
| **UGC-style ad** | Face + direct address in frame 1; handheld, imperfect | 2–5s ASL, deliberately uneven | Auto-caption look; slight imperfection is a feature | Camera-mic realism, minimal music | Skepticism → trial → result. CTA spoken, not graphic |
| **Podcast clip** | Start mid-sentence on the punchiest claim | 3–6s ASL; cuts driven by speaker changes | Full verbatim captions mandatory (sound-off viewing) | J/L cuts on speaker turns; consistent loudness across mics | Self-contained argument. Weak CTA or none |
| **Documentary / archival mini-doc** | 20–40s cold open on the most arresting artifact | 5–12s ASL, high variance | Lower-thirds, date/source cards | Ambience-led, sparse score, room tone always present | Question → evidence → turn → resolution. No CTA |
| **Motion-graphics explainer** | Visual metaphor on screen by 2s | 3–6s per idea beat | Text *is* the visual; one idea per screen | SFX synced to motion; whooshes on transitions | Sequential build, each graphic inheriting the last. CTA as final card |
| **Slideshow / photo memories** | Best photo first, Ken Burns already in motion | 2.5–4s per image; vary by 30%+ | Minimal — dates, names | Music leads entirely; cut on phrase boundaries | Chronological or emotional arc. No CTA |
| **Screen-recording tutorial** | State the outcome in 5s, show the finished result | 6–12s ASL; zoom-punches instead of cuts | Step numbers, keystroke overlays | VO-only, no music under instruction | Numbered steps, recap. CTA = next tutorial |
| **Music-synced montage** | First beat drop ≤3s | Cut on beat; ASL = bar length | Sparse or none | Music is the timeline | Energy curve matching track structure |
| **Talking-head + B-roll** | Strongest sentence first, B-roll off the top | 4–9s ASL; B-roll covers every cut | Captions for social cut-downs | J-cuts into B-roll, L-cuts out | Claim → evidence → claim. CTA at natural close |

**The load-bearing insight: pacing *variance* beats pacing *speed*.** Shot-duration σ of
40–70% of mean ASL is what reads as human editorial rhythm; uniform shot length reads as
automation regardless of the average.

## 2. Thirty verifiable quality rules

Machine-checkable from the timeline or the rendered MP4.

**Pacing & structure**
1. ASL within genre band (short-form 1.5–3s; talking-head 4–9s; tutorial 5–10s; cinematic 3–8s). (C, cross-validated by 2–3s modal shot-length finding, PsyCh Journal, A)
2. Shot-duration standard deviation ≥ 40% of mean ASL. (C)
3. No three consecutive shots within ±10% of the same duration — the single strongest slop tell.
4. First visual change before 1.5s short-form; before 5s long-form. (C)
5. No shot > 8s short-form / 15s long-form without a motion or scale change.
6. Long-form: a structural beat change at the 25% and 65% marks. (C)
7. No logo bumper, greeting, or disclaimer before first value delivery. (C, consistent across sources)
8. AI-generated source clips capped at 3–4s each — model coherence degrades after ~6s. (C)

**Audio**
9. Integrated loudness −14 LUFS ±1 YouTube; −14 to −16 TikTok/Reels. (B/C)
10. True peak ≤ −1.0 dBTP to survive AAC transcode. (A/B)
11. Speech-vs-bed difference ≥ 10 LU commentary-over-music, ≥ 15 LU over ambience. (AES, Torcoli et al. 2019 — **Tier A, strongest citation in the list**)
12. Practical ducking: music 15–20 dB under voice during speech. (C, consistent with the AES LU figures)
13. Duck fades: 0.5–1s in, 1–2s out. Abrupt gain steps read as pumping.
14. LRA ≤ 11 for speech-led content.
15. No silent gaps > 500ms unless intentional; crossfade ≥ 2 frames at clip boundaries.
16. Room tone/ambience under every location shot — absence is a top-cited AI tell.
17. ≥ 30% of speaker-change cuts use J or L split edits.
18. Music energy transitions align to beat/bar boundaries (onset within ±80ms).

**Captions & text**
19. Reading speed 160–180 WPM; minimum ~0.3s/word on screen. (BBC, A)
20. Max 2 lines landscape, 3 lines vertical. (BBC, A)
21. Line width ≤ 68% of frame for 16:9, ≤ 90% for 9:16; ~25 chars fits a 90%-width 9:16 region. (BBC, A)
22. No text-region edge inside the outermost 5% of the render area. (EBU-TT-D, A)
23. 9:16 safe zone: keep text/faces out of top ~250px, bottom ~460px, right ~180px on 1080×1920; caption band y:700–1360px. (C — verify against current app builds)
24. Caption font ≥ 60px on 1080×1920; TikTok 70–90px to survive compression. (C)
25. Text contrast ≥ 4.5:1 against the *sampled underlying frame*, enforced with stroke or plate.
26. One idea per caption card; no caption overlapping another text element in time and space.

**Visual & motion**
27. 1080p minimum; luminance/white-balance drift bounded shot-to-shot.
28. UI/text animation 200–500ms; 150ms state changes; >500ms only full-frame transitions. (M3, A)
29. Easing on every animated property — never linear. M3 standard `cubic-bezier(0.2, 0, 0, 1)`. (A)
30. ≥ 4 distinct compositions per video; none repeated more than twice. (C)

## 3. Slop signals — concrete detectors

**AI video fails on behavior and rhythm, not pixels.** A 2025 *Perception* study (via Tier C)
reports viewers identified AI motion 83% of the time from movement alone even when stills were
indistinguishable. Frame-level fidelity metrics systematically miss slop.

Ranked by detection cost:

- **Uniform shot length** — variance below 20% of mean. Cheapest, highest-signal.
- **Template sameness across outputs** — hash the timeline's structural skeleton across a
  user's history; flag near-duplicates. (YouTube's Jan 2026 enforcement targeted *channel-level*
  automation patterns — an agent producing structurally identical outputs at volume creates
  demonetization risk even when each video is individually fine.)
- **Robotic TTS** — flat F0 variance, no breaths, uniform inter-sentence pauses. Measure F0 σ
  and pause-length entropy on the VO track.
- **Over-captioning** — every word burned in when audio is clear; captions over faces; > ~28 CPS.
- **Stock-footage mismatch** — CLIP-style similarity between transcript window and visual
  embedding; flag low-similarity segments.
- **Missing ambience** — near-zero energy outside the VO band during location shots.
- **No narrative arc** — no measurable change in cut rate, loudness, or music energy start to
  end. Good edits have an energy contour; slop is flat.
- **Bad music choice** — valence contradicting transcript sentiment; BPM unrelated to cut rhythm.
- **Peripheral instability in generated clips** — differential optical-flow variance, center vs edge.
- **Physics/permanence violations** — needs a VLM.
- **Face avoidance** — abstract visuals and text overlays only.

## 4. Self-evaluation loop — what 2025–26 research supports

VMAF/PSNR measure fidelity to a reference; irrelevant when the question is taste. Relevant work:

- **VideoScore2** (arXiv 2509.22799) — video critic scoring visual quality, prompt alignment,
  physical consistency, with CoT rationales before numbers; designed as a reward model for
  Best-of-N selection. Closest off-the-shelf critic.
- **VISTA** (CVPR 2026) — most transferable architecture: decompose intent into a temporal plan
  → generate candidates → **pairwise tournament** to pick a champion → critique by a trio of
  specialized agents (visual, audio, context) with normal/adversarial/meta judges → a reasoning
  agent rewrites the plan. 1 init + 4 refinement rounds, early stop. 66.4% human preference over
  direct prompting.
- **ReLook** (ACL 2026) — the discipline layer. Copy two mechanisms verbatim: **zero-reward for
  invalid renders**, and **Forced Optimization** — accept only strictly improving revisions.
- **VideoAesBench** (2026) — current LMMs have "basic, incomplete and imprecise" video
  aesthetic perception. **Never let a VLM be the sole gate.**

Recommended tiers:

- **Tier 0 — timeline lint** (pre-render, ms): deterministic rules against the project model.
  Hard gates, non-negotiable with a model.
- **Tier 1 — signal analysis** (post-render, s): loudnorm verification, scene detection to
  verify realized ASL distribution, OCR rendered frames for contrast/safe-area *as rendered*.
- **Tier 2 — VLM jury** (post-render, min): keyframes + transcript to a VISTA-shaped
  multi-agent critique; **give the jury the deterministic measurements** so it critiques taste,
  not numbers. Findings become targeted revision instructions naming timestamps.
- **Tier 3 — selection**: render N variants (N=3) differing in hook, pacing, music; pairwise
  tournament, not absolute scores; Forced Optimization before shipping a revision.
- **Tier 4 — ground truth**: log which variants users ship unmodified, where they edit first,
  retention curves where available. The local dataset beats any published benchmark.

**The discipline that matters most: keep taste judgments and measurements in separate tiers.**
Deterministic rules are hard gates the model cannot argue past; the VLM is only asked what it is
good at — does this feel like it was made by a person who cared.
