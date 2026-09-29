# Raw clips for style-skill before/after previews

This file lists one raw clip, or a small pile of clips, for each editing style. bay edits the clip to
show a before/after preview in the app. I researched it on 2026-09-27. It builds on
`sample-footage.md` and `raw-talking-head.md`, so read those first. Nothing was downloaded into the repo.
The scratch files are in `/tmp/styleclips-463-1790487268`.

**How each clip was checked:**

- **Licence:** read from the live source. For Commons I used the API's `extmetadata` and the file's
  wikitext, which shows whether a licence review has passed. For Mixkit I read the licence line on each
  item's own page. Each Mixkit item is either "Free" or "Restricted", and **every Restricted item was
  dropped**.
- **Streams:** `ffprobe` over HTTP. For Commons I used the 480p VP9 transcode.
- **Speech:** I range-fetched the first 4–8 MB of each Commons transcode into the scratch dir. Then I ran
  `volumedetect`, and `silencedetect` at −35 dB for 0.4 s to count pauses. I transcribed 20–25 s with
  whisper.cpp and bay's `ggml-base.bin`. The quotes below come from those transcripts. Seeking over
  HTTP into a Commons WebM returns zero samples, so the byte range is required.
- **Framing:** I looked at extracted frames for every pick.

**Caveats that apply to everything below:**

- **Mixkit Free License:** "Allows use in commercial projects (YouTube videos, social media marketing,
  online ads, music videos) and personal projects. No attribution required." The Restricted License
  "only allows use in personal, non-commercial projects" (mixkit.co/llm-info). Mixkit clips have **no
  audio stream**, which suits piles where speech is optional.
- **Mixkit URLs come in two forms.** Older items use the stable pattern
  `assets.mixkit.co/videos/<id>/<id>-1080.mp4` (also `-720`). Items numbered around 100000 and up return
  403 on that pattern. Their file sits at an opaque `assets.mixkit.co/<hash>` found through
  `mixkit.co/free-stock-video/download/<id>/?type=1080p`. **Treat the hash URLs as unstable** and
  resolve them again at download time.
- **"YouTube CC-BY" files on Commons** were copied from YouTube by Commons users under the uploader's
  CC BY 3.0. Downloading them from `upload.wikimedia.org` is fine. Downloading from YouTube itself is
  not. `{{LicenseReview}}` with no reviewer means the licence **has not been reviewed yet**. That is
  flagged per file.
- **Share-alike (BY-SA) passes on to the edit**, and publicity rights stay with the people on camera.
  US-government footage implies no endorsement, so add a line such as "NASA does not endorse bay".

## Summary

| # | Style | Pick | Licence | Audio |
|---|---|---|---|---|
| 1 | Retention talking-head short | Candidate statement (vertical selfie) · alt: James, Yorkshire English (CC0) | BY-SA 4.0 · CC0 | Speech verified |
| 2 | Podcast / two-person | The CSS-Podcast 088 (locked two-shot, 4K) · alt: Houston, We Have a Podcast Live | CC BY 3.0 · PD | Speech verified |
| 3 | Interview + B-roll | NASA SVS Artemis II: Kelsey Young soundbites + roll-ins | PD | Speech verified; B-roll silent |
| 4 | Travel/vlog pile | Mixkit hiking-couple shoot (10 clips, 43148–43161) · plus road POV 41574–41576 | Mixkit Free | No audio (none needed) |
| 5 | Sports/action pile | Mixkit skate-park shoot (34382–34389) | Mixkit Free | No audio |
| 6 | Product (luxury/minimal) | Mixkit watch set (44070, 3649, 3652, 3672, 3673) · alt: Intel CPU unboxing (vertical, hands only) | Mixkit Free · CC BY 3.0 | Mixkit none; Intel speech verified |
| 7 | Screen recording / tutorial | Annotating the Schrödinger equation · alt: Uploading to Wikimedia Commons | BY-SA 4.0 · BY-SA 3.0 | Speech verified |
| 8 | Documentary / archival | Duck and Cover (1951, LoC scan) · alt: The Eagle Has Landed (1969, NARA) | PD | Narration verified |
| 9 | Lo-fi / aesthetic everyday | Mixkit vinyl/retro set (100871–100875) + coffee (43935, 43941, 808) | Mixkit Free | No audio |
| 10 | UGC testimonial | Yarn Unboxing with Kristy Glass (licence reviewed) · alt: Intel unboxing (vertical) | CC BY 3.0 | Speech verified |
| 11 | Music for beat edits | Mixkit "Let's Move" (EDM) · "Non Stop" (breakbeat) · lo-fi: "Hip Hop Two" | Mixkit Free (music) | MP3 probed |
| 12 | Cinematic B-roll for LUT/grade | Mixkit lake-and-hills drone shoot (101501–101516) · for real log footage: Pexels Apple Log (see `sample-footage.md`) | Mixkit Free | No audio |

