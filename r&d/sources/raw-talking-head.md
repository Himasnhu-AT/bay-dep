# Raw vertical talking-head footage for before/after demos

This file lists unedited 9:16 videos of one person talking to camera, with real speech, that bay may
download, edit into a short and **publish**. I researched it on 2026-09-27.

**How each clip was checked.** Every clip in the usable tables was checked in three ways:

- **Licence:** read on the live Wikimedia Commons file page, through the Commons API or WebFetch.
- **Audio stream:** `ffprobe` read the container headers over HTTP range requests. I used Commons'
  480p VP9 transcode where one exists, so only a few MB were read.
- **Speech:** I decoded the first 30 s of audio. `volumedetect` gave the level, and `silencedetect` at
  -35 dB for 0.4 s counted the pauses. whisper.cpp with bay's own `ggml-base.bin` model transcribed the
  audio, and the quotes below come from that transcript.
- **Framing:** I looked at two poster frames per clip (Commons `seek=` thumbnails).

Nothing was saved into the repo. The scratch files are in `/tmp/rawtalk-4191-1790483752`.

**The main finding: free stock sites are the wrong place to look.** Pexels, Mixkit and Coverr serve
their "talking to camera" clips **without an audio stream**:

- **Pexels:** 11 of 11 portrait clips I probed had a video stream and no audio stream. For example,
  "A Man Talking" 7261920 is 2160×3840 and 40.8 s long.
- **Mixkit:** 3 of 3 had no audio stream (41290, 41289, 41270).
- **Clip length:** the stock clips are also 7–43 s long, and most are shorter than 20 s.

Real, unedited vertical speech with a licence that allows edits is on **Wikimedia Commons**. Most of it
comes from phone-recorded Wikimedia community videos, Wikitongues oral histories, and US Congress
members' own phone videos (public domain).

**Caveats that apply to every clip:**

- **Share-alike passes on to our edit.** A CC BY-SA edit must itself be released CC BY-SA, with the
  credit shown next to the video.
- **The person on camera keeps their personality and publicity rights**, even when the file is public
  domain or CC0. Commons prints this warning on the Congress files. A *demo* is lower risk than an
  *ad*. Never imply endorsement, and prefer the non-politicians for anything promotional.
- **Download from Commons (`upload.wikimedia.org`), never from YouTube, Instagram or TikTok.** Those
  platforms' terms forbid downloading except through their own features, and that applies to
  CC-licensed videos too. Commons rate-limits hard (HTTP 429), so pace your downloads.
- **Hindi and Hinglish need a bigger whisper model than bay's default `base`.** On the Hindi clips, base
  produced loops of repeated words ("बादली बादली…"). The levels show there is speech, but the
  transcripts cannot be trusted. Use `medium` or `large-v3` for the Hindi demos, or the subtitle step
  will fail on camera.

## Top 5

1. **Candidate statement.** Handheld selfie. Clear English speech with 11 pauses of more than 0.4 s in the
   first 30 s, so there is plenty to tighten. CC BY-SA 4.0, own work.
2. **Daniel speaking English.** A genuine phone selfie in a room, with 16 pauses in 30 s and a relaxed,
   rambling delivery. It is 4:24 long, so cut it to a 45–60 s short. CC BY-SA 4.0 (Wikitongues).
3. **James speaking West Riding Yorkshire English.** Seated to camera, conversational, and 6:20 long.
   It is **CC0**, so no credit and no share-alike. The strong accent is a good test of subtitles.
4. **Participant of WHC 2018 sharing view about Hindi Wikipedia 01.** A tight vertical close-up of a man
   speaking Hindi to camera at a conference, 39 s. This is the Hindi demo (use a larger whisper model).
5. **Kamala Harris speaks about the Impeachment trial… 2020-01-21.** The Instagram-style "quick update"
   straight to a phone camera, 68 s, public domain. **Only for a demo**: she is a political figure, so
   keep it out of ads.

## Usable vertical clips (speech confirmed)

