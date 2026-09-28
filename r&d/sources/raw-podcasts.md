# Raw podcast footage, and the talking-head list re-checked against the owner's rule

Researched 2026-09-28 under the owner's rule of that day (`r&d/MEMORY.md`): /compare shows only plain,
raw, unedited video made by ordinary people, plus podcasts. Nothing from an agency, company or
organisation, and no officials or politicians.

**Method** (the same as `raw-talking-head.md`):

- **Licence:** read on the live page. For Commons that means the Commons API's `extmetadata`. For the
  Internet Archive it means the item's `metadata` API plus the details page through WebFetch.
- **Audio:** `ffprobe` over HTTP range requests (Commons 480p/360p transcodes, or IA's own file).
- **Speech:** 30 s of audio decoded from a point past any intro. `volumedetect` gives the mean
  level. `silencedetect` at −35 dB / 0.4 s counts the pauses. whisper.cpp (`whisper-cli`) with bay's
  `ggml-base.bin` gives the quote.
- **Framing:** 2–3 poster frames per clip, viewed.

Nothing was downloaded into the repo. The scratch files are in `/tmp/rawpod-97601-1790570959`.
Commons rate-limited hard (HTTP 429). Where a check could not run, the table says so.

**Blockers:**

- **Separate mic tracks.** No raw multitrack podcast came with a licence that allows commercial use.
  The only ones found are Linux Weekly Daily Wednesday's dry multitrack and Interfacing Linux's
  "podmix" packs, and both are BY-NC-ND.
- **Separate raw camera angles.** None found. Where a podcast has two angles, the file has already
  been switched between them.
- **The result:** `sync_angles` has **no real candidate**, and `switch_speakers` only has split-screen
  composites (crop each tile) or files that are already switched. Recording our own is the only clean
  source for those two tools.

## 1. Podcast candidates

Ranked for a before/after on /compare. "Pauses" means pauses of more than 0.4 s in the 30 s sample.

| # | Clip | Licence (as read) | People on camera | Length | Angles / tracks | Audio (probed) | Speech (whisper base) | Framing | Risks |
|---|---|---|---|---|---|---|---|---|---|
| 1 ★ | [WIKITONGUES- Stephan and Simon speaking Frisian](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Stephan_and_Simon_speaking_Frisian.webm) | "CC BY-SA 4.0". Artist: "Wikitongues, Guillem Belmar"; "recorded by Wikitongues volunteer Guillem Belmar in the Netherlands" | Two private men (Stephan, Simon) | 24:12 | One wide shot, one stereo mix | Yes: opus stereo, −29.2 dB, 8 pauses | Speech is present, but base cannot transcribe Frisian (as `nl` it produced "We kwamen ook over 1,25.50.000…", garbage) | Both men seated side by side at a kitchen table, mid-shot, 1080×606 original. A 9:16 crop takes one man at a time. | **Language:** whisper can't handle Frisian, so `find_highlights` and subtitles fail; `remove_silences`, `level_voices` and the reframe still work. **Owner call:** Wikitongues is a non-profit, though the speakers are private people talking about themselves. **Share-alike.** **Unverified:** whether it opens on a title card. |
| 2 ★ | [The Impodcast Episode 1](https://archive.org/details/TheImpodcastEpisode1) (IA) | "CC BY 4.0" (`licenseurl` …/by/4.0/). Uploader: `theimpodcastfan@gmail.com` | Two private hosts (a man and a woman) in a small studio | 48:35 | Two angles (a wide two-shot and a close single), **already switched** in the file; one stereo mix | Yes: aac stereo 48 kHz, 1920×1080, −20.4 dB, 0 pauses | "There's a similar model out there where you get paid… you get paid to exercise or something, but if you don't do it, then it takes like a dollar out…" | Seated, facing each other, two mics, English | **Provenance:** the uploader's name ("…fan") suggests someone other than the creator uploaded it, so the licence may not be the creator's. Verify before use. **Not raw angles:** someone already cut between cameras. Branded shirts. **Unverified:** the hosts' names. |
| 3 ★ | [IQMZ Tech Ep 13](https://archive.org/details/iqmz_tech_e013) (IA) | "Attribution-ShareAlike 4.0 International". Uploader: IQMZ (`info@iqmz.com`); creators Owen JJ Stone and Anthony Lemos | Two hosts, recording remotely | 23:44 | A split-screen composite (two webcam tiles) on a baked IQMZ-branded background; one mono mix | Yes: aac mono, 1280×720, −21.0 dB, 2 pauses | "…the government can control everything and they can monitor everything else… if you really want to go secure, then you need to develop your own way…" | Two tiles side by side. Cropping each tile gives `switch_speakers` two "angles". | **Organisation rule:** IQMZ may be a small company, and Owen JJ Stone is a known tech-podcast personality (not an official). The logo is baked into the background. **Share-alike.** |
| 4 | [To Live A Lie Podcast – TLAL003](https://archive.org/details/tolivealiepodcast-tlal003-covid-19tigerkingcrisis) (IA) | "CC0 1.0 Universal". Uploader: ToLiveALie | AJ, Dylan, Eli, CJ, and guest Tommy Smith "of No Time Records" | 1:27:46 | A 4–5-person video-call grid, baked; one stereo mix | Yes: aac stereo, 1920×1080, −28.8 dB, 8 pauses | "One of the best things to happen in… power violence and like grind core… did you go to the first one? Yeah, so I went with the…" | Webcam tiles in bedrooms. Crop a tile per speaker. | **Music:** the page lists "music from various artists", which CC0 from the uploader cannot cover, so cut those spans. **Organisation rule:** the guest represents a record label. **File size:** the original is 5.8 GB, so read only ranges. **Unverified:** explicit language. |
| 5 | [WIKITONGUES- Jacques and Yvette speaking Chiac](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Jacques_and_Yvette_speaking_Chiac.webm) | "CC BY-SA 4.0". "Wikitongues, Noah Sullivan" (recorded in Massachusetts) | An elderly couple, private | 5:51 | One wide shot | Yes: opus stereo, −27.9 dB, 11 pauses | As `fr`: "Donc là, c'est la première fois que je suis prêt. – Où est-ce ? – Non, c'est pas la première fois…" | A kitchen table, both in frame, very homely. Pauses to cut. | Short. The language is a French/English mix. Wikitongues (as #1). Share-alike. |
| 6 | [WIKITONGUES- jan Tepo and jan Lakuse speaking Toki Pona](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_jan_Tepo_and_jan_Lakuse_speaking_Toki_Pona.webm) | "CC BY-SA 4.0". "Wikitongues, jan Tepo, jan Lakuse" | Two young private people | 8:38 | One handheld selfie two-shot | Yes: opus, −31.3 dB, 1 pause | Not transcribable ("(speaking in foreign language)") | Outdoors, phone selfie, both faces. Close to the owner's selfie reference. | A constructed language, so no subtitles and no highlights. The original is 3 GB, so use a transcode. |
| 7 | [WIKITONGUES- Disa and Niken speaking Javanese](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Disa_and_Niken_speaking_Javanese.webm) | "CC BY-SA 4.0". "Wikitongues, Fiel Sahir" | Two private women | 5:41 | One wide shot | Yes: opus, −24.1 dB, 0 pauses | Not transcribable (base output: "Kakao!") | Two women, lively, in a museum-like room. Handheld. | Javanese, so no subtitles. Short. |
| 8 | [Conversas de pescador](https://commons.wikimedia.org/wiki/File:Conversas_de_pescador.webm) | "CC BY-SA 4.0", Own work (Isac445564grtb45b). "Antonio Ivan do Nascimento conversando com seu filho Isac…" | A fisherman and his son (the son films) | 2:40 (from the transcode; the original reports none) | One handheld 4K camera | Yes: opus stereo, −24.7 dB, 2 pauses | "E a vida de pescador é sofrer… Seca também tem uma preocupação…" | 3840×2160, the father working on a red boat, horizontal | Too short for a podcast. A beautiful raw "ordinary person" clip, mostly one voice. |

### Seen and rejected for publishing

| Clip | Why |
|---|---|
| [ЯMP (Ritual Misery) Ep 194](https://archive.org/details/rm_podcast_e0194), CC BY-SA 4.0, 58:36, two hosts (Anthony Lemos, Kent Fellure) | A live-stream layout: **Twitch chat with viewers' usernames** is baked in beneath the webcams, plus a follower-goal bar. Usable only with a crop, and it is not "plain raw". Audio −22.5 dB. Whisper: "…Queen's music. It was spot on and perfect." |
| [The 4x4 Podcast Ep 30](https://archive.org/details/The4x4PodcastEpisode30InterviewWithPettyCashRacing), CC0, 72:39 | A Google+ Hangout with a lower-third name, a show logo and screen-shared web pages (SEMA, a Ram truck), so it is already produced. The guest leads a racing team. |
| [Podcast GeografiadoClima](https://commons.wikimedia.org/wiki/File:Podcast_GeografiadoClima.webm), CC0 | A black video frame over **scripted narration** ("São três horas da tarde. O sol bate forte…"). Not a conversation. |
| [Dasse Ep 15 Okkur](https://archive.org/details/DasseEp15Okkur), CC0, 71:49 | Audio over a still title card (band members as guests). |
| [Spoiler Alert Show Ep 15](https://archive.org/details/SpoilerAlertShowEpisode15-CaptainAmericaAndTheAvengers), CC BY 3.0 | The picture is arcade-game footage (third-party copyright). |
| [The Band Practice Podcast Beta One](https://archive.org/details/TheBandPracticePodcastEpisodeBetaOne), CC BY-SA 3.0 | One man with a guitar, a finished "Final" cut with a logo. Not a conversation. |
| Amateur Zen (IA) | The item says CC BY-SA, but its description says "CC-BY-NC-ND License applies to program as a whole". |
| Monsters of Law 13/14 (Wikimedia Deutschland), Sopa Wiki Podcast (Wiki Movimento Brasil), WikiTalks (WMF staff), Podcast Canet (Médiathèque / Conseil Municipal des Jeunes), The CSS-Podcast, Inside the FBI, Spring Podcast (NPS), Houston We Have a Podcast, CHP "Behind the Badge" | Made by organisations, agencies or companies, so they are out under the rule. |
| LWDW dry multitrack; Interfacing Linux podmix | BY-NC-ND. |
| YouTube CC-filtered search (checked with a `yt-dlp` listing only, nothing downloaded) | The results are finished, edited shows, and many are re-uploads by third parties (e.g. Harmontown by "JoneseyCat"), so the CC claim is not the creator's. Downloading is also against YouTube's terms. |
| Vimeo CC | Still cannot be verified without an account (as in `raw-talking-head.md`). |
| Hacker Public Radio (hpr*, CC BY-SA) | Audio only, and mostly one host. Not checked per episode. |
| Unprobed lead | Commons "Entrevista a un estudiante / a un compañero" (Manuel Gonzales, CC BY-SA 4.0, own work, 1080×2400, 0:39 and 1:40): a student interviewing students by phone. Private people, but short. |

## 2. `raw-talking-head.md` against the rule

**Fail (officials, politicians, a company):**

- **Politicians:** Kamala Harris ×3 (#6–8), Terri Sewell (#9) and Deb Haaland (#13).
- **Election candidates at the PIRA forum:** Barbara Pocock, Rex Patrick and Karen Grogan (#10, #11,
  #14).
- **A company:** Bill Smith, a CEO speaking for Shipt (#15).
- **A Microsoft dataset:** VCD2.

**Borderline (the owner decides; I lean exclude):**

- **Candidate statement (#1, the old top pick):** its Commons description reads "This is my statement
  as a candidate for the Wikimedia Board of Trustees". It is an election pitch about an organisation's
  governance, so it fails a strict reading of "no politicians / nobody speaking for an organisation".
- **WHC 2018 Hindi 01/02 (#4, #5):** attendees of the 11th World Hindi Conference, a
  government-organised event, talking about Hindi Wikipedia. Who they are is unknown, and delegates
  are often officials.
- **WIKITONGUES- Gereon:** he explains editathons, so he is speaking about Wikimedia's work.

**Pass, ranked:**

1. **James speaking West Riding Yorkshire English.** CC0, a private man, a self-shot ramble ("I
   thought I'd do a little video"), 6:20. It is the cleanest on both licence and rule.
2. **Daniel speaking English.** CC BY-SA 4.0, a private man, a genuine phone selfie with a false start
   and 16 pauses. It is the closest match to the owner's reference.
3. **Interview Traditional Kangri Dhaam.** CC BY-SA 4.0, own work: "a local person of HP district
   Kangra" talking about festival food, vertical. It needs a larger whisper model.
4. **WIKITONGUES- Krishna speaking Hindi.** CC BY-SA 4.0, a private speaker, a clean horizontal clip
   that crops to 9:16. It is the Hindi demo.
5. **WIKITONGUES- Sam / Mckensie speaking English.** CC BY-SA 4.0. Private people recorded at
   Wikimania 2018, talking about language rather than the organisation. Sam's fillers suit a
   filler-removal demo.
6. **WIKITONGUES- Kavyanjali (Hindi) and Muktesh (Kumaoni/Hindi).** CC BY-SA 4.0, private people,
   horizontal.

**One caveat for every Wikitongues item:** Wikitongues is a non-profit, so an owner who reads "no
organisation" literally loses #2 and #4–6. James is the one pick that survives any reading, because
it is CC0 and self-filmed. It is still distributed by Wikitongues.