**All 12 needs have at least one verified pick.** Weak spots: see [Gaps](#gaps).

---

## 1. Retention talking-head short

Both clips were verified in `raw-talking-head.md`, and I re-probed them today.

**Candidate statement** ★
- Page: https://commons.wikimedia.org/wiki/File:Candidate_statement.webm
- File: https://upload.wikimedia.org/wikipedia/commons/transcoded/f/f1/Candidate_statement.webm/Candidate_statement.webm.480p.vp9.webm
- 3:05 · 1080×1920 vertical · handheld selfie
- Audio: opus mono. The first 117 s averages −21.8 dB with **41 pauses** over 0.4 s. Whisper: "Hi everyone,
  my name is Abdurafi…"
- Licence: "CC BY-SA 4.0", own work. Credit: *Alhaj Darajaati, CC BY-SA 4.0*
- Fit: eye contact and many dead-air pauses, so a jump-cut short with word captions is a strong "after".
  Share-alike applies to the edit.

**James speaking West Riding Yorkshire English** (alt, **CC0**)
- Page: https://commons.wikimedia.org/wiki/File:James_speaking_West_Riding_Yorkshire_English.webm
- File: https://upload.wikimedia.org/wikipedia/commons/transcoded/1/13/James_speaking_West_Riding_Yorkshire_English.webm/James_speaking_West_Riding_Yorkshire_English.webm.480p.vp9.webm
- 6:20 · 1080×1920 · seated, to camera
- Audio: opus stereo. −29.4 dB with 18 pauses in the first 59 s.
- Licence: CC0 1.0 (Wikitongues). No credit required. "Wikitongues" as a courtesy.
- Fit: the only no-strings option. Run whisper with `-l en`, because auto-detect guessed Welsh.

## 2. Podcast / two-person conversation

**The CSS-Podcast – 088 – State queries** ★
- Page: https://commons.wikimedia.org/wiki/File:The_CSS-Podcast_%E2%80%93_088_%E2%80%93_State_queries.webm
- File (480p): https://upload.wikimedia.org/wikipedia/commons/transcoded/4/43/The_CSS-Podcast_%E2%80%93_088_%E2%80%93_State_queries.webm/The_CSS-Podcast_%E2%80%93_088_%E2%80%93_State_queries.webm.480p.vp9.webm
  (original 4K: https://upload.wikimedia.org/wikipedia/commons/4/43/The_CSS-Podcast_%E2%80%93_088_%E2%80%93_State_queries.webm, 269 MB)
- 23:12 · 3840×2160 · **one locked-off wide two-shot**: two hosts on director's chairs, with a
  composited graphic background. It stays a single framing for the 3 minutes I sampled (9-frame tile).
- Audio: opus stereo. −21.9 dB with 11 pauses in 185 s. Whisper: "…there are a few that we're starting with
  to prototype. So we're going to talk about those in this episode…"
- Licence: `{{YouTube CC-BY|Chrome for Developers}}` (CC BY 3.0). **`{{LicenseReview}}` is still
  pending.** Credit: *"The CSS Podcast – 088: State queries", Chrome for Developers, CC BY 3.0*
- Fit: the textbook podcast-to-shorts input. The 4K wide shot leaves room to punch in on each speaker
  and follow whoever is talking in 9:16.
- Flags: the hosts are identifiable Google employees, and the show is Google-branded. Demo use only,
  never implying endorsement. An episode title card is burned in at the start.

**Houston, We Have a Podcast Live: #BeAnAstronaut** (alt)
- Page: https://commons.wikimedia.org/wiki/File:Houston,_We_Have_a_Podcast_Live;_Hashtag_BeAnAstronaut.webm
- File: https://upload.wikimedia.org/wikipedia/commons/transcoded/2/24/Houston%2C_We_Have_a_Podcast_Live%3B_Hashtag_BeAnAstronaut.webm/Houston%2C_We_Have_a_Podcast_Live%3B_Hashtag_BeAnAstronaut.webm.480p.vp9.webm
- 57:45 · 1280×720 · three people at a desk. It is live-switched multicam (wide shots and singles),
  with lower thirds, tweet cards and a remote guest box.
- Audio: opus stereo. −30.0 dB with 6 pauses in 132 s. Whisper: "…We also have Kayla Baron… you're among
  the turtles, the astronaut class of 2017…"
- Licence: `{{PD-NASA}}`, licence review passed (2025-12-25). Credit: *NASA Johnson Space Center* plus a
  non-endorsement line.
- Fit: PD with long conversational stretches. It is less raw than the pick, because switching and
  graphics already exist.
- Rejected: the CHP "Behind the Badge" podcast. Its PD claim for California state work is doubtful, and it
  is edited multicam with lower thirds. The Wikimania podcast talks are presentations.

## 3. Interview with B-roll

**NASA SVS 14934: Artemis II interview opportunity** ★ (one page, two files)
- Page: https://svs.gsfc.nasa.gov/14934/
- Interview: https://svs.gsfc.nasa.gov/vis/a010000/a014900/a014934/Kelsey_Young__SOTs_Artemis_II_1.mp4
  8:38, 1920×1080, h264 + AAC stereo, 1.31 GB, and Range requests are supported.
  - Audio: **−38.2 dB (quiet, so it needs gain)**. Whisper at 60–80 s: "We're also going to be doing lunar
    science on board the Orion vehicle. The crew will be studying up on their lunar geography…"
  - Framing: a mid shot of Dr. Kelsey Young in front of an Artemis-branded set, with slated question
    blocks (soundbites).
- B-roll: https://svs.gsfc.nasa.gov/vis/a010000/a014900/a014934/ARTEMIS_II_ROLL-INS_1.mp4
  4:46, 1920×1080, 693 MB. It has an AAC track, but **it is silent: −91 dB mean and max**. Contents:
  topic-slated roll-ins such as crew training in the NBL pool and Orion.
- More on the same page: Nicola Fox soundbites (8:26, 720p), `LONGER_QUESTIONS_1.mp4` (6:08 B-roll) and four
  crew-profile videos.
- Licence: NASA media is public domain. The page says "Please give credit for this item to: NASA's
  Goddard Space Flight Center". Add a non-endorsement line. The people on camera keep publicity rights.
- Fit: the page is built for this edit. Slated soundbites plus matching B-roll give a "find the best take,
  lay cutaways over it" before/after. The files are big and the server is slow (a 20 s probe took over
  4 minutes), so download them once and keep a local copy.

## 4. Travel / vlog footage pile

**Mixkit hiking-couple shoot** ★ (one crew, one location, sequential IDs)

| Clip | ID | Dur | File |
|---|---|---|---|
| Couple walking in the forest | 43148 | 7 s | https://assets.mixkit.co/videos/43148/43148-1080.mp4 |
| Explorers taking a selfie | 43149 | 5 s | https://assets.mixkit.co/videos/43149/43149-1080.mp4 |
| Hiking couple taking a selfie | 43150 | 10 s | https://assets.mixkit.co/videos/43150/43150-1080.mp4 |
| Couple exploring a forest | 43151 | 15 s | https://assets.mixkit.co/videos/43151/43151-1080.mp4 |
| Young people walking through a forest | 43152 | 20 s | https://assets.mixkit.co/videos/43152/43152-1080.mp4 |
| Lovers walking through a forest | 43153 | 15 s | https://assets.mixkit.co/videos/43153/43153-1080.mp4 |
| High view of young people hiking | 43155 | 6 s | https://assets.mixkit.co/videos/43155/43155-1080.mp4 |
| Close-up to a hiker in a forest | 43158 | 7 s | https://assets.mixkit.co/videos/43158/43158-1080.mp4 |
| Hiker looking at the sky | 43159 | 6 s | https://assets.mixkit.co/videos/43159/43159-1080.mp4 |
| Couple looking at a landscape | 43161 | 7 s | https://assets.mixkit.co/videos/43161/43161-1080.mp4 |

- All are 1920×1080 h264 with no audio stream. Each page reads "Mixkit Stock Video Free License".
- Pages: `https://mixkit.co/free-stock-video/<slug>-<id>/`, for example
  https://mixkit.co/free-stock-video/hiking-couple-taking-a-selfie-43150/
- To add a road-trip leg, use the POV series from one set: 41574 forest path (15 s), 41575 road at dusk
  (20 s), 41576 curved mountain highway (50 s), in the same URL pattern.
- Credit: none required.
- Fit: about 2 minutes of one trip, with wides, close-ups and selfies, so it can be ordered into a story
  and cut to music. Models are featured in stock, and the Mixkit licence covers that use.
- Gap: there is **no real phone-vlog pile with natural sound**. Commons travel "vlogs" are finished
  edits. See Gaps.

## 5. Sports / action pile for a beat-cut hype edit

**Mixkit skate-park shoot** ★ (same skaters, same park, IDs 34382–34389)

| Clip | ID | Dur |
|---|---|---|
| Boy doing a pirouette with a skateboard in a park | 34382 | 9 s |
| Young skateboarder getting on the skateboard with a pirouette | 34384 | 12.6 s |
| Young man with roller skates sliding down ramps with graffiti | 34385 | 12.3 s |
| Skater with his skateboard, portrait | 34387 | 10.2 s |
| Boy skating in a park on a sunny day | 34388 | 16.4 s |
| Boy skating with a skateboard in a park with ramps | 34389 | 15.5 s |

- Files: `https://assets.mixkit.co/videos/<id>/<id>-1080.mp4`. All are 1920×1080 with no audio stream,
  and all are "Mixkit Stock Video Free License".
- Fit: tricks against graffiti ramps, with clear action peaks to land on beats. Pair with the track in #11.
- Rejected: the Mixkit surfing aerials (36924, 36833) are **Restricted License**.

## 6. Product footage (luxury / minimal)

**Mixkit watch set** ★
- 44070 "Close-up view of an elegant watch" (in a purple box): 9 s, 1920×1080,
  https://assets.mixkit.co/videos/44070/44070-1080.mp4
- 3649 "Detailed wrist watch while working" (macro dial): 10 s, 1920×1080, https://assets.mixkit.co/videos/3649/3649-1080.mp4
- 3652 "Mechanism of a watch through a glass": 10 s, 1920×1080, https://assets.mixkit.co/videos/3652/3652-1080.mp4
- 3672 "Hands on an automatic watch": 11 s, **1080×1920 vertical**, https://assets.mixkit.co/videos/3672/3672-1080.mp4
- 3673 "Machinery of a very close watch": 11 s, **1080×1920**, https://assets.mixkit.co/videos/3673/3673-1080.mp4
- All are "Mixkit Stock Video Free License", with no audio stream.
- Fit: macro detail and slow movement, the raw material of a minimal luxury spot.
- **Flag:** the dial in 3649 carries a real watchmaker's branding. Crop or blur it in a published demo,
  or lead with 44070 and 3652.
- Rejected: the Mixkit perfume and skincare-jar macros (20766, 45160, 45161) are Restricted.

**Intel Core i7-10700KF Unboxing** (alt: hands-on, vertical, with speech)
- Page: https://commons.wikimedia.org/wiki/File:Intel_Core_i7-10700KF_Unboxing.webm
- File: https://upload.wikimedia.org/wikipedia/commons/transcoded/b/be/Intel_Core_i7-10700KF_Unboxing.webm/Intel_Core_i7-10700KF_Unboxing.webm.480p.vp9.webm
- 1:10 · **2160×3840 vertical** · hands and box only, **no face**
- Audio: opus stereo. −26.6 dB with 10 pauses in 48 s. Whisper: "This CPU has 8 cores and 16 threads…
  without further ado, let's open the box. So let's open it up. When you open the box, you have three
  things…"
- Licence: `{{YouTube CC-BY|The Nvidians}}` (CC BY 3.0). **Licence review pending.** Credit: *The Nvidians,
  CC BY 3.0*
- Fit: real hands-on product footage with voice-over. It covers a product film and a vertical UGC short.
  The Intel trademarks are on the box, so it is a demo, not an ad.

## 7. Screen recording / tutorial with narration

**Annotating the Schrödinger equation** ★
- Page: https://commons.wikimedia.org/wiki/File:Annotating_the_Schr%C3%B6dinger_equation.webm
- File: https://upload.wikimedia.org/wikipedia/commons/transcoded/f/f6/Annotating_the_Schr%C3%B6dinger_equation.webm/Annotating_the_Schr%C3%B6dinger_equation.webm.480p.vp9.webm
- 5:02 · 1280×720 · a raw browser screen capture, **no burned-in captions, no webcam**
- Audio: opus stereo. −32.0 dB with **30 pauses in 112 s**. Whisper: "…I'm logged in with my user name… so
  that others can see that I did the change… you can click on Edit Source for equations that you want to
  highlight…"
- Licence: `{{self|cc-by-sa-4.0}}`. Credit: *Physikerwelt, CC BY-SA 4.0*
- Fit: slow, pause-heavy narration over a scrolling page. It suits pause removal, zoom-to-cursor and
  chapter cards. Share-alike applies.

**Uploading to Wikimedia Commons** (alt)
- Page: https://commons.wikimedia.org/wiki/File:Uploading_to_wikimedia_commons.ogv
- File: https://upload.wikimedia.org/wikipedia/commons/transcoded/6/6d/Uploading_to_wikimedia_commons.ogv/Uploading_to_wikimedia_commons.ogv.480p.vp9.webm
- 6:04 · 640×480 · a 2009 zoomed screencast
- Audio: −29.3 dB with 41 pauses in 128 s. Whisper: "…So in a Google search just put wiki media, wiki media
  commons. And the first result is a good one."
- Licence: CC BY-SA 3.0, own work (Leighblackall). Low resolution and dated UI.
- Rejected: "How to create a Wikimedia Commons account – screen recording tutorial" (BY-SA 4.0) and "Wikimedia
  Commons media upload guide (screen recording)" (CC BY 4.0). Both have speech, but **captions are
  already burned in**, and the first shows the author's email address in an autofill dropdown. "Blender
  Tutorial. A cup of tea." has **no audio stream** in either the original or the transcode.

## 8. Documentary / archival (public domain)

**Duck and Cover (1951), Library of Congress scan** ★
- Page: https://commons.wikimedia.org/wiki/File:Duck_and_Cover_1440_x_1080_01836081.webm
- File: https://upload.wikimedia.org/wikipedia/commons/transcoded/f/fb/Duck_and_Cover_1440_x_1080_01836081.webm/Duck_and_Cover_1440_x_1080_01836081.webm.480p.vp9.webm
  (original 1440×1080, 474 MB)
- 9:28 · 4:3 black-and-white film with a narrator and a jingle
- Audio: opus stereo. −24.2 dB with 20 pauses in 146 s.
- Licence: `{{PD-USGov}}`. Source: https://www.loc.gov/item/mbrs01836081/ (US Office of Civil Defense /
  Archer Productions). Credit as a courtesy: *Library of Congress*
