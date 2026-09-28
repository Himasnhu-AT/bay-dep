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
| `editing-styles.md` | **Usable with corrections** | The measured core holds up: Tubefilter, PandaStudio MKBHD/DOAC/Fireship, ShotBook, ANFX, Guo, Calliope and TikTok's 6 s/90% all check out. But **12 quotes or numbers are not in the source they cite**, **3 claims are wrong**, and several bay-capability statements are wrong in both directions. Every draft skill names real tools. Six parameter or usage errors would make the agent's calls fail or do the wrong thing. |
| `hypit.md` | **Trustworthy, one stale claim** | The licence is quoted accurately, and every file path and line I checked (12) is right. Stats are within a day's drift. There are two errors: "skills stay user-invoked" is stale, and bay has 14 skills, not 15. One omission matters: licence clause 1a (no multi-tenant or SaaS use). Its licence conclusion is correct and conservative. |
| `podclip.md` | **Usable with corrections** (§8) | All algorithm numbers and file:line refs check out, and both claimed defects reproduce. The doc missed that its leading-cut defect defeats podclip's one-state refusal, so its Safety and one-mic claims are wrong. The smart-mode table compares SigLIP scores across searches, which `search_footage` says is invalid. |
| `threejs.md` | **Trustworthy, small corrections** (§9) | Route A reproduced with real three r186 under bay's own sandbox filter. The worker-GPU claim is confirmed and broader than stated: WebGL2 shaders, `readPixels` and the unmasked GPU name all work after lockdown. **Priority fix now, not with 3D.** The r160 → r161 date is wrong and the bundle estimate is low. |
| `masking.md` | **Usable with corrections** (§10) | Every licence, hash, revision and exclusion checks out, and MODNet can be bundled (licence copy + attribution; no NOTICE). The compositor design and the two-element drift warning are real. The two sizing estimates are wrong, both measured: MODNet ~83 ms/frame (not 15–40; CoreML is slower) and ~90 KB per 1080p matte (~1.6 GB per 10 min). Apple Vision is reachable through JXA with no native addon. |
| `style-clips.md` | **Trustworthy** (§7) | 11 licences checked on the live source: 8 Commons files (API `extmetadata` + wikitext) and 3 Mixkit pages. All match, including which reviews are pending and which passed. Three speech clips range-fetched and re-measured: streams, levels, pause counts and whisper openings all reproduce. One soft spot: the Mixkit **music** licence could not be confirmed, because the cited page redirects. Its self-reported gaps are accurate. |

