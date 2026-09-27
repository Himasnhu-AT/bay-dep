# Editing styles: a catalog for bay's style skills

*Research for bay's agent, 27 Sep 2026. It lists distinct, recognisable editing styles and, for each, what it is in numbers, what raw footage it needs, how far bay's current tools get, and a draft skill body. Companion to [`entertaining-editing.md`](./entertaining-editing.md), which holds the cross-format retention, caption and audio-level rules. This file does not repeat them.*

**How to read the numbers.** Every figure carries a tag:

- **[M]**: measured by someone from real videos. Shot counts, scene detection, frame-by-frame analysis.
- **[P]**: platform documentation or a platform's own data.
- **[R]**: peer-reviewed research.
- **[C]**: practitioner rule of thumb, tutorial or vendor guide, attributed to whoever wrote it.
- **[E]**: my own estimate, not from a source. Every "bay fit %" is [E].

Most "style guides" on the web are AI-tool marketing pages with no numbers, or with numbers they do not source. I have left out figures I could not attribute. Where the only source is a vendor blog, the tag says [C] and names the vendor.

**bay's tool surface, as checked in `src/shared/tools/` on this date:**

- **Speech:** `transcribe`, `find_highlights`/`mark_highlights`, `remove_range`, `apply_script`.
- **Captions:** `add_subtitles` offers word-level designs `spotlight`, `punch`, `boxed`, `clean` and `reveal`, with `accent`, `scale` and `bottom` %. `add_captions` handles long-form captions.
- **Motion graphics:** `write_brf`: JSX scenes of rect, ellipse, path, text and group, with `interpolate`, `spring`, `Sequence` and `Easing`, plus gradients, blur, shadow, split text and variable-font axes. `add_template` offers subtitle, lower-third, title-card, callout, stat, progress and end-card. `write_composition` makes HTML.
- **Per-item:** `edit_item` sets layout, crop, opacity, rotation, blendMode (12 modes), adjustments (a static CSS filter, including blur) and constant `speed`. It keyframes opacity, left, top, width, height, rotation, scale and volume, with eases. It also sets fades, pan and `duck` under a key track.
- **Grade:** wheels, white balance, curves, `.cube` LUT, halation, vignette, grain.
- **Transitions:** cross-dissolve, dip-to-black, dip-to-white, wipe, push, slide, iris.
- **Analysis:** `detect_beats`, `detect_cuts`, `index_footage`/`search_footage` (visual search, local files only), `frame_grid`, `preview_frame`.
- **Generation:** `generate_speech`, `generate_image`, `generate_video` (API keys needed). `import_url` uses the user's own yt-dlp.
- **Export:** `set_canvas`, and export with loudness mastering (−14/−16/−23 LUFS).

**What bay does not have, as checked:**

- Speed is a constant per item, so a ramp must be stepped across splits.
- Keyframes cannot drive blur or other filter values.
- No motion blur, masks or rotoscoping.
- No speaker diarisation, no face or subject tracking, no auto-reframe.
- No sound-effect or music library, and no music generation.
- No audio-reactive graphics, no frame-rate posterise, no multicam audio sync.

---

## Summary table

| # | Style | Identity | Pace | Key techniques | Raw footage needed | bay fit [E] |
|---|---|---|---|---|---|---|
| 1 | Retention talking-head short ("Hormozi") | One face, one camera, every word on screen | Cut on every pause; visual change every ~2–4 s [C] | Word-by-word bold caption with a coloured keyword; punch-in zooms; sparse SFX; emoji | Single-camera talking head, 4K preferred, clean audio | **85%** |
| 2 | High-retention YouTube ("MrBeast") | Spectacle challenge; open on the extreme moment | 23–38 cuts/min [M] | Cold open on the payoff; bold text overlays; zooms; countdowns; loud SFX; zero dead air | Many hours of multicam challenge footage | **55%** |
| 3 | Clean educational ("Ali Abdaal") | Friendly expert, tidy desk, graphics beside the face | Jump cuts on every pause; B-roll/graphic often (≈5–8 cuts/min for the comparable MKBHD pace [M]) | Animated text beside the speaker; paper/handwritten graphics; second-camera punch; soft music | Talking head (ideally 2 angles) + screen/desk B-roll | **70%** |
| 4 | Podcast clip ("DOAC clips") | One strong moment from a long conversation, captioned | Hard cut every 4.1–6.3 s [M]; 60–140 s long [M] | Speaker switching; 1–3-word uppercase captions colour-coded by speaker; dry audio (no music/SFX) [M] | Multicam podcast (a camera per person) + clean mics | **60%** |
| 5 | Documentary explainer ("Vox") | Narrated argument built from archival stills, maps and collage | Cuts every 1–3 s on narration beats [C] | 12 fps stutter; animated maps; highlighter on documents; paper textures; camera-blur transitions | Voiceover + archival photos/documents + maps | **45%** |
| 6 | Cinematic travel ("Sam Kolder") | Motion-matched transitions across places, on the music | Beat-cut montage (≈0.5–2 s shots [C]) | Whip pans; speed ramps 100%→35–50% over 10–15 frames [C]; masking transitions; LUT | Gimbal/drone footage shot *for* matched moves, some 60–120 fps | **40%** |
| 7 | Apple-style product film | The object in a void, lit, one idea per shot | Type card 1.2–2.0 s; UI shot 3–7 s (internal house rule) | Slow push-ins; macro detail; sentence-case headline in one family; black/off-white; hard cuts | Product macro/turntable footage or clean UI captures | **60%** |
| 8 | SaaS / tech launch | Software shown as a story: problem → UI in motion → CTA | 1–3 s shots cut on beats [C] | Cursor-led UI zooms; floating UI cards; kinetic headlines; beat-cut music | Screen recordings (high-res), logo, optional founder VO | **60%** |
| 9 | Kinetic typography / lyric | The words are the picture | One phrase per beat/line | Words snap/stack/pulse on the beat; one hero word per moment; one or two fonts [C] | A song or VO track (+ lyrics text); no picture needed | **75%** |
| 10 | Hype / sports edit | Peak action cut to the drop | Cuts often <1 s on hits [C] | Beat-synced cuts; white flash on hits; shake on impacts; speed ramps 100%→10–20% over 4–8 frames [C] | Action footage (ideally high-fps) + a driving track | **45%** |
| 11 | Luxury / minimal brand | Restraint; mood over explanation | Long holds, slow dissolves (≈4–8 s shots [E]) | Slow motion; minimal serif/spaced type; muted or B&W grade; silence and ambience | Beautifully shot product/model/location footage | **75%** |
| 12 | Lo-fi / film-grain aesthetic | Analogue nostalgia: grain, halation, gate weave | Loose; often montage | Grain, halation, vignette, faded blacks; 16–18 fps feel [C]; light leaks | Any handheld lifestyle footage | **70%** |
| 13 | News package / lower-thirds | Authoritative, labelled, clean | Soundbite + B-roll, shots ≈3–6 s [E] | Lower third held 4–7 s, in 0.3–0.7 s, out 0.3–0.5 s [C]; title-safe 10% [C]; stat cards | Interview soundbites + B-roll + VO | **80%** |
| 14 | Tutorial / screencast | Show exactly where to click, cut the waiting | Shots 5–15 s (screen must be readable) [C] | Zoom 150–200% to the action; cursor emphasis; callouts; dead-time removal; chapters | Screen recording at ≥ output res + mic | **55%** |
| 15 | Faceless stock explainer | Voiceover over stock/AI B-roll and text | Visual event every 1–3 s short-form [C] | VO-driven B-roll per sentence; kinetic text; Ken Burns on stills (5–15% zoom) [C] | A script/VO; stock or generated clips | **65%** |
| 16 | UGC ad / testimonial | Looks like a creator's post, sells like an ad | Hook 0–3 s, value 3–15 s, proof 15–25 s, CTA last 5 s [C] | Direct-to-camera selfie; native captions; product close-ups; no "ad" polish | Phone-shot 9:16 selfie + product B-roll | **75%** |
| 17 | Anime / AMV velocity edit | Motion and speed choreographed to the beat | Every beat a hit | Speed curves (slow on drop, fast on build); flash; shake; zoom-blur; overlays | Anime/action clips (licensing!) + track | **30%** |
| 18 | "Day in the life" vlog | Morning-to-night montage, calm and aesthetic | Montage 0.5–2 s; talk 4–8 s [C] | Timelapses; ASMR-level natural sound; soft grade; location/time labels; in-camera transitions | Many short handheld clips across a day + some talking | **60%** |
| 19 | Interview / documentary two-camera | A-cam medium + B-cam close; reactions and cutaways | Alternating angles ≈5–6 s [M for DOAC long holds] | A/B cut at thought changes; listener cutaways; lower thirds; L-cuts into B-roll | Two synced cameras + lav/boom + B-roll | **65%** |

---

## 1. Retention talking-head short ("Hormozi" style)

**Identity.** One person, one camera, direct address. Every spoken word appears on screen in a heavy font, with the important words coloured. OpusClip calls it "deceptively simple — one person, one camera, minimal B-roll". The editing precision is the style.

**References**
- Alex Hormozi Shorts: https://www.youtube.com/@AlexHormozi/shorts
- Leila Hormozi Shorts: https://www.youtube.com/@LeilaHormozi/shorts
- Breakdowns: Riverside https://riverside.com/blog/hormozi-style-videos · Quso https://quso.ai/blog/how-to-edit-reels-and-shorts-like-alex-hormozi

**Pacing**
- Every pause and false start is cut. A visual change (cut, zoom, caption pop) lands every ~2–4 s in short-form [C, cross-format convention in `entertaining-editing.md`].
- The hook is a bold claim in the first 1–3 s, spoken and on screen [C].

**Signature techniques**
- **Captions.** Bold uppercase. Named fonts are TheBoldFont, Montserrat Bold and Anton [C, Riverside]. Keywords go yellow or green [C, OpusClip]. The caption sits lower-middle, 1–3 words at a time, and may be rotated for variety [C, Increditors].
- **Emoji and animation.** OpusClip claims emojis and animations "increase numbers of views by 42% on average" [C, unsourced, so treat it as marketing].
- **Zoom.** Punch-in on emphasis. A zoom-out marks a new section [C, Increditors]. Conventional amounts: +10–15% as a "second camera", +20–30% as an emphatic snap [C, see `entertaining-editing.md`].
- **SFX.** The early style put a whoosh or pop on every movement. By 2026 SFX are sparse, on punchlines only, and the "voice carries the energy" [C, Joyspace].
- **Music.** A low bed or none.
- **B-roll.** Minimal. Tweet-style text cards and image overlays illustrate named things [C, Riverside].