- Fit: a classic archival texture for a documentary-style recut with titles, film grain and
  reframing.

**The Eagle Has Landed: The Flight of Apollo 11 (1969)** (alt)
- Page: https://commons.wikimedia.org/wiki/File:The_Eagle_Has_Landed,_The_Flight_of_Apollo_11,_1969.webm
- File: https://upload.wikimedia.org/wikipedia/commons/transcoded/4/4a/The_Eagle_Has_Landed%2C_The_Flight_of_Apollo_11%2C_1969.webm/The_Eagle_Has_Landed%2C_The_Flight_of_Apollo_11%2C_1969.webm.480p.vp9.webm
- 28:33 · 1920×1080 transfer of a 4:3 film · with narration and mission audio
- Audio: −22.4 dB (first 87 s).
- Licence: `{{PD-USGov-NASA}}`, YouTube review passed (2020-02-01, US National Archives channel). Add a
  non-endorsement line.
- Fit: iconic footage, and "LIVE FROM THE SURFACE OF THE MOON" is already on screen, so it works for a
  tighter documentary trailer.

## 9. Lo-fi / aesthetic everyday footage

**Mixkit retro-vinyl set** ★ (one shoot, IDs 100871–100876)
- 100871 vintage TV tuning up (5 s), 100872 spinning vinyl (7 s), 100873 extreme close-up of a vinyl (5 s),
  100874 vinyl record spinning (9.5 s), 100875 vinyl record playing (9 s). All are 1920×1080 and
  "Mixkit Stock Video Free License".
