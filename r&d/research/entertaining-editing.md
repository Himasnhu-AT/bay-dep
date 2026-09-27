# Editing for attention: retention rules with numbers

*Research for bay's agent, Sept 2026. Evidence tiers: **[P]** platform documentation or platform-scale data, **[R]** peer-reviewed research, **[I]** industry dataset (a vendor's own data), **[C]** creator or agency anecdote/convention. When sources disagree, prefer P/R over I over C.*

## Summary

- **Most viewers leave in the opening seconds, and every platform measures that window.** YouTube's "Intro" moment is the share still watching at **30 s** [P]. TikTok tells advertisers to land the proposition in the **first 3 s** and the hook within **6 s** [P]. MrBeast's handbook treats the **first minute** as the make-or-break unit: the video must deliver what the thumbnail promised [C, leaked internal doc].
- **Shots have been getting shorter for 75 years.** Hollywood's average shot length (ASL) fell from about **10 s (1930s–40s) to under 4 s after 2000**, with shorter shots carrying more motion [R, Cutting]. Short-form social video cuts faster than film, but the "cut every 0.5–1 s" claims come from blogs and are unverified.
- **Pace is not the goal.** Murch's ranking puts **emotion at 51%** and **rhythm at only 10%** of what makes a cut right [C, canonical]. Colin & Samir recut a MrBeast video *slower* and it performed [C]. Cut away dead air; do not cut for speed alone.
- **Audio carries half the experience.** Speech sits around −6 to −12 dBFS peak. Music drops **15–25 dB** under voice, landing near −20 to −30 dB. SFX are felt more than heard, at −18 to −24 dB. The master targets about **−14 LUFS** [C/I, consistent across sources].
- **Captions are for sound-off viewers and they must stay inside the safe zone.** TikTok recommends **5–10 words/s** of on-screen text [P]. On 9:16, keep the top ~14% and bottom ~35% clear for Meta, and roughly the top 130 px, bottom 484 px and right 140 px of a 1080×1920 frame for TikTok [P via secondary]. Short-form captions are **1–3 words at a time**. Long-form/broadcast subtitles are **≤42 chars/line, 2 lines, ≤17 chars/s** [P, Netflix].

## Principles