**Camera and motion.** A static locked-off camera. All the motion is digital: punch-ins, caption motion, occasional overlay slides.

**Raw footage.** One talking-head take, framed chest-up with headroom. 4K gives punch-in room. Clean close-mic audio. Works from 16:9 (crop to 9:16) or native 9:16.

**How bay does it today**
- `transcribe`, then `remove_range` for silences and false starts. Tighten by removing silence rather than deleting items, so sync holds.
- `set_canvas` 1080×1920. Reframe with `edit_item` layout scale/left/top.
- `add_subtitles` style `punch` (outlined uppercase, 1–2 words, yellow pop) or `spotlight`, with `accent` for the keyword colour.
- Snap zooms with scale keyframes over ≤3 frames. Alternate 100%/112% across jump cuts.
- Emoji and tweet cards with `write_brf`.

**Gaps**
- **No SFX library.** Pop and whoosh assets must be user-supplied.
- **No face tracking.** A 16:9 → 9:16 crop is static, so the speaker can drift out of frame if they move.
- **Caption styling is per-clip, not per-word.** You can't colour one chosen keyword differently from the design's active-word highlight. Emphasis follows the spoken word, not meaning.

**Draft skill body**
1. `transcribe` the talking-head clip.
2. Find the strongest one-sentence claim. If it is not in the first 3 s, move it to 0 s as a cold open ≤3 s long (`split_at` + `place_asset`).
3. `remove_range` every silence >0.3 s, every repeated take and every filler word. Report the total seconds removed.
4. `set_canvas` preset 1080×1920. Scale the clip so the face fills the upper-middle and the eyes sit at ~40% of frame height.
5. At every remaining jump cut, alternate scale 1.00 ↔ 1.12 so no two adjacent segments share a scale.
6. Choose ≤1 emphasis word per ~8 s. On each, add a scale keyframe +20% over 3 frames with an `easeOut`, holding until the next cut.
7. `add_subtitles` with style `punch` (or `spotlight` if the user prefers mixed case). Set `bottom` so the caption sits at 25–35% from the bottom, inside the platform safe zone.
8. Put a ≤6-word hook line on frame 0 with `write_brf`, top third, visible for the first 2–3 s.
9. For each named number, tool or quote, add one `write_brf` card (tweet-style or stat) for 1.5–2.5 s. Use at most one card per 10 s.
10. If a music bed is supplied, place it at −24 dB under voice with `duck` on the voice track.
11. Check: no segment runs >4 s without a cut, zoom or card (list the frame gaps).
12. Export with mastering "streaming" (−14 LUFS).

---

## 2. High-retention YouTube ("MrBeast" style)

**Identity.** A spectacle with a simple premise. Open on the most extreme moment, then rewind into the story. Nothing is allowed to sit still. The production handbook frames the first minute as the make-or-break unit [C, leaked handbook via Simon Willison, see `entertaining-editing.md`].

**References**
- MrBeast channel: https://www.youtube.com/@MrBeast
- "$456,000 Squid Game In Real Life!": https://www.youtube.com/watch?v=0e3GPea1Tyg
- Tubefilter analysis: https://www.tubefilter.com/2024/03/04/mrbeast-editing-style-number-of-cuts-per-video/

**Pacing**
- Tubefilter counted **38 cuts per 60 s** in "I Paid A Real Assassin To Try To Kill Me" (Mar 2023). "I Survived 7 Days In An Abandoned City" (2024) had **23 cuts per 60 s** [M].
- MrBeast, 3 Mar 2024: "slowed down our videos, focused on story telling, let scenes breathe… our views have skyrocketed". He asked creators to leave "the ultra fast paced/overstim era" [M, quoted by Tubefilter].
- So the current style is ~23 cuts/min, not 38.
- Hook: open on the extreme moment within the first ~5 s [C, SendShort].

**Signature techniques**
- A cold open on the payoff.
- Bold text overlays for money, time and counts. Countdown timers. Map and number graphics.
- Snap zooms on reactions. Loud whooshes, risers and impacts on reveals.
- A saturated, bright grade. Music changes per act.

**Camera and motion.** Multicam: wide, participant close-ups, drones, GoPros. Handheld energy, and constant angle changes.

**Raw footage.** Hours of multicam coverage of an event with a clear goal and stakes. Editors cut "over 10 hours of footage" per video [C, C4E]. A single talking head cannot become this style.

**How bay does it today**
- `detect_cuts` and `search_footage` to find reactions and payoffs.
- `find_highlights` on the dialogue.
- `write_brf` for counters, timers and money totals (springs, split text). Snap zooms with keyframes.
- `detect_beats` to cut montages. `add_transition` dip-to-white for "flash" reveals.

**Gaps**
- **No SFX library** (risers, impacts, cash sounds).
- **No multicam sync.**
- **No speed ramps.**
- **No auto-tracking** of people for zooms.
- **Hard to automate.** Story structure over hours of footage is beyond the current tools. `find_highlights` works from speech only.

**Draft skill body**
1. `index_footage`, then `transcribe` every clip with speech.
2. Identify the premise sentence and the single most extreme visual moment (`search_footage` + `frame_grid` to confirm). Place that moment at 0 s for 3–5 s as the cold open.
3. State the premise in words by 5 s: a `write_brf` title overlay ≤5 words, plus the spoken line.
4. Structure the body in blocks (0–1 min, 1–3, 3–6, 6–end). Put a marker at each block with its job (`add_marker`).
5. Cut dialogue with `remove_range` so that no line starts later than 0.2 s after the previous one ends.
6. Hold the average near 23 cuts/min (one cut per ~2.6 s). Count cuts per minute and report any minute outside 15–35.
7. Every number that matters (money, days, people left) gets a `write_brf` counter that springs in for 1.5–2 s.
8. On each reaction shot, add a scale keyframe 1.0 → 1.15 over 4 frames.
9. At each block boundary, re-hook: a text tease of what comes next, ≤6 words.
10. Montages: `detect_beats` on the music, cut on beats, with bar downbeats on the big changes.
11. Grade: +saturation and brighter mids via `edit_item` grade/adjustments. Keep skin natural (check with `preview_frame`).
12. Master at −14 LUFS.

---

## 3. Clean educational ("Ali Abdaal" style)

**Identity.** A friendly expert on a clean set. Talking head interleaved with tidy B-roll, screen captures and paper or handwritten animated graphics placed *beside* the speaker, not over them [C, Choppity].

**References**
- Ali Abdaal: https://www.youtube.com/@aliabdaal
- MKBHD, a comparable measured pace: https://www.youtube.com/@mkbhd
- Ali's own workflow: https://aliabdaal.com/youtube/the-ultimate-guide-to-youtube/

**Pacing**
- No measurement of Ali's cut rate was found.
- The closest measured analogue is MKBHD: **7.4 cuts/min** (6.4–8.9), median shot 3.6–6.7 s, 48% talking head / 43% B-roll [M, PandaStudio]. Its first 30 s ran at 1.1–1.9× the body cut rate [M].
- One unbroken 32–55 s shot sits at 72–92% of runtime (the verdict) [M].
- Creators report 2–5 s per talking-head shot for this style [C].

