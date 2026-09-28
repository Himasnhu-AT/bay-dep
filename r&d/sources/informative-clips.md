# Informative raw footage for /compare (motion-graphics edits)

This file lists raw clips of one person explaining something with concrete facts: numbers, steps,
comparisons, names and dates. bay's agent can edit them into a piece with animated stats, lists,
diagrams, maps and chapter cards, not just subtitles. I researched it on 2026-09-28. It builds on
`sample-footage.md`, `raw-talking-head.md` and `style-clips.md`, so read those first. Nothing was
downloaded into the repo. The scratch files are in `/tmp/infoclips-36641-1790562083`.

## Read this first: the likeness problem

**Every strong pick here is a named NASA, NOAA or ESO employee, and all three agencies restrict
promotional use of their people's faces.** Quoted from the live pages today:

- **NASA** (nasa.gov/nasa-brand-center/images-and-media): "NASA content … generally are not subject
  to copyright in the United States." But also: "If a NASA image … includes an identifiable person,
  using the media for commercial purposes may infringe that person's right of privacy or publicity",
  and current NASA employees cannot have "their names, likenesses or other personality traits
  displayed … on any commercial products, advertisements, promotional material." NASA also will
  "not promote or endorse … a commercial product, service or activity."
- **ESO** (eso.org/public/copyright): CC BY 4.0, but "If an image includes a picture of an
  identifiable person, using that image for commercial purposes is not permitted."
- **NOAA** clips below are hosted by NASA SVS under the same public-domain statement, and the same
  publicity point applies to the speakers.

**A before/after on bay's product website is arguably "promotional material."** The copyright is
clear; the publicity question is not. `raw-talking-head.md` drew the line at "a demo is lower risk
than an ad". This page sits closer to the ad end than a blog post does. Before any of these go on
/compare, someone should decide one of these:

1. **Ask.** Email NASA's multimedia or public-inquiries contact (or the speaker) to confirm that a
   side-by-side edit demo with a "NASA does not endorse bay" line is acceptable.
2. **Use them only in non-promotional places**, such as docs, a tutorial or an engineering blog post.
3. **Record our own informative talking head**, or pay a creator with a signed release. That is the
   only fully clean option for a marketing page.

