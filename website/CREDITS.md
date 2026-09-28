# Credits

Third-party material the site serves, where it came from, and the terms it is used under.
Everything listed here is self-hosted in `public/`; nothing is hotlinked, and no page
requests anything from these sources.

## Footage: the home page's edit (Fig. 1 and Fig. 2)

Four clips from Pexels, downloaded on 2026-09-24. They were edited in the app (cut, trimmed,
graded, keyframed and dissolved) and are served only in that edited form, as frames in
`public/plate/` and as the "before" and "after" videos in
`public/compare/`. The "before"
video is the same four source ranges, cut to the same frames and scaled, and nothing else.

| Clip in the edit | Title on Pexels | Author | Page | File downloaded |
|---|---|---|---|---|
| `shore.mp4` | Person Walking on Beach Shore During Sunrise | Mikhail Nilov | https://www.pexels.com/video/person-walking-on-beach-shore-during-sunrise-6981405/ | `6981405-hd_1920_1080_25fps.mp4` |
| `walk.mp4` | Man Walking on Beach during Sunrise | Karma Rayshar | https://www.pexels.com/video/man-walking-on-beach-during-sunrise-10325661/ | `10325661-hd_1920_1080_30fps.mp4` (1280×720) |
| `rocks.mp4` | Waves Crashing To The Rocks | Elia Clerici | https://www.pexels.com/video/waves-crashing-to-the-rocks-2053565/ | `2053565-hd_1920_1080_24fps.mp4` |
| `topview.mp4` | Top View of Ocean Waves Crashing on Beach Shore | Eduardo Cano Photo Co. | https://www.pexels.com/video/top-view-of-ocean-waves-crashing-on-beach-shore-5646564/ | `5646564-hd_1920_1080_30fps.mp4` |

**Licence: the Pexels licence**, https://www.pexels.com/license/, as it read on 2026-09-24:

- "All photos and videos on Pexels are free to use."
- "Attribution is not required. Giving credit to the photographer or Pexels is not
  necessary but always appreciated."
- "You can modify the photos and videos from Pexels. Be creative and edit them as you like."

and it does not allow: showing identifiable people in a bad light or an offensive way;
selling unaltered copies; implying that people or brands in the imagery endorse a product;
redistributing the material on other stock or wallpaper platforms; or using it in a
trademark. The people in these clips are silhouettes, seen walking on a beach; the page
presents the clips as material an editor was pointed at and says nothing about them.

The site credits the authors anyway, on the home page under Fig. 2.

## Footage: /compare

Each figure on `/compare` is raw footage beside the edit the app's agent made of it. The
entries live in `src/lib/comparisons.ts` and the files in `public/compare/<slug>/`. When an
entry is marked ready, its footage and sound are listed here, one table per entry in the same
shape as the one above (title, author, page, file downloaded, licence), and the same rows are
the entry's `credits`, which the page prints under the figure.

### kinetic-type

| Title | Author | Page | File downloaded | Licence |
|---|---|---|---|---|
| James speaking West Riding Yorkshire English | Wikitongues | https://commons.wikimedia.org/wiki/File:James_speaking_West_Riding_Yorkshire_English.webm | the original `.webm` (1080×1920, 6:20); the page uses 2:34.4–2:53.0, with its sound | CC0 1.0 |

The person on camera keeps his personality and publicity rights; the page presents the clip as
material the agent was given and implies no endorsement.
The first export came out at −26.9 LUFS because the prompt didn't ask for mastering; the agent
re-exported it, unchanged, mastered to −14 LUFS, when asked in a follow-up message.

### luxury-minimal

| Title | Author | Page | File downloaded | Licence |
|---|---|---|---|---|
| Close-up view of an elegant watch | Mixkit | https://mixkit.co/free-stock-video/ (item 44070) | https://assets.mixkit.co/videos/44070/44070-1080.mp4 | Mixkit Stock Video Free License |
| Machinery of a very close watch | Mixkit | https://mixkit.co/free-stock-video/ (item 3673) | https://assets.mixkit.co/videos/3673/3673-1080.mp4 | Mixkit Stock Video Free License |
| Hands on an automatic watch | Mixkit | https://mixkit.co/free-stock-video/ (item 3672) | https://assets.mixkit.co/videos/3672/3672-1080.mp4 | Mixkit Stock Video Free License |

No music or sound: these clips have no audio stream and none was added. The agent kept brand
names out of frame (it dropped a fourth clip, item 3652, whose rotor is engraved with the
maker's name); a faint generic "…S MADE" remains at the edge of the dial in the last seconds.

### podcast-frisian

| Title | Author | Page | File downloaded | Licence |
|---|---|---|---|---|
| WIKITONGUES: Stephan and Simon speaking Frisian | Wikitongues; recorded by Guillem Belmar | https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Stephan_and_Simon_speaking_Frisian.webm | https://upload.wikimedia.org/wikipedia/commons/3/3f/WIKITONGUES-_Stephan_and_Simon_speaking_Frisian.webm | CC BY-SA 4.0 |

Share-alike: the edit (`public/compare/podcast-frisian/after.*`) is an adaptation and is
shared under CC BY-SA 4.0 too. The two speakers are private people talking about themselves;
neither they nor Wikitongues endorse bay. The lower third and credit were drawn by bay's agent.

### explainer-drawboard

| Title | Author | Page | File downloaded | Licence |
|---|---|---|---|---|
| WIKITONGUES: Musuweu speaking English and Subiya | Musuweu Theron Kolokwe / Wikitongues | https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Musuweu_speaking_English_and_Subiya.webm | https://upload.wikimedia.org/wikipedia/commons/8/85/WIKITONGUES-_Musuweu_speaking_English_and_Subiya.webm | CC BY-SA 4.0 |

Share-alike: the edit (`public/compare/explainer-drawboard/after.*`) is an adaptation and is
shared under CC BY-SA 4.0 too. The drawboard (tree, map, labels) was drawn by bay's agent from
what he says; two small captions are its paraphrase. Neither he nor Wikitongues endorses bay.

### mask-3d

| Title | Author | Page | File downloaded | Licence |
|---|---|---|---|---|
| James speaking West Riding Yorkshire English | Wikitongues | https://commons.wikimedia.org/wiki/File:James_speaking_West_Riding_Yorkshire_English.webm | the original `.webm` (1080×1920, 6:20); a different passage from kinetic-type | CC0 1.0 |

The 3D title uses bay's bundled Inter (OFL-1.1). The person on camera keeps his personality and
publicity rights; no endorsement is implied.

## Sound

The music bed (`coast-bed.m4a`) and the surf bed (`surf.m4a`) in the edit were generated
for this page with ffmpeg's `aevalsrc` and `anoisesrc` sources: an original 100 bpm pattern
and filtered noise. No third-party audio is used. The walking shot's waves are that clip's
own sound, from Pexels as above.