The Audio column gives ffprobe's audio codec, then the mean volume from `volumedetect` and the
number of pauses over 0.4 s in the first 30 s.

| # | Title / page | Dur | Res | Lang | Audio (how confirmed) | Licence | Attribution | Edit potential |
|---|---|---|---|---|---|---|---|---|
| 1 ★ | [Candidate statement](https://commons.wikimedia.org/wiki/File:Candidate_statement.webm) | 3:05 | 1080×1920 | English (Ghanaian) | opus, −21 dB, 11 pauses; whisper: "Hi everyone, my name is Abdurafi…" | "CC BY-SA 4.0", own work (Alhaj Darajaati, 2025) | Alhaj Darajaati, CC BY-SA 4.0 | Selfie with steady eye contact and many pauses. Cut to about 60 s and add word subtitles. |
| 2 ★ | [Daniel speaking English](https://commons.wikimedia.org/wiki/File:Daniel_speaking_English.webm) | 4:24 | 1080×1920 | English (US) | opus stereo, −34 dB (quiet), 16 pauses; "Okay, hi. My name is Daniel…" | "CC BY-SA 4.0" (Wikitongues, interviewee opt-in). Commons shows "awaits licence review" | Wikitongues, Inc, CC BY-SA 4.0 | Genuine phone selfie with a false start ("Okay, hi"). Low level, so it needs loudness mastering. |
| 3 ★ | [James speaking West Riding Yorkshire English](https://commons.wikimedia.org/wiki/File:James_speaking_West_Riding_Yorkshire_English.webm) | 6:20 | 1080×1920 | English (Yorkshire) | opus, −31 dB, 7 pauses; with `-l en`: "My name's James. I thought I'd do a little video…" (auto-detect misread it as Welsh) | "CC0 1.0" (Wikitongues) | None required (credit Wikitongues as a courtesy) | Long ramble, so pick the best 60 s. Strong accent, a good subtitle stress test. 272 MB original, so use the 720p or 480p transcode. |
| 4 ★ | [Participant of WHC 2018 … Hindi Wikipedia 01](https://commons.wikimedia.org/wiki/File:Participant_of_WHC_2018_sharing_view_about_Hindi_Wikipedia_01.webm) | 0:39 | 608×1080 | Hindi | opus, −28 dB, continuous speech with hall noise; whisper-base cannot transcribe it | "CC BY-SA 4.0" (Suyash Dwivedi; imported from his YouTube via video2commons) | Suyash Dwivedi, CC BY-SA 4.0 | Close vertical selfie framing at a conference. Needs noise cleanup and Hindi subtitles. Low resolution. |
| 5 | [Participant of WHC 2018 … Hindi Wikipedia 02](https://commons.wikimedia.org/wiki/File:Participant_of_WHC_2018_sharing_view_about_Hindi_Wikipedia_02.webm) | 0:41 | 608×1080 | Hindi | opus, −26 dB, continuous; not transcribable with base | "CC BY-SA 4.0" | Suyash Dwivedi, CC BY-SA 4.0 | Second speaker from the same series. Pairs with #4 as a two-clip Hindi demo. |
| 6 ★ | [Kamala Harris … Impeachment trial … 2020-01-21](https://commons.wikimedia.org/wiki/File:Kamala_Harris_speaks_about_the_Impeachment_trial_of_Donald_Trump_-_2020-01-21.ogv) | 1:08 | 720×1280 | English | opus (transcode), −30 dB, 6 pauses; "Hey, everybody. So in about 10 minutes…" | "PD-USGov-Congress"; Commons warns that personality rights apply | None legally; credit "Office of Kamala Harris" | Classic phone-to-face update, standing and talking straight to camera. Demo only. |
| 7 | [Kamala Harris … 2020-01-22](https://commons.wikimedia.org/wiki/File:Kamala_Harris_speaks_about_the_Impeachment_trial_of_Donald_Trump_-_2020-01-22.ogv) | 0:46 | 720×1280 | English | −34 dB, 0 pauses; "Hey guys, I'm about to head into the capital…" | PD-USGov-Congress | Same as #6 | Walk-and-talk energy, dense speech. Demo only. |
| 8 | [Kamala Harris … 2020-01-25](https://commons.wikimedia.org/wiki/File:Kamala_Harris_speaks_about_the_Impeachment_of_Donald_Trump_-_2020-01-25.ogv) | 0:49 | 720×1280 | English | −31 dB, 4 pauses; "Hey guys, so I'm about to head back into the Senate…" | PD-USGov-Congress | Same as #6 | Against marble columns, with run-on sentences to tighten. Demo only. |
| 9 | [Video of Terri Sewell speaking about her vote … 2018](https://commons.wikimedia.org/wiki/File:Video_of_Terri_Sewell_speaking_about_her_vote_regarding_GOP_in_2018.ogv) | 1:15 | 720×1280 | English | −32 dB, 9 pauses; "My friends, I'm currently in my office in Washington…" | Public domain (US Congress member, official duties; from her Twitter) | None legally; credit Rep. Terri Sewell | Seated in her office, to camera, with pauses. Demo only (politician). |
| 10 | [Barbara Pocock speaking at the PIRA Federal Election Forum](https://commons.wikimedia.org/wiki/File:Barbara_Pocock_speaking_at_the_PIRA_Federal_Election_Forum.webm) | 0:34 | 1080×1920 | English (AU) | −40 dB (quiet), 8 pauses; "…leaving this university with an economics degree…" | "CC BY-SA 4.0", own work (Pangalau) | Pangalau, CC BY-SA 4.0 | **Holding a mic**, seated, filmed by an audience phone. Not eye-to-lens. Quiet, so it needs gain. Politician. |
| 11 | [Rex Lyall Patrick speaking at the PIRA Federal Election Forum](https://commons.wikimedia.org/wiki/File:Rex_Lyall_Patrick_speaking_at_the_PIRA_Federal_Election_Forum.webm) | 0:31 | 1080×1920 | English (AU) | −36 dB, 7 pauses; "…I've just been sitting back watching in a neutral capacity…" | CC BY-SA 4.0, own work (Pangalau) | Pangalau, CC BY-SA 4.0 | Mic in hand, same set-up as #10. Short, so the whole clip becomes the short. |
| 12 | [Interview Traditional Kangri Dhaam](https://commons.wikimedia.org/wiki/File:Interview_Traditional_Kangri_Dhaam.webm) | 4:48 | 1080×1920 | Hindi / Kangri (Pahari) | opus, −31 dB, speech throughout; base model looped, so not transcribable | CC BY-SA 4.0 (Singhbijta) | Singhbijta, CC BY-SA 4.0 | Man in a kurta talking animatedly to an off-camera interviewer. Pick 60 s. Food story, good for B-roll. |
| 13 | [Deb Haaland speaking at the Tax the Rich Bus Tour](https://commons.wikimedia.org/wiki/File:Deb_Haaland_speaking_at_the_Tax_the_Rich_Bus_Tour_in_Albuquerque,_New_Mexico.ogv) | 0:45 | 720×1280 | English | −23 dB, 0 pauses; "…Amazon paid zero dollars in taxes…" | Public domain (Congress) | None legally | Weak: a wide rally shot with a small speaker. Needs a heavy punch-in. |
| 14 | [Karen Grogan speaking at the PIRA Federal Election Forum](https://commons.wikimedia.org/wiki/File:Karen_Grogan_speaking_at_the_PIRA_Federal_Election_Forum.webm) | 0:20 | 1080×1920 | English (AU) | −37 dB, 6 pauses; "…a different perspective, I think, on how our future should look…" | CC BY-SA 4.0 (Pangalau) | Pangalau, CC BY-SA 4.0 | Mic in hand. Under 30 s, so use it only as a set with #10 and #11. |
| 15 | [Bill Smith speaking about Shipt Birmingham expansion](https://commons.wikimedia.org/wiki/File:Bill_Smith_speaking_about_Shipt_Birmingham_expansion_in_2018.ogv) | 0:22 | 720×1280 | English | −37 dB, 0 pauses; "The culture and the values that exist here in Birmingham…" | Public domain (posted by Rep. Terri Sewell) | None legally | Podium speech, not a selfie. A CEO names his company, so keep it well away from ads. |

★ marks the top 5, plus #6. #6 is the fifth pick, and #1–#4 are the others.

## Horizontal but croppable (real speech, one person to camera)

These are Wikitongues oral histories: a person seated, facing the lens. A 9:16 crop from 1080p leaves
608×1080, and from 720p it leaves 405×720, which is soft but fine for a demo. I checked them the
same way as the vertical clips.

| Title / page | Dur | Res | Lang | Audio | Licence | Note |
|---|---|---|---|---|---|---|
| [WIKITONGUES- Krishna speaking Hindi](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Krishna_speaking_Hindi.webm) | 1:41 | 1920×1080 | Hindi (whisper translated it: "Namaste, my name is Krishna… I live in Taiwan") | −17 dB, 1 pause | CC BY-SA 4.0 (Wikitongues, Teddy Nee) | **Best Hindi clip found.** Centred subject, clean audio, crops well to 9:16. |
| [WIKITONGUES Kavyanjali speaking Hindi](https://commons.wikimedia.org/wiki/File:WIKITONGUES_Kavyanjali_speaking_Hindi.ogg) | 2:15 | 1280×720 | Hindi | −28 dB, 11 pauses | CC BY-SA 4.0 (Wikitongues) | Woman seated, reciting and talking. Many pauses to cut. |
| [WIKITONGUES- Muktesh speaking Kumaoni and Hindi](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Muktesh_speaking_Kumaoni_and_Hindi.webm) | 1:17 | 1280×720 | Kumaoni + Hindi | −26 dB, 7 pauses | CC BY-SA 4.0 | Man in an office, to camera. |
| [WIKITONGUES- Mckensie speaking English](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Mckensie_speaking_English.webm) | 1:13 | 1080×606 | English | −26 dB | CC BY-SA 4.0 (Bogreudell, Wikimania 2018) | Fluent and direct: "So my name is Mackenzie Mack…" |
| [WIKITONGUES- Sam speaking English](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Sam_speaking_English.webm) | 1:53 | 1080×606 | English (Nigerian) | −21 dB | CC BY-SA 4.0 (Bogreudell) | Lots of "you know" filler, ideal for showing filler-word removal. |
| [WIKITONGUES- Gereon speaking English](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Gereon_speaking_English.webm) | 2:26 | 1080×606 | English (German) | −22 dB | CC BY-SA 4.0 (Bogreudell) | Seated man explaining editathons. Calm, low energy. |
| [VCD2 (Microsoft)](https://github.com/microsoft/VCD) | 15 s each ×838 | 720p–4K webcam, 16:9 | mostly English | not probed (lossless FFV1 MKV; the paper describes text-reading and video-call scenarios) | "CC BY 4.0" per the paper (arXiv 2603.26763) | Only 15 s and partly scripted (counting, reading). Use it for bulk testing, not as a hero demo. |

## Rejected

| Source / clip | Why |
|---|---|
| **Pexels** (all "talking to camera" / vlogger portrait clips) | No audio stream in 11 of 11 probed (7261920, 4962733, 4994156, 6965116, 8724452, 8724213, 4022723, 9032180, 7231255, 8048443, 6595460). They are also 7–43 s long. The licence is fine, and they still work as silent B-roll. |
| **Mixkit** vlogger clips | No audio stream (41290, 41289, 41270), and 13–20 s long. |
| **Coverr** talking-head | The page says "Royalty-Free for Commercial Use… no attribution required", but lists no audio. Its clips are silent stock like Mixkit's. Not probed. |
| **Pixabay** | Only 31 results for "talking to camera" in portrait, mostly 5–20 s non-speech clips. Audio is not listed per clip, and I did not probe any. Low yield. |
| **Videvo** | `videvo.net/terms-of-use` now 301-redirects to Freepik. The free tier needs an account and attribution, and its clips are generic silent stock. |
| **Vimeo Creative Commons** | Download is available only when the uploader enabled it, usually after signing in, so I could not verify it without an account. There are 2.8M CC BY videos, but no reliable way to filter for vertical raw selfies. Worth a manual look later. |
| **Internet Archive** | Licences are asserted by the uploader. Many "Public Domain Mark" items are re-hosted YouTube or news footage, such as war footage and "youtube-…" identifiers. Too much laundering risk for a published demo. |
| [My God My God… Bible Scripture interpretation](https://commons.wikimedia.org/wiki/File:My_God_My_God_why_have_you_forsaken_me_Bible_Scripture_interpretation.webm) (CC0) | A perfect-looking mirror selfie, but the frame carries a **"YouTube Shorts @CaraganeeShorts" watermark**, so the CC0 claim is doubtful. |
| WP25Andrew / Netha / Yuriko / Goodness (Wikimedia Foundation) | Already edited: infobox graphics, music bed, zero pauses. There is no "before". |
| Interview at Wikimania 2024; Igbo WP@25 Shoutouts; A Message from First Lady Jill Biden; Wiki clubs testimonials | Already edited: lower thirds, captions, montage or voice-over over B-roll. |
| Sadam speaking Hausa, English | Burned-in captions, and mostly Hausa. |
| Ashmi speaking English (Wikitongues) | Already graphic-framed (League of Women Voters logos in pillarbox bars). |
| Hindi Wikimedians with Asaf (WMF) | A meeting recording, not to camera; −44 dB. |
| Angika Yuva Kavitri Arpita Choudhary | A sung poem with two people, not talk. |
| Hand cleaning – covid-19 | Portuguese demo video, not talking to camera for most of it. |
| Alexander's message to Iranian Wikipedians | Persian, and 4:11 long. |
| **VoxCeleb 1/2** | Annotations are CC BY-SA 4.0, but the videos are YouTube links, and VoxCeleb2 is designated for "Academic Research Purposes". Getting the videos means downloading from YouTube. |
| **TalkingHead-1KH** | The README says the videos were "published in YouTube by their respective authors under Creative Commons BY 3.0". The licence could allow it, but obtaining them means downloading from YouTube (terms violation), and per-clip provenance is unverified. |
| **CelebV-HQ** | "available for non-commercial research purposes only". Celebrities too. |
| **Meta Casual Conversations v1/v2** | v1 is "for non-commercial, academic research". v2 is under a data licence agreement for evaluating models, not public demos. |
| **HDTF, MEAD, LRS3, AVSpeech** | Research-only, or YouTube-sourced without redistribution rights for edits. |
| **RawFootage Lab** | Hosted on YouTube, "for educational use", with no licence for publishing edits. It was rejected in `sample-footage.md` for the same reason. |
| **PRADUMNA_FX raw clips** | They claim "✓ Commercial Use", but there is no licence text and no talking-head clips (cars, anime, memes). |
| **Editors Den / Gumroad "raw clips to practise"** | Practice-only packs, one cinematic clip, and no talking head. |
| **YouTube / Instagram / TikTok CC content** | Downloading breaks their terms of service even when the video is CC-licensed. Only use copies the creator re-hosts elsewhere, such as Commons. |

## Next steps

- **Download:** take the 720p transcode, `…/transcoded/<hash>/<File>/<File>.720p.vp9.webm`, rather than
  the original. The file page has a link under "Transcode status".
- **Record our own:** for a hero demo on the website, record a raw selfie ourselves or pay a creator
  with a signed release. Commons clips are fine for demos and blog posts, but share-alike and
  personality rights make them weak for paid ads.
- **Find more Hindi:** query Commons with `filetype:video fileh:>1000 filew:<1300 <term>`. More Hindi
  and Hinglish probably exists under WikiConference India and Hindi Wikimedians categories. All of it
  still needs checking by eye.