I looked for consenting non-government speakers (Commons "own work" explainers, Royal Society, WMF
creator videos). None survived: see [Rejected](#rejected). **ESO's Pale Red Dot** has the strictest
terms of all (no commercial use of identifiable people), so it is listed for completeness only.

## How each clip was checked

- **Licence:** read on the live source today. For SVS I read the help page: "All of our content is in
  the public domain (unless otherwise noted), meaning that it is free to download, use, and
  redistribute for whatever purposes you see fit." No SVS page below carries a notice to the
  contrary. The only stated exception is licensed music, and interviews have none. ESO's terms are
  quoted above.
- **Streams:** `ffprobe` over HTTP on the original MP4 read the container header: h264 plus AAC 48 kHz
  stereo for every SVS clip.
- **Speech:** I range-fetched the first 30 MB of each SVS WebM (or 12 MB of the Commons 480p
  transcode), which decodes to 2.5–4 minutes of audio. Then I ran `volumedetect`, and
  `silencedetect` at −35 dB for 0.4 s to count pauses. I transcribed 20–50 s with whisper.cpp
  (`whisper-cli`) and bay's `ggml-small.en-q5_1.bin`. **Every SVS interview also ships NASA's own
  `.en_US.srt` captions**, which I fetched in full. The fact quotes and timestamps below come from
  those captions and were spot-checked against whisper. They agree word for word apart from
  spellings ("Dymorphos", "Web").
- **Framing:** I looked at extracted frames and 8-frame tiles over the decoded span.
- **The SVS server is slow and drops long parallel connections.** Fetch one file at a time. The
  WebMs are 5–20× smaller than the MP4s at the same 1080p, so use them.

**What "canned interview" means, and why it suits /compare.** A single locked camera records a
scientist answering a list of questions. **Black question slates** (white text, 3–4 s each) separate
the answers, and each package also has a **"where can viewers learn more"** plug to cut. There is no
B-roll in the interview file, but every package has a separate, public-domain **B-roll/animation
reel** on the same page. So the raw file is really raw, and the edit has licensed cutaways to hand.

## Top 4

1. **DART: Tom Statler** (SVS 13985). 7:50, 1080p, and the densest set of graphics-ready facts
   found: 40% of hazardous asteroids found, a 160 m moonlet "the size of a football stadium",
   4 mi/s = 15,000 mph, a nudge of "a few millimeters per second", plus a two-body orbit diagram.
   **Explainer.**
2. **Roman Space Telescope: Julie McEnery** (SVS 15073, August 2026). 7:32, 1080p, a studio set,
   and nearly every answer is a number: 2 billion galaxies, 20 billion objects, 1,000× faster than
   Hubble or Webb, 1 TB a day, 1 million miles, a 20 PB archive. **Explainer / kinetic.** Timely.
3. **James Webb: Jonathan Gardner** (SVS 14044). 5:16, 1080p, the loudest and cleanest audio
   (−21 dB). 21 ft mirror, a tennis-court sunshield, a three-step unfolding sequence, and "since
   2002, almost 20 years". **Kinetic typography.**
4. **2024 eclipse: Nicoleen Viall** (SVS 14551). 4:04, 1080p studio. The answer is spoken as a
   list ("the first… the second… the third"): totality of 2 min in 2017 against 4 min in 2024, a
   corona "hundreds of times hotter", safe-viewing steps. **Retention talking-head plus list cards.**

Runners-up: Gavin Schmidt's global temperatures (the best for **news-lower-thirds**) and Pam
Sullivan's GOES-U (the best for a **map** graphic).

## Candidates

The Audio column gives the codec, then mean volume and the number of pauses over 0.4 s in the
decoded span. The pause counts include slate gaps, so treat them as relative only.

| # | Clip | Dur | Res | Audio (how checked) | Speaker |
|---|---|---|---|---|---|
| 1 ★ | DART: Tom Statler canned | 7:50 | 1920×1080 | AAC; −25.4 dB; 21 pauses/229 s; whisper ✓ | NASA HQ, DART Program Scientist |
| 2 ★ | Roman: Julie McEnery canned | 7:32 | 1920×1080 | AAC stream (ffprobe); NASA captions; whisper: see note | NASA, Roman Senior Project Scientist |
| 3 ★ | Webb: Jonathan Gardner canned | 5:16 | 1920×1080 | AAC; −21.4 dB; 25 pauses/237 s; whisper ✓ | NASA Goddard, Webb Deputy Senior Project Scientist |
| 4 ★ | Eclipse 2024: Nicoleen Viall | 4:04 | 1920×1080 | AAC; −34.2 dB; 28 pauses/211 s; whisper ✓ | NASA Goddard heliophysicist |
| 5 | 2021 temperatures: Gavin Schmidt | 4:39 | 1920×1080 | AAC; −23.1 dB; 4 pauses/222 s; whisper ✓ | NASA GISS director |
| 6 | GOES-U: Pam Sullivan (head-on) | 4:39 | 1920×1080 | AAC stream; NOAA captions; first 21 s decoded were the slate | NOAA GOES-R program |
| 7 | PACE / Earth Day: Dalia Kirschbaum | 6:29 | 1920×1080 | AAC; −33.7 dB; 15 pauses/234 s; whisper ✓ | NASA Earth Science Division director |
| 8 | Landsat 9: Jeff Masek | 3:43 | 1920×1080 | AAC; **−36.2 dB (quiet)**; whisper ✓ | NASA, Landsat 9 Project Scientist |
| 9 | GOES-T: Kevin Fryar | 7:19 | 1280×720 | AAC; −25.3 dB; 36 pauses/151 s; whisper ✓ | NOAA GOES-R Chief of Staff |
| 10 | Parker Solar Probe: Nicoleen Viall | 4:13 | 1920×1080 | AAC; −35.3 dB; whisper ✓ (first 30 s) | NASA Goddard |
| 11 | PACE: Jeremy Werdell | 3:17 | 1920×1080 | AAC; −30.7 dB (45 s sample) | NASA, PACE Project Scientist |
| 12 | ESO: Interviews with Pale Red Dot scientists | 4:19 | 1920×1080 | opus; −22.8 dB; whisper ✓ | Three ESO-partner astronomers |

### 1. DART: Tom Statler ★
- Page: https://svs.gsfc.nasa.gov/13985/ (released 2021-11-16)
- File: https://svs.gsfc.nasa.gov/vis/a010000/a013900/a013985/Tom_Statler_canned_1.webm (62 MB)
  · MP4 `…/Tom_Statler_canned_1.mp4` (1.18 GB) · captions `…/Tom_Statler_canned.en_US.srt`
- Framing: a home office, medium close-up, eye to lens, suit and tie. Question slates such as "NASA
  says the DART mission is about planetary defense. Can you tell us…".
- Licence: SVS public domain. Credit: *NASA/Goddard Space Flight Center Scientific Visualization
  Studio; Tom Statler, NASA. NASA does not endorse bay.*
- Facts:
  - 00:57 "we understand where about **40 percent** of those asteroids are" (5:01 "we need to find
    that other **60 percent**")
  - 01:57 Dimorphos is "about **160 meters** across, or about the size of a **football stadium**"
  - 03:57 "DART will be moving at about **4 miles per second**, that's about **15,000 miles an hour**"
  - 04:17 "change the speed of the asteroid by only **a few millimeters per second** … far smaller than
    walking speed"
- Graphics: a 40/60 split bar; a Didymos–Dimorphos orbit diagram with the impact arrow; a
  stadium-scale comparison; a speed counter (mph); a three-step "find → deflect → coordinate" list
  from 04:49; a LICIACube side-view diagram. Cut the slates and the hashtag plug (03:37–03:49). The
  page's DART B-roll gives the cutaways.
- Style: new **explainer**.

### 2. Roman Space Telescope: Julie McEnery ★
- Page: https://svs.gsfc.nasa.gov/15073/ (released 2026-08-24). Extra graphics:
  https://svs.gsfc.nasa.gov/20416/
- File: https://svs.gsfc.nasa.gov/vis/a010000/a015000/a015073/Julie_McEnery_Roman_canned.mp4
  (1.15 GB, no WebM listed) · captions `…/Julie_McEnery.en_US.srt`. The same page has a second
  speaker (`Joshua_Schlieder.mp4`) and two "back pocket" graphics clips (detector shape, Hubble
  comparison).
- Framing: not yet seen. The first 60 MB decoded to 11.7 s of slate at −61 dB, which is the opening
  slate, not a fault. See [Verification gaps](#verification-gaps).
- Licence: SVS public domain. Credit: *NASA/GSFC SVS; Julie McEnery, NASA.* Add the non-endorsement line.
- Facts:
  - 00:21 "we are going to measure over **2 billion galaxies**" and "find **tens of thousands** of
    new planets"
  - 01:35 "that survey is going to find **20 billion** new objects … the largest catalog of
    astronomical objects ever known"
  - 02:13 surveys "about a factor of **a thousand times faster** than either Hubble or Webb"
  - 03:19 "over **a terabyte** of data per day … transmitted **1 million miles** … our archive will be
    **20 petabytes**"
- Graphics: counters (2B, 20B, 1,000×); a data-pipeline diagram (telescope → 1M mi → cloud →
  "a class in high school in Kentucky to a professor at Princeton"); a "every 5 days, same patch of
  sky" survey loop (00:53). Launch is imminent, so it is topical.
- Style: **explainer** or **kinetic-typography**.

### 3. James Webb: Jonathan Gardner ★
- Page: https://svs.gsfc.nasa.gov/14044/ (2021-12-13)
- File: https://svs.gsfc.nasa.gov/vis/a010000/a014000/a014044/Jon_Canned_Webb.webm (40 MB) ·
  captions `…/Jon_Canned_Webb.en_US.srt`. The page also has each answer as its own file (Q1–Q6 `.mov`).
- Framing: a home room, webcam-style mid shot, eye to lens.
- Licence: SVS public domain. Credit: *NASA/GSFC SVS; Jonathan Gardner, NASA.*
- Facts:
  - 02:52 "Webb is such a big telescope – **21 feet in diameter** – that it's too big to fit inside the
    rocket"
  - 03:12 "First a giant **tennis court sized sunshield** … Next we'll fold out the side wings of the
    primary mirror and the secondary mirror" (a three-step process)
  - 04:20 "I've worked on this telescope … **since 2002**. Almost **20 years**"
  - 01:24 the mirrors "are actually coated in **gold**", which reflects infrared (a Hubble vs Webb
    wavelength comparison)
- Graphics: a Hubble-vs-Webb spectrum band; an origami unfold sequence as numbered steps; a
  "21 ft" dimension line; a 2002→2021 timeline. Lively, fast delivery.
- Style: **kinetic-typography**.

### 4. 2024 eclipse: Nicoleen Viall ★
- Page: https://svs.gsfc.nasa.gov/14551/ (2024-03-25)
- File: https://svs.gsfc.nasa.gov/vis/a010000/a014500/a014551/Nicholeen_Viall_eclipse.webm (31 MB) ·
  captions `…/Nicoleen_Viall_eclipse.en_US.srt` (note the two spellings)
- Framing: NASA's purple hex studio set with an eclipse-path map behind her. She gestures and looks
  to camera. A NASA logo and a rocket model are on set.
- Licence: SVS public domain. Credit: *NASA/GSFC SVS; Nicoleen Viall, NASA.*
- Facts:
  - 01:17–01:54 "several things that are different … **The first** is that more people just live along
    the path of totality … **The second** … totality will last longer … **The third** … the sun … maximum"
  - 01:33 "The **2017** eclipse totality lasted as long as about **2 minutes**. For this one, it can last
    as long as **4 minutes**"
  - 02:20 "the corona is **hundreds of times hotter**" than the body of the Sun
- Graphics: numbered list cards synced to "first/second/third"; a 2 min vs 4 min bar; safe-viewing
  steps (glasses, pinhole) as icons from 00:09; a path-of-totality map.
- Style: **retention-talking-head** with list inserts, or **explainer**.

### 5. Global temperatures 2021: Gavin Schmidt
- Page: https://svs.gsfc.nasa.gov/14069/ (2022-01-12)
- File: https://svs.gsfc.nasa.gov/vis/a010000/a014000/a014069/GavinSchmidt_2022GlobalTempUpdate.webm
  (38 MB) · captions `…/GavinSchmidt_2022GlobalTempUpdate.en_US.srt`
- Framing: a webcam in front of a bookshelf, close. Punchy, almost continuous delivery (only 4 pauses
  in 222 s).
- Licence: SVS public domain. Credit: *NASA/GSFC SVS; Gavin Schmidt, NASA GISS.*
- Facts:
  - 00:20 "the **7th year in a row** that the temperatures have been more than about **two degrees
    Fahrenheit** above the late 19th century"
  - 02:14 "Landsat 9, is the latest in an almost **50 year** series … back in the **1970s**"
  - 03:52 a list of predictions: sea-level rise, heat waves, intense precipitation, stronger storms,
    storm tracks moving north, Arctic sea ice, Greenland/West Antarctica mass loss
- Graphics: a temperature-anomaly line chart (GISTEMP; SVS 5190 has a PD spiral); lower-thirds;
  a seven-item prediction list.
- Style: **news-lower-thirds**.

### 6. GOES-U: Pam Sullivan
- Page: https://svs.gsfc.nasa.gov/14602/ (2024-06-17)
- File (head-on): https://svs.gsfc.nasa.gov/vis/a010000/a014600/a014602/Pam_Sullivan_head_on_view.mp4
  (1.33 GB) · captions `…/Pam_Sulivan_head_on_view_SRT_file.en_US.srt`. A **side-angle** take of the
  same answers exists (`GOES-U_Canned_Side_Interview_Pam_Sullivan.mp4`), which makes it a
  two-camera interview.
- Framing: studio set with an Earth backdrop. Slates are "Question 1: What is the GOES-R series
  mission…".
- Licence: SVS public domain (NOAA). Credit: *NOAA/NASA; Pam Sullivan, NOAA.*
- Facts:
  - 00:57 "taking images as often as **every 30 seconds**"
  - 02:10 the "advanced lightning mapper … **500 times a second**"
  - 03:29 "GeoXO satellites are actually going to be delivering **ten times as much data** as GOES-R"
  - 03:48 coverage: the whole US, the Caribbean and South America, across the Atlantic "to Europe and
    Africa"
- Graphics: a **coverage map** (the one clip with a natural map); a geostationary orbit diagram
  (04:19); a series timeline (GOES-R→U→GeoXO). The two angles let bay show a camera switch.
- Style: **explainer**.

### 7. PACE / Earth Day 2024: Dalia Kirschbaum
- Page: https://svs.gsfc.nasa.gov/14566/ · File:
  https://svs.gsfc.nasa.gov/vis/a010000/a014500/a014566/Dalia_Kirschbaum.webm (50 MB) · captions
  `…/Dalia_Kirschbaum.en_US.srt`
- Framing: purple studio set with an Earth backdrop.
- Facts: 01:13 chlorophyll "about like **4 to 6** different colors of green … With … PACE, we can look
  at over **200**"; 02:51 "**2023** really was the warmest year on record … **July 2023** was the
  hottest month"; 04:23 oceans "absorb **90%** of the heat"; 04:53 "over **two dozen** satellites".
- Graphics: a 6 vs 200 swatch grid; a 90% ring; record-year callouts. **Explainer.**

### 8. Landsat 9: Jeff Masek
- Page: https://svs.gsfc.nasa.gov/13920/ · File:
  https://svs.gsfc.nasa.gov/vis/a010000/a013900/a013920/Jeff_Masek_canned.webm (29 MB) · captions
  `…/Jeff_Masek_canned.en_US.srt`
- Framing: webcam in a home office. **Quiet at −36 dB**, so it needs loudness mastering.
- Facts: 00:12 "the Earth's **family photo album** … the last **50 years**"; 01:00 "worked on a project
  like this for **6 years** … **hundreds** of people"; 02:00 "all of the Earth's land area with **two**
  Landsat satellites every **8 days**"; 02:43 a three-part agriculture list (crop inventory, crop health,
  evapotranspiration).
- Graphics: a 1972→2021 satellite timeline; an 8-day revisit loop; a three-item list. **Explainer.** Short.

### 9. GOES-T: Kevin Fryar
- Page: https://svs.gsfc.nasa.gov/14084/ · File:
  https://svs.gsfc.nasa.gov/vis/a010000/a014000/a014084/GOEST_CannedInterview_KevinFryar.webm
  (57 MB) · captions `…/GOEST_CannedInterview_KevinFryar.en_US.srt`
- Framing: webcam at **720p**, wearing a headset. Numbered question slates ("1. NOAA and NASA are
  launching…").
- Facts: 00:52 a geostationary explanation ("rotating as fast as the planet rotates"); 02:06 the
  Tonga pressure wave and wildfire detection; 03:20 space weather affecting "GPS and the power grid";
  06:34 search-and-rescue. Few numbers; the content is about **process**.
- Graphics: an orbit diagram; a hazard icon list (hurricanes, fire, turbulence, lightning, SAR).
  Warm, anecdotal delivery. **Explainer.** 720p is the weak point.

### 10. Parker Solar Probe: Nicoleen Viall
- Page: https://svs.gsfc.nasa.gov/14722/ · File:
  https://svs.gsfc.nasa.gov/vis/a010000/a014700/a014722/Parker_Solar_Probe_pre-recorded_soundbites_2.mp4
  (568 MB) · captions `…/Parker_Solar_Probe_pre-recorded_soundbites.en_US.srt`
- Framing: blue studio set with a Parker/Sun image behind her. **The same speaker as #4.** Pick one.
- Facts: 00:11 "launched in **2018**"; 00:23 "within **3.83 million miles** of the surface of the sun,
  which is closer than any human made object has ever gone"; 03:26 the Venus gravity assist and the
  heat shield "at room temperature". **Explainer** (distance scale graphic).

### 11. PACE: Jeremy Werdell
- Page: https://svs.gsfc.nasa.gov/14566/ · File:
  https://svs.gsfc.nasa.gov/vis/a010000/a014500/a014566/Jeremy_Werdell.mp4 (474 MB) · captions
  `…/Jeremy_Werdell.en_US.srt`
- Framing: his office, slightly off-axis, wearing a PACE polo.
- Facts: 00:34 "Current missions only measure **one green** … It measures **all of the greens**";
  01:09 "launched less than **three months** ago"; 01:31 a list of aerosols ("dust, sea salt, pollen,
  volcanic ash"). Short, but more of an analogy than numbers. **Kinetic.**

### 12. ESO: Interviews with Pale Red Dot scientists
- Page: https://www.eso.org/public/videos/eso1629i/ · Commons copy:
  https://commons.wikimedia.org/wiki/File:Interviews_with_Pale_Red_Dot_scientists.webm · File:
  https://upload.wikimedia.org/wikipedia/commons/5/5d/Interviews_with_Pale_Red_Dot_scientists.webm
- Framing: three astronomers (Pedro Amado, Guillem Anglada-Escudé, Ansgar Reiners), each seated
  before a library shelf. It is **already cut** as a sequence of speakers, but each segment is a raw
  single shot with no graphics.
- Licence: CC BY 4.0, credit "ESO", **but "using that image for commercial purposes is not
  permitted" when it shows identifiable people, and no endorsement may be implied.** Treat it as
  unusable for /compare.
- Facts (whisper): "Proxima Centauri is the closest star … at only **4.2 light years** away"; "We look
  at the star for **60 nights**"; HARPS "one of the most precise radial velocity machines".

## Style fit

| Style | Best clip | Why |
|---|---|---|
| **explainer** (new) | DART · Roman · GOES-U | Diagrams, counters and maps carry the edit |
| kinetic-typography | Webb · Roman | Short, quotable numeric lines ("21 feet", "20 petabytes") |
| news-lower-thirds | Gavin Schmidt | A named expert, a news hook (a record year), a chart |
| retention-talking-head | Viall eclipse | A three-item spoken list, energetic, studio framing |

A proposed **explainer** style: chapter cards made from the question slates the raw file already
contains (the edit replaces each black slate with a designed card), a stat counter per number, one
diagram per "how it works" answer, and the package's own B-roll for cutaways.

## Rejected

| Source / clip | Why |
|---|---|
| Royal Society interviews on Commons (Robyn Grant "Five things… whiskers", Hannah Cloke, Gilly Forrester, Michele Dougherty, zebrafish), CC BY 3.0 | **Already edited.** Grant has 39 scene cuts in 143 s, animated title cards and on-screen text ("OUR ANCESTORS PROBABLY HAD WHISKERS", "45cm"). Cloke is a two-person multicam with a wide shot. There is no "before". |
| Interview with pharmaceutical scientist Karin Kogermann (CC BY 4.0, own work) | Raw single shot, but **Estonian** (whisper: foreign language), and framed off-axis at a desk. |
| Gina McCarthy explains… (White House, PD) | Burned-in captions, and a political figure. |
| Abu Rayhan al-Biruni… (vertical, CC BY-SA) | Edited map animation, not English, and carries a third-party "@reedschultzgeo" watermark. |
| Deutsche Welle "Explaining the Human Body" | Finished animated productions. |
| WMF creator videos (e.g. Fact-Checking by Jananie Kulandaivelu) | 18 s and already edited for social. |
| UC Berkeley "How Does a Seismometer Work?", NIBIB "How Does an MRI Work" | Produced explainers (the Commons thumbnailer also refused the seismometer file). |
| ESO/acagastya interviews (Rivinius, Boccaletti, Martisius; CC0) | 30–68 min Q&A recordings. Too long for this, though CC0 with a consenting interviewee; worth a later look for a 1–2 min excerpt. |
| SVS Hubble 30 (Rosa Diaz, 16 min), Alex Young eclipse (11:26), Lesley Ott (9:13) | Over 8 minutes. |
| Kate Calvin 2024 temperatures (SVS 14742) | Fine but short (2:38) and thin on numbers compared with Schmidt. |
| Spanish-language canned interviews (OSIRIS-REx, Ingenuity) | Not English. Useful later for a dubbing demo. |

## Verification gaps

- **Roman (#2) is the one top-4 clip not checked by whisper or by eye.** ffprobe confirms an AAC
  stereo stream (452 s), and NASA's 7:31 caption file gives the quotes. But the MP4 is about
  2.5 MB/s with no WebM listed, the first 60 MB was all opening slate, and an HTTP seek to 2:05
  stalled for more than 10 minutes on the SVS server before I stopped it. **Download it whole
  (1.15 GB) and look at it before committing to it.** If it turns out badly framed, swap in #5 or #6.
- **GOES-U (#6):** the stream is confirmed and the head-on framing was seen. Speech rests on NOAA's
  captions, because the decoded 21 s was the slate.
- **Werdell (#11):** the 45 s sample came from an MP4 connection that dropped. The level is
  measured, but I did not run whisper on it.

## Next steps

- **Settle the likeness question before building the page** (see the top of this file).
- Download the SVS **WebM**, not the MP4, one file at a time. Keep media out of git.
- Each SVS page's B-roll reel is public domain and pairs with its interview. DART, Webb and Roman
  have the richest animation sets.
