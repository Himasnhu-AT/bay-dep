# Raw educational footage: a person explains, a drawboard draws it

Researched 2026-09-28 under the owner's rule of that day (`r&d/MEMORY.md`). The footage must be plain,
raw and unedited, of an ordinary person talking to camera. Nothing from an agency, company or
organisation, and no officials or politicians. The licence must allow a published derivative on a
commercial site. The target edit: the person explains a concept, the cut goes to an animated
drawboard that draws it step by step, then comes back to the person.

**Method** (the same as `raw-talking-head.md` and `raw-podcasts.md`):

- **Licence:** read live from the Commons API's `extmetadata` (LicenseShortName, LicenseUrl, Artist,
  ImageDescription).
- **Audio:** `ffprobe` on Commons' 240p VP9 transcode. The whole transcode was downloaded, because
  Commons returned HTTP 429 to repeated range reads.
- **Speech:** the **whole** clip was decoded, not just 30 s, because the passage that explains
  something is rarely at the start. `volumedetect` gives the mean level. `silencedetect` at
  −35 dB / 0.4 s over the first 30 s counts the pauses. whisper.cpp (`whisper-cli`) with bay's
  `ggml-base.bin` and `-l en` gives the quotes and timestamps.
- **Framing:** six evenly spaced frames per clip, plus the first and last frames to look for title
  cards.
- Scratch is in `/tmp/educlip-96865-1790577158`. Nothing was saved into the repo except this file.

**Main finding:** raw footage in which a private person explains a *concept* is rare under an open
licence. Almost every Commons "explained" or "how it works" video is a produced explainer (animation,
slides, voice-over) or organisation or university courseware. The usable seam is **Wikitongues**
recordings in which the speaker, unprompted, explains how their language is built or where it came
from. That is exactly the owner's "how a word's etymology branched" example, and it draws well as a
tree or word map.

**Caveats for every pick below:**

- **Wikitongues is a non-profit.** The speakers are private people talking about themselves, and the
  owner already accepted the Frisian podcast on this basis (`raw-podcasts.md` §1). An owner who reads
  "no organisation" literally loses all of them, and the knot video (§Rejects) is then the only
  fallback.
- **Share-alike:** CC BY-SA 4.0 makes the edit CC BY-SA 4.0, with credit next to the video. CC BY 3.0
  needs only the credit.
- **Personality rights** stay with the person on camera. Never imply endorsement.
- **Download from `upload.wikimedia.org` only**, never from the Wikitongues YouTube source. Pace the
  requests (HTTP 429).

## Top candidates

### 1 ★ Musuweu speaking English and Subiya