Counts across both documents: **WRONG 10**: 3 web claims (arXiv count, Netflix cps, the "deceptively simple" attribution), 6 bay
capabilities in editing-styles.md (blend-mode count, static rotation, canvas preset id, brf blur
"gap", source fps check, `add_captions clean`) and 1 in hypit.md (skill count). **UNSOURCED 12**
(§1 rows 17, 18, 19, 21, 26, 28, 29, 31, 39, 40, 43, 46). style-clips.md adds **1 unverified
licence** (Mixkit music) and no WRONG. **STALE 1** (hypit "skills are
user-invoked"). VERIFIED ~50. PARTIAL 8.

---

## 1. editing-styles.md: quantitative and quoted claims

| # | Claim (style) | Status | Evidence |
|---|---|---|---|
| 1 | MrBeast 38 cuts/60 s ("I Paid A Real Assassin…", Mar 2023) vs 23 ("…Abandoned City", 2024) (§2) | **VERIFIED**, n=1 minute per video | Tubefilter counted "one minute of footage from the midpoint of each video". https://www.tubefilter.com/2024/03/04/mrbeast-editing-style-number-of-cuts-per-video/ |
| 2 | MrBeast tweet, 3 Mar 2024: "slowed down… let scenes breathe… our views have skyrocketed"; "ultra fast paced/overstim era" | **VERIFIED** | Same page, verbatim: "…longer videos, etc. And our views have skyrocketed! My fellow YouTubers lets get rid of the ultra fast paced/overstim era of content." |
| 3 | "So the current style is ~23 cuts/min" (§2, and skill step 6 "hold near 23") | **PARTIAL**: over-generalised | One 60 s sample of one video. Fine as a target but not as "the style". The skill's 15–35 band is [E] and should say so. |
| 4 | MKBHD 7.4 cuts/min (6.4–8.9), median shot 3.6–6.7 s, 48% TH / 43% B-roll, hook 1.1–1.9× body, one 32–55 s hold at 72–92% (§3) | **VERIFIED**, n=3 videos | https://www.writepanda.ai/blog/mkbhd-editing-style-measured/ PandaStudio is an AI-tool vendor, so [M] means "vendor-measured, 3 videos". |
| 5 | Fireship ≈13 cuts/min (§14) | **VERIFIED** | The MKBHD page says "Fireship runs about 13 per minute". The primary figure is in PandaStudio's own Fireship article: "11.8 to 15.4 hard cuts per minute across the three videos, 13.3 aggregate" (https://www.writepanda.ai/blog/fireship-editing-style-measured/). Cite that one. |
| 6 | DOAC: cut every 4.1–6.3 s, ~2.5–3 s near payoff, 1–1.5 s reaction cutaways, 1–3 words, 60–70% height, host yellow / guest white, "completely dry", B-roll 0–6.5% (§4) | **VERIFIED**, n=3 clips | https://www.writepanda.ai/blog/how-diary-of-a-ceo-edits-podcast-clips/ |
| 7 | DOAC clips 66–139 s; payoff "lands at 55–80%" [M] | **PARTIAL** | Measured 65.8–138.6 s. Measured payoffs are **55/62/69%**. "55–80%" is the article's *recipe target band*, not a measurement. The tag should be [C] for 80. |
| 8 | ~5.1 s on emotional material (§4) | Not re-checked | — |
| 9 | Social cinematic ads **1.2 s** avg shot, "**70 ads**, 17.9 s" [M/R] (§8) | **WRONG** (count) | arXiv 2608.24329 (Law, Li, Narechania, 25 Aug 2026). 1.2 s and 17.9 s come from Study 1b's **99 real Meta/TikTok ads**. The **70** are the paper's *AI-generated* ads for Study 2. Correct: "99 human-made social cinematic ads". https://arxiv.org/html/2608.24329 |
| 10 | Guo, Kim & Rubin L@S 2014: 6.9M sessions, ~6 min plateau, talking head + slides > slides, Khan-style > PPT (§3, §14) | **VERIFIED** | https://dl.acm.org/doi/10.1145/2556325.2566239 (abstract and summaries). |
| 11 | TechSmith: most-desired instructional length 10–19 min; 30–35% prefer 3–6 min (§14), tagged **[I]** | **PARTIAL** + tag error | Secondary summaries of TechSmith's viewer study say ">30% preferred 3–6 min, the most popular band" *and* "most desired length… 10–19 min". The sources are internally inconsistent. The blog URL cited (techsmith.com/blog/video-length) says neither. **`[I]` is not in the doc's tag legend.** |
| 12 | Microlearning 2–6 min, demos 5–10 min (§14) | **VERIFIED** | https://www.techsmith.com/blog/video-length/ |
| 13 | Lower third held 4–7 s (2–3 s repeat), in 0.3–0.7 s, out 0.3–0.5 s, ≥~96 px left/bottom, secondary 50–65% (§13) | **VERIFIED** | https://anfx.co/blog/lower-thirds-design-rules-free-templates/ Note: 96 px is ~5% of 1920 (action-safe). The skill's step 5 demands the 10% title-safe area (192/108 px). Pick one. |
| 14 | Title-safe 10%, action-safe 5% [C, Motion Array]; "SMPTE convention" | **PARTIAL** | No Motion Array page states it. 10%/5% per edge is the legacy SD convention. SMPTE ST 2046-1 (HD) defines 93% action-safe and 90% title-safe *areas*, i.e. ~3.5%/5% per edge. Fine as a conservative rule, but it is not "SMPTE". |
| 15 | Speed ramps: travel 100%→35–50% over 10–15 f; "2–3 ramps max per 30–60 s"; sports 100%→10–20% over 4–8 f; "slow hold 8–15 frames" (§6, §10) | **VERIFIED** | https://shotbook.art/blog/how-to-find-and-use-speed-ramp-references-for-video-editing |
| 16 | Ken Burns 5–15% zoom (§15) | **VERIFIED** (5–15) | Frameo: "A zoom increase between 5 percent and 15 percent is typically effective." The "5–8% for subtlety" part was not found on Frameo. Cloudinary not fetched. |
| 17 | UGC structure: hook 0–3 s, value 3–15, proof 15–25, CTA last 5 s; "15–30 s sweet spot" [C, Stackmatix] (§16) | **UNSOURCED / contradicted** | Stackmatix says **"9–15 seconds typically outperform longer formats for direct response"** and has no timed structure. https://www.stackmatix.com/blog/tiktok-creative-best-practices-startups |
| 18 | "3×3×3 test matrix = 27 variants" [C, Stackmatix] | **UNSOURCED** | The article says "Launch 3–5 creative variants per ad group". |
| 19 | "Avoid heavy branding or cinematic polish that signals 'ad'…" [C, Stackmatix/Hustler] | **UNSOURCED** at Stackmatix | The idea is there ("polished, clearly-produced advertising" underperforms), but not the quote. Hustler not fetched. |
| 20 | TikTok: first 6 s carry 90% of ad-recall impact [P] | **VERIFIED** (secondary) | TikTok Marketing Science, via Social Media Today: "first 6 seconds capture 90% cumulative impact on Ad Recall". https://www.socialmediatoday.com/news/tiktok-shares-new-notes-maximize-ad-effectiveness/694989/ |
| 21 | "93% of top-performing TikTok videos use sound" [P] | **UNSOURCED** (no primary found) | The doc already flags this as secondary. Keep it out of skills until a TikTok page is found. |
| 22 | OpusClip: emojis/animations "increase numbers of views by 42% on average" | **VERIFIED** as quoted, and correctly flagged as marketing | https://www.opus.pro/blog/create-videos-in-alex-hormozi-style-the-ultimate-guide |
| 23 | OpusClip calls Hormozi style "deceptively simple — one person, one camera, minimal B-roll" (§1) | **WRONG attribution** | Not on OpusClip. The quote is Choppity's: https://www.choppity.com/tools/recreate-video-editing-style/alex-hormozi/ |
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
| 34 | MrBeast editors cut "over 10 hours of footage" per video [C, C4E] | **PARTIAL** | "Editors cut over 10 hours of footage into a seamless arc" describes one video (Squid Game). The same page says "A single shoot can generate hundreds of hours of footage". "Per video" overstates it. |
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
| 46 | Manfrotto: three movements; "24 fps with manual exposure" (§7) | **PARTIAL / UNSOURCED** | "the hero product reveal, the details, and the product in context" is on the page. **24 fps and manual exposure are not** (a teammate searched the full HTML; my own fetch hit 429). |
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
   Superhuman/Stripe lines, Shootsta's listener-cutaway line, "93% use sound", Manfrotto's "24 fps,
   manual exposure", and 150–200% zoom (relabel [E]). Re-attribute "deceptively simple" to Choppity.
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
8. **style-clips.md:** re-confirm the Mixkit music licence on each track's live page before
   shipping (the `free-stock-music/<slug>-<id>/` URLs redirect to `/discover/`). Pick CC0/PD/Mixkit
   clips for anything bundled in the app. BY-SA picks (Candidate statement, both screencasts) pass
   share-alike onto the edited preview. The two pending-review files (CSS-Podcast, Intel) should
   not be the shipped hero until reviewed.

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

---

## 7. style-clips.md

Added after the file appeared. Checked 27 Sep 2026. Scratch files are in the session scratchpad
(`audit-clips/`), not the repo.

### Licences (11 checked on the live source)

| Pick | Claimed | Live source says | Status |
|---|---|---|---|
| Candidate statement (#1) | CC BY-SA 4.0, own work, Alhaj Darajaati | `{{self|cc-by-sa-4.0}}`, Artist User:Alhaj_Darajaati | **VERIFIED** |
| James, West Riding Yorkshire (#1 alt) | CC0, Wikitongues | `{{cc-zero}}`, Artist "Wikitongues Inc" | **VERIFIED** |
| CSS-Podcast 088 (#2) | CC BY 3.0, review **pending** | `{{YouTube CC-BY|Chrome for Developers}}` + bare `{{LicenseReview}}` | **VERIFIED**, including pending |
| Houston, We Have a Podcast (#2 alt) | PD-NASA, review passed 2025-12-25 | `{{PD-NASA}}`, `{{LicenseReview|…|user=Sikander|date=2025-12-25}}` | **VERIFIED** |
| Intel i7 unboxing (#6/#10 alt) | CC BY 3.0, review pending | `{{YouTube CC-BY|The Nvidians}}` + bare `{{LicenseReview}}` | **VERIFIED** |
| Annotating the Schrödinger equation (#7) | CC BY-SA 4.0, Physikerwelt | `{{self|cc-by-sa-4.0}}`, User:Physikerwelt | **VERIFIED** |
| Duck and Cover (#8) | PD-USGov | `{{PD-USGov}}`, US Office of Civil Defense / Archer Productions | **VERIFIED** |
| Eagle Has Landed (#8 alt) | PD-USGov-NASA, YouTube review 2020-02-01 | `{{PD-USGov-NASA}}`, `{{YouTubeReview|…|date=2020-02-01}}`, US National Archives | **VERIFIED** |
| Yarn Unboxing (#10) | CC BY 3.0, YouTube review passed 2019-12-16 | `{{YouTubeReview|id=3ivUax2MIYw|…|date=2019-12-16}}`, CC BY 3.0 (Yarnspirations) | **VERIFIED** |
| Mixkit 43150 hiking selfie, 100874 vinyl (#4, #9) | Mixkit Free | Page shows "Mixkit Stock Video Free License", links `license/#videoFree` | **VERIFIED** |
| Mixkit 43150 / 34382 / 44070 / 3649 files | Stable `-1080.mp4` URLs | All `HTTP/2 200` | **VERIFIED** |
| Mixkit music "Let's Move" 836 (#11) | Free music licence (`#musicFree`) | `free-stock-music/lets-move-836/` **redirects to `/discover/lets-move-836/`**, where no licence text was found. The MP3 URL returns 200. | **UNVERIFIED** (not wrong; re-check) |

### Audio on 3 speech clips (4 MB range fetch → bay's vendored ffprobe/ffmpeg → whisper.cpp `ggml-base`, `-l en`)

| Clip | Claimed | Measured | Whisper, first 20 s |
|---|---|---|---|
| Candidate statement | opus mono, −21.8 dB, 41 pauses | `opus, 1 ch`, 270×480 vp9; mean **−21.8 dB**, **41** pauses (−35 dB/0.4 s) | "Hi everyone, my name is Abirrafi… in the Wikimedia movement I am known as…" **Speech: VERIFIED** |
| Yarn Unboxing | opus stereo, −18.9 dB, 2 pauses in 88 s | `opus, 2 ch`; mean **−19.0 dB**, 1 pause in this shorter range | "Hey everybody, Christy Glass here… thanks to my friends at Spinrite, I have an unboxing video…" **VERIFIED** |
| Annotating the Schrödinger equation | opus stereo, −32.0 dB, 30 pauses in 112 s | `opus, 2 ch`; mean **−32.3 dB**, 22 pauses in this range | "Hi, in this video, I'm going to demonstrate how to annotate the time-dependent [Schrödinger] equation…" **VERIFIED** |

### Self-reported gaps: all accurate

The travel pile is silent (Mixkit has no audio streams). The podcast pick's review is pending
(confirmed above). Clean screencasts are BY-SA only. UGC creators are identifiable, and the Yarn
video is sponsored ("thanks to my friends at Spinrite" is audible). One addition: the Candidate
statement speaker is an identifiable Wikimedia community member giving an election statement, so
the same publicity-rights caution applies to the #1 hero.

### Safe to use from style-clips.md

- For **bundling in the app** (no attribution, no share-alike): James/Wikitongues (CC0), Duck and
  Cover and Eagle Has Landed (PD), NASA SVS Artemis II (PD + credit line; I did not re-check that page), and the Mixkit video sets.
- For **demos with a credit line**: Yarn Unboxing (reviewed CC BY 3.0).
- **Not yet**: CSS-Podcast and Intel (review pending) and Mixkit music (licence page unconfirmed).
  BY-SA picks only if the edited preview is also released BY-SA.


---

## 8. podclip.md

Checked 28 Sep 2026 against `treydoe1/podclip-public-release` at **`bfb3371`**. The source files
were fetched raw at that commit into the session scratchpad (`podclip-raw/`). A full clone of the
51 MB repo was started in a unique `/tmp` dir and removed after the raw fetch. I ran podclip's
`decideEdits` in my own harness (`repro.js`, `repro2.js`). The harness slices the function out of
`panel.js` with the same boundary markers as podclip's own test and asserts both markers are found.

**Verdict: usable with corrections.** Every algorithm number and every file:line I checked is
right. Both claimed defects reproduce. Two claims are refuted, and the first matters more than the
doc realises: its §4.2 "redundant leading cut" defect **disables podclip's own one-state refusal**,
so the §2 "Safety" claim and §4.4's account of one-mic podcasts are both wrong. The bay-side claims
are all correct. The smart-mode signal table overstates two signals.

Counts for this doc: **WRONG 2** · **UNSOURCED 0** · PARTIAL 3 · VERIFIED ~30.

### 8.1 Licence and repo facts

| Claim | Status | Evidence |
|---|---|---|
| MIT, "Copyright (c) 2026 Podclip contributors" | **VERIFIED** | `LICENSE`, 21 lines, standard MIT text. GitHub API `license: MIT`. |
| Copying is allowed with the notice; recommend reimplementing | **VERIFIED** as a reading of MIT | MIT permits copy/modify/sublicense/sell, provided the notice goes "in all copies or substantial portions". The doc's handling is correct. |
| Created 2026-07-16, 13 stars, 5 forks, 0 open issues, 7 commits, last commit 2026-07-22 | **VERIFIED** | API: `created_at 2026-07-16T23:13:47Z`, 13 / 5 / 0, 7 commits, head `bfb3371` at `2026-07-22T03:50:16Z`. The doc's "(2026-07-21)" for `bfb3371` is the same instant in a US time zone. Repo size 51,366 KB. |
| No network use | **VERIFIED** (grep) | No `http`, `fetch`, `XMLHttpRequest` or socket use in `client/*.js`/`host/host.jsx`. |

### 8.2 Algorithm numbers (file:line at `bfb3371`)

| Number | Status | Source |
|---|---|---|
| 50 ms RMS windows (20/s) | **VERIFIED** | `client/analyzer.js:25` `SAMPLE_MS = 50`. `:214` samples per window. `:220-221` `astats=metadata=1:reset=1` + `ametadata … RMS_level`. `panel.js:397` repeats `SAMPLE_MS = 50`. |
| `-inf` → −120 dB; channel fallback when peak ≤ −100 dB | **VERIFIED** | `analyzer.js:288-289` and `:255` (`maxDb(samples) <= -100` → re-read channel 0). Also falls back when the channel index ≥ channel count (`:253`). |
| −50 dB threshold (slider −70…−10) | **VERIFIED** | `client/index.html:101` `min="-70" max="-10" value="-50"`. Per-mic override at `panel.js:519-521`. |
| 0.35 s attack | **VERIFIED** | `index.html:91` `ignoreShort … value="0.35"`. `panel.js:491` → `Math.round(0.35×20)` = **7** samples. |
| 0.45 s release, fixed | **VERIFIED** | `panel.js:492` `Math.round(0.45 * samplesPerSec)` = 9 samples. |
| 6 dB dominance, fixed | **VERIFIED** | `panel.js:481` `bestDb - secondDb >= 6`. |
| 0.12 s early cut (`leadIn`) | **PARTIAL** | The default is 0.12 (`index.html:96`), but `panel.js:494` rounds it to whole 50 ms samples: `Math.round(2.4)` = **2 samples = 0.10 s**. The slider value is never applied exactly. |
| 0.75 s min shot, fixed | **VERIFIED** | `panel.js:493` (15 samples). Used at `:573` (no cut sooner) and `:582`/`:623-639` (`smoothEvents`). |
| 0.10 s `delayCuts` | **VERIFIED** | `index.html:86`, `panel.js:490`, `:572`. |
| "Effective latency ≈ 0.33 s after onset" | **PARTIAL** | **Measured 0.30 s.** Speech starting at 0.50 s produced a cut at **0.80 s** (`repro.js`). The latch fires on the 7th hot sample (onset + 6), the delay adds 2 and the lead-in subtracts 2 → onset + 6 samples. |
| `pickCamera` rules: exact set → smallest superset → loudest single → hold | **VERIFIED** | `panel.js:423-442`, fallback `:550-554`, hold `:543-547`. |
| Line ranges cited: `decideEdits` 396-640, `dominantSet` 461-487, latch 514-538, debounce 565-579, prepend 588-590, segments 592-617, `smoothEvents` 623-639 | **VERIFIED** | Exact. |
| `host.jsx`: active-sequence check 236-238, swallowed razor error 262-268, midpoint toggle 273-285, hand-built HH:MM:SS:FF 297-309 | **VERIFIED** | Exact. The timecode builder uses `Math.round(fps)` with no drop-frame handling, which supports the doc's (untested) drop-frame concern. |
| Clip speed ignored | **VERIFIED** (read) | No `speed` anywhere in `analyzer.js`/`host.jsx`. |

### 8.3 The two claimed defects

**(1) `wideFreq` low/medium/high are identical: REPRODUCED.** `allowMulti` is computed at `:541`
and never read inside `pickCamera` (`:423-442`), and `wideFreq` is otherwise compared only with
`"off"` (`:545`; the only other uses are UI, `:71`, `:135`). On a 12 s two-speaker curve with a 2 s
equal-level overlap and a V3 wide tagged A1+A2, the serialised output of `low`, `medium` and `high`
was **byte-identical** (`low==medium true, medium==high true`). Positive control: `off` differed
(`off==medium false`), so the harness can see a setting change.

**(2) No-op leading razor: REPRODUCED**, with a consequence the doc missed. Same run, V1 segments
`[0,0.8]ON [0.8,5.3]ON …`: a boundary at 0.8 s between two enabled segments of the same camera.
The prepend at `:588-590` fires whenever the first cut is past sample 0, and it always is, because
the latch needs 7 samples. **Consequence:** the refusal at `panel.js:763` is `eventCount <= 1`, and
the prepend makes every non-silent run at least 2 events. In `repro2.js`:

| Input | eventCount | Cameras actually used | Panel refuses? |
|---|---|---|---|
| Only A1 speaks, from 1 s | 2 | V1 only | **no** |
| Only A1 speaks, from 0 s | 2 | V1 only | **no** |
| Silence on both mics (control) | 1 | V1 | yes |

So the "refuses to write when analysis finds only one camera state" safety (§2) holds only for
total silence. A dead or mis-thresholded second mic, or one mixed track on every lane, **passes
the guard**. With one mixed track, both lanes are identical, dominance is 0 dB and the set is
{A1,A2}, so the wide is chosen: one state, still written. podclip then duplicates the sequence and
razors it with no visible change.

### 8.4 Claims about bay

| Claim | Status | Evidence |
|---|---|---|
| `Item.disabled` exists, with podclip's meaning, via `playableTimeline` | **VERIFIED** | `src/shared/project.ts:537-542` (field + doc) and `:951-975` (`playableTimeline`). |
| The store toggles it; **no agent tool sets it** | **VERIFIED** | `src/renderer/src/store/slices/editing.ts:136-148`. No `disabled` in any `src/shared/tools/*.ts` or `src/renderer/src/mcp/*.ts`. |
| `afftdn`, `arnndn`, `silencedetect` required by the build and pinned by the capability test | **VERIFIED** | `script/build-ffmpeg.sh:67` `REQUIRED_FILTERS`, `src/main/ffmpeg/capabilities.test.ts:201`. The vendored binary lists all three (`vendor/ffmpeg/darwin-arm64/ffmpeg -filters`). `vendor/ffmpeg/README.md:58`: "`arnndn` is compiled in but needs a model file… none is shipped". |
| "No code uses any of them" | **VERIFIED** | `git grep` finds them only in the build script, the capability test's list and docs. |
| "`acompressor` is not in the required list yet" | **VERIFIED**, with an addition | It is not in `REQUIRED_FILTERS`, but the vendored binary **does include it** (`.. acompressor`), as it does `astats`. A compressor needs a required-list entry, not a rebuild. |
| `waveform.ts` decodes mono s16le at 8 kHz | **VERIFIED** | `src/main/media/waveform.ts:4-6, 19, 79` |
| `src/main/vision/` is SigLIP only; no face detector anywhere | **VERIFIED** | `vision/` holds encoder/indexer/sampler/tokenizer/worker. No face/detector code in `src/`. One frame per 2 s: `src/shared/visual-search.ts:123`. |
| Tool list (59 files incl. `read_style`, `search_styles`, `write_style`), 15 skills incl. `style-from-reference`, 6 styles | **VERIFIED** (today's tree) | This supersedes §2's "14 skills", which was true on 27 Sep before `style-from-reference` landed. |
| `docs/research/editor-features.md` #7 silence/filler, #8 scene detection, #10 noise | **VERIFIED** | Lines 57, 58, 60. |
| `Asset.channels` at `project.ts:56-59` | **VERIFIED** | Also returned by `browse_assets` when recorded. |
| whisper.cpp `-di` / `-tdrz` | Correctly labelled **unverified** | bay passes neither today (no match in `src/main`). |

### 8.5 Are the smart-mode signals computable today?

| Signal (§6.2) | Computable now? | Note |
|---|---|---|
| Aspect, resolution, duration | **Yes**: in-app from `Asset`, and via `browse_assets` | — |
| fps | **In-app yes, agent no** | `Asset.fps` exists (`project.ts:52`), but `browse_assets`/`inspect_item` do not return it (see §2). The doc cites `probe.ts → Asset.width/height/durationUs` and does not mention fps's path. |
| Audio channels | **Yes** | `browse_assets.channels`, only when import recorded it. |
| Speech ratio | **Yes**: `transcribe` cues | Cost is as stated. |
| Concurrent sources by equal duration | **Yes** | Durations are in `browse_assets`. |
| Mic energy overlap | **No, needs new code** | Correctly marked **new** (`media/levels.ts`). |
| Cut rate | **Yes**: `detect_cuts` | — |
| Music vs speech | **Yes** | `detect_beats` returns `confidence` (`src/renderer/src/mcp/beats.ts:89`). |
| Screen-recording look via SigLIP; "two people" > "one person" | **WRONG as specified** | `search_footage`'s own contract says **"Scores are only comparable within one search"** (`src/shared/tools/search-footage.ts:14`). Comparing the scores of two separate queries, or thresholding a "UI score", is exactly what that forbids. Needs an in-app classifier that scores several prompts against the same embeddings in one pass (the embeddings exist). That is new code, not a current tool. |
| Face count | **No** | Correctly marked none. |

Probe-only classes (multicam podcast by matching durations, B-roll pile) are computable today. The
one-mic podcast, talking-head-vs-podcast and screen-recording classes depend on the SigLIP
comparison above, so they need new code.

### 8.6 Required corrections to podclip.md

1. **§2 Safety and §4.4:** podclip does **not** reliably refuse a one-state result. The
   leading-cut prepend makes `eventCount ≥ 2` for any non-silent input, so a single-speaker or
   single-mixed-track run is duplicated and written. Promote §4.2 from "a razor that changes
   nothing" to "defeats the refusal guard", and give bay's `switch_speakers` a test for it: refuse
   when **distinct cameras used** is 1, not when the event count is 1.
2. **§6.2 smart mode:** replace the cross-query SigLIP comparisons with "score N prompts against the
   same frame embeddings in one pass (new code)". `search_footage` scores are not comparable across
   searches. Mark fps as in-app only.
3. **§3.2:** lead-in is effectively **0.10 s** (rounded to 50 ms samples), and the measured
   onset-to-cut latency is **0.30 s**, not ≈0.33 s. bay's version should work in frames, not
   rounded 50 ms samples.
4. Minor: `acompressor` and `astats` are already in the vendored binary. Only the required-list
   entry and capability pin are missing.

### 8.7 Safe to implement from podclip.md

- `disabled` on `edit_item` (S). The field and its semantics are already in bay.
- `find_silences`/`remove_silences` on `silencedetect` plus transcript gaps. The filter is shipped
  and unused.
- `switch_speakers` as specified in §6.1: latch/bleed/tag-set/debounce/min-shot, reimplemented in
  frames, with the two reproduced defects **and** the refusal-guard fix above built in. The idea
  is MIT; if any line is copied, carry the notice.
- Smart mode's probe-only classes (multicam podcast, B-roll pile).

---

## 9. threejs.md

Checked 28 Sep 2026. Probes ran in **bare Electron 44.4.3** (the same binary bay uses) from the
session scratchpad (`brf-gpu-probe/`, `routeA-probe/`), each with a fresh `mktemp -d
/tmp/audit-*-XXXXXX` user-data dir that was removed afterwards. The running bay instance was not
touched. bay's real lockdown (`src/shared/brf-lockdown.ts`) and composition request filter
(`src/main/html/sandbox.ts`) were loaded by type-stripping the source files, not re-typed.

**Verdict: trustworthy, with small corrections.** Route A's three measured claims reproduce, and
this time with a real three.js (r186) rather than a raw triangle. The worker-GPU claim is **real
and broader than the doc says** (§9.2). One version fact is wrong (r160 → **r161**), and the bundle
estimate is low for current three.js. Every bay code reference checked is correct.

Counts for this doc: **WRONG 1** · **UNSOURCED 0** · PARTIAL 3 · VERIFIED ~20. Plus **1 priority
security finding** (confirmed and extended) and 1 side finding in bay's own guide.

### 9.1 Route A (three.js inside HTML compositions): reproduced

Window configured exactly as `compositions.ts:309-345`: `show:false, transparent, backgroundColor
'#00000000', frame:false, offscreen:false, sandbox:true, contextIsolation:false`, its own
partition, with bay's `decideCompositionRequest` installed on `onBeforeRequest` and permissions
denied. The page loaded three r186 through an import map
(`{"three":"./three.module.min.js"}` → `./three.core.js`), drew a 0.5×0.5 red plane at `x = t` in
an ortho camera over a transparent clear, with a 100×100 green DOM box on top, and registered
`window.__timelines.probe.time(t)`.

| Claim | Status | Measured (640×360 capture, resized like `compositions.ts:476`) |
|---|---|---|
| Module scripts + import maps load inside the composition sandbox | **VERIFIED** | `moduleLoaded: true`, `THREE.REVISION` "186". The filter blocked only the two control URLs. |
| `capturePage` keeps WebGL output | **VERIFIED** | 14,396 red pixels vs 14,400 expected (160×90) at both t. |
| Transparency is preserved | **VERIFIED** | 204,804 of 230,400 pixels had alpha 0. The green DOM box kept all 10,000 pixels. |
| Frames follow `t` | **VERIFIED** | t=−0.6: left probe `[255,0,0,255]`, right `[0,0,0,0]`. t=+0.6: swapped. |
| The sandbox still blocks the network and outside files (positive control) | **VERIFIED** | `fetch('https://example.com')` and `fetch('file:///etc/hosts')` were both refused, and both appear in the filter's blocked list. |
| "Seek + capture 10–23 ms" | Not re-measured | Main-process side only, as the doc says. |

I did not use bay's preload or `seekScript` (`scripts.ts:71-79`, which waits two rAFs). I called
`time(t)` directly, which is the harder case. The code paths cited (`compositions.ts:309-345`,
`:460-480`, `MAX_WINDOWS = 8` at `:73`, the always-resize at `:467-476`) are correct.

### 9.2 PRIORITY: the `.brf` worker can still reach the GPU

**Confirmed, and wider than stated.** `OffscreenCanvas` is not in `REMOVED_GLOBALS`
(`brf-lockdown.ts:35-66`). I ran the real `lockdown()` in a real Chromium worker, and a
second, un-locked worker as a positive control that the probe can see each API:

| After `lockdown()` | Result |
|---|---|
| `fetch`, `navigator` (global **and** prototype) | `undefined`. The lockdown works for what it lists. |
| `OffscreenCanvas` | **function** |
| `new OffscreenCanvas(256,256).getContext('webgl2')` | **a live WebGL2 context** |
| `WEBGL_debug_renderer_info` | **`"ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro…)"`**, vendor "Google Inc. (Apple)", `MAX_TEXTURE_SIZE` 16384 |
| Compile and link a GLSL ES 3.0 program, draw, `readPixels` | **ran**: pixel `[255,0,0,255]` |
| `getContext('webgpu')` | returns a context object. **Not usable** without a `GPUDevice`, and `navigator` (so `navigator.gpu`) is gone. Untested beyond that. |
| `WebAssembly`, `createImageBitmap`, `performance.now`, `crypto.subtle` | present (WebAssembly deliberately so: `test/app/brf-sandbox.mjs:136-145`) |

Nothing in the worker needs it: `OffscreenCanvas`, `getContext` and `measureText` appear nowhere in
`brfWorkerCore.ts`, `brf-code.ts` or `brf.ts`. The compositor's own `OffscreenCanvas` use
(`engine/brf.ts:398-433`) is in the renderer, not the worker.

**Is it a security issue?** It matters because a `.brf` is untrusted input: CLAUDE.md treats a
`.bay` as possibly "someone else's", and an agent reading injected text can write one.

- **Data exfiltration: low.** The GPU is not a way out. Every network door is removed and main's
  `offline.ts` stands behind them. The worker has its own GL context and cannot sample the
  compositor's textures or video frames. What it gains is a hardware fingerprint, and the only
  place that can go is the module's own scene output: pixels in the preview or in an exported file
  someone may share.
- **Denial of service: the real risk (untested here, deliberately).** A module can allocate
  textures up to 16384² or submit a pathological shader. That work runs in the **renderer's shared
  GPU process**, the same one that holds the compositor's grade context (`engine/grade.ts`, "a
  page at ~16 live contexts"). The 3 s `TIMEOUT_MS` terminates a worker that does not *answer*.
  It does not recall GPU work already submitted, and a module can answer promptly while leaving
  the GPU loaded on every chunk it renders. A GPU watchdog reset loses every WebGL context in the
  editor, grade included, which is the "context loss that takes grade down too" risk the doc
  assigns to route B. I did not run a GPU hang on this machine, because a GPU reset on macOS can
  take other apps' rendering with it.
- **Fingerprinting: low to medium.** The unmasked renderer string plus timing is a stable device
  identifier. It is only useful combined with an output channel (above).

**The fix, and what it removes:** add `'OffscreenCanvas'` to `REMOVED_GLOBALS`. That one entry
removes, from user code, every way to create a canvas in a worker, and with it: WebGL and WebGL2
contexts (shaders, `readPixels`, the renderer string), the WebGPU canvas context, and 2D canvas
(`measureText`, which the worker does not use). Context interfaces
(`WebGL2RenderingContext`, `GPUCanvasContext`) are not constructible without a canvas, so they
need no entry. The lockdown loop already walks the prototype chain, so a single entry covers it.
Tests:

1. `brf-lockdown.test.ts`: `OffscreenCanvas` is `undefined` on the global and its prototype chain.
2. `test/app/brf-sandbox.mjs`: a module that tries `new OffscreenCanvas(1,1).getContext('webgl2')`
   is refused.
3. Positive control, paired with 2: an ordinary `.brf` still renders.

The doc proposes this only "when 3D lands". **It should land now, independently of any 3D
work.** It is a one-line change with a measured exposure, and it is the `FontFace` pattern
(`brf-lockdown.ts:56-59`) again: a platform API nobody listed.

### 9.3 Licence and bundle facts

| Claim | Status | Evidence |
|---|---|---|
| three.js MIT | **VERIFIED** | npm `three@0.186.1` `license: MIT`; LICENSE "Copyright © 2010-2026 three.js authors". |
| opentype.js MIT | **VERIFIED** | npm `opentype.js@2.0.0` `license: MIT`. Its WOFF2 and `VariationManager` claims were not checked. |
| troika-three-text: `blob:`/eval'd worker and a CDN default font | **PARTIAL** | The troika docs confirm both: "Default: The Roboto font loaded from Google Fonts CDN", and a restrictive CSP "blocks how troika-three-text creates its web worker". But they also give `configureTextBuilder({ useWorker: false })`, and the font is a parameter, so it is not unfit as a matter of fact. MIT (`troika-three-text@0.52.5`). |
| "r160 removed `build/three.js` and `three.min.js`" | **WRONG** | jsDelivr's file lists: **r160 still ships** `three.js`, `three.min.js` and `three.cjs`. **r161** is the first without them. |
| Ship `three.module.min.js` as the route A vendor file | **PARTIAL** | Current three (r186) no longer ships *any* minified build in npm. `build/three.module.js` (662,772 B) imports `./three.core.js` (1,458,113 B). A vendor folder needs **two** files, minified by bay's build. The file I loaded was jsDelivr's on-the-fly minification. |
| WebGLRenderer bundle "600–700 KB minified" | **PARTIAL** (low) | `three.module.min.js` 392,831 B + `three.core.min.js` 415,816 B = **~809 KB minified** (~195 KB gzip) for the full build. A tree-shaken `WebGLRenderer` import through Vite will be smaller, but that is unmeasured. Either way it goes in a lazy chunk, as the doc says. |
| three.js `WebGLRenderer` accepts `OffscreenCanvas` | Not re-checked | Plausible (docs cited). Route B's slice will prove or disprove it. |

### 9.4 Claims about bay's code

| Claim | Status | Evidence |
|---|---|---|
| `CHUNK_SECONDS = 0.5`, `TIMEOUT_MS = 3000`, one worker per module, terminated | **VERIFIED** | `engine/brfCode.ts:44, 46, 80, 200` |
| `.brf` painted to an `OffscreenCanvas` surface, then through `#drawSource` | **VERIFIED** | `engine/brf.ts:397-433` (`BrfSurfaces`), `compositor.ts:606-647` (`#drawSource` at `:370`, the brf call at `:647`) |
| `GradeContext`: one `OffscreenCanvas`, `premultipliedAlpha`, `preserveDrawingBuffer`, `webglcontextlost`, ~16-context note, samplers fixed "for the life of the context" | **VERIFIED** | `engine/grade.ts:24, 257-296`. "Life of the context" is at `:296` (the doc says `:293`, close). `MAX_EDGE = 4096` at `:76`. |
| Composition windows, 8 max, transparent, always resized | **VERIFIED** | §9.1 |
| Renderer CSP: `script-src 'self'`, `connect-src 'self' bay:`, no `worker-src` | **VERIFIED** | `src/renderer/index.html:13` |
| Fonts are content-addressed assets (`media/font-file.ts`) | **VERIFIED** | The file exists. The pipeline is as in CLAUDE.md. |
| No three.js in `package.json`; no bundled font in `resources/` | **VERIFIED** | `resources/` holds only `styles/`. No three/opentype/troika in `package.json`. |
| The contract warns a CDN tag "renders as a still frame"; the guide says to vendor | **VERIFIED** | `src/main/mcp/docs/editing.md:314`, `src/shared/composition.ts:287` |

**Side finding (not in threejs.md):** bay's own composition guide contradicts that rule. Its
example code loads GSAP from a CDN,
`<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js">`
(`src/main/mcp/docs/compositions/minimal-composition.md:19`, `composition-patterns.md:53`). §9.1
measured that the composition sandbox cancels exactly that request, so an agent copying the
example gets a still frame. The examples should use a vendored `./gsap.min.js`.

### 9.5 Required corrections to threejs.md

1. **Promote the lockdown fix out of the 3D plan:** remove `OffscreenCanvas` from the `.brf` worker
   now (§9.2), with the three tests above. Describe the exposure accurately: WebGL2 with shader
   execution and `readPixels`, plus the unmasked GPU string, not only "can reach the GPU".
2. `build/three.js` / `three.min.js` were removed in **r161**, not r160. Current three ships
   `three.module.js` + `three.core.js`, unminified, so route A's vendor folder is two files that
   bay minifies.
3. Bundle: the full WebGLRenderer build is ~809 KB minified / ~195 KB gzip. Keep the estimate
   only for a measured tree-shaken chunk.
4. troika: "does not fit as it stands" → "needs `useWorker: false` and an explicit font. Still
   second choice to opentype outlines for extruded text."

### 9.6 Safe to implement from threejs.md

- The `OffscreenCanvas` removal (now), which is a security fix and independent of 3D.
- Route A documentation plus a vendored three folder. It is measured to work under bay's real
  sandbox rules, and it adds no new attack surface: any composition can already use WebGL.
- Route B's design (a data-only `<scene3d>` in the worker, one long-lived renderer context in the
  engine, caps checked before geometry, `pending` and context-loss handling), as a design to be
  proven by its own parity probe. Its performance figures are estimates and are labelled as such.

---

## 10. masking.md

Checked 28 Sep 2026. Scratch work is in the session scratchpad (`matte-audit/`). I downloaded the
pinned MODNet file and a 1080p Mixkit clip with two people (43150, Mixkit Free), ran MODNet through
the repo's own `onnxruntime-node` 1.30.0, encoded mattes with bay's vendored ffmpeg, and called
Apple Vision through `osascript -l JavaScript`. Nothing touched the running bay app or the repo.

**Verdict: usable with corrections.** The licence work is excellent: every hash, size, revision and
exclusion checks out. The compositor design is sound, and its central warning about two elements is
real. But the **two numbers that size the feature are wrong in the optimistic direction**, both
measured: MODNet is **~83 ms/frame** on CPU (not 15–40), and a 1080p matte PNG is **~90 KB** (not
15–40 KB). The claimed CoreML speed-up is a slow-down. Apple Vision **is reachable from Electron with
no native addon and no new binary**, which changes the spike's cost and possibly the default.

Counts for this doc: **WRONG 4** (three estimates contradicted by measurement, one file path) ·
**UNSOURCED 0** · PARTIAL 4 · CONFIRMED ~30.

### 10.1 Licences, pins and bundling

| Claim | Status | Evidence |
|---|---|---|
| `Xenova/modnet` @ `fa2fa546…`, licence apache-2.0 | **CONFIRMED** | HF API: `sha fa2fa546052fba4c08921230a26cc69a333fca12`, `cardData.license apache-2.0`, not gated. |
| `onnx/model.onnx` 25,888,640 B, SHA-256 `07c308cf…584df9` | **CONFIRMED by download** | `shasum -a 256` of the downloaded file matches, and so does the size. fp16 12,984,781 / `25f165da…` and uint8 6,627,048 / `7bad6522…` match the tree API too. |
| MODNet upstream: "code, models, and demos … Apache License 2.0" | **CONFIRMED** | `ZHKKKe/MODNet` README §License, verbatim (it excludes `doc/gif`). GitHub `license: Apache-2.0`. |
| The Xenova ONNX conversion is covered | **CONFIRMED, with a duty** | The conversion is a derivative of Apache-2.0 weights, and the HF card declares apache-2.0. The Xenova repo has **no LICENSE file** (tree: `onnx/`, README, configs only), so bay must supply the licence text itself. |
| MODNet can ship in the bundle; NOTICE duties | **CONFIRMED, duties named** | Upstream has **no NOTICE file** (repo root: `LICENSE`, `README.md`, `demo`, `doc`, `onnx`, `pretrained`, `src`, `torchscript`), so §4(d) imposes nothing. What remains: §4(a), ship a copy of the licence; §4(c), keep attribution. **There is no top-level `LICENSES/`** as the doc says; bay ships third-party licences through `electron-builder.yml` `extraResources` (`vendor/ffmpeg/LICENSES` → `ffmpeg/LICENSES`, lines 45-50). Add `models/modnet/{model.onnx,LICENSE,README}` the same way. An `.onnx` is data, not a Mach-O, so `release-signed` is unaffected. The bundle grows 25.9 MB. |
| `onnx-community/BiRefNet_lite-ONNX` @ `de15b22b…`, MIT, 224,005,088 B / `56000243…`, fp16 114,538,221 B / `d39b897c…` | **CONFIRMED** (tree API) | Upstream `ZhengPeng7/BiRefNet` MIT, and `ZhengPeng7/BiRefNet_lite` card MIT. Not downloaded. |
| RVM GPL-3.0 | **CONFIRMED** | README: "[Sep 16 2021] Code is re-released under GPL-3.0 license". GitHub `GPL-3.0`. |
| MatAnyone 1 and 2: S-Lab, non-commercial | **CONFIRMED** (both) | `LICENSE` / `LICENSE.txt`: "S-Lab License 1.0 … Redistribution and use for non-commercial purpose". The doc said MatAnyone 2 was "not verified"; it is now. |
| RMBG-1.4 non-commercial; RMBG-2.0 CC BY-NC 4.0 | **CONFIRMED** | 1.4: `license_name bria-rmbg-1.4`, "available as a source-available model for non-commercial use". 2.0: `license_link …/by-nc/4.0`, gated. |
| VideoMaMa: CC BY-NC 4.0 code + Stability Community weights | **CONFIRMED** | `cvlab-kaist/VideoMaMa` README §License, verbatim on both. |
| `onnx-community/ISNet-ONNX` tagged AGPL-3.0 | **CONFIRMED** | HF `license:agpl-3.0`. |
| The `licence` allow-list test for pinned models (§5.1.8) | Good idea | Correct shape: a test over a literal list, not a comment. |

### 10.2 Claims about bay's code

| Claim | Status | Evidence |
|---|---|---|
| `#drawSource` at `compositor.ts:370` is the draw site for video, image, composition and `.brf`, and grades before `drawImage` | **CONFIRMED** | `:370` signature. Callers at `:647` (brf surface), `:676` (composition bitmap), `:698` (element). The grade at `:416-440` draws `graded.canvas` into `dest`. |
| Masking after the grade gives one path for preview, `preview_frame` and export | **CONFIRMED, one caveat** | Same function for all three consumers. Caveat: the *ungraded* branch draws straight from the element to `dest`, with no intermediate canvas. The mask needs the scratch `pic` canvas the doc describes on both branches, so an ungraded masked clip pays a copy a graded one already pays. Worth saying in the design. |
| `elementSlots` (`compositor.ts:1091`) gives each drawing of an asset its own element | **CONFIRMED** | `:1091-1099`: slot = running count per `assetId`, independent of source time. The rationale is at `:176-190`. |
| "Two decoders, each allowed to drift up to 80 ms in playback" | **CONFIRMED, understated** | `DRIFT_TOLERANCE_SECONDS = 0.08` (`engine/sync.ts:18`), applied per element in playback (`compositor.ts:898, 924-925`). Each element is corrected only past 80 ms *from the target*, so base and cut-out can be **up to ~160 ms apart** (one early, one late), about 4–5 frames at 30 fps. The fix (share a slot when asset *and* source frame match) is right. It must also go through the preroll path, which asks `elementSlots` for its slot (`compositor.ts:1082`). |
| `requestVideoFrameCallback` unused | **CONFIRMED** | No occurrences in `src/renderer`. |
| Matte frames over `bay://` with Range | **CONFIRMED** | `src/main/serve.ts` `parseRange` (`:85`), with a test suite (`serve.test.ts`). The cache dir must be admitted to `bay://` like fonts and generated files. |
| Utility-process pattern reusable: `utilityProcess.fork`, nice 10, 2 min idle, `frames` messages, abort | **CONFIRMED** | `vision/host.ts:21` (`IDLE_MS = 120_000`), `:54` (`setPriority(pid, WORKER_NICE)`), `protocol.ts:13` (`{type:'frames'}`). |
| `onnxruntime-node` 1.30.0, `executionProviders: ['cpu']`, fp16 outputs refused | **CONFIRMED** | `package.json` 1.30.0. `encoder.ts:58`, `:71`. |
| The shipped dylib contains the CoreML EP | **CONFIRMED** | `strings libonnxruntime.1.30.0.dylib \| grep -c CoreMLExecutionProvider` → 19. |
| `contentKey`: size + three 1 MiB windows | **CONFIRMED** | `vision/cache.ts:8, 23` |
| `cacheDir()/<family>-${CACHE_SCHEME}` swept by `sweepStaleCaches` | **CONFIRMED** | `media/cache-dirs.ts:11-26` |
| `png` is a required encoder and decoder; no FFV1 | **CONFIRMED** | `capabilities.test.ts:179` (`png` is added at 179, not 176), `:200` (`read` list). `ffv1` appears 0 times in `build-ffmpeg.sh`. `ya8` is not yet pinned, as the doc says. |
| `KEYFRAME_PROPERTIES` in `@shared/keyframes.ts` | **WRONG path** | It is exported from `src/shared/project.ts:273`. `keyframes.ts` imports it. |
| grade.ts "one WebGL context, shared by every compositor"; ~16-context cap | **CONFIRMED** | `grade.ts:22, 24` |
| `#glassBackdrop`, `@shared/links` `normaliseLinks`, `freeze-frame.ts` exist | **CONFIRMED** | — |

### 10.3 Feasibility, measured

**MODNet per-frame cost:** the doc says "~15–40 ms/frame on an M-series CPU [E]". **WRONG.** On
this Mac, repo `onnxruntime-node` 1.30.0, 48 real frames of the 1080p clip at the model's own
preprocessing (`shortest_edge: 512`, `size_divisibility: 32` → 896×512, mean/std 0.5), excluding
decode and pre/post-processing:

| Execution provider | median | p90 |
|---|---|---|
| `cpu` | **82.8 ms** | 87.3 ms |
| `coreml` | **139.5 ms** (slower) | 174.7 ms |

At 512×288 (short edge 288, which is wrong for this model) CPU was 28.4 ms, which is probably where
the estimate came from. So §2.5's throughput table is **~2–4× optimistic**. A 60 s clip at 30 fps is
~150 s of inference alone on CPU (the doc says 40–80 s). The "CoreML EP, if it helps" column should
be deleted for MODNet: it does not help. The output is a sane matte: frame 10 had 141k pixels ≥250,
301k ≤5 and 17k soft, matching Vision's count (below) to within 3%.

**Matte pack size:** the doc says "15–40 KB per 1080p ya8 PNG [E]; 60 s ≈ 30–70 MB". **WRONG.**
Real MODNet mattes, bilinear-upscaled to 1920×1080 and encoded `-c:v png -pix_fmt ya8` by bay's
ffmpeg: **~90 KB/frame** (84–103 KB over 48 frames). A single-channel `gray` PNG was 72 KB. A
synthetic, perfectly clean silhouette was 20 KB, which is presumably the estimate's picture; real
soft edges and low-level noise are what cost. The guided filter's output was not measured and could
move this either way.

| Clip, 1080p | Frames | ya8 at ~90 KB |
|---|---|---|
| 60 s @ 30 fps | 1,800 | **~160 MB** |
| **10 min @ 30 fps** | 18,000 | **~1.6 GB** |
| 10 min @ 24 fps | 14,400 | ~1.3 GB |

That changes the "never evict a matte the open project references" rule from a detail into a disk
policy. Consider storing mattes at the model's resolution (896×512 compresses far better; the
guided filter can run at draw time or on decode). Otherwise a long podcast costs gigabytes per clip.

**Apple Vision without a native addon: YES, measured.** JavaScript for Automation reaches
`Vision.framework` through the ObjC bridge. `osascript -l JavaScript vision.js frame.png out.png`
ran `VNGeneratePersonSegmentationRequest` on a 1080p frame and wrote the mask, on macOS 26.6.2, with
nothing compiled, no helper Mach-O and nothing new for `release-signed` to sign. Main can spawn
`/usr/bin/osascript` like any tool. Warm timings, 8 runs in one process, per image including file
decode:

| Quality | Mask size | median |
|---|---|---|
| `.accurate` | **2016×1512** | 80 ms (first call 1.6 s, model load) |
| `.balanced` | 512×384 | 31 ms |
| `.fast` | 256×192 | 25 ms |

- The doc's "accurate has 64× the pixels of fast" holds: 62×.
- **New trap:** the mask is **4:3 for a 16:9 frame**. It must be stretched back to the image's
  aspect, or the matte is misplaced horizontally.
- Coverage agreed with MODNet: 145,783 vs 141,383 pixels ≥250 at 896×512.
- Caveats: the JXA bridge is slow for moving pixels and per-frame files are clumsy, so treat this as
  the **spike vehicle** (hours, not a day). A production path might still want a Swift helper for
  streaming. Neither timing includes bay's pipeline overhead.
- The doc's claim that the spike needs "a small Swift helper binary" is **PARTIAL**: it does not,
  for the spike.

**Other estimates:** the guided filter (2–5 ms), 4K mask blits (1–3 ms), PNG decode (5–15 ms) and
BiRefNet_lite timings are correctly labelled [E] and were not measured.

### 10.4 Required corrections to masking.md

1. **Replace the throughput table** with the measured MODNet 83 ms/frame (CPU, 896×512) and remove
   the CoreML column for MODNet, which measured 1.7× *slower*.
2. **Replace the pack-size estimate** with ~90 KB/frame at 1080p ya8 (~1.6 GB per 10 min @ 30).
   Decide the storage resolution and eviction policy with that number, not 15–40 KB.
3. **Apple Vision spike:** do it first and cheaply through `osascript -l JavaScript`, with no
   helper binary. `.balanced` at ~31 ms/frame (512×384) is faster than MODNet on CPU and needs no
   25.9 MB in the bundle. Record the 4:3-mask trap. If it wins, MODNet stays as the fallback.
4. **Slot drift** is up to ~160 ms between two elements, not 80. The fix stays the same. Include
   the preroll path (`compositor.ts:1082`).
5. **Licensing mechanics:** there is no `LICENSES/`. Ship MODNet's LICENSE beside the model through
   `electron-builder.yml` `extraResources`, as ffmpeg's are. Upstream has no NOTICE, so §4(a)
   (licence copy) and attribution are the duties.
6. `KEYFRAME_PROPERTIES` lives in `@shared/project.ts:273`. The `png` pin is at
   `capabilities.test.ts:179`.

### 10.5 Safe to implement from masking.md

- The **`masks: Mask[]` model** (array from day one, additive optional field), the `#drawSource`
  placement after the grade, the missing-matte policy (draw nothing, name it in `IncompleteFrames`)
  and `put_behind_subject`'s shape.
- **Slot sharing by (asset, source frame)** in `elementSlots`, with preroll. It is independently
  useful for any duplicate-and-stack effect.
- The **pinned-model spec with a licence allow-list test**, and MODNet as a licence-clean bundled
  fallback (all pins verified).
- The Apple Vision spike via JXA, before any bundle or pipeline decision.
- Not yet: the throughput and size figures in UI copy, and the "one-click in ~40 s" promise. At the
  measured rate, 60 s of 1080p is ~2.5 min of MODNet inference plus decode.