- Pages: `https://mixkit.co/free-stock-video/<slug>-<id>/`, for example https://mixkit.co/free-stock-video/vinyl-record-spinning-100874/
- Files: **opaque hash URLs** (resolved today; for example 100874 was
  `https://assets.mixkit.co/dnbtgkmsm0rl7rp9v2r5loc41299`). Resolve them again through
  `https://mixkit.co/free-stock-video/download/<id>/?context=sidebar&type=1080p`.

**Mixkit coffee** (same aesthetic, stable URLs)
- 43935 steaming cup of coffee (10 s), 43941 pouring coffee in a cup (15 s), 808 steaming mug (11 s):
  `https://assets.mixkit.co/videos/<id>/<id>-1080.mp4`. All Free.
- Fit: warm, slow, textural shots for a lo-fi edit with grain, a slight fade and a chill track (#11).
  No people.
- Rejected: Mixkit 36190 and 48377 (vinyl) are Restricted.

## 10. UGC testimonial (a person talking about a product)

**Yarn Unboxing! Caron x Pantone Bamboo With Kristy Glass Knits** ★
- Page: https://commons.wikimedia.org/wiki/File:Yarn_Unboxing!_Caron_x_Pantone_Bamboo_With_Kristy_Glass_Knits.webm
- File: https://upload.wikimedia.org/wikipedia/commons/transcoded/a/a8/Yarn_Unboxing%21_Caron_x_Pantone_Bamboo_With_Kristy_Glass_Knits.webm/Yarn_Unboxing%21_Caron_x_Pantone_Bamboo_With_Kristy_Glass_Knits.webm.480p.vp9.webm
- 8:19 · 1920×1080 · a woman to camera against a plain wall, handling the product
- Audio: opus stereo. −18.9 dB with 2 pauses in 88 s (fluent). Whisper: "…thanks to my friends at Spinrite
  I have an unboxing video for you today… I am thrilled today to present to you some yarn that I believe
  is for everybody. Behold the box…"
- Licence: `{{YouTube CC-BY|Yarnspirations}}` (CC BY 3.0), **YouTube review passed (2019-12-16)**.
  Credit: *Yarnspirations / Kristy Glass Knits, CC BY 3.0*
- Fit: real creator testimonial energy with product in hand, for cutting to a 30 s UGC ad with hook,
  captions and a product callout. Crop to 9:16 (centred subject).
- **Flags:** the creator is identifiable and the video is brand-sponsored ("thanks to my friends at
  Spinrite"). Keep it to a demo; do not imply she endorses bay.

**Intel Core i7-10700KF Unboxing** (alt): see #6. It is vertical, voice-over and hands only, so it has no
likeness issue. Its licence review is pending.

## 11. Music for beat edits

All tracks are from Mixkit, and each track's JSON-LD links `https://mixkit.co/license/#musicFree`. The terms
are the same as the video Free License: commercial use and no attribution. Probed with ffprobe as MP3,
44.1 kHz stereo, 256 kb/s. I did not measure tempo; run `detect_beats` in bay.

| Track | Artist | Genre | Dur | Mean level (first 60 s) | File |
|---|---|---|---|---|---|
| **Let's Move** ★ | Michael Ramir C. | EDM | 1:41 | −13.1 dB | https://assets.mixkit.co/music/836/836.mp3 |
| **Non Stop** | Michael Ramir C. | Breakbeat | 1:48 | −15.7 dB | https://assets.mixkit.co/music/1187/1187.mp3 |
| Hard Techno | Arulo | House | 3:12 | −13.9 dB | https://assets.mixkit.co/music/197/197.mp3 |
| Hip Hop Two (lo-fi, for #9) | Francisco Alvear | Chillout | 2:20 | −16.2 dB | https://assets.mixkit.co/music/666/666.mp3 |

- Pages: `https://mixkit.co/free-stock-music/<slug>-<id>/`
- Fit: short, loop-structured tracks with strong downbeats, well suited to #5 and #4.
- Caution: Mixkit does not say whether its tracks are registered with YouTube Content ID. If a published
  demo gets a claim, dispute it with the Mixkit item page.

## 12. Cinematic B-roll (drone / landscape) for LUT and grade demos

**Mixkit lake-and-hills drone shoot** ★ (one flight set, IDs 101501–101516)

| Clip | ID | Dur |
|---|---|---|
| Sunset glowing over lakeside hills | 101501 | 22 s |
| Sunlit lake and green hill | 101503 | 23 s |
| Sunset reflections on lake | 101504 | 21 s |
| Drone shot over hills and dock | 101506 | 26 s |
| Majestic hills and sky reflections | 101510 | 21 s |
| Drone pullback over lake | 101513 | 15.7 s |
| Reflections of majestic hills | 101516 | 20 s |

- All are 1920×1080 h264 (2160p is offered on the download menu). They are "Mixkit Stock Video Free
  License", with no audio.
- Files: **opaque hash URLs**. Resolve through the download endpoint, as in #9. For example 101513 was
  `https://assets.mixkit.co/muviwgb69ezcqov35m0it841v1t9` today.
- Fit: slow aerial moves over water and hills, with skies, reflections and greenery, so every grade move
  shows.
- **Limit:** these are delivered graded Rec.709 8-bit, so a LUT demo on them shows a look being
  added, not a log image being developed. For a true log-to-709 before/after, use the **Pexels Apple Log
  ProRes set plus Apple's LUT** already listed in `sample-footage.md` (#3 there).

---

## Gaps

- **A travel/vlog pile with natural sound.** The Mixkit pile is silent stock with models. On Commons, the
  travel "vlogs" (Peace Travels, Travel Optician and others, CC BY 3.0) are finished edits with music.
  Gulshan Asia's raw Nepal/India phone clips (BY-SA 4.0) look like the right kind of material, but I did not probe them.
  For a hero demo, shoot our own trip pile.
- **A raw podcast.** The CSS-Podcast is a locked two-shot, which is close to raw, but it is still a
  published episode with a title card. Its licence review is also pending. No genuinely unedited
  two-camera podcast with a free licence turned up.
- **A CC BY narrated screencast without captions.** Both clean ones are BY-SA. The CC BY ones (Status 401)
  have burned-in captions.
- **UGC with no likeness or brand concerns.** Every talking-to-camera product video found is
  a creator on YouTube-sourced CC BY, and most are sponsored or show trademarks. A paid creator with a
  signed release is the clean route for anything promotional.
- **Mixkit hash URLs** for newer items (vinyl and drone sets) may rotate. Stable pattern URLs exist
  only for older IDs.
