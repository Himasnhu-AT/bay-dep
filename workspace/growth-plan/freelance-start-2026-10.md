# Starting freelance editing for coding and tech channels

Checked 2026-10-07. Companion files: `freelance-channels-2026-10.csv` (70 channels) and
`freelance-agencies-2026-10.csv` (35 agencies, boards and communities). Nobody was contacted, no form
was filled, nothing was signed up for and no video was downloaded.

## What could not be verified — read this first

**Channels**

- **Nobody watched the videos.** Each channel was read from its own YouTube pages: the About, Videos,
  Shorts and Live tabs, and for two or three recent uploads the title, length, description, date and
  YouTube's caption track with word timings. The picture was looked at for 15 channels only, as one
  sheet of 25 thumbnails (160×90 each) from the middle of one video. Every other "format" is inferred
  from titles and captions and says so in the row.
- **Audio level was not measured** for anyone. That needs the file, and nothing was downloaded. No row
  claims quiet or uneven audio.
- **"um/uh" counts are what YouTube's automatic captions wrote down.** Auto-captions miss some fillers
  and mishear others, so treat a count as a strong hint and open the timestamp before quoting it to the
  creator. Channels whose English track is an automatic translation of Hindi were given no filler claim.
- **"No speech for 5 s or more" is silence in the captions, not proof of dead air.** It can be typing, a
  build running or music. On live-coding channels it mostly is typing; the pitch there is a condensed
  cut, not "you left pauses in".
- **"No chapter timestamps" means none are written in the description.** YouTube may still show
  automatic chapters.
- **"Newest Short" is the first item on the Shorts tab**, taken to be the newest.
- **Upload cadence** comes from the relative ages on the channel tabs ("3 weeks ago"), plus exact dates
  for the two or three videos read. The tab count stops at 30.
- **"Individual or tiny team" is read from the About text.** Rows where that was unclear say "not
  verified" and were scored one point lower.
- **Country** is the one shown on the About tab. Four India rows have no country there and are marked
  "inferred".
- **Emails behind "Sign in to see email address" were not read.** A row quotes an email only where the
  creator wrote it in the public channel description.
- **Only two or three videos per channel were read.** A gap in those is not proof the whole channel has it.
- Part-way through, YouTube began refusing the normal watch pages for this machine. The rest was read
  through YouTube's own player and "next" endpoints, which return the same title, length, description,
  date and captions.

**Agencies and boards**

- 9 of 35 rows rest on a search snippet, not an opened page; each says so in its notes. Two more
  (LinkedIn, X) are search patterns, not pages.
- Not opened at all: Reddit (blocked), Upwork, Fiverr and Contra (bot walls), Behance, most Discord
  listings. Subreddit rules in the file are snippets.
- Vidpros' requirements sit inside a Typeform that was not opened. The Coding Sloth's post has no
  readable apply route and its status today is unknown.
- No opened page gave a rate for a **video podcast episode**, and none said what individual creators use
  to pay an editor in India. Both are marked as estimates below.

**Footage licences**

- Not read: Internet Archive / Prelinger (the site answered 503 all day), Mixkit's licence text (hidden
  in a pop-up), Videezy, Vidsplay, Life of Vids, FilmKits (gone or 404), KubeCon's and NixCon 2025's
  recording licence.