- **URL:** https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Musuweu_speaking_English_and_Subiya.webm
- **Licence (live):** "CC BY-SA 4.0" (https://creativecommons.org/licenses/by-sa/4.0). Artist:
  "Wikitongues, Musuweu Theron Kolokwe". Description: "This video was recorded by Musuweu Theron
  Kolokwe in Windhoek, Namibia, where he lives and works." Dated 2017-07-15.
- **Credit:** "Musuweu Theron Kolokwe / Wikitongues, CC BY-SA 4.0". Share-alike applies.
- **Who:** a private man, 31 by his own account, who **recorded himself**. He is not an official.
- **Duration:** 6:02 (362.5 s). English runs 0:00–4:10; after that he speaks Subiya, which whisper
  prints as "(speaking in foreign language)".
- **Resolution:** 1920×1080, horizontal. A 9:16 crop keeps him, because he sits centred.
- **Audio:** opus stereo, −19.3 dB mean. 0 pauses at −35 dB in the first 30 s, because the room tone
  sits above that threshold and he talks continuously. It is clear to the ear and to whisper.
- **Framing:** this is the owner's reference look. It is a webcam or phone selfie at his office desk:
  eye contact with the lens, a red gingham shirt, ceiling lights, filing shelves, and a hand
  gesturing into frame. It is unedited, with no title card at either end.
- **Concept:** how Namibia's languages are grouped into families. There are three groups: Bantu
  (his own language, Subiya, is related to Tonga), Khoisan (clicks) and Germanic (English, German,
  and Afrikaans, which grew out of Dutch). He also explains why Subiya is dying.
- **Best passage: 2:19–3:44 (85 s; trim to ~2:19–2:58 + 3:38–3:44 for a 45 s beat).** Whisper base
  heard:
  > [2:19] "Namibia is basically divided into three language groups. There's Bantu languages which
  > includes my own language Subiya like I said before and then there's the Khoisan languages. The
  > Khoisan languages are the ones with the click sound … [2:44] Bantus migrated from the Great Rift
  > Valley and West Africa into southern Africa. We found these people here and colonialism put us
  > together … [2:58] And then there is the European language group that was brought here by
  > colonialism. It's Germanic … English … German … [3:24] like the Dutch … eventually formed a new
  > language called Afrikaans … [3:38] So basically we have Germanic, we have the Bantu language
  > groups and we have the Khoisan language groups in Namibia."

  Whisper spelled "Subiya" as "Serbia", "Khoisan" as "Koisan", "Namibia" as "Namibe" and "Afrikaans"
  as "Africans". Give bay's agent those names, or correct the words before timing the drawboard to
  them.
- **Second passage: 1:28–1:53.** "Subia is a Bantu language. It is spoken in Botswana across the
  border. It's closely related to … Tonga, over the border in Zambia, but it's growing further and
  further apart over time." This is one branch splitting in two, and it works as a teaser for the
  big tree.
- **Why it makes a good drawboard:**
  1. Draw an outline of Namibia with a dot at Windhoek.
  2. On "three language groups", draw a root that splits into three branches.
  3. On "Bantu", grow a branch with a migration arrow from the Great Rift Valley and West Africa down
     into southern Africa. Hang Subiya on it, then Tonga beside it, drifting apart.
  4. On "Khoisan … click sound", grow the second branch with a click glyph (ǃ ǂ).
  5. On "Germanic … brought by colonialism", grow the third branch with English, German, and
     Dutch → Afrikaans as a sub-branch.
  6. On "So basically we have…", the whole tree lights up, then cut back to him.

  Every step is a noun he says aloud, so the reveals can be keyed to whisper's word times.

### 2 ★ David speaking Doric Scots and English

- **URL:** https://commons.wikimedia.org/wiki/File:WIKITONGUES-_David_speaking_Doric_Scots_and_English.webm
- **Licence (live):** "CC BY 3.0". Artist: "Wikitongues". Credit: "YouTube: WIKITONGUES: David
  speaking Doric Scots and English". Category: "Files from external sources with reviewed licenses".
  Attribution only, with no share-alike.
- **Credit:** "Wikitongues (David Campbell), CC BY 3.0".
- **Who:** David Campbell, a private man and a storyteller by trade. He is not an official. Filmed in
  Edinburgh.
- **Duration:** 6:56 (416.2 s).
- **Resolution:** 1920×1080, horizontal, one seated camera. He is centred, so a 9:16 crop works.
- **Audio:** opus stereo, **−31.9 dB mean (quiet)**, 11 pauses in the first 30 s. Master it. Whisper
  follows his English well, and the Doric storytelling at 0:21–2:35 less well.
- **Framing:** a white-haired man in a blue shirt with lilies behind him, talking to the lens. It
  looks like a still, tripod-mounted interview camera, not a phone selfie. No title card, no cuts
  seen in 8 frames.
- **Concept:** why north-east Scots (Doric) says "f" where English says "wh", and the pun that
  follows: in Doric, "fit" means both "what" and "foot".
- **Best passage: 5:27–6:27 (60 s).** Whisper base heard:
  > [5:27] "So these are two modes of speech in Scotland. I mean, the north-east is much affected by
  > the connection they have to the lands of Norway and Sweden. And for instance, the word 'what'
  > would be 'fit'. Fit is it? What's that? Far are ye gaun? Where are you going? … [5:53] a BBC
  > announcer from Aberdeen who spoke the Doric … went skiing … [6:05] 'Aye, but fit fit fits fit
  > fit?' Which translated into English is: yes, but which foot fits which ski? … Because fit is what,
  > and fit is foot in the Doric."
- **Why it makes a good drawboard:**
  1. Draw a map of Scotland's north-east with an arrow across the North Sea to Norway and Sweden.
  2. On "what would be fit", write **wh**at, strike out *wh*, and draw **f** in: what → fit. Do the
     same for where → far.
  3. On "fit is foot", write foot → fit, sharing the same "fit" node. That gives two arrows into
     one word.
  4. On the joke, build the sentence "fit fit fits fit fit" word by word, with each "fit" colour-coded
     to what / foot / fits and the English line drawn underneath.

  It is short, funny and visual, which suits a 30–45 s beat.

### 3 James speaking West Riding Yorkshire English (from `raw-talking-head.md`)

- **URL:** https://commons.wikimedia.org/wiki/File:James_speaking_West_Riding_Yorkshire_English.webm
- **Licence:** "CC0 1.0" (Wikitongues), per `raw-talking-head.md`. It was not re-read live today.
- **Who:** a private student, 22. **Duration:** 6:20. **Resolution:** 1080×1920, vertical,
  self-shot at a table.
- **Audio:** opus, −29.1 dB, 7 pauses in the first 30 s.
- **Concept:** why his dialect "drops" the h in *history*. He argues the h was never pronounced and
  was added later by re-Latinising the spelling (Latin *historia* → an h-less French/Middle English
  form → the modern re-spelt *history*).
- **Best passage: 4:47–5:18 (31 s).** Whisper base garbles it badly. It heard:
  > "…I'll tell us something about history … we didn't use the pronouncing it … they didn't use to be
  > a … h … and then we added it on later because … Latin … so there's our shape in English…"

  The words are there, but base cannot time a drawboard to them. It needs `medium` (or a hand-fixed
  transcript), and his etymology should be checked before we illustrate it.
- **Why it makes a drawboard, and why it ranks third:** the etymology branch is a picture: historia →
  istorie → history, with the h fading in. But the transcript is unreliable, and the claim needs a
  fact check before we draw it.

### 4 Louis speaking Louisiana French & English

- **URL:** https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Louis_speaking_Louisiana_French_%26_English.webm
- **Licence (live):** "CC BY 3.0". Artist: "Wikitongues" (from YouTube, licence reviewed).
- **Who:** Louis Michot, per his own words "from Lafayette, Louisiana". **Unverified:** whether he is
  the Lost Bayou Ramblers musician of that name. If so, he is a performer, not an official; the owner
  decides.
- **Duration:** 5:53. **Resolution:** 1920×1080, horizontal, a handheld close-up against a red wall.
- **Audio:** opus stereo, −9.0 dB (loud), 0 pauses.
- **Framing:** **lightly edited.** The first frame is a fade-in from dark, so the file is not fully
  raw.
- **Concept:** how French disappeared from his family in one generation and came back.
- **Best passage: 1:11–2:10.** Whisper heard: "my grandpa was the first generation to not be allowed
  to speak French. Everyone before that was French, was the first language… his parents were both
  teachers. And that's how French had its demise in Louisiana. So my dad learned French on his own.
  I learned French on my own… it was really a product of Americanization."
- **Drawboard:** a four-generation family ladder, with a French speech bubble on each rung. The
  grandpa's bubble is crossed out, and the bubbles return on dad and Louis.

### 5 Jerry speaking English and Cherokee

- **URL:** https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Jerry_speaking_English_and_Cherokee.webm
- **Licence (live):** "CC BY 3.0". Artist: "Wikitongues".
- **Who:** Jerry Wolfe (1924–2018), an Eastern Band Cherokee elder, WWII veteran and storyteller at
  the Museum of the Cherokee Indian. In 2013 the tribe gave him the honorific title "Beloved Man"
  ([Cherokee One Feather](https://theonefeather.com/2013/04/12/jerry-wolfe-named-beloved-man/),
  [Wikipedia](https://en.wikipedia.org/wiki/Jeremiah_Wolfe)). It is an honour, not an elected
  office.
- **Duration:** 9:33. **Resolution:** 1920×1080, horizontal. He is seated against a mural,
  apparently at the museum where he worked.
- **Audio:** opus stereo, −21.6 dB, 1 pause.
- **Concept:** Cherokee marks the plural at the **start** of a word; English marks it at the end.
  Tone changes meaning.
- **Best passage: 5:38–6:14.** Whisper heard: "Now, the plural is the beginning of a word… we can put
  the plural in the very beginning, the first character… that's a plural. Whereas in English, you
  know, we end up with a little [s] at the end of it."
- **Drawboard:** one Cherokee word drawn as blocks, with a prefix block sliding in at the front, beside
  an English word with an "-s" sliding in at the end.
- **Risks:** whisper mangles every Cherokee word, so the examples need a Cherokee-literate check. He
  has died, and the location links him to a museum (an organisation), so this is an owner call.

## Rejects

- **Tying off onto the middle of a rope** (Slashme, own work, CC BY-SA 4.0, 7:21, 1920×1080, −28.0 dB).
  A perfect spoken step-by-step knot explanation ("put it through the eye, make your bowline loop
  here, go through there around and back… a bowline with a bight, not a bowline on a bight", 0:00–1:10),
  but the camera shows **hands and rope only; no person talks to camera.** It is the fallback if the
  owner rules out Wikitongues, and the knot drawboard itself would be excellent.
- **Simon speaking Cumbrian** (CC BY 3.0, 3:01): the only explanation lasts 0:05–0:32 ("a mixture of
  Old Norse, Old English, various Celtic languages… Cumbric, Pictish… parallels with Norwegian"), and
  whisper garbles his name and the dialect. He is dimly lit, and for most of the clip he reads from a
  diary, looking down.
- **Daniel speaking English** (CC BY-SA 4.0): he teaches phrases, not a concept. A cherry is not a
  diagram.
- **Omar speaking English and Jamaican Patois** (CC BY 3.0, 3:56): he describes switching accents, not
  a structure. Too vague to draw.
- **Caroline speaking Gullah and English** (CC BY 3.0, 17:26): food and plantation memories. One
  small grammar point ("the children… more than one child", 6:01–6:17) is not enough.
- **Piotr speaking Silesian and English** (CC BY-SA 4.0, 3:12): whisper cannot follow the Silesian
  half, and the English half is a biography.
- **Wikitongues × AfroCrowd English clips** (Leena, Jesse, Dr Luv): recorded at an
  AfroCrowd / Whose Knowledge? event, so organisation-hosted. Not checked further.
- **Christine speaking Shetlandic** (CC BY 3.0): Christine De Luca was Edinburgh's Makar, a civic
  post, so she is out under the officials rule. It is also mostly poetry.
- **Web Science MOOC** (Renepick / Rob-nowman, CC BY-SA 3.0; "3 ways to look at the World Wide Web",
  "IP-Routing", "Zipf law"…): courseware "held at the university of Koblenz".
- **Produced explainers:** Universaldenker Physics, Improbable Matter, Electrical Guru (YouTube
  imports), simpleshow, Sprouts, Deutsche Welle, engineerguy, and Nick Parlante's "How a Hard Drive
  Works" (Stanford).
- **Official or organisation:** HPV-vaccine doctor series, the Speaker of the House of Commons, the
  White House, WMO, FSA, "Wiki Minute" (WMF), CN Banner Editor (WMF).
- **Wiki Loves Africa short demos** ("A Hausa lady explaining how a local delicacy is prepared", 46 s,
  Hausa; "Demonstrating how to iron clothes", 41 s, 320×570): too short, not English, or too low
  resolution.
- **Fitness "how to" clips** (leg press, dumbbell shoulder press): exercise demos, not a concept
  explained to camera. Not probed.
- **Internet Archive** CC searches ("whiteboard", "explained", "how to") returned YouTube re-uploads
  (`youtube-*` identifiers), RSA Animate, and "Public Domain Mark" items with no creator. That is the
  same laundering risk as `raw-talking-head.md` found.
- **Vimeo CC BY:** still not verifiable without an account (as in the earlier docs).

## Blockers and next steps

- **The owner decides on Wikitongues.** Every to-camera pick is a Wikitongues recording. If that is
  out, the knot video is the only candidate, and it has no face. Recording our own explainer (a
  selfie explaining, for example, compound interest) would then be the clean route.
- **Whisper base spells names wrong** (Subiya, Khoisan, Afrikaans). The drawboard timing still works,
  because the timestamps are right, but the labels must come from a corrected word list.
- **Horizontal sources:** all of the top two are 16:9, so a vertical /compare entry needs a 9:16
  crop. Both men sit centred.
- **Download:** Musuweu's original is 1080p. Take the 720p transcode for the edit and pace the
  requests.
