# Audit: editing-styles.md, hypit.md, style-clips.md

*Independent check, 27 Sep 2026, before anything is implemented from these documents. The audited
files were not edited. Web checks used WebFetch/WebSearch/curl on this date; repo checks read the
working tree of `rnd/entertaining-edits`; hypit was shallow-cloned to
`/tmp/audit-hypit-36913-21589` at `557497b`.*

Status key: **VERIFIED** (number is in the cited source, attributed correctly) · **WRONG** (source
says something else; correct value given) · **UNSOURCED** (cited source does not say it, or no
source) · **RULE-OF-THUMB** (correctly labelled as practitioner/estimate) · **PARTIAL** (true in
part; the caveat matters).

A WebFetch answer comes from a small model reading the page. Where a verdict depends on text being
*absent*, I asked a second, narrower question ("does the page contain X? verbatim or NOT PRESENT").
Pages can change after the author read them, so an UNSOURCED quote may once have been on the page.
Either way it cannot go into a skill as a cited fact now.

---

## Verdicts

| Document | Verdict | Why |
|---|---|---|
| `editing-styles.md` | **Usable with corrections** | The measured core holds up: Tubefilter, PandaStudio MKBHD/DOAC/Fireship, ShotBook, ANFX, Guo, Calliope and TikTok's 6 s/90% all check out. But **12 quotes or numbers are not in the source they cite**, **2 numbers are wrong**, and several bay-capability statements are wrong in both directions. Every draft skill names real tools. Six parameter or usage errors would make the agent's calls fail or do the wrong thing. |
| `hypit.md` | **Trustworthy, one stale claim** | The licence is quoted accurately, and every file path and line I checked (12) is right. Stats are within a day's drift. There are two errors: "skills stay user-invoked" is stale, and bay has 14 skills, not 15. One omission matters: licence clause 1a (no multi-tenant or SaaS use). Its licence conclusion is correct and conservative. |
| `style-clips.md` | **Does not exist** | `r&d/sources/` holds only `raw-talking-head.md` and `sample-footage.md` at audit time. Nothing to audit, and no licence or audio claims can be relied on yet. |