- Cinestudy's multicam rules were read from the owner's post on Adobe's forum, not from cinestudy.org.
- Quotes were read through a fetch tool that extracts text. Six were re-opened and matched (FOSDEM's
  video archive, EditStock's terms, The Coding Sloth, the YT Jobs board, Cinestudy's project list,
  DebConf's licence). Re-read any line on its own page before you rely on it with a client.

**Bay**

- What Bay can do is taken from its tool descriptions in `src/shared/tools/` and the README, not from
  running it. The README's own tool count (33) is behind the folder.
- "Bay has no XML/EDL/project export" rests on finding none under the names `fcpxml`, `otio`, `edl`,
  `xml`. If it exists under another name, the hand-off section below is too pessimistic.

**How the work was split:** two helper agents read the agency and licence pages and wrote notes; the
channel list was built and checked directly.

---

## 1. Free raw footage, and what each licence lets you publish

Three questions decide a source: is it really **raw** (unedited takes), may the **edit be posted
publicly**, and is **credit** owed. "Portfolio" below means a public page that advertises paid editing,
which a non-commercial licence may not cover.

### The honest answer for this niche: record your own

You are a developer. A 20-minute screen recording of you building something small — screen, webcam and
mic as separate tracks, mistakes left in — is genuinely raw, exactly the niche, and yours to publish and
show to clients. A 30-minute two-camera conversation with a friend about a technical topic is the same
for podcasts. No source below is as on-target or as clean. Make these two first.

### Sources with written permission

| Source | What it is | Raw? | Post the edit publicly? | Credit | Use for a client? |
|---|---|---|---|---|---|
| **FOSDEM talks** — https://video.fosdem.org/ | Hundreds of software talks a year, downloadable files | Finished single-camera talk recordings | Yes | Speaker, talk title, FOSDEM + year, talk URL, licence | Yes, with credit |
| **media.ccc.de talks** — https://media.ccc.de/ | Security and infrastructure talks | Finished recordings | Only talks marked CC BY | As the licence says, per talk | Yes if CC BY |
| **DebConf recordings** — https://meetings-archive.debian.net/pub/debian-meetings/ | Debian conference talks | Finished recordings | Yes | Keep the copyright and permission notice | Yes |
| **Cinestudy "EDIT THIS"** — https://www.cinestudy.org/ | Short-film dailies, a podcast/documentary project, a multicam project | **Yes** — takes, angles, b-roll | Yes, with the rules followed | Full credits, project title, `#sonnyboo` `#cinestudy` | Not stated — ask |
| **Blender Studio films** — https://studio.blender.org/ | Animated films and production files | Finished films; some audio stems | Yes | CC BY credit | Yes, with credit |
| **Tears of Steel** — https://mango.blender.org/ | Live-action sci-fi short, frames and separate audio | Partly (frames and mixes, not multi-take dailies) | Yes | "(CC) Blender Foundation \| mango.blender.org" | Yes, with credit |
| **EditStock** — https://editstock.com/ | Real dailies of short films, documentaries, commercials | **Yes** | Yes, with their logo | EditStock credit logo at start or end | **No** |
| **Pexels / Pixabay / Coverr** | Stock b-roll shots | No — finished shots | Yes, inside an edit | None | Yes |
| **NASA** — https://images.nasa.gov/ | Mission and ISS footage | Some long unedited feeds | Yes | Acknowledge NASA | Yes, without implying endorsement |

The lines those verdicts rest on, each checked 2026-10-07:

- **FOSDEM** — video archive: "This work is licensed under the Creative Commons Attribution 2.0 Belgium
  Licence." (https://video.fosdem.org/). The 2026 site footer says CC BY 4.0
  (https://archive.fosdem.org/2026/). Both allow adaptation and commercial use with credit. Do not use
  the FOSDEM name or gear logo as your own branding.
- **media.ccc.de** — "The license displayed in the actual video file applies" (https://media.ccc.de/about.html).
  One talk checked reads "Licensed to the public under http://creativecommons.org/licenses/by/4.0". Read
  the line on each talk page.
- **DebConf** — a permissive notice letting anyone "copy, transform, adapt, modify, merge, publish,
  distribute, sublicense, and/or sell copies of the work" provided the notice travels with it
  (https://meetings-archive.debian.net/pub/debian-meetings/LICENSE). Covers DebConf 6 onwards.
- **Cinestudy** — multicam project: "You may upload your versions of the project on social media and
  anywhere you like, as long as you follow these simple rules" (the owner's post,
  https://community.adobe.com/questions-105/anyone-want-a-free-editing-project-cinestudy-offers-several-1550931).
  Rules differ per project; the footage stays "All Rights Reserved". Its music may only be used with
  that project.
- **Blender Studio** — "Unless notified otherwise, all digital content (webpages, video, artwork, 3D
  data) is available under the Creative Commons Attribution 4.0." (https://studio.blender.org/terms-and-conditions).
  Logos are excluded.
- **Tears of Steel** — "licensed under the Creative Commons Attribution 3.0 license"
  (https://mango.blender.org/sharing/). The download page warns its 2012 links may have expired.
- **EditStock** — "Post your completed edit on your personal website or on video-sharing sites like
  YouTube or Vimeo, as long as it displays the EditStock credit logo" and "A Single User or Multi-User
  License does not permit any business use" (https://editstock.com/pages/terms-of-use). It is **paid**
  (banner: "GET ANY 2 PROJECTS FOR $99"); the three free projects showed "Sold Out".
- **Pexels** — "All photos and videos on Pexels are free to use." "Attribution is not required."
  "Don't redistribute or sell the photos and videos on other stock photo or wallpaper platforms."
  (https://www.pexels.com/license/)
- **Pixabay** — "Modify or adapt Content into new works"; "You cannot sell or distribute Content (either
  in digital or physical form) on a Standalone basis." (https://pixabay.com/service/license-summary/)
- **Coverr** — "You may use Coverr.co's videos and music for both commercial and non-commercial purposes
  at no cost." (https://coverr.co/license)
- **NASA** — content "generally are not subject to copyright in the United States"; "NASA should be
  acknowledged as the source of the material."; the insignia is protected
  (https://www.nasa.gov/nasa-brand-center/images-and-media/)

### Usable with care

- **Wikimedia Commons video** — "Each media file has its licensing specified on its file description
  page." (https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia). Record the file
  page, author and licence for every clip. Share-alike licences bind your whole edit.
- **ESO** (https://www.eso.org/public/copyright/) — CC BY 4.0; "the full image or footage credit must be
  presented in a clear and readable manner".
- **ESA** (https://www.esa.int/ESA_Multimedia/Terms_and_Conditions) — the standard licence "shall not be
  used for a commercial purpose". Use only items marked CC BY-SA 3.0 IGO.
- **Dareful** (https://dareful.com/) — nature b-roll under CC BY 4.0; credit required.
- **Videvo** — now part of Freepik/Magnific. Free use is "conditioned upon any use by the User being
  duly attributed", and the user "Does not resell, assign, transfer or sublicense the Magnific Content
  or any derived work" (https://www.videvo.net/legal/terms-of-use). Fine for a portfolio with credit;
  avoid for client work.
- **Mixkit** — two video licences, "Stock Video Free License" and "Stock Video Restricted License"
  (https://mixkit.co/license/). The text of each was not read. Check each clip.
- **Library of Congress** — no blanket licence: "You should determine for yourself whether or not an
  item is protected by copyright" (https://www.loc.gov/legal/).
- **CC BY videos on YouTube** — in search, Filters → Features → Creative Commons. YouTube's help says:
  "If you're using someone else's work under the Creative Commons Attribution license, you need to give
  them credit", listing title, author, source URL and licence
  (https://support.google.com/youtube/answer/2797468). **The tick is only as good as the uploader's
  right to give it.** A re-upload channel can mark footage it does not own. Use CC BY videos only from
  the channel that made them, and keep a screenshot of the licence row with the date.

### Practice only — do not publish

- **Non-commercial, share-alike lectures and talks**: EuroPython ("CC BY-NC-SA 4.0",
  https://blog.europython.eu/speaker-release-agreement), linux.conf.au (CC BY-NC-SA 4.0,
  https://linux.conf.au/programme/proposals/), CS50 (https://cs50.harvard.edu/x/license/), MIT
  OpenCourseWare (https://ocw.mit.edu/pages/privacy-and-terms-of-use/). A portfolio that sells editing
  is arguably commercial. Ask first.
- **PyCon US** is not Creative Commons. Viewers get a licence "to access, use, display, and perform the
  User Submission in a non-commercial, private context"
  (https://pycon-archive.python.org/2025/speaking/recording/). Not a footage source.
- **Blackmagic's DaVinci Resolve training files and camera samples, ARRI and RED samples** — no usage
  terms on the pages; Blackmagic's site says "all rights reserved". ARRI's are "for workflow evaluation
  purposes".
- **Filmsupply Editfest** (https://editfest.filmsupply.com/faqs) — "You only have the license to use them
  for your Editfest submission." Submissions close 2026-10-09.
- **RawFootage Lab** (https://rawfootagelab.com/terms) — a directory of other people's videos: "any use,
  editing, or distribution of the actual footage you find via these links is strictly between you and
  the original copyright holder." It grants nothing.
- **Podcasts.** No show checked publishes a licence to clip. Syntax: "You may not reproduce, distribute,
  republish… any copyrighted material on Syntax without our prior written consent"
  (https://syntax.fm/pages/terms-of-service). Changelog's terms forbid copying and derivative works
  (https://changelog.com/terms). Nothing written was found for Lex Fridman, Dwarkesh Patel, This Week in
  Startups or Software Engineering Daily. Clip channels exist because owners tolerate them. Treat every
  podcast as someone to ask, not as footage.
- **No creator was found who publishes raw, unedited coding-tutorial recordings under an open licence.**

### What is not free footage

**A creator's published video is not raw and not free.** YouTube's terms forbid users to "access,
reproduce, download, distribute, transmit, broadcast, display, sell, license, alter, modify or otherwise
use any part of the Service or any Content" except as the service allows or with permission
(https://www.youtube.com/static?template=terms). Its fair-use page adds: "Giving credit to the owner of
a copyrighted work won't by itself turn a non-transformative copy of their material into fair use."
(https://support.google.com/youtube/answer/9783148)

So: **do not post a re-cut of someone's video on your portfolio, channel or socials without their
written yes.**

**Sending a re-cut privately to that creator as a pitch is a different act, and it is the norm.** Three
editor guides recommend it, including an India-focused one ("I actually edited a 30-second version to
show you", https://fueler.io/blog/freelance-video-editing-in-india-how-beginners-get-their-first-5-clients-without-connections;
also https://www.miracamp.com/learn/video-editing/how-to-become-a-video-editor-for-youtubers and
https://alexberman.com/how-to-start-freelancing-video-editing). The only viewer is the rights holder.
It is still made without a licence, and making it means getting the video off YouTube outside its
features — the terms above do not carve out pitches. No source was found describing a creator
objecting; that is not evidence none do. Keep the risk small: 30–60 seconds, one unlisted or private
link, say in the message that it is their video and you will delete it on request, and never show it to
anyone else until they agree in writing. One hiring guide warns creators that "Free test edits attract
the desperate, not the good" (https://adsnipper.com/?p=2495), so make the next step a **paid** trial.

---

## 2. The portfolio: five pieces

A tech creator hiring an editor looks for four things: the code stays readable, the pace is tighter
without losing a step, the sound is even, and you understood what was being taught. Show raw beside
final every time; the difference is the product.

| # | Piece | Footage | What it proves | Bay tools it uses |
|---|---|---|---|---|
| 1 | **A 10-minute coding tutorial, tightened** — before → after, with zooms on the code, captions, chapters | Your own screen + webcam recording | The core job | `remove_silences`, `remove_range`, keyframed zoom, `add_captions`, export with loudness |
| 2 | **Three vertical Shorts from one long tech talk** — 30–50 s, word-by-word captions | A FOSDEM or DebConf talk, credited | Finding the moment; reframing slides for a phone | `find_highlights`, `set_canvas`, `add_subtitles` |
| 3 | **A two-camera podcast segment, 3–4 minutes** — switched by speaker, levelled | You and a friend, two cameras, two mics | Multicam and audio | `sync_angles`, `switch_speakers`, `level_voices` |
| 4 | **A 30-second product or tool explainer** | Your own capture of an open-source tool, plus motion graphics | Motion design for sponsor reads and launches | `.brf` graphics, captured UI |
| 5 | **A 45-second audio fix, before/after** | A deliberately rough recording of your own | That you hear problems | `level_voices`, loudness-mastered export |

Two cautions from Bay's own status. Nobody has yet listened to its composed music or system voice, so
leave both out of the portfolio. Its default graphic layouts were just reworked and are unchecked, so
look at every lower third, title and chart frame by eye before it goes on the page.

**Where to host.** One page on himanshuat.com: five embedded videos, each with one line on what was
done and how long it took, the credit lines for any CC footage, your rate card and a contact route.
Host the videos as an unlisted YouTube playlist so a creator can watch in the player they know. Keep
pieces 1 and 3 downloadable as files too: agencies ask for links to your best edit (EditVisions' form:
"Link the best edit you have made").

---

## 3. Outreach

### Three messages (each under 90 words)

**A. Cold pitch to a channel, with a private sample**

> Subject: 50 seconds of "‹video title›", re-cut
>
> Hi ‹name› — I edit coding tutorials. I took 50 seconds of ‹video title› (from ‹mm:ss›) and tightened
> it: pauses and "um"s out, a zoom on the code you were explaining, captions on. Unlisted link: ‹link›.
> It is only for you, and I'll delete it if you'd rather.
>
> If it's useful, I'd edit one full video as a paid trial for ‹price›: 48-hour turnaround, two rounds
> of changes. No reply needed otherwise.
>
> Himanshu — himanshuat.com

**B. Reply to a hiring post**

> Hi ‹name› — applying for the editor role. I cut developer tutorials: screen recordings tightened,
> zooms on the code, captions, chapters, Shorts from the long video. Three before/after samples, a
> minute each: ‹link›.
>
> One thing up front: I edit in my own Mac editor, so I deliver finished MP4 or MOV plus an .srt, not a
> Premiere project. Say if that rules me out.
>
> ‹price› per video, first one as a paid test. I'm in India (IST) and online ‹hours› your time.

**C. Application note to an agency**

> Hello — I'd like to be considered as a contract editor. I work on coding and tech tutorials and
> two-camera podcasts. Portfolio, five pieces with raw beside final: ‹link›.
>
> Capacity: ‹n› long videos a week, 48-hour turnaround, IST with ‹hours› overlap.
>
> I edit in Bay, an editor I built. I deliver MP4/MOV, overlays with alpha, WAV and .srt. I can't hand
> over Premiere or Resolve project files; if your pipeline needs them I'm not the fit. Glad to do a
> test edit.

### Cadence

- **Daily (45 minutes):** check YT Jobs and the two or three boards in section 7; send **two** channel
  pitches, each with its own sample cut. Two a day is what one person can cut honestly.
- **Weekly:** 10 pitches out, one follow-up to each of last week's non-replies (one line, then stop),
  one new portfolio piece or a better version of an old one, one agency application.
- **Track** in a sheet: channel, date sent, sample link, reply, outcome. Delete samples for anyone who
  says no.

### What not to do

- No identical message to many channels. Every row in the channel file names a different video and
  timestamp for this reason.
- No public re-upload of anyone's footage: not on the portfolio, not as a Short "to show them".
- No criticism in the opener. "I counted 213 ums" is a number for you to find the right minute, not a
  sentence to send. Show the after.
- No unlimited free work. One sample of under a minute, then a paid trial.
- No lowball spam on Reddit or in Discords. r/forhire requires a stated rate on every post and removes
  very low offers (search snippet; rules not opened).
- No hiding that you edit in Bay. Say it in the first message; it filters out clients who need project
  files before either side spends time.
- No contact through a route the creator did not publish for business.

---

## 4. Rates, as of 2026

Every figure was seen on 2026-10-07 at the URL given. Almost none is specific to coding channels; the
two that are come first.

### What listings offer editors

| Work | Figure | Source |
|---|---|---|
| Freelance editor, **Fireship** (coding, 4M+ subs) — closed posting; Premiere and After Effects required | "Rate: 250 - 350 USD per day" | https://www.builtinnyc.com/job/video-editor-freelancer-fireship/10037720 |
| Freelance editor, **The Coding Sloth** (programming), 8–20 min videos, 1–2 a month | "Pay is negotiable based on experience and portfolio" | https://hollow-somersault-6ae.notion.site/The-Coding-Sloth-Video-Editor-1ededc94de5b80de8b65f5e656c1e12f |
| Long-form per project, YT Jobs, various niches | "$50-$350", "$100-$600", "$350-$1,000", "$500-$750" per project | https://ytjobs.co/job/search/?role=video-editor |
| Long-form, large channel (1.48M subs, 30–40 min episodes) | "$1,000-$2,000 Per project" | https://ytjobs.co/job/45090 |
| **Short**, per project, YT Jobs | "$30-$50 Per project" | https://ytjobs.co/job/45143 |
| Agency sub-editing, long-form | "$5 / finished minute", "$6 / finished minute" | https://www.freelancer.com.au/projects/adobe-premiere-pro/long-form-youtube-video-editors |
| Long-form, **Indian client**, 8–15 min, 5–10 videos a month | "₹1,500–12,500 INR" project budget | https://www.freelancer.in/projects/motion-graphics/youtube-video-editor-motion-designer |
| Full-time remote editor, YT Jobs | "$9,600-$19,200", "$21,600-$30,000", "$24,000-$36,000" a year | https://ytjobs.co/job/search/?role=video-editor |
| Salaried editor in India | "₹2,00,000 - 3,00,000/year" up to "₹3,00,000 - 8,00,000/year" | https://internshala.com/jobs/video-editing-jobs/ |

### What agencies charge the client (a ceiling on what they pay you)

| Agency | Figure | Source |
|---|---|---|
| Tasty Edits, horizontal | "1 video at $327/per video" … "8 videos at $278/per video" | https://www.tastyedits.com/ |
| Tasty Edits, vertical | "1 video at $94/per video" … "30 videos at $80/per video" | https://www.tastyedits.com/ |
| Vidchops | "$495/month" for 4 long-form or 16 short-form (about $124 a long video) | https://vidchops.com/pricing/ |
| Video Husky | "$849 p/m", "$1,590 p/m", "$2,749 p/m" | https://videohusky.com/pricing/ |
| Vidpros | "$1000/Month" for 2 editor-hours a workday; "$4000/Month" full time | https://vidpros.com/pricing/ |

### Rate guides (written by vendors; weaker than listings)

- **Per long-form video:** talking head "$30–$150", retention-edited "$200–$600"; **per Short:** entry
  "$5–$25", mid "$25–$100"; **retainer:** part-time offshore "$800–$1,800" a month. The same page cites
  a 2025 survey of 201 editors: "an average of $287.16 per project" and "$1,206.60 per month for
  retainers" (https://www.thecreatorsassistant.com/youtube-video-editor-cost).
- **India, freelance:** Reels/Shorts "₹1,000 to ₹5,000", standard YouTube videos "₹3,000 to ₹10,000",
  retainers junior "₹15,000 to ₹28,000", mid "₹30,000 to ₹58,000"; international hourly "$5 to $10"
  junior, "$10 to $25" mid
  (https://fueler.io/blog/video-editor-salary-in-india-freelance-and-full-time-pay-guide).
- **Hiring an editor in India, from the buyer's side:** "$5-10" an hour at 1–2 years, "$10-25" at 3–5
  (https://vidpros.com/hire-video-editor-in-india/, page labelled 2025).

### India against US/EU

For the same long-form video: an Indian client's budget was ₹1,500–12,500 and the guide range is
₹3,000–10,000; foreign channels on YT Jobs offered $100–$1,000. Agency sub-editing pays least.

### A starting card — **estimate, not sourced**

Placed inside the ranges above for a new editor with a portfolio and no client credits:

| Work | Foreign client | Indian client |
|---|---|---|
| 10–20 min tutorial: tighten, zooms, captions, chapters | $100–200 | ₹4,000–8,000 |
| One Short from supplied long-form | $20–35 | ₹800–1,500 |
| Two-camera podcast episode, 45–60 min, switched and levelled | $100–200 — **no source found for this line** | ₹4,000–8,000 — no source found |
| Monthly: 4 long videos + 8 Shorts | $600–1,000 | ₹25,000–40,000 |
| Paid trial (first video) | about 60% of the per-video price | same |

### Getting paid from abroad, briefly

- One vendor page names what buyers use to pay editors in India: "Wise", "PayPal" and "bank transfers",
  with Wise at "0.5-1.5% fee" and PayPal "4-5% fee" (https://vidpros.com/hire-video-editor-in-india/).
  No opened source says what individual YouTubers use; Wise or PayPal for direct clients is an
  assumption to confirm with each.
- Through a marketplace the platform pays you. Upwork "charges freelancers a 0% to 15% service fee per
  contract" and "$0.99 per withdrawal" to a local bank (https://www.skydo.com/blog/upwork-fees-freelancers,
  2026-09-10 — check Upwork's own page; another summary gave different tiers). "Roster takes no
  commission on hires" (https://www.joinroster.co/).
- Razorpay's guide says "FEMA applies from payment one" and to collect an e-FIRA/FIRC for each inward
  remittance (https://razorpay.com/blog/upwork-fiverr-payments-indian-freelancers/, 2026-09-08). Skydo
  and Razorpay sell payment products; read them as vendors.
- **This is not tax advice.** GST registration and export-of-services treatment, income tax on foreign
  receipts, and which paperwork your bank wants are yours to confirm with a chartered accountant before
  the first invoice.

---

## 5. Deliverables and workflow

What a small tech channel usually expects. This is common practice, not sourced, except where a line is
quoted.

| Expectation | Usual form | Bay today |
|---|---|---|
| **Final video** | H.264 MP4 at the source resolution and frame rate | Yes — `export_timeline` writes mp4, mov, webm. H.264 is Apple's VideoToolbox encoder, not x264 |
| **Loudness** | Even dialogue, no clipping; around −14 LUFS for YouTube is the common target (unsourced) | Yes — loudness-mastered export, measured on the encoded file, reported as `deliveredLoudness` |
| **Captions file** | .srt uploaded to YouTube alongside the video | Yes — Deliver page, "Export captions (.srt)" |
| **Shorts** | 1080×1920 MP4, captions burned in | Yes — `set_canvas`, `add_subtitles` |
| **Chapters** | A timestamp list for the description | By hand, or ask Bay's agent to write it from the transcript; no dedicated export found |
| **Overlays for someone else's edit** | Transparent .mov | Yes — .mov with alpha |
| **Audio only** | WAV or MP3 for the podcast feed | Yes — wav, mp3 |
| **File naming** | `channel_video-slug_v01.mp4`, then `_v02`; `_final` only once approved | Your discipline; Bay exports to the name you give |
| **Review rounds** | Two rounds included; notes as timestamps on an unlisted link or in a shared doc | Partly. Bay has review comments pinned to the timeline, but only inside Bay — a client cannot leave them. Take notes by timestamp and enter them yourself |
| **Turnaround** | 48 hours first cut, 24 hours for changes. One listing: "completed within 48 hours… revisions due within 24 hours" (search snippet, onlinejobs.ph) | Not a tool question |
| **Raw footage hand-over** | Client shares a Drive or Dropbox folder; you return finals to the same place | Outside Bay |
| **Project-file hand-off** | Agencies and bigger channels want the Premiere or Resolve project | **No.** No Premiere, Final Cut or Resolve project export and no XML/EDL was found in Bay. Say so before the trial |
| **Machine** | Any | Bay is a Mac app |

The project-file line is the one that loses work. Electrify's Fireship posting asked editors to "Maintain
organised project files… to ensure easy access to assets and seamless collaboration"; 7xContent says
"Premiere Pro & After Effects are key". A solo creator who wants a finished file does not care which
editor made it. An agency with shared projects does. Aim at the first kind.

---

## 6. The 15 channels to approach first

Chosen for a gap that Bay closes well (pauses and fillers, Shorts, captions), a sign the channel earns
money, and a size where one person still decides. India-based channels are marked. Brian Casel scored 5
but is left out because he is already on Bay's product outreach list; make one ask of him, not two.

Open each timestamp and listen before you cut. The counts came from captions.

**1. nunomaduro** — https://www.youtube.com/@nunomaduro — 31.1K subscribers

- Why: A two-person conversation with sponsor logos on screen, 44 minutes, 4.8 fillers a minute in the captions and no chapters. Sponsors mean budget; a podcast is where speaker switching and levelling show.
- Seen: YouTube's auto-captions for "DHH may be right.. is coding literally dead?" (2026-09-29, 44 min) contain 213 'um/uh' — 4.8 a minute; the densest minute starts at 17:58 (13 of them); no chapter timestamps in the description of "DHH may be right.. is coding literally dead?" (2026-09-29, 44 min).
- Cut this: A 45–60 s before/after of "DHH may be right.. is coding literally dead?" starting at 17:58: fillers and restarts cut, pauses closed, word-by-word captions on the 'after'. Video: https://www.youtube.com/watch?v=SL4APfE4894 (2026-09-29)
- Reach: site linked on the channel: nunomaduro.com; public profile linked on the channel: x.com/enunomaduro, linkedin.com/in/nunomaduro; business email on the YouTube About tab ("Sign in to see email address")

**2. Daniel Hirsch** — https://www.youtube.com/@HirschDaniel — 78.5K subscribers

- Why: 82-minute coding sessions with over ten minutes of no-speech stretches, no chapters, and no Short since January. His descriptions mention Patreon, Gumroad and a course.
- Seen: Caption word-timings for "File Scrambler in Python" (2026-10-02, 82 min) show 79 stretches of 5 s or more with no speech, 10:34 in total — the longest 18 s at 1:11:18, then 17 s at 1:06:57; no chapter timestamps in the description of "File Scrambler in Python" (2026-10-02, 82 min) — nor in the other recent long video checked; the newest Short is dated 2026-01-31 while 20 long videos/streams went up in the last 60 days; in the one storyboard sheet viewed (25 thumbnails, about 4 minutes mid-video) the screen stays full-frame at one scale — no zoom-in on the code or UI visible in that span.
- Cut this: A 60 s before/after of "File Scrambler in Python" around 1:11:18: the 18 s without speech closed or speed-ramped (if it is typing), with a zoom on the code being written; plus one vertical Short from the same video. Video: https://www.youtube.com/watch?v=TYl7WJW_ey0 (2026-10-02)
- Reach: site linked on the channel: linktr.ee/hirschdaniel; business email on the YouTube About tab ("Sign in to see email address")

**3. ServersatHome** — https://www.youtube.com/@ServersatHome — 34.5K subscribers

- Why: A two-hour weekly show and no Short since 2024. He publishes a business email and has Patreon and sponsors.
- Seen: YouTube's auto-captions for "State Of Self-Hosting Week 37 — GitHub Outages, the Memory Tax & HA Proxy Manager" (2026-09-11, 2.0 h) contain 463 'um/uh' — 3.8 a minute; the densest minute starts at 35:25 (13 of them); caption word-timings for "State Of Self-Hosting Week 37 — GitHub Outages, the Memory Tax & HA Proxy Manager" (2026-09-11, 2.0 h) show 20 stretches of 5 s or more with no speech, 2:16 in total — the longest 11 s at 1:16:26, then 9 s at 1:49:59; the newest Short is dated 2024-10-28 while 15 long videos/streams went up in the last 60 days.
- Cut this: A 45–60 s before/after of "State Of Self-Hosting Week 37 — GitHub Outages, the Memory Tax & HA Proxy Manager" starting at 35:25: fillers and restarts cut, pauses closed, word-by-word captions on the 'after'; plus one vertical Short from the same video. Video: https://www.youtube.com/watch?v=mWDgBVLVKGs (2026-09-11)
- Reach: email published in the channel description: evan@serversatho.me; site linked on the channel: serversatho.me; business email on the YouTube About tab ("Sign in to see email address")

**4. Anwar Haq** — https://www.youtube.com/@DrAnwarHaq — 18.9K subscribers

- Why: 7.6 fillers a minute in the captions and no Short this year. His descriptions mention a course.
- Seen: YouTube's auto-captions for "I Analyzed 3,000 AI Job Postings- This is what I found!" (2026-09-22, 38 min) contain 287 'um/uh' — 7.6 a minute; the densest minute starts at 1:26 (14 of them); caption word-timings for "RAG For AI Engineering in 2 Hrs (Beginner to Expert)" (2026-09-12, 2.2 h) show 47 stretches of 5 s or more with no speech, 5:52 in total — the longest 20 s at 1:36:11, then 17 s at 1:35:02; the newest Short is dated 2025-12-31 while 5 long videos/streams went up in the last 60 days.
- Cut this: A 45–60 s before/after of "I Analyzed 3,000 AI Job Postings- This is what I found!" starting at 1:26: fillers and restarts cut, pauses closed, word-by-word captions on the 'after'; plus one vertical Short from the same video. Video: https://www.youtube.com/watch?v=0NGF8VNrQhA (2026-09-22)
- Reach: YouTube About tab

**5. Cand Dev** — https://www.youtube.com/@CandDev — 20.8K subscribers

- Why: Posts about twice a week, 4.1 fillers a minute, last Short in 2023, and the screen stayed at one scale in the thumbnails seen.
- Seen: YouTube's auto-captions for "This Next js Dashboard Starter Saved Me Hours of Work" (2026-10-06, 9 min) contain 37 'um/uh' — 4.1 a minute; the densest minute starts at 6:28 (12 of them); the newest Short is dated 2023-03-16 while 15 long videos/streams went up in the last 60 days; in the one storyboard sheet viewed (25 thumbnails, about 2 minutes mid-video) the screen stays full-frame at one scale — no zoom-in on the code or UI visible in that span.
- Cut this: A 45–60 s before/after of "This Next js Dashboard Starter Saved Me Hours of Work" starting at 6:28: fillers and restarts cut, pauses closed, word-by-word captions on the 'after'. Video: https://www.youtube.com/watch?v=nw_W66pxHK4 (2026-10-06)
- Reach: site linked on the channel: cand.site; business email on the YouTube About tab ("Sign in to see email address")

**6. Techdox** — https://www.youtube.com/@Techdox — 21.6K subscribers

- Why: A homelab channel whose descriptions mention sponsorship, with 3 fillers a minute; at 21.6K the owner likely reads his own messages (my guess).
- Seen: YouTube's auto-captions for "What I Actually Run in My Homelab Every Day" (2026-10-02, 12 min) contain 37 'um/uh' — 3.0 a minute; the densest minute starts at 7:08 (9 of them).
- Cut this: A 45–60 s before/after of "What I Actually Run in My Homelab Every Day" starting at 7:08: fillers and restarts cut, pauses closed, word-by-word captions on the 'after'. Video: https://www.youtube.com/watch?v=xGKKf6iKM0g (2026-10-02)
- Reach: site linked on the channel: bsky.app/profile/techdox.nz; business email on the YouTube About tab ("Sign in to see email address")

**7. Sarvin Style Coding** — https://www.youtube.com/@sarvinStyleCoding — 73.6K subscribers

- Why: 73.6K subscribers, 30-minute builds, no Short since 2024. The gap is clips more than cleanup.
- Seen: YouTube's auto-captions for "Build a Smarter AI Chatbot with Python | Memory, Streaming & Tokens" (2026-10-03, 36 min) contain 84 'um/uh' — 2.3 a minute; the densest minute starts at 4:55 (7 of them); the newest Short is dated 2024-04-07 while 8 long videos/streams went up in the last 60 days.
- Cut this: A 45–60 s before/after of "Build a Smarter AI Chatbot with Python | Memory, Streaming & Tokens" starting at 4:55: fillers and restarts cut, pauses closed, word-by-word captions on the 'after'; plus one vertical Short from the same video. Video: https://www.youtube.com/watch?v=F4xn2GUVr84 (2026-10-03)
- Reach: site linked on the channel: sarvinstyle.ir; business email on the YouTube About tab ("Sign in to see email address")

**8. No place like localhost** — https://www.youtube.com/@NoPlaceLikeLocalhost — 12.3K subscribers

- Why: 28 videos in 60 days, 5.9 fillers a minute, and an empty Shorts tab. High volume is where an editor saves the most time.
- Seen: YouTube's auto-captions for "Building custom MCP tools with local AI" (2026-10-05, 21 min) contain 127 'um/uh' — 5.9 a minute; the densest minute starts at 16:44 (18 of them); the Shorts tab is empty while 28 long videos/streams went up in the last 60 days.
- Cut this: A 45–60 s before/after of "Building custom MCP tools with local AI" starting at 16:44: fillers and restarts cut, pauses closed, word-by-word captions on the 'after'; plus one vertical Short from the same video. Video: https://www.youtube.com/watch?v=2UZAWTzzZxQ (2026-10-05)
- Reach: YouTube About tab

**9. Dan Vega** — https://www.youtube.com/@DanVega — 93.8K subscribers

- Why: A Java and Spring teacher whose live-migration video carries 4.2 fillers a minute. Some graphics are already added, so pitch speed and polish.
- Seen: YouTube's auto-captions for "Spring Boot 3 to 4 Migration: A Real App, Migrated Live" (2026-09-24, 30 min) contain 124 'um/uh' — 4.2 a minute; the densest minute starts at 1:55 (10 of them); no chapter timestamps in the description of "Spring Boot 4 Crash Course: VegaCon 2027" (2026-09-25, 13 min).
- Cut this: A 45–60 s before/after of "Spring Boot 3 to 4 Migration: A Real App, Migrated Live" starting at 1:55: fillers and restarts cut, pauses closed, word-by-word captions on the 'after'. Video: https://www.youtube.com/watch?v=HiPkoGTeNJc (2026-09-24)
- Reach: site linked on the channel: danvega.dev; public profile linked on the channel: twitter.com/therealdanvega; business email on the YouTube About tab ("Sign in to see email address")

**10. Code With Cypert** — https://www.youtube.com/@CodeWithCypert — 9.89K subscribers

- Why: Small, but mentions sponsors, and the 69-minute video has no chapters and long quiet stretches.
- Seen: YouTube's auto-captions for "Zig 0.17 Release Notes - TLDR Highlights" (2026-10-04, 8 min) contain 36 'um/uh' — 4.4 a minute; the densest minute starts at 0:21 (9 of them); caption word-timings for "Mojo: First Impressions - Is this the next Python?" (2026-09-08, 69 min) show 21 stretches of 5 s or more with no speech, 2:57 in total — the longest 27 s at 13:53, then 18 s at 13:12; no chapter timestamps in the description of "Mojo: First Impressions - Is this the next Python?" (2026-09-08, 69 min); in the one storyboard sheet viewed (25 thumbnails, about 2 minutes mid-video) the screen stays full-frame at one scale — no zoom-in on the code or UI visible in that span.
- Cut this: A 45–60 s before/after of "Zig 0.17 Release Notes - TLDR Highlights" starting at 0:21: fillers and restarts cut, pauses closed, word-by-word captions on the 'after'; plus one vertical Short from the same video. Video: https://www.youtube.com/watch?v=yWZxuZoH3j0 (2026-10-04)
- Reach: site linked on the channel: bradcypert.com; public profile linked on the channel: twitter.com/bradcypert; business email on the YouTube About tab ("Sign in to see email address")

**11. Neural Breakdown with AVB** — https://www.youtube.com/@avb_fj — 37.1K subscribers

- Why: **India.** A 4.7-hour live-coding stream, 8 fillers a minute, newest Short dated January, Patreon, and an email he publishes.
- Seen: YouTube's auto-captions for "Live coding Jev from Scratch | Understanding Qwen architecture" (2026-09-26, 4.7 h) contain 2290 'um/uh' — 8.0 a minute; the densest minute starts at 34:51 (20 of them); caption word-timings for "Live coding Jev from Scratch | Understanding Qwen architecture" (2026-09-26, 4.7 h) show 58 stretches of 5 s or more with no speech, 12:30 in total — the longest 194 s at 2:28:35, then 100 s at 52:03; the newest Short is dated 2026-01-06 while 11 long videos/streams went up in the last 60 days; in the one storyboard sheet viewed (25 thumbnails, about 4 minutes mid-video) the screen stays full-frame at one scale — no zoom-in on the code or UI visible in that span.
- Cut this: A 45–60 s before/after of "Live coding Jev from Scratch | Understanding Qwen architecture" starting at 34:51: fillers and restarts cut, pauses closed, word-by-word captions on the 'after'; plus one vertical Short from the same video. Video: https://www.youtube.com/watch?v=AzxoU7kxjig (2026-09-26)
- Reach: email published in the channel description: neural.avb@gmail.com; site linked on the channel: paperbreakdown.com; public profile linked on the channel: x.com/neural_avb

**12. Dhruvin Shah** — https://www.youtube.com/@iamdhruvinshah — 69.9K subscribers

- Why: **India.** 69.9K subscribers, sells training, 3.2 fillers a minute. Already posts Shorts, so pitch the long-form cleanup.
- Seen: YouTube's auto-captions for "Build Power Automate Flows with Claude Code | FlowAgent MCP Setup 2026" (2026-10-04, 20 min) contain 63 'um/uh' — 3.2 a minute; the densest minute starts at 1:17 (11 of them).
- Cut this: A 45–60 s before/after of "Build Power Automate Flows with Claude Code | FlowAgent MCP Setup 2026" starting at 1:17: fillers and restarts cut, pauses closed, word-by-word captions on the 'after'. Video: https://www.youtube.com/watch?v=2rDP8Ohm0ZA (2026-10-04)
- Reach: site linked on the channel: powerplatformtrainings.com; public profile linked on the channel: twitter.com/DhruvinShah16, linkedin.com/in/dhruvin-shah-powerplatform; business email on the YouTube About tab ("Sign in to see email address")

**13. Cloud Quick Labs** — https://www.youtube.com/@cloudquicklabs — 22.5K subscribers

- Why: **India.** Eleven videos in 60 days, no chapters, 2.9 fillers a minute, and a full-screen console at one scale in the thumbnails seen.
- Seen: YouTube's auto-captions for "Migrate Azure DevOps Pipeline to GitHub Actions | Complete CI/CD Migration Demo" (2026-10-04, 26 min) contain 75 'um/uh' — 2.9 a minute; the densest minute starts at 5:07 (7 of them); no chapter timestamps in the description of "Migrate Azure DevOps Pipeline to GitHub Actions | Complete CI/CD Migration Demo" (2026-10-04, 26 min) — nor in the other recent long video checked; in the one storyboard sheet viewed (25 thumbnails, about 4 minutes mid-video) the screen stays full-frame at one scale — no zoom-in on the code or UI visible in that span.
- Cut this: A 45–60 s before/after of "Migrate Azure DevOps Pipeline to GitHub Actions | Complete CI/CD Migration Demo" starting at 5:07: fillers and restarts cut, pauses closed, word-by-word captions on the 'after'. Video: https://www.youtube.com/watch?v=aHfonaGgNus (2026-10-04)
- Reach: site linked on the channel: sylvaera.com; public profile linked on the channel: linkedin.com/in/rekhu-chinnarathod-58b3a860; business email on the YouTube About tab ("Sign in to see email address")

**14. Sriniously** — https://www.youtube.com/@sriniously — 85.7K subscribers

- Why: **India.** 85.7K subscribers, lectures of 84 and 108 minutes, and an empty Shorts tab. The pitch is clips only.
- Seen: The Shorts tab is empty while 15 long videos/streams went up in the last 60 days.
- Cut this: 3 vertical Shorts (30–50 s each, word-by-word captions, zoom on the screen) cut from "How an AI agent's cloud computer works". Video: https://www.youtube.com/watch?v=LmYBcGF2Lj4 (2026-10-02)
- Reach: site linked on the channel: sriniously.com; public profile linked on the channel: x.com/sriniously, linkedin.com/in/k-srinivas53168; business email on the YouTube About tab ("Sign in to see email address")

**15. AWS with Jaymit** — https://www.youtube.com/@AWSwithJaymit — 7.91K subscribers

- Why: **India.** 11.7 fillers a minute on a small channel. Likely a low budget (my guess); good for a first credit.
- Seen: YouTube's auto-captions for "Amazon Bedrock AgentCore Crash Course | Build Your First AI Agent (Part 1)" (2026-09-18, 23 min) contain 270 'um/uh' — 11.7 a minute; the densest minute starts at 12:43 (22 of them); no chapter timestamps in the description of "PostgreSQL for Beginners | AWS RDS Hands-On Tutorial" (2026-09-24, 24 min) — nor in the other recent long video checked; in the one storyboard sheet viewed (25 thumbnails, about 4 minutes mid-video) the screen stays full-frame at one scale — no zoom-in on the code or UI visible in that span.
- Cut this: A 45–60 s before/after of "Amazon Bedrock AgentCore Crash Course | Build Your First AI Agent (Part 1)" starting at 12:43: fillers and restarts cut, pauses closed, word-by-word captions on the 'after'. Video: https://www.youtube.com/watch?v=maRIJykPz0g (2026-09-18)
- Reach: public profile linked on the channel: linkedin.com/in/jaymitb, twitter.com/jaymitb


The other 55 are in the CSV, sorted by fit within "global" and "India".

---

## 7. The 8 application routes worth your time

Asking an agency to pass on overflow is not how any agency found takes editors. Each one that takes
outsiders does it through a form or posting, a portfolio, and usually a sample or interview. The routes
below are the real ones, in order.

1. **YT Jobs** — https://ytjobs.co/job/search/?role=video-editor. Channels post per-project work with a
   pay band; you apply from a talent profile. Sixteen editor listings on the day, none coding. Check
   daily; read each listing for a named editor.
2. **The Coding Sloth's editor post** — https://hollow-somersault-6ae.notion.site/The-Coding-Sloth-Video-Editor-1ededc94de5b80de8b65f5e656c1e12f.
   A programming channel hiring a freelancer for "long-form videos (around 8–20 minutes)", tools
   "Premiere Pro, After Effects, or DaVinci Resolve". Published 2026-07-09. Open it in a browser to find
   how to apply and whether it is still open; neither could be read.
3. **EditVisions** — https://tally.so/r/mZ4v15. An agency form that asks which "softwares used", your
   "rates per minute" and "Are you willing to do a 30s sample?" No editor is mandated. They want "clean
   animations". Undated; may be unmonitored.
4. **Gostek Media** — https://join.com/companies/wzlo. Contract, remote, reposted often. Lists "Adobe
   Premiere Pro, Final Cut Pro, and After Effects or Davinci Resolve" and requires a reel. Ask in the
   application whether a finished-file workflow is acceptable.
5. **Roster** — https://www.joinroster.co/jobs. Creator hiring board; "Roster takes no commission on
   hires". Jobs are hidden until sign-up and profiles lead with channels you have worked for, so join
   after the first client.
6. **Increditors** — https://increditors.com/careers/. Remote, contract-to-hire, a Google Form each for
   long-form and short-form, then a phone screen and "two rounds of panel interviews". Software not
   stated; ask.
7. **Upwork / Freelancer.com agency sub-editing** — where agencies recruit editors at "$5 / finished
   minute". Low pay, real volume, and credits you can name afterwards. Upwork itself was not opened.
8. **Electrify Video Partners' board** — https://electrify.teamtailor.com/jobs. Runs Fireship and The
   Rundown. **Blocked for Bay today** (Premiere and After Effects by name, shared project files, regions
   that exclude India), and no Fireship role is open. Listed so you watch it: it is what the top of this
   niche pays.

Not worth an application now: Vidchops (no careers page), Tasty Edits (no public route), Video Husky
("not currently looking for talent"), Superside and 7xContent (full-time, Adobe required).