**Signature techniques**
- **Three passes.** Ali describes (1) an "A-cut" of the best takes with silences trimmed, (2) "B-roll shenanigans": second-camera clips, titles, lower thirds, screen recordings, handwritten animations, and (3) "coats of polish": music, SFX on titles, vocal compression/EQ, grade [C, Ali Abdaal's guide via search summary].
- **Text.** "Spin-in by character" text, unfolding paper graphics, paper-tear transitions, and old B&W clips with an fps-lag effect [C, Increditors / TechBullion].
- **Research.** Guo et al. (edX, 6.9M sessions) found engagement plateaus around **6 min**. Talking head interleaved with slides beat slides alone, and tablet-drawing "Khan-style" beat PowerPoint [R, Guo, Kim & Rubin, L@S 2014].

**Camera and motion.** A two-camera A/B setup (front and 45°), static. Shallow depth of field and warm practical lights.

**Raw footage.** Talking head, ideally two angles. Desk and hands B-roll. Screen recordings of what is discussed.

**How bay does it today**
- `transcribe` + `remove_range`. Use `add_transition` push or slide for section changes.
- Side-of-frame animated text with `write_brf` (split text, springs, paper-coloured rects with shadow). Chapter title cards with `add_template` title-card.
- A punch-in on A-cam gives the second-camera feel when only one angle exists.
- A soft music bed ducked under the voice. A warm grade.

**Gaps**
- **No paper-tear or texture assets.** You would generate them with `generate_image`.
- **No keyframeable blur** for soft text reveals.
- **No stutter or fps-lag effect.**
- **No SFX library.**

**Draft skill body**
1. `transcribe`, then `remove_range` silences >0.4 s and flubbed takes (keep the last good take).
2. Mark sections from the transcript (intro, each point, recap) with `add_marker`.
3. Open with the outcome in ≤15 s. Move the promise sentence first if it is not.
4. Each section starts with an `add_template` title-card or a `write_brf` chapter card (≤4 words, 1.5 s).
5. Frame the speaker on the left or right third (`edit_item` left). Put each key term as `write_brf` animated text on the empty side for 2–4 s.
6. Every 20–40 s, cover the speaker with B-roll or a screen capture that shows the thing said (`search_footage` → `place_asset` on V2).
7. At jump cuts not covered by B-roll, alternate scale 1.00/1.10.
8. Keep a single talking-head hold under 6 s, except one deliberate longer hold for the key argument.
9. Add a lo-fi/acoustic music bed at −26 dB with `duck` under the voice.
10. Grade warm: white balance slightly warm, soft contrast, and a LUT if the user has one.
11. Long-form: `add_captions` (≤42 chars/line). Shorts: `add_subtitles` `spotlight`.
12. Export at −14 LUFS.

---

## 4. Podcast clip (two-speaker, captioned)

**Identity.** One self-contained moment from a long conversation. The speaker on screen is the one talking. Captions carry it on mute.

**References**
- The Diary Of A CEO Clips: https://www.youtube.com/@TheDiaryOfACEOClips
- PandaStudio's DOAC analysis: https://www.writepanda.ai/blog/how-diary-of-a-ceo-edits-podcast-clips/
- Recast audiogram guide (the waveform variant): https://recast.studio/blog/audiogram-best-practices-for-social-media

**Pacing** (DOAC vertical clips, frame by frame [M, PandaStudio])
- A hard cut every **4.1–6.3 s**, tightening to ~2.5–3 s near the payoff and slowing to ~5.1 s on emotional material.
- Clips run 66–139 s. The payoff lands at **55–80%** of runtime.
- Reaction cutaways of the listener last 1–1.5 s while the speaker's audio continues.
- Generic guidance: 15–45 s for an audiogram [C, Recast]. TikTok 15–60 s [C, Quso].

**Signature techniques**
- **Captions.** 1–3 words per screen, bold condensed uppercase with a heavy black outline, at 60–70% of frame height (below the chin). Host in yellow, guest in white. Serious material switches to small mixed case with a soft shadow [M, PandaStudio].
- **Audio.** "Completely dry": no music, no SFX, laughter kept [M].
- **Visuals.** Punch-ins or crops every 5–6 s during long holds. B-roll only 0–6.5% of runtime [M].
- **Hooks.** A redacted pull-forward (strongest line at 0 s with its key words muted), a banner, or a trap question [M].
- **Speaker labels.** Help comprehension in debate clips [C, Recast].
- **Audiograms.** "Real faces and reactions consistently outperform waveform animations" [C, Recast].

**Camera and motion.** A camera per speaker plus a wide. Static.

**Raw footage.** Multicam podcast, ideally separate ISO camera files per person, or one 4K wide to crop singles from. Separate mics help speaker detection.

**How bay does it today**
- `find_highlights` is built for exactly this (scores hook, information, emotion, completeness) → `mark_highlights`.
- `remove_range` to tighten. `set_canvas` 9:16. Crop each speaker from the wide with `edit_item` crop/layout.
- `add_subtitles` `punch` or `clean` (the serious variant).
- Split screen: two items stacked with layout top/height.

**Gaps**
- **No speaker diarisation.** Switching to whoever is talking, and colouring captions per speaker, cannot be automated. It is the defining technique here.
- **No face tracking or auto-reframe.**
- **No multicam sync** by waveform.
- **One accent per caption clip,** not a colour per speaker. It would need two subtitle clips split at turns.
- **No waveform visualiser** for audio-only podcasts.

**Draft skill body**
1. `find_highlights` on the episode. Pick 1–3 moments of 30–90 s that stand alone (no unresolved "as I said earlier") and whose payoff falls at 55–80% of the clip.
2. `mark_highlights`, then build each clip on its own timeline range.
3. Hook: if the strongest line is late, copy it to 0 s (≤4 s), then cut back to the start of the thought.
4. `set_canvas` 1080×1920.
5. Crop a single for each speaker from the wide (or use their ISO camera), with eyes at ~35–40% of frame height.
6. At every turn of talk (from the transcript), cut to the speaker who is talking. Where one voice runs >6 s, alternate punch 1.00/1.12 every ~5–6 s.
7. Insert 1–1.5 s listener reactions where the listener visibly reacts, keeping the speaker's audio (split edit).
8. `add_subtitles` style `punch`, `bottom` ≈32% (sits below the chin). For grief, health or serious topics use `clean` at `scale` 0.8.
9. No music and no SFX. Keep laughter.
10. `remove_range` pauses >0.5 s, except on serious material where the pause is the point.
11. Optional ≤6-word title banner at the top for the whole clip.
12. Export at −14 LUFS. Report each clip's length and payoff position %.

---

## 5. Documentary explainer ("Vox" style)

**Identity.** A narrated argument made of archival photos and documents, clean maps and flat graphics. Every animated element clarifies rather than decorates [C, Calliope; Cliptude].

**References**
- Vox: https://www.youtube.com/@Vox
- Vox Borders / Johnny Harris: https://www.youtube.com/@johnnyharris
- Nieman Lab on Borders: https://www.niemanlab.org/2018/08/explanatory-video-engagement-how-voxs-borders-series-is-humanizing-the-map-and-building-local-source-networks/

**Pacing.** Cuts every **1–3 s** on narration beats [C, Calliope]. The hook is a question or a surprising fact over a striking archival image.

**Signature techniques** [C, PremiumBeat "5 breakdowns"; Calliope]
- **12 fps stutter.** Graphics animated at half the timeline rate (12 in 24).
- **Camera-blur tracking transitions.** A 3D pullback plus motion blur peaking at the cut.
- **Stepped lower thirds.** A frame-by-frame jagged reveal, with text delayed a few frames.
- **Motion texture backgrounds.** 5–6 paper textures cycled 2–3 per second.
- **Lens imperfection.** Chromatic aberration plus edge blur 3.5 with a feathered mask (radius 50).
- **Maps and documents.** A decluttered map zooms to a region, the country fills with an accent colour, and callouts appear on cue. A highlighter sweeps over document text.
- **Palette.** Limited, often with one hot red accent. Halftone B&W cut-outs with torn edges and drop shadows. Slow 2.5D parallax push-ins.
- **Music.** Understated electronic or ambient under the VO.

**Camera and motion.** A virtual camera over a "tabletop" of paper. Slow drifts and push-ins.

**Raw footage.** A voiceover (or script to generate one), archival stills and documents, maps. Optionally interview soundbites.

**How bay does it today**
- `generate_speech` for the VO, then `transcribe` it for timing.
- `write_brf` does flat shapes, paths (map outlines if supplied as SVG paths), highlighter rect sweeps, split-text callouts, drop shadows and gradients. Slow push-ins on stills with scale keyframes (Ken Burns).
- `generate_image` for paper textures. A LUT or grade for a warm paper tone.

**Gaps**
- **No 12 fps stutter / posterise time.** You can fake it in brf by quantising the frame, `Math.floor(frame/2)*2`. That is possible but must be done per module.
- **No map data.** Country shapes must be supplied.
- **No motion blur.**
- **No 2.5D/3D camera or parallax** beyond layering items at different scale rates.
- **No chromatic aberration.**
- **No stock or archival search** beyond local `search_footage` and `import_url`.

**Draft skill body**
1. Get the script. If no VO exists, `generate_speech` it, then `transcribe` for word times.
2. Split the narration into beats of 1–3 s (one clause each) and mark each with `add_marker`.
3. For each beat, choose one visual: an archival still, a document, a map or a stat. Record which in the marker note.
4. Stills: place and add scale keyframes 1.00 → 1.08 over the beat with a gentle ease, plus a slight left/top drift. Never exceed 15%.
5. Documents: a `write_brf` highlighter (a semi-transparent yellow rect whose width animates 0 → line width over 10–15 frames) lands on the quoted words exactly as the VO says them.
6. Maps: a `write_brf` module draws the supplied outlines. Zoom to the region, fill the target with the accent colour, and bring in a callout label on the named word.
7. Animate every graphic on twos: quantise the brf frame to even frames for a 12 fps look.
8. Use one accent colour (for example `#E4332E`) plus off-white paper and near-black. No other hues.
9. Background: a paper texture (`generate_image`) under every graphic, `blendMode` multiply.
10. Transitions: hard cuts on beats. Use push or slide only between chapters.
11. Chapter cards with `add_template` title-card at each section.
12. Music bed at −26 dB under the VO. `add_captions` for long-form.
13. Check: no beat without a visual change (list beats longer than 3 s).

---

## 6. Cinematic travel ("Sam Kolder" style)

**Identity.** Continuous motion carried across places. Every cut hides inside a matched camera move, whip or foreground wipe, timed to the music. Built on "one complete camera motion across multiple locations… cut together, sometimes utilizing speed ramping" [C, Mia Hagerty on Kolder].

**References**
- Sam Kolder: https://www.samkolder.com/ · https://www.youtube.com/@SamKolder
- Hagerty, "The Art of the Seamless Transition": https://miahagerty.medium.com/what-made-it-the-art-of-the-seamless-transition-270d10334efb

**Pacing**
- Montages cut on beats, with shots ≈0.5–2 s in montage [C, cross-format convention].
- Speed ramps: travel ramps are longer and gentler, 100% → 35–50% over **10–15 frames**. Use "2–3 ramps max per 30–60 s" for polished work [C, ShotBook].

**Signature techniques**
- **Whips.** A whip pan out of one shot into a whip in the same direction on the next.
- **Masking.** A foreground object wipes into the next frame.
- **Matched motion.** Movement direction continues across the cut. Speed ramps sit into the transitions.
- **Look.** A heavy LUT (teal/orange or warm film). Letterbox 2.39:1 sometimes.
- **Sound.** Whoosh SFX on whips. Music-led, often cinematic electronic.

**Camera and motion.** A gimbal and drone. Every shot is shot to *start and end* in motion so it can be matched. High frame rate for ramps.

**Raw footage.** Footage shot for this: whips at the start and end of clips, 60–120 fps sections, drone reveals. Ordinary travel clips give only a weak version.

**How bay does it today**
- `detect_beats` for cut points.
- A whip is approximated by a `push` transition in the whip direction, or by keyframed left offset + scale over 4–6 frames on each side.
- Stepped ramps: `split_at` a clip into 3–5 pieces with speeds 1.0 → 0.7 → 0.4 → 0.7 → 1.0. This is visibly stepped.
- A LUT via grade. Letterbox with `write_brf` black bars or a canvas crop.

**Gaps**
- **No smooth speed curves** (time remapping). This is the style's core.
- **No motion blur,** so a digital whip looks like a slide.
- **No masks** for foreground wipes.
- **No keyframeable directional blur.**
- **No SFX library** (whooshes).
- **No optical flow** to smooth slowed 24/30 fps footage.

**Draft skill body**
1. `detect_beats` on the track. Mark bar downbeats.
2. `index_footage`. For each clip, estimate the dominant motion direction at the start and end (inspect with `frame_grid`), and note clips that end or start in a fast pan.
3. Order clips so the outgoing and incoming motion directions match. Pair whip-ends with whip-starts.
4. Cut every clip on a beat. Big location changes land on bar downbeats. Montage shots are 2–4 beats long.
5. On matched whip pairs, add a `push` transition in the direction of motion, 4–6 frames, centred on the beat.
6. Use at most 3 speed ramps per 60 s. For each, split the clip into 5 equal parts with speeds [1.0, 0.7, 0.45, 0.7, 1.0], with the slowest part landing on the beat. (Tell the user it is a stepped approximation.)
7. Use only footage recorded at ≥50 fps for slowed sections. Check each clip's fps with `inspect_item`.
8. Apply one LUT to every clip (the user's, or a warm film LUT). Match exposure so no clip's midtones jump.
9. Optional 2.39:1 letterbox via `write_brf` bars over the whole timeline.
10. The music is the only audio bed. Natural sound only on 1–2 "breath" moments, where the music dips.
11. Open on the strongest drone or reveal shot within 2 s. End on a slow reveal or a fade to black on the last downbeat.
12. Check: every cut is within 1 frame of a beat (list the offsets).

---

## 7. Apple-style product film

**Identity.** The object in a void, lit, with the camera always moving slowly and one idea per shot. Three movements: hero reveal, details, product in context [C, Manfrotto "How to shoot cinematic tech videos like Apple"].

**References**
- Apple on YouTube: https://www.youtube.com/@Apple
- Manfrotto guide: https://manfrotto.com/us-en/stories/how-to-shoot-cinematic-tech-videos-like-apple
- Internal: [`apple-launch-style.md`](./apple-launch-style.md), bay's own tone card for this category, written from Apple's films.

**Pacing.** Per the internal card: a type card holds **1.2–2.0 s**, a UI shot **3–7 s**, long slow moves, hard cuts between them. A beat of black and silence before the reveal. These are a house rule derived from watching Apple films, not a published measurement.

**Signature techniques**
- **Light.** Backlight and edge light drawing lines along the product's contours [C, Manfrotto]. Macro texture shots. Shot at 24 fps with manual exposure, gimbal-stable [C, Manfrotto].
- **Type.** One family (SF Pro, so a third party uses Inter Display/Tight). Semibold, sentence case with a full stop, tight tracking, 2–5 words, filling 10–14% of frame height (internal).
- **Colour.** Pure black or `#F5F5F7`, with one accent taken from the product.
- **Music and grade.** Music-led, and a clean, neutral grade.

**Camera and motion.** Slow dolly, turntable rotation and push-in. Never handheld.

**Raw footage.** Product macro, turntable and hero footage on a seamless background, or crisp high-resolution UI captures for software.

**How bay does it today**
- `write_brf` does the typography well (variable fonts, split text, springs).
- Slow push-ins with scale keyframes 1.00 → 1.06 over 3–7 s. Hard cuts. `detect_beats` for the music. Grade for neutral contrast.
- `generate_video`/`generate_image` for a missing hero shot (with care).

**Gaps**
- **No smooth speed ramps** for the classic slow-to-fast product whip.
- **No motion blur.**
- **No masks** for light-sweep or reveal effects. A gradient brf rect with blendMode screen gets partway.
- **No 3D.**

**Draft skill body**
1. `set_canvas` 3840×2160 or 1920×1080. Set the background to `#000` or `#F5F5F7` throughout.
2. Structure: reveal (0–8 s), 3–5 detail beats (4–6 s each), context (8–12 s), end card. Mark each.
3. Open on 0.5–1 s of black and silence, then the hero shot fading in over 12–18 frames.
4. Every product or UI shot gets exactly one slow move: scale 1.00 → 1.05–1.08, or a left/top drift ≤3% of frame, eased in and out across the whole shot.
5. Between shots, hard cuts only. Put at most one dip-to-black, before the final line.
6. Type cards in `write_brf`: Inter Display semibold, sentence case with a full stop, 2–5 words, 10–14% of frame height, tracking −0.02em. Each holds 1.2–2.0 s and fades or rises in over 10–14 frames. One card per idea.
7. One accent colour per film, on one word or one UI element per shot.
8. `detect_beats` on the music, and land every shot change on a beat. The reveal lands on a downbeat.
9. Grade neutral: no LUT look, lifted blacks off, a slight contrast curve, skin and product colours true.
10. No transitions other than cuts and fades. No particles, glows, lens flares or shake.
11. End card: logo or product name on the background, 2–3 s, then cut to black.
12. Check every frame with `preview_frame` for type inside the 10% title-safe area.

---

## 8. SaaS / tech launch video

**Identity.** Software shown as a story. Problem → product in motion (cursor-led, zoomed UI) → proof → CTA. Superhuman's launch film "leads with a single sharp promise", and Stripe uses "clean motion design and UI walkthroughs" [C, Blare].

**References**
- Linear: https://www.youtube.com/@linear
- Stripe: https://www.youtube.com/@StripeDev
- Blare's examples: https://blarevideo.com/feeds/blog/saas-product-launch-video
- Internal: [`motion-graphics-launch.md`](./motion-graphics-launch.md)

**Pacing.** 1–3 s shots cut on beats [C, `entertaining-editing.md` per-format table]. Commercials generally run 2–5 s shots [C, Vidpros, unsourced]. Social "cinematic ads" measured at **1.2 s** average shot (70 ads, 17.9 s average length) [M/R, arXiv 2608.24329].

**Signature techniques**
- **UI zooms.** Zoom into the region that matters instead of showing the whole screen [C, Hera].
- **Cursor.** Smoothed cursor paths, with cursor tilt on movement "often turned on for launch-style clips" [C, Tella].
- **UI cards.** UI elements lifted out as floating cards with shadow.
- **Type and music.** Kinetic headlines between UI beats. Electronic music with hits on reveals.
- **Frames.** Device frames or a soft gradient background.

**Camera and motion.** A virtual camera over the UI: push to the click, pan to the next.

**Raw footage.** High-resolution screen recordings (≥2× the output region you will zoom into), the logo, brand colours, optionally a founder VO.

**How bay does it today**
- Scale plus left/top keyframes on the screen recording zoom to a region, with bezier eases.
- `write_brf` for headlines, UI cards (rect + shadow + gradient background), and a cursor drawn as a path.
- `detect_beats` for cut timing. `generate_speech` for the VO.
- The `add_template` callout and end-card.

**Gaps**
- **No click or cursor telemetry** from recordings, so zoom targets must be found by eye (`frame_grid`) or given by the user.
- **No motion blur** on fast pans.
- **No cursor replacement or smoothing.**
- **No SFX** (clicks, whooshes).
- **No device-mockup assets.**

**Draft skill body**
1. Collect the recordings, the logo and one brand colour. `set_canvas` 1920×1080 (or 1080×1350 for social).
2. Write a 30–60 s beat sheet: pain (≤5 s), 3 feature beats (8–12 s each), proof/stat (4 s), CTA (3–4 s).
3. Pain: one `write_brf` headline, ≤6 words, springing in word by word.
4. For each feature, place the recording on a gradient background at 85–90% scale with rounded-corner crop and shadow (`write_brf` background + item layout).
5. For each important click (the user names it, or find it with `frame_grid`), keyframe scale to 1.6–2.0 centred on the click over 12–18 frames with ease-in-out. Hold during the action, then zoom back out over 12 frames.
6. Cut idle time in recordings (loading, typing) with `remove_range`, or speed those spans to 2–4×.
7. Label each feature with a 2–4-word kinetic caption that enters as the UI action starts.
8. `detect_beats` on the track. Every feature change and headline lands on a beat.
9. The stat beat uses `add_template` stat (a number counting up).
10. The CTA uses `add_template` end-card with the URL, held ≥3 s.
11. Duck music 18 dB under any VO.
12. Check: no UI text shown smaller than ~24 px at output size (inspect with `preview_frame`).

---

## 9. Kinetic typography / lyric video

**Identity.** The words are the picture. Beat-synced type "cuts hard to a rhythm: words snap, stack, and pulse onto the screen" [C, Todaymade/iArt]. Keep "one hero word per moment, not every word shouting" and "stick with one or two primary fonts" [C, Linearity; iArt].

**References**
- "22 (Taylor's Version)" lyric video type, on Fonts In Use: https://fontsinuse.com/uses/43958/22-taylor-s-version-lyric-video
- SVGator, 50 examples: https://www.svgator.com/blog/50-kinetic-typography-examples/
- PremiumBeat lyric tutorials: https://www.premiumbeat.com/blog/create-lyric-videos-after-effects/

**Pacing.** One phrase per lyric line, entrances on beats. Hand-animating runs "roughly an hour per 30 seconds of song" [C, iArt]. No authoritative words-per-second figure exists for lyric videos. Readable caption rates are ≤17 cps (Netflix) for subtitles and 5–10 words/s on TikTok [P, see `entertaining-editing.md`].

**Signature techniques**
- Scale pops, stacks and rotations. Masks and wipes revealing words.
- Font weight and width changing with intensity. Colour inversion on the chorus.
- Background textures from the album art. Camera moves through a type layout.

**Camera and motion.** A virtual camera only.

**Raw footage.** An audio track plus lyrics (or a VO script). Optionally album art or a background loop.

**How bay does it today**
- A strong fit. `transcribe` gives word times (sung vocals are less reliable). `detect_beats` gives the grid.
- `write_brf` does split text, springs, variable-font axes (width/weight driven by intensity), gradients, blur and shadow.
- The `reveal` and `punch` subtitle designs cover simple versions.

**Gaps**
- **No lyrics-to-audio forced alignment.** whisper on a sung vocal can mis-time or mis-hear words. You need a supplied-lyrics alignment mode.
- **No audio-reactive values** (amplitude → scale) inside brf.
- **No text masks** or text-behind-subject.

**Draft skill body**
1. Get the song and the exact lyrics text. `transcribe` the song and align the supplied lyrics to the word times. Where the transcript disagrees, trust the supplied words and the transcript's timings, and list low-confidence lines for the user.
2. `detect_beats`. Mark downbeats and the first beat of each chorus.
3. Pick one or two fonts, one heavy display face plus one light, with the user's or album's palette (≤3 colours).
4. Per lyric line, write one `write_brf` scene. Each word enters on its own sung onset (±2 frames), with a spring scale 0.6 → 1.0 or a rise of 20 px with fade.
5. Choose one hero word per line (the stressed or rhymed word). It gets 1.5–2× size or the accent colour. The others stay neutral.
6. Lines leave on the next line's first onset, or on a downbeat if the gap is longer than 1 beat.
7. The chorus gets a distinct treatment (colour inversion, heavier weight via the variable axis, larger scale) used every time the chorus returns.
8. Keep at most ~8 words on screen at once. Never show a word before it is sung.
9. Background: album art blurred (static `adjustments` blur) and darkened, or a solid colour. Change it only at section boundaries.
10. On big downbeats, add a scale bump of the whole text group 1.00 → 1.04 → 1.00 over 6 frames.
11. `preview_frame` a sample of lines to confirm legibility (text ≥5% of frame height).
12. Export with mastering off (keep the song's own master).

---

## 10. Hype / sports edit

**Identity.** Peak action, cut to the drop. Flash on the hit, shake on impact, slow motion on the key movement. Cuts "should be very fast — often less than one second — and perfectly synchronized with the music's beat or the moment of peak action" [C, Inside Editors].

**References**
- NBA on YouTube: https://www.youtube.com/@NBA
- House of Highlights: https://www.youtube.com/@HouseofHighlights
- Inside Editors guide: https://insideeditors.com/how-to-edit-sports-videos/

**Pacing**
- Sub-second cuts on beats in the peak sections [C].
- Ramps for action: 100% → **10–20%** over **4–8 frames**. Sports ramps "slow hold for 8–15 frames" [C, ShotBook].

**Signature techniques**
- A white or black flash frame on hard beat hits [C, Inside Editors].
- Zoom transitions pushing into the action. Shake on collisions and landings [C].
- Smooth-arc speed curves, not sharp angles [C, CapCutGuide].
- Bold condensed type for names and stats. A high-contrast, crushed grade.
- Bass-heavy trap or orchestral hybrid music, with risers into drops.

**Camera and motion.** Broadcast telephoto plus handheld sideline. The editor adds shake and zoom punches.

**Raw footage.** Action clips (ideally 60–120 fps) and a driving track with a clear drop.

**How bay does it today**
- `detect_beats`, cuts on beats.
- Flash: a `dip-to-white` transition of 2–4 frames, or a white `write_brf` rect with opacity keyframes 1 → 0 over 3 frames with blendMode screen.
- Shake: left/top/rotation keyframes alternating ±1–2% over 6–8 frames.
- Zoom punch: scale keyframes. Stepped slow motion via split + speed. Grade: contrast plus a LUT.

**Gaps**
- **No smooth time remapping.**
- **No motion blur** (shake without blur looks digital).
- **No optical flow.**
- **No shake or flash presets.** Hand-keying works but is verbose, so a keyframe "shake" generator would help.
- **No SFX library** (impacts, risers).

**Draft skill body**
1. `detect_beats` on the track. Find the drop: the downbeat after the largest energy rise (confirm with the user if unsure).
2. `index_footage`. Use `search_footage` to find peak moments (dunk, goal, tackle) and note their frame.
3. Build-up section: cuts every 2 beats with growing intensity. Drop section: cuts every beat.
4. Align each clip so its peak action frame lands exactly on a beat.
5. For the 2–4 biggest moments, a stepped slow-mo: split at the action with speed [1.0, 0.5, 0.2 held 8–15 frames, 0.5, 1.0], the 0.2 segment centred on the impact. Only for ≥60 fps sources.
6. On each drop or hit beat, a 2–3-frame white flash (dip-to-white or a brf flash).
7. On impacts, shake: left ±1.5%, top ±1%, rotation ±0.5°, alternating across 6 frames and decaying to 0.
8. On the first beat after a flash, a zoom punch: scale 1.00 → 1.12 over 3 frames, easing back over 8.
9. Names and stats: `write_brf` bold condensed uppercase, slam-in (scale 1.3 → 1.0 over 4 frames), held ≥1.5 s.
10. Grade: raise contrast, lower saturation slightly except the team colours, add vignette 0.3.
11. Keep no natural sound except crowd roars on 1–2 peaks, ducked under the music.
12. Check: every cut is within 1 frame of a beat, and no flash lands off-beat.

---

## 11. Luxury / minimal brand film

**Identity.** Restraint. "Understated and unhurried — the opposite of high-energy, fast-cut video" [C, Captions.ai]. It is about "summoning a mood". Narrative is kept to a minimum and branding played down [C, Luxury Society]. "Camera movement is deliberate, lighting is sculpted, and performances are minimal but meaningful" [C, Beast Agency].

**References**
- Chanel: https://www.youtube.com/@CHANEL
- Hermès: https://www.youtube.com/@hermes
- Luxury Society on the fashion-film fantasy: https://luxurysociety.com/en/marketing-the-fashion-film-fantasy/
- Gucci Lido analysis: https://modesfashion.substack.com/p/an-analysis-of-the-gucci-lido-campaign

**Pacing.** No measured source. Estimate shots of ~4–8 s, with dissolves and long holds [E]. Model movement is "breath-paced" and decelerated [C, Snappyit].

**Signature techniques**
- Slow motion. Occasional B&W [C, Captions.ai].
- Thin serif or widely spaced sans type, used rarely. "Flowing script fonts and sans-serif labels" [C, Captions.ai].
- Muted, cool or warm-neutral grade with soft contrast. Negative space.
- Sparse piano, strings or ambient music, or silence plus foley (fabric, footsteps).

**Camera and motion.** Locked-off or very slow dolly. Symmetry.

**Raw footage.** High-quality, well-lit footage of product, model or location. Slow motion helps. This style cannot rescue poor footage.

**How bay does it today**
- Cross-dissolves. Slow scale drifts. Constant slow motion via `speed` 0.5 on ≥50 fps sources.
- Grade: soft contrast curve, desaturation or B&W, grain 0.05–0.1.
- `write_brf` with a variable serif and wide tracking. Track volume and fades.

**Gaps**
- **No optical-flow slow motion** for 24/30 fps footage.
- **No masks** for light reveals.
- **No foley library.**

**Draft skill body**
1. Choose ≤10 shots with the cleanest composition (inspect with `frame_grid`). Drop anything handheld-shaky or cluttered.
2. Order them for mood: establish (wide), texture (macro), gesture (person), object (hero), close.
3. Shot length 4–8 s. No shot shorter than 3 s.
4. On ≥50 fps sources, `speed` 0.5 (0.4 for hands and fabric).
5. Each shot gets one slow move at most (scale 1.00 → 1.04 over the shot), or none.
6. Transitions: cross-dissolve 18–30 frames between moods, hard cuts within a mood. Never wipes or pushes.
7. Grade every shot the same: lower saturation (−20–30%), a soft S-curve, lifted blacks slightly, grain 0.06. Optionally B&W for 1–2 shots.
8. Type: at most 3 text moments (brand, one line, end). Serif or light sans, tracking +0.1–0.2em, ≤5% of frame height, fading in over 24 frames and holding ≥3 s.
9. Audio: one sparse music track at −18 dB, or silence plus natural sound. No SFX hits.
10. Start and end on black with 1 s fades.
11. Check: average shot length ≥4 s and no more than one type of transition besides the cut.

---

## 12. Lo-fi / film-grain aesthetic

**Identity.** Analogue nostalgia: grain, halation, gate weave, faded blacks, a lower frame rate. It reads as memory rather than record.

**References**
- StraySpark on halation, grain and gate weave: https://www.strayspark.studio/blog/blender-film-look-halation-grain-gate-weave
- MoonBear on 16mm/8mm grain: https://moonbear.shop/blogs/news/how-to-add-film-grain-to-video
- Beverly Boy, "Retro Aesthetics": https://beverlyboy.com/film-technology/retro-aesthetics-modern-films-embrace-vhs-and-film-grain/

**Pacing.** Loose, usually a montage over music.

**Signature techniques**
- **Frame rate.** Drop to 16 or 18 fps "to mimic mechanical camera motion". Super 8 ran at 18 fps [C, Filmora / Grass Valley forum].
- **Texture.** Grain combined with halation and gate weave, including micro-jitter [C, StraySpark]. Grain overlays in Screen or Overlay blend, "felt, not stared at" [C, Filmora].
- **Look.** Warm faded grade and vignette. Light leaks and film burns as transitions. Sometimes 4:3 with rounded gate corners.

**Camera and motion.** Handheld, casual.

**Raw footage.** Any lifestyle or handheld footage. Daylight scenes with highlights give halation something to bloom on.

**How bay does it today**
- bay's grade has **grain, halation (screened in RGB, warm by default) and vignette** built in, plus curves for faded blacks and LUTs.
- Gate weave via small left/top keyframes (±0.2–0.4%) at irregular intervals.
- 4:3 via `set_canvas` 1440×1080 or crop. Light leaks via `generate_image`/`generate_video`, blended in screen mode.

**Gaps**
- **No frame-rate posterise** for the 18 fps feel on video items. A speed/frame-hold option or per-item output fps would do it.
- **No real grain plates or light-leak library.**
- **No gate weave generator** (it is verbose to key).

**Draft skill body**
1. Choose the gauge with the user: "8mm" (strong grain, 4:3, 18 fps feel), "16mm" (medium grain, 4:3 or 16:9) or "35mm" (fine grain, 16:9).
2. `set_canvas`: 1440×1080 for 8mm or 16mm at 4:3. Otherwise keep it.
3. Grade every clip identically: lift blacks (curve toe to ~0.06), soft highlight roll-off, warm white balance, saturation −15%.
4. Halation on (default warm tint), strength scaled to the gauge.
5. Grain: 8mm 0.35, 16mm 0.22, 35mm 0.12 (bay's scale: ~0.15 ≈ fine 35mm at 1080).
6. Vignette 0.3–0.5.
7. Gate weave: on each clip, left/top keyframes jittering ±0.3% every 3–5 frames (irregular), linear.
8. Transitions: cuts, plus 1–3 light-leak moments (a generated leak clip, blendMode screen, 12–24 frames) at section changes.
9. Optional date stamp in `write_brf` (monospace orange, bottom-right) only if the user asks.
10. Music: lo-fi or warm track, slight high-cut if the user has an EQ'd version, at −16 dB.
11. `preview_frame` three frames (dark, mid, bright) to confirm grain is visible but not dominant.

---

## 13. News package / explainer with lower-thirds

**Identity.** Authoritative and labelled. Every speaker named, every place and number on screen, clean bars and tidy motion. "White text on a dark semi-transparent bar, with a colored rule above… used in news" [C, search summary of Infinite Creation/LIGR].

**References**
- BBC News: https://www.youtube.com/@BBCNews
- Reuters: https://www.youtube.com/@Reuters
- Lower-third rules (ANFX): https://anfx.co/blog/lower-thirds-design-rules-free-templates/

**Pacing.** Soundbite → B-roll → VO, with shots ≈3–6 s [E]. Lower thirds held **4–7 s** (2–3 s for repeat IDs), animated in over **0.3–0.7 s** and out over **0.3–0.5 s** [C, ANFX].

**Signature techniques**
- **Safe area.** Title-safe ~10% in from every edge. Action-safe 5% (SMPTE convention) [C, Motion Array / search summary]. ANFX says keep text ≥~96 px from the left and bottom on 1920×1080.
- **Hierarchy.** Secondary line at 50–65% of the primary's size, lighter weight [C, ANFX].
- **Other graphics.** Stat cards, maps and quote cards. Neutral grade.

**Camera and motion.** Tripod interviews, handheld B-roll, stand-ups.

**Raw footage.** Interview soundbites, B-roll, a VO or reporter track.

**How bay does it today**
- `add_template` lower-third, stat, callout and title-card cover most of it.
- `transcribe` for soundbite selection. `remove_range` to trim bites. `add_captions`. L-cuts via `detach_audio`/`trim_item`.

**Gaps**
- **No speaker identification** to auto-name lower thirds (a name must be given).
- **No map data.**
- Templates may need a broadcast-style variant (bar + rule).

**Draft skill body**
1. `transcribe` all interviews. Pick soundbites of 6–15 s that make one point each.
2. Structure: VO/stand-up intro (≤15 s), then alternate soundbite / B-roll-with-VO, ending on the strongest bite or a stand-up.
3. Cover every VO span with B-roll that shows what is said (`search_footage`).
4. The first time each speaker appears, add an `add_template` lower-third (name + role) 0.5–1 s after they start speaking. Hold 4–7 s. Repeat appearances: 2–3 s or none.
5. Keep all graphics inside the 10% title-safe area (≥192 px left/right and ≥108 px top/bottom at 1080p).
6. Every number gets an `add_template` stat card or a `write_brf` full-frame, 3–5 s.
7. Place and date: a small top-left locator via `write_brf`, 3 s, at each new location.
8. L-cut: let the interview audio start 6–12 frames before its picture, or continue under B-roll.
9. Neutral grade: correct white balance, no stylised LUT.
10. `add_captions` (≤42 chars/line, ≤17 cps) for accessibility.
11. Export with mastering "broadcast" (−23 LUFS) for TV, "streaming" for web.

---

## 14. Tutorial / screencast

**Identity.** Show exactly where to click, remove the waiting, never make the viewer hunt. "Leave a small beat before important clicks, then use zooms, cursor effects, or callouts to guide attention" [C, TechSmith].

**References**
- Fireship: https://www.youtube.com/@Fireship (measured ≈13 cuts/min [M, PandaStudio])
- Kevin Stratvert: https://www.youtube.com/@KevinStratvert
- TechSmith on editing screen recordings: https://www.techsmith.com/blog/how-to-edit-screen-recording/

**Pacing**
- Shots of 5–15 s are acceptable while the viewer reads the screen [C, `entertaining-editing.md`].
- Length: microlearning 2–6 min, demos 5–10 min. Engagement plateaus near 6 min (Guo's edX analysis) [C/R, TechSmith; Guo et al.].
- TechSmith's viewer survey: the most desired length for instructional videos is 10–19 min, with 30–35% preferring 3–6 min [I, TechSmith Video Viewer Study].

**Signature techniques**
- Zoom 150–200% to the action region [C].
- Cursor highlight and click rings. Keep the cursor still unless demonstrating [C, TechSmith].
- Callouts and arrows. Silence and dead-air removal. Chapters.
- Burned-in labels for keyboard shortcuts.

**Camera and motion.** Virtual zoom and pan over the capture. An optional face-cam bubble.

**Raw footage.** A screen recording at ≥ output resolution (ideally 2× for zooms), plus a mic track.

**How bay does it today**
- `transcribe` + `remove_range` for silence and mistakes.
- Scale/left/top keyframes for zooms. `add_template` callout. `write_brf` for key-press chips and arrows. Chapter markers.
- A face-cam inset: a second item with crop and layout. It can only be rectangular, because bay has no shape masks.
- Speed up typing and loading spans (`speed` 2–4).

**Gaps**
- **No cursor or click telemetry.**
- **No cursor highlight or click-ring effect** tied to the actual cursor.
- **No shape masks** (circle face-cam).
- **No auto-zoom** (Camtasia SmartFocus-style) [P, TechSmith AI auto zoom].
- **No keystroke capture.**

**Draft skill body**
1. `transcribe`. Outline the steps from the narration and add a marker at each step.
2. Open with the finished result shown for 5–10 s, then "here's how".
3. `remove_range` silences >0.6 s, restarts and "wait, let me…" spans.
4. Loading, rendering or typing spans with no narration longer than 2 s: split, then `speed` 3–4×, or remove if nothing is learned.
5. For each click or field the narration names, zoom scale 1.5–2.0 centred on it (find it with `frame_grid`/`preview_frame`) over 12–15 frames. Hold through the action, then zoom out.
6. Never zoom and pan at the same moment the cursor moves fast. Start the zoom 6–10 frames before the click.
7. Keyboard shortcuts: a `write_brf` key-chip (for example "⌘ K") bottom-centre for 1.5 s as it is pressed.
8. Warnings and tips: `add_template` callout pointing at the region, 3–4 s.
9. Chapter title at each step (`add_template` title-card, 1.2 s), and list chapter times for the description.
10. Music: none, or a bed at −30 dB.
11. `add_captions` for long-form.
12. Check: UI text readable at output size (≥~20 px) in every zoomed hold.

---

## 15. Faceless stock-footage explainer

**Identity.** A voiceover carries everything. Each sentence gets a matching stock or generated clip, map, chart or text. A "meaningful visual event every one to three seconds" in fast short-form. Tutorials and long-form hold longer [C, faceless.so].

**References**
- vidIQ, faceless channel ideas: https://vidiq.com/blog/post/youtube-channel-ideas-without-showing-your-face/
- faceless.so, B-roll ideas: https://faceless.so/blog/11-b-roll-ideas-for-faceless-videos-that-retain
- Kurzgesagt (animated, faceless): https://www.youtube.com/@kurzgesagt

**Pacing.** A visual change every 1–3 s short-form [C]. Long-form documentaries layer B-roll over a 10–15 min script [C, faceless.my via search].

**Signature techniques**
- Literal B-roll per sentence. Ken Burns on stills at **5–15%** zoom (5–8% for subtlety) [C, Frameo/Cloudinary].
- Kinetic text for key phrases. Maps and charts.
- A dramatic VO and a cinematic music bed.

**Camera and motion.** Borrowed from stock, plus digital moves on stills.

**Raw footage.** A script or VO. Stock or AI clips. Bay can generate the VO and clips.

**How bay does it today**
- `generate_speech` for the VO → `transcribe` → per-sentence `search_footage` (local library), `generate_image` + Ken Burns keyframes, or `generate_video`.
- `write_brf` for text and charts. `add_template` stat. Ducked music.

**Gaps**
- **No stock-footage search or licensing** (Pexels/Storyblocks-type). `search_footage` only searches what is already imported.
- **Generation is costly and slow** for a clip every 2 s.
- **No music library.**

**Draft skill body**
1. Get the script. `estimate_speech` for length, then `generate_speech` (or use the user's VO), then `transcribe` for sentence and word times.
2. Split into visual beats: one per clause, 1.5–3 s (short-form) or 3–6 s (long-form). Add a marker per beat with a concrete shot description.
3. For each beat, try `search_footage` with the description. Accept only if the match is clearly on-topic (confirm with `frame_grid`).
4. Unmatched beats: `generate_image` (then Ken Burns) or `generate_video`. Say how many generations it needs, and the cost, before running.
5. Stills: scale 1.00 → 1.08 plus a slight drift across the beat. Alternate zoom-in and zoom-out on consecutive stills.
6. Every number, name or list item gets kinetic text (`write_brf`, ≤5 words) synced to the spoken word.
7. Cut each visual on the first word of its clause (±2 frames).
8. Hook: the most surprising claim and its best visual in the first 3 s, with frame-1 text.
9. Music at −24 dB, `duck` under the VO. Change track or intensity at section breaks.
10. Short-form: `add_subtitles` `spotlight`. Long-form: `add_captions`.
11. Check: no beat longer than 3 s (short) or 6 s (long) without a visual change. Report the list.

---

## 16. UGC ad / testimonial

**Identity.** Looks like a creator's post and sells like an ad. Direct-to-camera, natural light, phone-shot. "Avoid heavy branding or cinematic polish that signals 'ad' before the viewer is hooked" [C, Stackmatix/Hustler Marketing].

**References**
- TikTok Creative Codes: https://ads.tiktok.com/business/en/creative-codes
- TikTok's creative best practices blog: https://ads.tiktok.com/business/en/blog/creative-best-practices-top-performing-ads
- Motion Creative Benchmarks 2026: https://motionapp.com/library/research/creative-benchmarks-2026/

**Pacing**
- Hook 0–3 s, value proposition 3–15 s, proof or demo 15–25 s, CTA in the last 5 s. 15–30 s is the "sweet spot" [C, Stackmatix].
- TikTok: value proposition in the first 3 s. The first 6 s carry 90% of ad-recall impact [P, TikTok via search].
- 93% of top-performing TikTok videos use sound [P, TikTok via search].
- Use the full 9:16 with no letterbox bars [P].

**Signature techniques**
- Hook types: bold claim, question, demonstration, relatability [C].
- A 3×3×3 test matrix: 3 hooks × 3 bodies × 3 CTAs = 27 variants [C, Stackmatix].
- Native-style captions. Product close-ups and demo inserts. A green-screen reaction over a screenshot. A CTA text card.

**Camera and motion.** Handheld selfie, jump cuts.

**Raw footage.** Phone 9:16 selfie takes (ideally several hook takes), product B-roll and hands demo.

**How bay does it today**
- `transcribe` + `remove_range`. `add_subtitles` (`boxed` reads "native").
- Product inserts via `place_asset`. CTA with the `add_template` end-card.
- **Variant generation:** one timeline per hook, by duplicating and swapping the first 3 s. That is manual but doable with `split_at`/`place_asset`.

**Gaps**
- **No project duplication or variant batch export tool.** (Check: no `duplicate_project` in the catalog.)
- **No green-screen or keying.**
- **No face tracking.**
- **No platform-native sticker styles.**

**Draft skill body**
1. `transcribe` every take. Label candidate hooks: sentences ≤3 s that make a claim, ask a question or show the product working.
2. `set_canvas` 1080×1920. Keep faces inside the TikTok safe zone (clear of the bottom ~25% and right ~13%).
3. Assemble the body: the problem (≤5 s), product demo or use (5–10 s), the result or proof (5–10 s), CTA (≤5 s). Total 15–30 s.
4. `remove_range` every pause >0.25 s. The pace should feel like one breath.
5. Cover every product mention with a product close-up or demo insert for 1–2 s.
6. `add_subtitles` `boxed` (or `spotlight`), `bottom` ≈30%.
7. Frame-1 text: the hook as ≤7 words, top third, for 0–3 s.
8. No logo before 3 s. The brand appears in the demo and CTA only.
9. CTA: spoken plus `add_template` end-card (offer + action), ≥2 s.
10. If there are 2–3 hook takes, build one variant per hook, identical after 3 s, and name them "hook A/B/C".
11. Music: a trending-style bed at −26 dB under voice, or none.
12. Export at −14 LUFS. Report each variant's length.

---

## 17. Anime / AMV "velocity" edit

**Identity.** Motion and speed choreographed to the music. Velocity edits "mix fast and slow motion", building anticipation and release. Speed goes down "e.g. 0.5x on drops" and up "e.g. 2x on highs". "A quick white flash exactly on the beat when video speeds up" [C, Columbus/Alight Motion guides via search].

**References**
- TikTok #velocityeditanime: https://www.tiktok.com/discover/velocity-edit-anime
- A Twixtor/time-remap tutorial: https://www.youtube.com/watch?v=p-N1FDjENJE
- FlexClip velocity guide: https://www.flexclip.com/learn/velocity-tiktok.html

**Pacing.** Every beat is an event. Ramps use 4–5 purposeful speed points rather than many [C, CapCutGuide]. CapCut offers 0.1×–10× [P, FlexClip].

**Signature techniques**
- Smooth speed curves (Twixtor-interpolated slow motion). Flash, shake and velocity zooms [C, Udemy course summary].
- RGB split, glow and overlays. Colour pulses on beats. Text rarely.

**Camera and motion.** Borrowed from the source, plus heavy digital motion.

**Raw footage.** Anime or action clips and a track. **Licensing:** fan edits use copyrighted footage. bay should only work on footage the user has rights to.

**How bay does it today**
- `detect_beats`. Flash via dip-to-white or a brf rect. Shake and zoom via keyframes.
- Stepped speed via split + speed. Glow roughly via adjustments plus screen blend of a duplicated blurred layer.

**Gaps.** This style depends almost entirely on what bay lacks:
- smooth speed curves,
- optical-flow interpolation,
- motion blur,
- directional or zoom blur,
- RGB split / chromatic aberration,
- keyframeable filters,
- shake presets,
- audio-reactive effects.

**Draft skill body**
1. Confirm the user has rights to the footage. Stop if not.
2. `detect_beats`. Classify sections as build, drop or breakdown by energy (ask the user to confirm the drop).
3. `detect_cuts` on the source to get clean shots. Pick shots with strong motion (inspect with `frame_grid`).
4. Build: shots of 2 beats. For each, split into [1.0, 1.6, 2.2] so speed rises into the next beat.
5. Drop: shots of 1 beat. On the drop, split into [2.0, 0.4 for 6–10 frames, 1.0], with the 0.4 segment starting exactly on the beat.
6. A 2-frame white flash on every drop and every 4th beat in the chorus.
7. Shake on hits: left ±2%, top ±1.5%, rotation ±1° across 6 frames, decaying.
8. Velocity zoom on accents: scale 1.00 → 1.2 over 3 frames, back over 6.
9. Glow on the chorus: duplicate the clip above itself, `adjustments` blur 8 px + brightness 1.3, `blendMode` screen, opacity 0.5.
10. Grade for punch: contrast +, saturation +10%.
11. Tell the user which effects are approximations (stepped speed, no motion blur).

---

## 18. "Day in the life" vlog

**Identity.** A day from morning to night as a calm, aesthetic montage, part talking and part observational. It comes from Casey Neistat's grammar: "Neistat montage" (rapid cuts showing a task's progression, often sped up), the "cut-off" (cutting mid-sentence once the viewer knows what is coming), in-camera transitions (setting the camera down, lens slap), and the push-in "Neistat zoom". He opens with a timelapse and ends abruptly [C, No Film School; Fstoppers].

**References**
- Casey Neistat: https://www.youtube.com/@casey
- "Make It Count": https://www.youtube.com/watch?v=WxfZkMm3wcg
- No Film School on Neistat's techniques: https://nofilmschool.com/2016/08/7-storytelling-techniques-you-can-learn-filmmaker-youtube-star-casey-neistat

**Pacing.** Montages 0.5–2 s. Talking segments 4–8 s. Vlogs typically run 4–8 s per shot [C, Vidpros, unsourced].

**Signature techniques**
- **Timelapse** "to skip dead time, show elapsed time, and add visual texture" [C, Neistat guides].
- **Grade.** A soft, low-contrast film look with "muted saturation" for slow lifestyle vlogs [C, Filmora].
- **Sound.** ASMR-level natural sound (pour, keyboard, door).
- **Labels.** Time-of-day stamps.
- **Frame rate.** 24 fps main with 60 fps B-roll slowed [C, Hollyland].

**Camera and motion.** Handheld, deliberate slow hand movement, top-down desk and coffee shots [C, Hollyland].

**Raw footage.** Many short clips spanning a day (morning to evening) plus a few talking bits. Timelapse clips help.

**How bay does it today**
- `index_footage` + `search_footage` to order by content ("coffee", "night street").
- Speed 4–10× for pseudo-timelapse. Soft grade + grain. `write_brf` time stamps.
- `detect_beats` for montages. Natural-sound moments by lowering the music with volume keyframes.

**Gaps**
- **No time-of-day ordering** from clip metadata. It needs creation-time reads, and bay's probe may not expose them. Unverified.
- **No SFX or foley library.**
- **No smooth ramps.**

**Draft skill body**
1. `index_footage`. Order clips chronologically (by file creation time if available, else by `search_footage` cues: sunrise → daylight → dusk → night). Confirm the order with the user.
2. Open with a 2–4 s establishing timelapse (a clip at `speed` 6–10×) or the most beautiful morning shot.
3. `transcribe` the talking clips. Keep 1–3 short talking bits (≤20 s each) that give the day a thread.
4. Group activities into mini-montages (4–8 shots each, 0.7–1.5 s per shot) cut on beats.
5. Tasks longer than 5 s of real time become sped-up montages (`speed` 2–4×) or timelapses.
6. At 3–5 moments, drop the music to −30 dB for 1.5–3 s and let natural sound play (the pour, the door) at full level. Use volume keyframes.
7. Time or place stamps with `write_brf` (small lowercase, e.g. "7:04 am") at each new part of the day, 2 s.
8. Talking bits: cut-offs are allowed. Cut once the point is clear.
9. Grade all clips: soft contrast, saturation −10–15%, warm white balance, grain 0.1.
10. Transitions: cuts. Allow in-camera transitions if present (camera set down → next shot).
11. End on the last evening shot with an abrupt cut or a 1 s fade. No outro card.
12. Check: morning-to-night order is monotonic, and no montage shot exceeds 2 s.

---

## 19. Interview / documentary two-camera

**Identity.** A-cam medium, B-cam close, cut at changes of thought, with cutaways and B-roll to compress time. "Each should have a different framing, so a cut between the cameras doesn't look like a jump cut" [C, digitalfilms/Oliver Peters]. "The most useful single cutaway in interview work is the listener nodding or reacting" [C, Shootsta].

**References**
- Shootsta's two-person interview guide: https://shootsta.com/blog/simple-guide-to-filming-a-2-person-interview
- Rocket House Pictures on two-camera interviews: https://rockethousepictures.com/blog/why-we-use-2-cameras-to-film-interviews.html
- digitalfilms, "The On Camera Interview": https://digitalfilms.wordpress.com/2015/11/27/the-on-camera-interview/

**Pacing.** Angle alternation around every 5–6 s during long monologues (DOAC measured 6.3 s [M]). Longer holds on emotional answers. Documentary shots average 7–25 s [C, Vidpros, unsourced].

**Signature techniques**
- A/B angle changes used to hide internal edits (bites compressed).
- Lower thirds on the first appearance. L-cuts into B-roll that illustrates the answer.
- Listener reactions. A natural grade. A light music bed only under B-roll passages.

**Camera and motion.** Static tripods. A-cam around 45°, B-cam tight [C, Shootsta].

**Raw footage.** Two synced cameras (or one 4K to punch in for a B-angle), a lav or boom, and B-roll.

**How bay does it today**
- `transcribe` → pick bites → `remove_range` (keeps both angles in sync if both are on tracks).
- Switch angles by track opacity or by cutting the upper track. Punch-in fake B-cam from 4K.
- `add_template` lower-third. L-cuts with `detach_audio`/`trim_item`. `add_captions` `clean`.

**Gaps**
- **No multicam sync** by audio waveform. The cameras must be pre-synced or aligned by hand.
- **No multicam angle-switch tool.**
- **No speaker diarisation.**

**Draft skill body**
1. If there are two cameras, align them. Find a clap or a shared word in both transcripts and offset the B-cam so its words fall on the same frames (±1). Report the offset. Otherwise use one 4K camera and make B by punch-in 1.3–1.5×.
2. Put A-cam on V1 and B-cam on V2, with audio from the lav only.
3. `transcribe` the lav. Select answers that stand alone and remove questions unless the question is needed for context.
4. `remove_range` false starts and tangents inside answers. At every such internal edit, switch camera angle so the edit is hidden.
5. Beyond edits, switch angles at thought changes, and at least every ~6 s during long answers. Stay on one angle through an emotional peak.
6. First appearance of each person: `add_template` lower-third 0.5–1 s after they begin, held 4–6 s.
7. Cover 20–40% of runtime with B-roll that illustrates what is said, entering on a key noun. Use L-cuts: the interview audio continues under it.
8. Insert listener reaction cutaways (1–1.5 s) where available.
9. Music only under B-roll passages or chapter breaks, at −26 dB, ducked under the voice.
10. Natural grade: match A and B for white balance and exposure so the cut does not jump.
11. `add_captions` or `add_subtitles` `clean`.
12. Check: no internal edit is left on the same angle unless it is covered by B-roll (list them).

---

## Gaps across styles, ranked by how many styles need them

Counted from the "Gaps" line of each section above (19 styles).

| Rank | Gap | Styles that need it | Count |
|---|---|---|---|
| 1 | **SFX / music / foley library** (whoosh, pop, riser, impact, click, licensed beds) | Hormozi, MrBeast, Ali Abdaal, Travel, SaaS, Hype, Luxury (foley), Faceless (music), DITL, Vox (music), Kinetic (optional), UGC (bed) | 12 |
| 2 | **Smooth speed curves / time remap** (not stepped splits) | MrBeast, Travel, Apple, Hype, AMV, DITL, Luxury (ramps into slow-mo) | 7 |
| 3 | **Motion blur** on keyframed moves and transitions (real whips) | Vox, Travel, Apple, SaaS, Hype, AMV | 6 |
| 4 | **Face/subject tracking + auto-reframe 16:9→9:16** | Hormozi, MrBeast, Podcast, UGC, Interview (framing), DITL (talking bits) | 6 |
| 5 | **Masks** (shape/rotoscope: foreground wipes, circle face-cam, text behind subject, light reveals) | Travel, Apple, Luxury, Tutorial, Kinetic, MrBeast | 6 |
| 6 | **Keyframeable filters** (blur/brightness/chromatic aberration over time: zoom-blur, soft reveals, RGB split) | Ali Abdaal, Travel, Vox, AMV, Kinetic | 5 |
| 7 | **Speaker diarisation** (who is speaking when → auto angle switch, per-speaker caption colour, auto lower-third names) | Podcast, Interview, News, UGC (multi-person) | 4 |
| 8 | **Shake / flash / gate-weave generators** (one call instead of dozens of keys) | Hype, AMV, Lo-fi, MrBeast | 4 |
| 9 | **Optical-flow slow motion** (frame interpolation) | Travel, Hype, AMV, Luxury | 4 |
| 10 | **Frame-rate posterise per item** (12 fps stutter, 18 fps film) | Vox, Lo-fi, AMV | 3 |
| 11 | **Multicam sync by audio + angle-switch tool** | Podcast, Interview, MrBeast | 3 |
| 12 | **Audio-reactive graphics** (waveform, amplitude-driven scale) | Podcast (audiogram), Kinetic, AMV | 3 |
| 13 | **Stock footage / archival search + licensing** | Faceless, Vox, Ali Abdaal | 3 |
| 14 | **Texture/overlay library** (grain plates, light leaks, paper, film burns) | Lo-fi, Vox, Ali Abdaal | 3 |
| 15 | **Cursor/click telemetry + auto-zoom for screen recordings** | SaaS, Tutorial | 2 |
| 16 | **Variant duplication / batch export** (hook A/B/C) | UGC, (MrBeast thumbnails/tests) | 2 |
| 17 | **Per-word caption emphasis by meaning** (keyword colour independent of active word) | Hormozi, Podcast (per-speaker colour) | 2 |
| 18 | **Map/geo shape data** | Vox, Faceless | 2 |
| 19 | **Lyrics-to-audio forced alignment** (sung vocals) | Kinetic | 1 |
| 20 | **Keying / green screen** | UGC | 1 |

**Reading the ranking.**
- **Assets, not capabilities.** Gap 1 is a library of sounds, not engine work. It is also the one gap bay cannot fill by generation today (`generate_speech` is speech only).
- **Speed curves and motion blur.** Gaps 2, 3 and 9 are one family: the "kinetic" styles (travel, hype, AMV) depend on them. They also account for the lowest fit scores (30–45%).
- **Reframing and diarisation.** Gaps 4 and 7 unlock the highest-volume use case, turning a 16:9 podcast or interview into 9:16 clips. `find_highlights` already does the selection half of that.
- **Presets over keys.** Several gaps (8, 10) are expressible today as many keyframes. A preset tool ("shake this item, intensity X, frames A–B") would turn a verbose, error-prone skill step into one call. That is cheaper than new rendering features.

**Five best fits today [E]:**
1. Retention talking-head (85%)
2. News/lower-thirds (80%)
3. Kinetic typography (75%)
4. Luxury/minimal (75%)
5. UGC ad (75%)

All five are built from transcript cuts, captions, brf type, templates and grade, which bay already has. None needs speed curves or motion blur.

---

## Sources

Internal (repo):
- [`r&d/research/entertaining-editing.md`](./entertaining-editing.md): cross-format retention, caption and audio-level rules, with its own sources (YouTube Help, TikTok Ads, Netflix Timed Text, Cutting et al., Zannettou et al. CHI '24, Murch).
- [`r&d/research/apple-launch-style.md`](./apple-launch-style.md): bay's Apple-film tone card.
- [`r&d/research/motion-graphics-launch.md`](./motion-graphics-launch.md): launch-video motion references.
- `src/shared/tools/*.ts`, `src/shared/project.ts`, `src/shared/grade.ts`, `src/shared/templates.ts`: bay's actual tool surface, as checked for the fit and gap columns.

Measured / research:
- Tubefilter, "MrBeast says to stop using his editing style": https://www.tubefilter.com/2024/03/04/mrbeast-editing-style-number-of-cuts-per-video/
- PandaStudio, "MKBHD's editing formula, measured": https://www.writepanda.ai/blog/mkbhd-editing-style-measured/
- PandaStudio, "How Diary of a CEO edits podcast clips": https://www.writepanda.ai/blog/how-diary-of-a-ceo-edits-podcast-clips/
- "How Do Professional Editors Evaluate the Editing Quality of AI-Generated Cinematic Video Ads?" (arXiv 2608.24329): https://arxiv.org/html/2608.24329
- Guo, Kim & Rubin, "How video production affects student engagement" (L@S 2014): https://dl.acm.org/doi/10.1145/2556325.2566239
- TechSmith, instructional video length: https://www.techsmith.com/blog/video-length/ · Video Viewer Trends 2024: https://www.techsmith.com/resources/research/video-viewer-report/

Platform:
- TikTok Creative Codes: https://ads.tiktok.com/business/en/creative-codes
- TikTok creative best practices blog: https://ads.tiktok.com/business/en/blog/creative-best-practices-top-performing-ads
- TechSmith AI auto zoom: https://www.techsmith.com/camtasia/features/ai-auto-zoom-and-pan/
- TechSmith, editing screen recordings: https://www.techsmith.com/blog/how-to-edit-screen-recording/

Practitioner / vendor guides (tagged [C] in the text):
- Hormozi: OpusClip https://www.opus.pro/blog/create-videos-in-alex-hormozi-style-the-ultimate-guide · Riverside https://riverside.com/blog/hormozi-style-videos · Joyspace https://joyspace.ai/hormozi-editing-style-2026-analysis · Increditors https://increditors.com/an-ultimate-guide-to-alex-hormozi-ali-abdaal-and-mr-beast-video-editing-style-and-methods/ · Quso https://quso.ai/blog/how-to-edit-reels-and-shorts-like-alex-hormozi
- MrBeast: SendShort https://sendshort.ai/guides/mrbeast-style/ · C4E https://c4e.in/blog/behind-the-scenes-how-mrbeasts-videos-get-edited/
- Ali Abdaal: https://aliabdaal.com/youtube/the-ultimate-guide-to-youtube/ · Choppity https://www.choppity.com/tools/recreate-video-editing-style/ali-abdaal/ · TechBullion https://techbullion.com/an-ultimate-guide-to-ali-abdaal-video-editing-style-and-methods/
- Podcast clips: Recast https://recast.studio/blog/audiogram-best-practices-for-social-media · Quso https://quso.ai/blog/how-to-edit-podcast-shorts-like-a-pro · Riverside https://riverside.com/blog/podcast-clips
- Vox: PremiumBeat https://www.premiumbeat.com/blog/replicating-vox-motion-graphic/ · Calliope https://www.calliopelabs.co/guides/vox-style-shorts · No Film School maps https://nofilmschool.com/how-create-vox-style-map-animations-after-effects · Nieman Lab https://www.niemanlab.org/2018/08/explanatory-video-engagement-how-voxs-borders-series-is-humanizing-the-map-and-building-local-source-networks/
- Travel / speed ramps: Mia Hagerty https://miahagerty.medium.com/what-made-it-the-art-of-the-seamless-transition-270d10334efb · ShotBook https://shotbook.art/blog/how-to-find-and-use-speed-ramp-references-for-video-editing · Sam Kolder https://www.samkolder.com/
- Apple: Manfrotto https://manfrotto.com/us-en/stories/how-to-shoot-cinematic-tech-videos-like-apple
- SaaS: Blare https://blarevideo.com/feeds/blog/saas-product-launch-video · Hera https://hera.video/blog/ui-animation-video-for-software-marketing · Tella https://www.tella.com/blog/animated-cursors-for-screen-recordings
- Kinetic type: Linearity https://www.linearity.io/blog/kinetic-typography/ · Todaymade https://www.todaymade.com/blog/kinetic-typography-examples · SVGator https://www.svgator.com/blog/50-kinetic-typography-examples/ · Fonts In Use https://fontsinuse.com/uses/43958/22-taylor-s-version-lyric-video · iArt https://www.iart.ai/lyric-video-maker
- Hype / velocity: Inside Editors https://insideeditors.com/how-to-edit-sports-videos/ · CapCutGuide https://capcutguide.com/capcut-velocity-edit/ · FlexClip https://www.flexclip.com/learn/velocity-tiktok.html · Columbus velocity guide https://smart.columbus.gov/columbus-news/mastering-tiktok-velocity-edits-a-full-guide-1767647332 · Udemy basic velocity https://www.udemy.com/course/after-effects-basic-velocity-course/
- Luxury: Captions.ai https://captions.ai/styles/byline · Luxury Society https://luxurysociety.com/en/marketing-the-fashion-film-fantasy/ · Snappyit https://snappyit.ai/blog/luxury-fashion-video-production · Beast Agency https://beast.agency/industries/luxury-brand-video-production/
- Lo-fi: StraySpark https://www.strayspark.studio/blog/blender-film-look-halation-grain-gate-weave · Filmora https://filmora.wondershare.com/video-effects/old-film-overlay.html · MoonBear https://moonbear.shop/blogs/news/how-to-add-film-grain-to-video · Grass Valley forum (18 fps 16mm) https://forum.grassvalley.com/forum/editors/editing-with-edius/572932-18fps-16mm-film-transfer-to-1080-18p
- Lower thirds: ANFX https://anfx.co/blog/lower-thirds-design-rules-free-templates/ · Motion Array https://motionarray.com/learn/motion-design/broadcast-design-terms/ · LIGR https://www.ligrsystems.com/blog/lower-thirds-explained
- Ken Burns: Frameo https://frameo.ai/blog/use-ken-burns-effect-images/ · Cloudinary https://cloudinary.com/guides/image-effects/ken-burns-effect-complete-guide-and-how-to-apply-it
- Faceless: faceless.so https://faceless.so/blog/11-b-roll-ideas-for-faceless-videos-that-retain · vidIQ https://vidiq.com/blog/post/youtube-channel-ideas-without-showing-your-face/
- UGC: Stackmatix https://www.stackmatix.com/blog/tiktok-creative-best-practices-startups · Hustler Marketing https://www.hustlermarketing.com/blog/how-to-write-ugc-ad-hooks-that-stop-the-scroll-on-meta-and-tiktok/ · Motion benchmarks https://motionapp.com/library/research/creative-benchmarks-2026/
- DITL / Neistat: No Film School https://nofilmschool.com/2016/08/7-storytelling-techniques-you-can-learn-filmmaker-youtube-star-casey-neistat · Fstoppers https://fstoppers.com/aerial/how-casey-neistats-style-editing-made-him-so-famous-157821 · Hollyland https://store.hollyland.com/blogs/creator-hub/film-aesthetic-vlogs · Filmora vlog filters https://filmora.wondershare.com/video-creative-tips/cinematic-daily-vlog-filters.html
- Interview: Shootsta https://shootsta.com/blog/simple-guide-to-filming-a-2-person-interview · Rocket House https://rockethousepictures.com/blog/why-we-use-2-cameras-to-film-interviews.html · digitalfilms https://digitalfilms.wordpress.com/2015/11/27/the-on-camera-interview/
- Shot-length table (unsourced vendor figures, used only where marked): Vidpros https://vidpros.com/video-clip-length/

**Not verified.**
- Individual YouTube video IDs, except the two cited (MrBeast Squid Game, Casey Neistat "Make It Count").
- Channel handles for Linear, Stripe, Chanel and Hermès. Check them before they appear in the product UI.
- Whether bay's probe exposes file creation time (style 18, step 1).
- TikTok's "first 6 s = 90% of ad recall" and "93% use sound": both reached via secondary summaries, because the TikTok pages refused direct fetch.