Counts across both documents: **WRONG 9**: 2 web numbers (arXiv count, Netflix cps), 6 bay
capabilities in editing-styles.md (blend-mode count, static rotation, canvas preset id, brf blur
"gap", source fps check, `add_captions clean`) and 1 in hypit.md (skill count). **UNSOURCED 12**
(§1 rows 17, 18, 19, 21, 23, 26, 28, 29, 31, 39, 40, 43). **STALE 1** (hypit "skills are
user-invoked"). VERIFIED ~50. PARTIAL 8.

---

## 1. editing-styles.md: quantitative and quoted claims

| # | Claim (style) | Status | Evidence |
|---|---|---|---|
| 1 | MrBeast 38 cuts/60 s ("I Paid A Real Assassin…", Mar 2023) vs 23 ("…Abandoned City", 2024) (§2) | **VERIFIED**, n=1 minute per video | Tubefilter counted "one minute of footage from the midpoint of each video". https://www.tubefilter.com/2024/03/04/mrbeast-editing-style-number-of-cuts-per-video/ |
| 2 | MrBeast tweet, 3 Mar 2024: "slowed down… let scenes breathe… our views have skyrocketed"; "ultra fast paced/overstim era" | **VERIFIED** | Same page, verbatim: "…longer videos, etc. And our views have skyrocketed! My fellow YouTubers lets get rid of the ultra fast paced/overstim era of content." |
| 3 | "So the current style is ~23 cuts/min" (§2, and skill step 6 "hold near 23") | **PARTIAL**: over-generalised | One 60 s sample of one video. Fine as a target but not as "the style". The skill's 15–35 band is [E] and should say so. |
| 4 | MKBHD 7.4 cuts/min (6.4–8.9), median shot 3.6–6.7 s, 48% TH / 43% B-roll, hook 1.1–1.9× body, one 32–55 s hold at 72–92% (§3) | **VERIFIED**, n=3 videos | https://www.writepanda.ai/blog/mkbhd-editing-style-measured/ PandaStudio is an AI-tool vendor, so [M] means "vendor-measured, 3 videos". |
| 5 | Fireship ≈13 cuts/min (§14) | **VERIFIED** | Same page: "Fireship runs about 13 per minute" |
| 6 | DOAC: cut every 4.1–6.3 s, ~2.5–3 s near payoff, 1–1.5 s reaction cutaways, 1–3 words, 60–70% height, host yellow / guest white, "completely dry", B-roll 0–6.5% (§4) | **VERIFIED**, n=3 clips | https://www.writepanda.ai/blog/how-diary-of-a-ceo-edits-podcast-clips/ |
| 7 | DOAC clips 66–139 s; payoff "lands at 55–80%" [M] | **PARTIAL** | Measured 65.8–138.6 s. Measured payoffs are **55/62/69%**. "55–80%" is the article's *recipe target band*, not a measurement. The tag should be [C] for 80. |
| 8 | ~5.1 s on emotional material (§4) | Not re-checked | — |
| 9 | Social cinematic ads **1.2 s** avg shot, "**70 ads**, 17.9 s" [M/R] (§8) | **WRONG** (count) | arXiv 2608.24329 (Law, Li, Narechania, 25 Aug 2026). 1.2 s and 17.9 s come from Study 1b's **99 real Meta/TikTok ads**. The **70** are the paper's *AI-generated* ads for Study 2. Correct: "99 human-made social cinematic ads". https://arxiv.org/html/2608.24329 |
| 10 | Guo, Kim & Rubin L@S 2014: 6.9M sessions, ~6 min plateau, talking head + slides > slides, Khan-style > PPT (§3, §14) | **VERIFIED** | https://dl.acm.org/doi/10.1145/2556325.2566239 (abstract and summaries). |
| 11 | TechSmith: most-desired instructional length 10–19 min; 30–35% prefer 3–6 min (§14), tagged **[I]** | **PARTIAL** + tag error | Secondary summaries of TechSmith's viewer study say ">30% preferred 3–6 min, the most popular band" *and* "most desired length… 10–19 min". The sources are internally inconsistent. The blog URL cited (techsmith.com/blog/video-length) says neither. **`[I]` is not in the doc's tag legend.** |
| 12 | Microlearning 2–6 min, demos 5–10 min (§14) | **VERIFIED** | https://www.techsmith.com/blog/video-length/ |
| 13 | Lower third held 4–7 s (2–3 s repeat), in 0.3–0.7 s, out 0.3–0.5 s, ≥~96 px left/bottom, secondary 50–65% (§13) | **VERIFIED** | https://anfx.co/blog/lower-thirds-design-rules-free-templates/ Note: 96 px is ~5% of 1920 (action-safe). The skill's step 5 demands the 10% title-safe area (192/108 px). Pick one. |
| 14 | Title-safe 10%, action-safe 5% [C, Motion Array] | **RULE-OF-THUMB** (not fetched) | Standard SMPTE convention, correctly tagged [C]. |
| 15 | Speed ramps: travel 100%→35–50% over 10–15 f; "2–3 ramps max per 30–60 s"; sports 100%→10–20% over 4–8 f; "slow hold 8–15 frames" (§6, §10) | **VERIFIED** | https://shotbook.art/blog/how-to-find-and-use-speed-ramp-references-for-video-editing |
| 16 | Ken Burns 5–15% zoom (§15) | **VERIFIED** (5–15) | Frameo: "A zoom increase between 5 percent and 15 percent is typically effective." The "5–8% for subtlety" part was not found on Frameo. Cloudinary not fetched. |
| 17 | UGC structure: hook 0–3 s, value 3–15, proof 15–25, CTA last 5 s; "15–30 s sweet spot" [C, Stackmatix] (§16) | **UNSOURCED / contradicted** | Stackmatix says **"9–15 seconds typically outperform longer formats for direct response"** and has no timed structure. https://www.stackmatix.com/blog/tiktok-creative-best-practices-startups |
| 18 | "3×3×3 test matrix = 27 variants" [C, Stackmatix] | **UNSOURCED** | The article says "Launch 3–5 creative variants per ad group". |
| 19 | "Avoid heavy branding or cinematic polish that signals 'ad'…" [C, Stackmatix/Hustler] | **UNSOURCED** at Stackmatix | The idea is there ("polished, clearly-produced advertising" underperforms), but not the quote. Hustler not fetched. |
| 20 | TikTok: first 6 s carry 90% of ad-recall impact [P] | **VERIFIED** (secondary) | TikTok Marketing Science, via Social Media Today: "first 6 seconds capture 90% cumulative impact on Ad Recall". https://www.socialmediatoday.com/news/tiktok-shares-new-notes-maximize-ad-effectiveness/694989/ |
| 21 | "93% of top-performing TikTok videos use sound" [P] | **UNSOURCED** (no primary found) | The doc already flags this as secondary. Keep it out of skills until a TikTok page is found. |
| 22 | OpusClip: emojis/animations "increase numbers of views by 42% on average" | **VERIFIED** as quoted, and correctly flagged as marketing | https://www.opus.pro/blog/create-videos-in-alex-hormozi-style-the-ultimate-guide |
| 23 | OpusClip calls Hormozi style "deceptively simple — one person, one camera, minimal B-roll" (§1) | **UNSOURCED** (misattributed) | Not on the OpusClip page, and not on Joyspace. Source unknown. |
| 24 | Keywords go yellow or green [C, OpusClip] | **VERIFIED** | "highlight keywords or phrases in yellow and green color" |
| 25 | Fonts TheBoldFont, Montserrat Bold, Anton [C, Riverside] | **VERIFIED** | https://riverside.com/blog/hormozi-style-videos |
| 26 | SFX sparse by 2026, "voice carries the energy" [C, Joyspace] (§1) | **UNSOURCED / contradicted** | Joyspace says "Even if you tone down the visual text, keep the subtle sound design." The quoted phrase is absent. https://joyspace.ai/hormozi-editing-style-2026-analysis |
| 27 | Audiogram 15–45 s [C, Recast] | **VERIFIED** | "A strong audiogram usually lands in the 15 to 45 second range." |
| 28 | "Real faces and reactions consistently outperform waveform animations" [C, Recast] | **UNSOURCED** as a quote | The page says "If you have strong face-first video, that often performs better on many social platforms." The doc turned a hedge into a strong claim inside quote marks. |
| 29 | Speaker labels help comprehension [C, Recast] | **UNSOURCED** | Not present on the Recast page. |
| 30 | Sports cuts "often less than one second… synchronized with the music's beat or the moment of peak action" [C, Inside Editors] | **VERIFIED** | https://insideeditors.com/how-to-edit-sports-videos/ |
| 31 | White/black flash frame on beat hits [C, Inside Editors] (§10) | **UNSOURCED** | Inside Editors does not mention flash frames. |
| 32 | Vox cuts every 1–3 s [C, Calliope] (§5) | **VERIFIED** | "cuts every 1-3 seconds in sync with narration beats" https://www.calliopelabs.co/guides/vox-style-shorts |
| 33 | "12 fps stutter" (§5) | RULE-OF-THUMB, attributed to PremiumBeat (not fetched) | Calliope does not mention it. |
| 34 | MrBeast editors cut "over 10 hours of footage" [C, C4E] | **VERIFIED** | "Editors cut over 10 hours of footage into a seamless arc" (about the Squid Game video). |
| 35 | Vidpros: commercials 2–5 s, vlogs 4–8 s, documentary 7–25 s | **VERIFIED**, correctly labelled unsourced | Vidpros cites nothing, and the doc says so. |
| 36 | CapCut ramps: 4–5 speed points; smooth arcs over sharp angles [C, CapCutGuide] | **VERIFIED** | "Four or five purposeful points are easier to adjust than a row of tiny changes." |
| 37 | CapCut 0.1×–10× [P, FlexClip] | **VERIFIED**, but mis-tagged | FlexClip is a third-party vendor, so the tag should be [C], not [P]. |
| 38 | Netflix ≤17 cps for subtitles (§9; also skill 13 step 10) | **WRONG** | Netflix English (USA): **adult up to 20 cps, children up to 17 cps**, 42 chars/line. https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide. The upstream `entertaining-editing.md` ("17 cps (13 for kids)") carries the same error. |
| 39 | Superhuman "leads with a single sharp promise"; Stripe "clean motion design and UI walkthroughs" [C, Blare] (§8) | **UNSOURCED** | The Blare page features Slack, Airtable, Figma, Pendo, Ceipal and Bolt. It does not mention Superhuman or Stripe. |
| 40 | Shootsta: "The most useful single cutaway in interview work is the listener nodding or reacting" (§19) | **UNSOURCED** | Not present on the page. The page does support "A-cam at 45°". |
| 41 | digitalfilms/Oliver Peters: "…different framing, so a cut between the cameras doesn't look like a jump cut" | **VERIFIED** | Verbatim on the page. |
| 42 | TechSmith: "Leave a small beat before important clicks, then use zooms, cursor effects, or callouts…" | **VERIFIED** | https://www.techsmith.com/blog/how-to-edit-screen-recording/ |
| 43 | Zoom 150–200% for screencasts [C] | **UNSOURCED** | No source is named, and TechSmith gives no percentage. Fine as [E]; it is not [C]. |
| 44 | Captions.ai luxury: "Understated and unhurried", "Flowing script fonts and sans-serif labels", B&W | **VERIFIED** | https://captions.ai/styles/byline (an AI-vendor style page) |
| 45 | "22 (Taylor's Version)" lyric type (§9) | **VERIFIED** | Fonts In Use: Montserrat + Mr Sheffield. |
| 46 | Manfrotto: three movements, 24 fps, edge light | **Not verified** (HTTP 429) | Re-check before citing. |
| 47 | Hagerty quote on Kolder; Luxury Society; Nieman Lab | **Not verified** (HTTP 403 to curl) | Blocked, not dead. |
| 48 | Every "bay fit %" | **RULE-OF-THUMB**, correctly tagged [E] | They are the author's estimates. Do not surface them to users as measurements. |
| 49 | Luxury shots 4–8 s, news shots 3–6 s | **RULE-OF-THUMB**, correctly tagged [E] | — |

### Reference URLs spot-checked (34)

| URL | Result |
|---|---|
| youtube.com/@AlexHormozi, @LeilaHormozi, @MrBeast, @aliabdaal, @mkbhd (Marques Brownlee), @TheDiaryOfACEOClips, @Vox, @Apple, @NBA, @HouseofHighlights, @CHANEL, @hermes (Hermès), @BBCNews, @Reuters, @Fireship, @KevinStratvert, @kurzgesagt, @casey (CaseyNeistat) | **Resolve and match** (og:title checked) |
| youtube.com/@linear | Resolves and matches: Linear, links linear.app |
| youtube.com/@StripeDev | **Mismatch:** "Stripe Developers", a dev-docs channel, not Stripe's launch films. Use `@stripe` ("Stripe"). |
| youtube.com/@johnnyharris | Resolves, but it is Johnny Harris's own channel. **Vox Borders lives on @Vox.** The label "Vox Borders / Johnny Harris" conflates the two. |
| **youtube.com/@SamKolder** | **DEAD (404).** samkolder.com resolves (200). |
| watch?v=0e3GPea1Tyg | Matches: "$456,000 Squid Game In Real Life!", MrBeast |
| watch?v=WxfZkMm3wcg | Matches: "Make It Count", CaseyNeistat |
| watch?v=p-N1FDjENJE | Matches: "After Effects AMV Tutorial – Twixtor + Time Remap/Velocity" (ACE) |
| fontsinuse 43958, premiumbeat lyric, svgator 50 examples, modes substack Gucci Lido, strayspark, moonbear, motionapp benchmarks 2026, techsmith ai-auto-zoom, captions.ai byline, nofilmschool Neistat, shootsta, rockethouse, digitalfilms, quso Hormozi, sendshort MrBeast, techsmith screen-recording, blare | **200** (content checks as in the table above) |
| aliabdaal.com guide, luxurysociety, niemanlab, miahagerty.medium | **403**: blocked to curl, not confirmed dead. The Ali Abdaal "three passes" content is still reported only "via search summary". |
| ads.tiktok.com creative-codes, tiktok.com/discover/velocity-edit-anime | **No response to curl** (anti-bot). Unverified. |

Result: 32 of 34 resolve or are blocked. **1 is dead (@SamKolder). 2 are mislabelled (@StripeDev, @johnnyharris as "Vox Borders").**

---

## 2. bay capability claims (both docs), checked against the repo

| Claim | Status | Evidence |
|---|---|---|
| Subtitle designs `spotlight`, `punch`, `boxed`, `clean`, `reveal`; params `accent`, `scale`, `bottom` | **VERIFIED** | `src/shared/subtitles.ts:31`, `src/shared/tools/add-subtitles.ts:28-36` |
| Transitions cross-dissolve, dip-to-black, dip-to-white, wipe, push, slide, iris | **VERIFIED** | `src/shared/tools/add-transition.ts:27-35` (direction: left/right/up/down) |
| Templates subtitle, lower-third, title-card, callout, stat, progress, end-card | **VERIFIED** | `src/shared/templates.ts:63-166` |
| Keyframes: opacity, left, top, width, height, rotation, scale, volume; eases | **VERIFIED** | `src/shared/tools/edit-item.ts:66`, `src/shared/keyframes.ts:136`. Ease names are `linear`, `hold`, `in`, `out`, `inOut` or a bezier. |
| "blendMode (12 modes)" | **WRONG** | There are **16** modes (normal through luminosity), `edit-item.ts:203-222`. |
| `edit_item` "sets … rotation" (static) | **WRONG** | `edit_item` has no static `rotation` field. Rotation is only reachable as a **keyframe** property (`edit-item.ts:47-60`). A constant tilt needs a single key. |
| "`edit_item` sets layout" / "`edit_item` layout scale/left/top" | **PARTIAL** (wording) | There is no `layout` parameter. The fields are top-level: `left`, `top`, `width`, `height`, `scale`, `opacity`. |
| Grade: wheels, WB, curves, LUT, halation, vignette, grain | **VERIFIED** | `edit-item.ts:182-201` |
| Mastering −14/−16/−23 LUFS | **VERIFIED** | `export-timeline.ts:36` ("streaming", "podcast", "broadcast") |
| `set_canvas` "preset 1080×1920" (skill 1 step 4) | **WRONG** (value) | Preset ids are `vertical-1080`, `portrait-1080` (4:5), `landscape-1080` and others (`src/shared/project.ts:1380-1387`). 1440×1080 (style 12) has no preset, so pass `width`/`height`. |
| brf features: gradients, blur, shadow, split text, variable axes, `interpolate`/`spring`/`Sequence`/`Easing` | **VERIFIED** | `src/main/mcp/docs/brf.md:51-119` |
| Gap: "No keyframeable blur for soft text reveals" (§3) | **WRONG: bay has it** | In `.brf`, `blur` is a prop, "any number or colour prop may be `[[t, value], …]`" keys, and there is an `in="blur"` preset plus `wipe` and `type` (`brf.md:63, 116-121`). The real gap is keyframed blur on **video items** (the `adjustments` filter is static). |
| Gap: "No text masks" (§9) | **PARTIAL** | brf has a `wipe` entrance, which is a masked reveal for text and shapes. Text-behind-subject and shape masks on video are genuinely absent (no `mask` anywhere in `project.ts`/`brf.ts`). |
| Gap: L-cuts only via `detach_audio`/`trim_item` (§13, §19) | **Understated: bay has more** | `edit_item.audioLeadFrames` (J-cut) and `audioTrailFrames` (L-cut) do it in one call (`edit-item.ts:103-119`). Skill 13 step 8 and skill 19 step 7 should use them. |
| Skill 6 step 7: "Check each clip's fps with `inspect_item`" (also "≥50/60 fps sources only" in skills 6, 10, 11, 17) | **WRONG: no tool reports source fps** | `Asset.fps` exists (`project.ts:52`), but `browse_assets` and `inspect_item` return only `width`/`height` (`src/renderer/src/mcp/read.ts:146-147, 246-247`). The agent cannot check this, so the step must be removed or a field added. |
| `add_captions` `clean` (§19 "How bay does it") | **WRONG** | `add_captions.style` is an object of text overrides (`add-captions.ts:44-48`). `clean` is an `add_subtitles` design. `add_captions` also takes `cues`/`srt`; it does not transcribe. |
| `frame_grid` shows words under cells | **VERIFIED** | `frame-grid.ts:11-17` (only for sources transcribed this session) |
| No speaker diarisation, no masks, no multicam sync, no SFX library, speed constant per item | **VERIFIED** as gaps | No diarisation in `transcribe.ts`. `speed` is a single number (`edit-item.ts:83`). |
| `duplicate_project` absent | **VERIFIED** | Not in `src/shared/tools/` |
| Whether the probe exposes file creation time (§18) | **VERIFIED absent** | No `creation_time`/`creationTime` anywhere in `src/main` or `src/shared`. Skill 18 step 1's "by file creation time" cannot work. |
| hypit.md: "15 hard-coded skills in `src/shared/skills.ts`" | **WRONG** (minor) | **14**: talking-head, captions, short-form, lower-third, motion-graphics, opening-title, rough-cut, transitions, end-card, chapters, highlights, dub, review, launch-film. |
| hypit.md §4a: "**Skills stay user-invoked** (`CLAUDE.md`: 'Skills are still user-invoked')" | **STALE** | `src/main/agent/prompt.ts:66-69` (Claude provider): "Load a skill with the Skill tool before you start whenever the task matches its description — the user does not have to name it." Only Codex still needs `/name`. CLAUDE.md's sentence is itself stale. A style catalog can therefore be skills the agent auto-loads, not only a searchable data store. |
| hypit.md: 5 format guides, `bay://guide/examples`, `fill_prompt_kit`/`src/shared/prompt-kits.ts` | **VERIFIED** | `src/main/mcp/resources.ts:44-56`, file exists |
| hypit.md: bay cites hypit at `prompt.ts:11`, `speech-duration.ts:8` | **VERIFIED** | Lines 10-11 and 7-8 respectively. |

---

## 3. hypit.md: licence, stats, source claims

**Licence**, read from `LICENSE` (26 lines, "© 2026 Hypit.AI"). The quotes in hypit.md are verbatim
and correct. What it permits and forbids for bay:

| Use | Permitted? | Clause |
|---|---|---|
| (a) Copy code into bay | **No**, while bay is supplied to third parties for commercial gain: 1b forbids supplying "any derivative work of it… bundled with, any product, application… provided to third parties" without written authorisation. A non-commercial fork must stay under the same licence (share-alike) and keep name/logo/copyright (1c). | 1b, 1c |
| (b) Copy docs / SKILL.md / reference prose / `.svs` kits / preview images | **No**, on the same terms. The licence covers "Hypit or any derivative work", and the repo's docs and skill text are part of what is distributed. Apache-2.0 base terms (attribution, NOTICE) would apply on top. | 1b + Apache 2.0 |
| (c) Reimplement ideas, architecture, facts (e.g. speech-rate figures) | **Yes.** The licence governs copies and derivatives, not ideas, and makes no patent-style claim beyond Apache's. bay already does this with attribution (`prompt.ts:10-11`, `speech-duration.ts:7-8`). | — |
| Output made with hypit | Belongs to the user; no conditions | 3 |
| **Omitted by hypit.md: clause 1a** | No multi-tenant / hosted / SaaS use of hypit code without authorisation. Irrelevant while bay is a desktop app. It would matter if bay ever ran hypit as a cloud backend. | 1a |
| Contributor clause | Contributions may be used commercially by Hypit, and Hypit may change the licence. | 2a, 2b |

hypit.md's conclusion ("no hypit code, docs text, `.svs` kits or preview images may be copied into
bay; ideas are fine") is **correct**.

**Stats** (GitHub API, 27 Sep 2026)

| Claim | Status | Actual |
|---|---|---|
| Created 2026-07-29 | VERIFIED | `2026-07-29T18:49:19Z` |
| 16,412 stars / 1,984 forks | VERIFIED (drift) | 16,420 / 1,985 |
| 15 open issues | **PARTIAL** | `open_issues_count` 15 counts PRs. Actual open *issues*: **9**. |
| ≥20 contributors | VERIFIED | The contributors endpoint returns exactly 20. |
| License reported `NOASSERTION` | VERIFIED | — |
| Last 100 commits 2026-09-17 → 09-26 | **PARTIAL** | The oldest of the last 100 is `2026-09-16 03:46 +0800`. The pace (~10/day) holds. |
| Head `557497b` 2026-09-26 | VERIFIED | — |
| `@hypit/hypit` v0.2.16; ~120 packages | VERIFIED | 122 dirs under `packages/` |
| `@hyperframes/engine`/`producer` 0.7.101 | VERIFIED | `packages/provider-hyperframes-local/package.json:25-26` |

**Source spot-checks (12, all correct)**

- `examples/ranking-football/reference.svml:34`: `<HOST>Ronaldo is <D | Dee> tier. || Bro has @{hair-gel}…`. Exact.
- `packages/caption-fine/src/manifest.ts:99`: the stroke-width "a twentieth… past about a tenth… reads as a slab" summary. Exact.
- `packages/caption-fine/src/recipe.ts:3`: the enum has 24 values, but one is `"none"`, so it is **23 entrances + none**. Trivial.
- `skills/hypit/SKILL.md`: 321 lines. The routing table sits at ~257 with 55 rows. "Evidence and reading" is at :234, "Files are the memory" at :237, "Done means watched" at :249, Money at :212. "Hypit's strong production prior" is at :11.
- `packages/media-track/preview/{preview.svml,recipes.svs,build.svrun}` exist. `caption-fine/preview/Track.png` exists.
- `packages/markup/src/types.ts:168`: `SurfacePreview = { mediaType, path … }`.
- `packages/visual-ir/src/style.ts:5-8`: "components cannot silently extend the language by inventing another CSS…"
- `examples/semantic-composition/.../render.ts:45`: `.glass { … height:12%; backdrop-filter:blur(9px); background:rgba(20,40,40,.15) }`. Exact.
- `provider-hyperframes-local/src/browser.ts:70`: `~/.cache/hyperframes/chrome`.
- `references/production/vocabulary.md:6`: "Search from the role".
- `.claude/skills/hypit -> ../../skills/hypit`: the symlink exists.
- README: tagline, "64 headless Chromium processes", "$1.15" all present.

**Omission worth knowing:** the README's "NICE RIDE" example does "head-tracked speaker-coloured
captions driven by face bounding boxes from Google Video Intelligence and YOLOv8 AnimeFace". That
is hypit's answer to two of editing-styles.md's top gaps (face tracking, per-speaker caption colour),
and it uses a hosted Google API, which bay's network rules would exclude.

---

## 4. Draft skill bodies: tool and parameter violations

Every backticked snake_case name in editing-styles.md exists in `src/shared/tools/`. The only
non-tool is `duplicate_project`, which the doc correctly names as absent. The violations are in
parameters, values and usage.

| Style | Step | Violation | Fix |
|---|---|---|---|
| 1 Hormozi | 4 | `set_canvas preset 1080×1920` is not a preset id | `preset: 'vertical-1080'` |
| 1 Hormozi | 6 | Ease `easeOut` does not exist | `ease: 'out'` |
| 1 Hormozi | 10 | "`duck` on the voice track" is backwards | Set `duck: { keyTrackId: <voice track> }` on the **music** clip. |
| 1, 5, 7, 8… | several | "`edit_item` layout scale/left/top" | Top-level `scale`, `left`, `top` (px). There is no `layout` param. |
| 6 Travel | 7 | "Check each clip's fps with `inspect_item`": no tool returns source fps | Drop the step, or add `fps` to `browse_assets`/`inspect_item` first. |
| 6, 10, 11, 17 | ramp steps | "Only for ≥50/60 fps sources": uncheckable for the same reason | As above |
| 6 Travel | 6 | "split into 5 equal parts with speeds…". `speed` changes each part's length (0.45 more than doubles it) and it stops at the next clip unless `ripple: true` | Say `ripple: true` and that the parts will not stay equal. |
| 9 Kinetic | 9 | "album art blurred (static `adjustments` blur)" | Valid. Noted only because §3's gap statement contradicts brf's keyable blur. |
| 12 Lo-fi | 2 | `set_canvas` 1440×1080: no preset | Pass `width: 1440, height: 1080`. |
| 13 News | 8 | L-cut via `detach_audio`/`trim_item` | `edit_item.audioLeadFrames` / `audioTrailFrames` |
| 13 News | 10 | "`add_captions` (≤42 chars/line, ≤17 cps)" reads like parameters; 17 cps is Netflix's *children's* rate | These are rules the agent applies when building `cues`, not params. Use 20 cps for adult English. |
| 17 AMV | 9 | "duplicate the clip above itself": no duplicate tool | `place_asset` the same asset on a higher track at the same `atFrame`, then match in-point with `trim_item`/`edit_item.sourceStartSeconds`. |
| 18 DITL | 1 | "by file creation time": not exposed | Remove it. Use visual cues plus user confirmation only. |
| 19 Interview | 11 / "How bay does it" | `add_captions` `clean` | `add_subtitles` `style: 'clean'`, or `add_captions` with a `style` object. |
| 19 Interview | 7 | L-cuts | `audioTrailFrames` / `audioLeadFrames` |
| all ramps | — | "stepped speed via split + speed" | Valid, and correctly disclosed as stepped. |

---

## 5. REQUIRED corrections before implementation

1. **Remove or re-source the unsourced quotes and numbers** before any appears in a skill body or
   user-facing text: UGC timing structure and "15–30 s sweet spot" (Stackmatix says 9–15 s), the
   3×3×3 matrix, "voice carries the energy" (Joyspace says the opposite), "deceptively simple",
   Recast's "faces outperform waveforms" and speaker labels, Inside Editors' flash frames, Blare's
   Superhuman/Stripe lines, Shootsta's listener-cutaway line, "93% use sound", and 150–200% zoom
   (relabel [E]).
2. **Fix the wrong numbers:** the arXiv ads were **99 real ads** (70 were AI-generated), and
   Netflix is **20 cps adult / 17 cps children**. Also fix `entertaining-editing.md`, which carries
   the same cps error. The DOAC payoff should read "measured 55–69%, target band 55–80%".
3. **Fix the skill-body parameter errors in §4**, above all `easeOut`, the preset id, duck
   direction, `add_captions clean`, and the uncheckable fps steps. An agent following these will
   fail or silently do the wrong thing.
4. **Correct the bay-capability statements:** 16 blend modes, not 12; no static `rotation`; brf
   *does* have keyframable blur and blur/wipe entrances; J/L cuts exist as
   `audioLeadFrames`/`audioTrailFrames`; source fps and creation time are not exposed to the agent.
5. **hypit.md §4a:** replace "skills stay user-invoked" with the current behaviour (Claude
   auto-loads matching skills, `prompt.ts:66`; Codex needs `/name`), and 15 → 14 skills. Add
   licence clause 1a.
6. **References:** replace `@SamKolder` (404) with samkolder.com or a working video. Use `@stripe`,
   not `@StripeDev`. Relabel `@johnnyharris` (Vox Borders is on `@Vox`). Re-check Manfrotto, which
   hit 429.
7. **Add `[I]` to the tag legend or retag it.** Retag FlexClip's CapCut range from [P] to [C].
8. **style-clips.md does not exist.** Nothing that depends on "raw clips with licences and audio"
   can be implemented until it is written and audited.

## 6. Safe to implement (verified inputs only)

- Tubefilter's 38 → 23 cuts/min contrast and MrBeast's "slow down" quote, labelled as n=1 minute.
- PandaStudio's MKBHD (7.4/min, verdict hold at 72–92%), Fireship (~13/min) and DOAC figures
  (4.1–6.3 s cuts, 1–3-word yellow/white captions, dry audio, 1–1.5 s cutaways), labelled
  vendor-measured with n=3.
- ShotBook ramp numbers, ANFX lower-third timings, Calliope's 1–3 s Vox cuts, Frameo's 5–15% Ken
  Burns, CapCutGuide's 4–5 ramp points, TikTok's 6 s/90% ad-recall figure, Guo et al.'s 6-min
  plateau, and Riverside's fonts.
- The tool mappings of styles **1, 3, 4, 5, 7, 9, 13, 14, 15, 16** once the §4 parameter fixes are
  applied. They rely only on verified tools: `transcribe`, `remove_range`, `add_subtitles` designs,
  `write_brf`, `add_template`, keyframes, grade and mastering.
- From hypit.md: every **idea** in §3 and §4 (parameter docs that carry design judgment, previews
  rendered from checked-in sources, the coarse→fine reference-analysis method, word-anchored
  placement, a style catalog with search/read tools). They must be written from scratch in bay's
  words, with **no hypit code, prose, kits or images copied**.
- The gap ranking in editing-styles.md as a *direction* (SFX library, speed curves, reframing,
  diarisation). Treat the counts as [E], and remove "keyframeable blur" for brf from the gap list.