1. **Match the promise at once.** The first seconds must show what the title/thumbnail sold. Viewers who feel their expectations are not being met click away. MrBeast: "We lost 21 million viewers in the first minute" out of about 60M clicks, and the doc calls that good. Paddy Galloway: long music-and-logo intros and guest bios waste the window where retention is decided; open on the payoff or a trailer. Source: MrBeast handbook (via Simon Willison); Galloway on The Editing Podcast.
2. **Measure the hook at 3 s (short) and 30 s (long).** YouTube's Intro metric is retention at **30 s**. YouTube only shows key moments on videos **≥60 s with ≥100 views** [P]. Secondary guides report that YouTube calls intros above **~50%** at 30 s "above typical"; this is unconfirmed on the Help page. TikTok: proposition in **3 s**, and the first 6 s carry about 90% of ad recall [P].
3. **Most short videos are abandoned before the halfway point.** In 4M+ donated TikTok views, **55%** of recommended videos were not watched to the end, most were skipped before halfway, and most users watch **30–50%** of videos [R, Zannettou et al., CHI '24]. Put the payoff early and do not save it for the end.
4. **Keep shots short, and give short shots motion.** ASL is about 10 s → <4 s (r = −.75), with shorter shots carrying more motion per second [R]. The **2.5 s** figure often quoted is for recent features. For talking-head content, creators report **2–5 s per shot** (Ali Abdaal style) [C].
5. **Reset attention on a schedule, tight early and looser later.** Agency guides: a visual reset every **10–20 s** in the intro, a pattern interrupt around **25–35 s**, then **25–40 s** spacing once viewers are hooked. In videos over 10 min, a larger interrupt every **2–4 min** [C]. Colin & Samir **re-hook every 2–3 min** with a tease, a question or a callback to the premise [C]. MrBeast structures a long video in blocks (**0–1, 1–3, 3–6, 6–end min**), each with a job [C]. "Interrupts every 3–5 s give 40–60% higher retention" is an unsourced blog claim; treat it as marketing.
6. **Priority order when rules conflict: emotion > story > rhythm > eye-trace > 2D plane > 3D space** (51/23/10/7/5/4%). Never give up an emotional beat to keep up pace. Source: Murch, *In the Blink of an Eye*.
7. **Hide jump cuts with a punch-in or B-roll.** A punch-in makes a jump cut look intentional. Jump cuts add pace and B-roll adds variety; B-roll covers the edit and shows rather than tells [C, Descript]. Scale convention: **+10–15%** on alternating segments for a "second camera", **+20–30%** for an emphatic punch. A "snap" punch is keyframed a few frames apart; a "push" glides [C]. 4K source holds quality at a 1080p export up to about **130–200%** scale.
8. **Use split edits for speech.** A J-cut leads the next shot's sound; an L-cut carries sound over the picture change. Lead by **6–12 frames @30 fps** for quick dialogue, **0.5–1 s** for voiceover, and up to **2 s** at most [C].
9. **Captions: big, synced and inside the safe zone.** Short-form: **1–3 words** at a time, word-by-word highlight of the active word, lower-middle of frame, text about **10–15% of frame height**, heavy sans-serif with stroke [C, OpusClip/Hormozi convention]. Font **≥48 px on 1080×1920** and high contrast [C]. On-screen text at **5–10 words/s** max [P TikTok]. Long-form subtitles: **42 chars/line, ≤2 lines, 17 cps** (13 for kids) [P Netflix]. Captions must match the words spoken; do not add extra copy [C].
10. **Mix audio for phone speakers.** Dialogue peaks at **−6 to −12 dB**, around −16 LUFS integrated. Music sits at **−18 to −25 dB (or −20 to −30)** under speech and **−12 to −14 dB** with no speech. Duck by **15–25 dB** with a **10–30 ms** attack and **200–500 ms** release. SFX sit at **−10 to −20 dB**, whooshes at **−18 to −24**. Master to about **−14 LUFS** for YouTube and **−16** elsewhere. The final test: every word is intelligible on phone speakers [C/I: Descript, Pure Audio Insight, MyTasker]. About 70–80% of Reels are watched with sound on [I], so design for sound but caption for silence.
11. **Choose length by goal.** TikTok (6M brand videos, 2026): **15–30 s** has the best engagement rate (6.0%) and **2–3 min** has about 11× the median views [I, Socialinsider]. Wistia (13M business videos): videos **<1 min average 52% engagement**, and engagement drops a further **11%** past 30 min [I]. YouTube Shorts accept up to **3 min** (since 15 Oct 2024) [P].
12. **End screens.** YouTube end-screen elements occupy the **last 5–20 s**, need a video **≥25 s**, and allow up to 4 elements on 16:9 [P]. Leave that span visually quiet, and do not pad it with a slow outro that triggers the exit before the end screen appears.

## Per-format table

| Format | Hook window | Avg shot length | Captions | Zoom / B-roll cadence | Music / SFX |
|---|---|---|---|---|---|
| **Talking head, long-form (8–20 min)** | Deliver the promise by 15 s; judge at 30 s (target ≥50–70% remaining) | 2–5 s; remove every pause >~0.4 s and every false start | Optional burned-in; if used, 42 ch/line, 2 lines, ≤17 cps, bottom centre | Punch-in +10–15% at most jump cuts, alternating; B-roll or graphic every 20–40 s; re-hook every 2–3 min | Bed −20 to −30 dB under voice, ducked 15–25 dB; SFX sparse (transitions, reveals) at −18 to −24 dB; −14 LUFS |
| **Shorts / Reels / TikTok (15–90 s; ≤3 min)** | Proposition in 1–3 s; bold text on frame 1 | ~1–3 s (typical; faster claims unverified); first cut ≤3 s | Always; 1–3 words, word-by-word highlight, lower-middle inside safe zone, ≥48 px, 5–10 words/s | Visual change every 2–4 s (punch, B-roll, text pop); snap punches +15–30% for emphasis | Trending/driving track, ducked under voice; SFX on text pops and cuts at −10 to −20 dB |
| **Product / launch (30–120 s)** | Show the product doing the thing in 3 s; no logo-first open | 1–3 s, cut on beats | Key claims as kinetic type (≤5 words per card), not full subtitles | Motion graphics / UI zooms every beat or bar; push-ins rather than snaps | Music-led, cut to beat grid; hit SFX on reveals; VO ducks music 15–20 dB |
| **Vlog / travel (5–15 min)** | Cold open with the best moment (≤10 s), then title | 2–6 s; montages 0.5–2 s on beats | Optional; location/time labels as text | L-cuts: ambient sound continues under picture; B-roll montage every 1–2 min | Music forward in montages (−12 to −14 dB), ducked under talk; natural-sound SFX |
| **Tutorial / screen (3–15 min)** | State the outcome and show the result in 10–15 s | Longer is acceptable (5–15 s) when the viewer must read the screen | Burned-in labels for key terms; subtitles optional | Zoom to the cursor region (150–200%) for every click that matters; remove dead typing/loading; chapter every 1–3 min | Quiet bed −25 to −30 dB or none; subtle click/whoosh only |

(Values combine the principles above; per-format shot lengths for social formats are convention, not measured data.)

## Editing checklist for bay's agent

1. **Transcribe first** (`transcribe`). Every rule below is keyed to words and times.
2. **Open on the payoff.** The first spoken sentence must state or show the promise. If the best moment is later, copy it to 0 s as a cold open of ≤10 s long-form or ≤3 s short-form (`find_highlights`/`mark_highlights`, `place_asset`).
3. **No logo, title card or music-only intro before the hook.** Delete any intro >2 s that contains no promise (`remove_range`).
4. **Remove silences over ~0.4 s, repeated takes, and filler ("um", "so, yeah") between sentences** with `remove_range` (keeps sync). Never use a rippled `delete_items` on a single track.
5. **No talking-head shot runs longer than 6 s (long-form) or 3 s (short-form)** without a change: cut, punch, B-roll or text.
6. **Hide every jump cut in talking head.** Alternate scale 100% ↔ 112% across the cut (`edit_item` layout scale), or cover it with B-roll (`search_footage` → `place_asset` on V2).
7. **Snap punch-ins (+20–30%) only on emphasis words**, keyframed over ≤3 frames (`edit_item` keyframes on scale/left/top), at most once per ~10 s.
8. **Visual reset every 10–20 s in the first minute**, then every 25–40 s. Log each reset as a marker and check the gaps (`add_marker`).
9. **Re-hook every 2–3 min in long-form** with a tease line, a question or on-screen text naming what comes next (`write_brf` text card).
10. **Short-form: add word-level captions** (`add_subtitles`). Show 1–3 words, highlight the active word, keep it ≤10 words/s, place it lower-middle, and keep it out of the top 14%, bottom 35% and right 13% of 9:16.
11. **Long-form subtitles** (`add_captions`): ≤42 characters per line, ≤2 lines, ≤17 characters/s.
12. **Put frame-1 text on shorts:** a ≤6-word hook line visible from 0 s (`write_brf`).
13. **Set the canvas for the platform:** 1080×1920 for shorts/reels, 1920×1080 or 4K for YouTube (`set_canvas`). Reframe subjects into the safe area with layout left/top.
14. **Use split edits in dialogue.** Lead the next speaker's audio by 6–12 frames (J-cut) and let ambient sound tail 0.5–1 s over B-roll (L-cut) (`detach_audio`, `trim_item`).
15. **Duck music 15–25 dB under speech.** The bed sits at −20 to −30 dB under voice and −12 to −14 dB alone (track volume and ducking).
16. **SFX at −10 to −20 dB, whooshes at −18 to −24 dB, only on a visible event** (cut, pop, reveal). Never stack two SFX within 0.5 s in the same frequency band.
17. **Cut montages and product shots on the beat grid** (`detect_beats`). Transitions fall on beats; bar downbeats carry the big changes.
18. **Default to hard cuts.** Use a transition only for a time/place change or a beat-timed montage (`add_transition`), and never more than one type per video.
19. **Master to −14 LUFS for YouTube, −16 elsewhere**, with a true peak ≤ −1 dBTP (export mastering).
20. **Leave the last 5–20 s visually clear for YouTube end-screen elements** on videos ≥25 s. Put the CTA on the final spoken line, not in a slow outro.
21. **Length by goal:** short-form engagement 15–30 s, short-form reach 60–180 s, and nothing longer than the content supports. Cut until the retention risk is dead air, not length.
22. **Never trade an emotional beat for pace** (Murch: emotion 51% > rhythm 10%). A reaction or pause that lands the point stays.
23. **Verify by viewing.** Run `preview_frame`/`frame_grid` at 0 s, 3 s and 30 s and at every re-hook, and confirm the promise, the captions and the safe zones are visible.

## Where sources disagree

- **Cut speed.** "Rapid cuts every 0.5–1 s give 3.3× completion" and "interrupts every 3–5 s give 40–60% retention" are unsourced blog numbers. The strong evidence is only that shots are shorter and busier over time (Cutting). Colin & Samir's slower MrBeast recut is a counterexample. Treat pace as removal of dead time, not a target.
- **Music level under voice.** Guides give either −18 to −25 or −20 to −30 dB. Both agree on a 15–25 dB duck, so use −20 to −25 as the overlap.
- **Short-form length.** Engagement-rate data favours about 30 s; view data favours 2–3 min (Socialinsider, Buffer). Choose by goal.
- **Wistia's "engagement drops at 2 min" (2016)** has since been revised to about 60 s, and more recently to "<1 min = 52%". It is business-hosted video, not entertainment.

## Sources

1. MrBeast, "How to Succeed in MrBeast Production" (leaked, 2024), via Simon Willison: https://simonwillison.net/2024/Sep/15/how-to-succeed-in-mrbeast-production/
2. Creator Handbook summary of the same doc: https://www.creatorhandbook.net/leaked-document-allegedly-reveals-mrbeasts-secrets-to-youtube-success-the-key-takeaways/
3. YouTube Help, key moments for audience retention: https://support.google.com/youtube/answer/9314415
4. YouTube Help, end screens: https://support.google.com/youtube/answer/6388789
5. YouTube Blog, 3-minute Shorts: https://blog.youtube/news-and-events/tall-updates-coming-to-shorts/
6. TikTok Ads Help, creative best practices: https://ads.tiktok.com/help/article/creative-best-practices
7. Cutting et al., "Quicker, Faster, Darker" (2011): https://pmc.ncbi.nlm.nih.gov/articles/PMC3485803/
8. Cutting, DeLong, Nothelfer, "Attention and the Evolution of Hollywood Film" (2010): https://journals.sagepub.com/doi/10.1177/0956797610361679
9. Zannettou et al., "Analyzing User Engagement with TikTok's Short Format Video" (CHI 2024): https://homes.cs.washington.edu/~franzi/pdf/zannettou-tiktok-chi24.pdf
10. Walter Murch's Rule of Six (No Film School): https://nofilmschool.com/2016/11/6-rules-good-cutting-according-oscar-winning-editor-walter-murch
11. Paddy Galloway on The Editing Podcast: https://creators.spotify.com/pod/profile/the-editing-podcast/episodes/Paddy-Galloway-Tells-Us-How-To-Edit-YouTube-For-TV-e2cl1fe
12. Colin & Samir, "Edited a Slow MrBeast Video. And It Worked.": https://www.youtube.com/watch?v=uOTd4tAJ8DA ; playbook: https://www.colinandsamir.com/playbook
13. Descript, talking-head tips (punch-ins, B-roll): https://www.descript.com/blog/article/tips-for-making-a-talking-head-video-that-people-want-to-watch
14. Descript, audio levels: https://www.descript.com/blog/article/how-to-set-the-perfect-audio-levels-for-video
15. Pure Audio Insight, background music levels and ducking: https://pureaudioinsight.com/blogs/content-production/background-music-volume-how-loud-should-it-be
16. MyTasker, sound design levels for video: https://mytasker.com/blog/the-complete-guide-to-sound-design-for-video-creators
17. Netflix Timed Text Style Guide (English): https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide
18. OpusClip, Hormozi-style captions: https://www.opus.pro/blog/create-videos-in-alex-hormozi-style-the-ultimate-guide
19. OpusClip, Facebook Reels caption practices: https://www.opus.pro/blog/facebook-reels-caption-subtitle-best-practices
20. Soundstripe, J-cuts and L-cuts: https://www.soundstripe.com/blogs/a-video-editors-guide-to-j-cuts-and-l-cuts
21. Wistia, optimal video length (13M videos): https://wistia.com/learn/marketing/optimal-video-length
22. Socialinsider, TikTok length data (6M videos, 2026): https://www.socialinsider.io/blog/how-long-are-tiktok-videos/
23. AIR Media-Tech, advanced retention editing (interrupt spacing): https://air.io/en/youtube-hacks/advanced-retention-editing-cutting-patterns-that-keep-viewers-past-minute-8
24. Quso, zoom-in quality/punch-in scale: https://quso.ai/blog/zoom-in-on-video
