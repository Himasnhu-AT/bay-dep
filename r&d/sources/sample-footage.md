# Sample footage for testing and demos

Where to get raw video that bay can edit and that we may **publish** (website comparisons, release videos).
Every licence below was read on the live page on 2026-09-27. Nothing here is downloaded into the repo, so
keep media out of git (see `../MEMORY.md` → Media policy).

**Before using any source:**
- **Government footage (NASA, DVIDS) carries no endorsement.** A product demo must say so (for example
  "NASA does not endorse bay"), and the people on camera keep their publicity rights. Use it as material,
  never as the face of an ad.
- **bay's ffmpeg decodes only some camera formats.** Run `vendor/ffmpeg/darwin-arm64/ffmpeg -decoders` to
  check. It reads EXR, ProRes, MPEG-2 (m2t/MXF/TS), DNxHD, CineForm and AV1. It **cannot** read Sony RAW,
  ARRIRAW, BRAW or R3D, which need a transcode in DaVinci Resolve (free) first.
- **Share-alike licences pass to our output.** An edit of CC BY-SA footage must itself be CC BY-SA, and
  the credit must appear next to the video.

## Top 5 for a first demo

| # | Source | Shows off in bay | Licence | Get it |
|---|---|---|---|---|
| 1 | **FOSDEM talk recordings.** Thousands of unedited English talks with the ums left in. Per talk: AV1 WebM (20–150 MB), MP4, and a VTT transcript | Pause/retake removal, word-by-word subtitles, vertical reels. The VTT is ground truth for checking our transcription | CC BY 2.0 BE; credit FOSDEM + speaker | https://video.fosdem.org/ (no account) |
| 2 | **NASA SVS Artemis II package.** Slated interviews (Nicola Fox 8:26 at 720p, Kelsey Young 8:37 at 1080p) with transcripts, plus 4:45 + 6:08 of B-roll | Keeping the best take, cutaways found by visual search, subtitles, dubbing | Public domain; add the non-endorsement line | https://svs.gsfc.nasa.gov/14934/ |
| 3 | **Pexels Apple Log set (Baran Robin, Basel)** + Apple's official LUT. Dozens of ungraded 4K ProRes Log clips | LUT, lift/gamma/gain, grain. Opens in bay with no transcode; doubles as a pile of B-roll | Pexels licence (free, no credit; no implied endorsement); the LUT needs an Apple ID | https://www.pexels.com/video/ungraded-apple-prores-log-footage-27814730/ · LUT https://download.developer.apple.com/Developer_Tools/Apple_Log_profile/AppleLogLUTsv1.zip |
| 4 | **Valkaama raw sources.** 173 GB of HDV `.m2t` from a scripted feature, organised as Scene/Shot/Take (30–460 MB per take) | Multi-take scene assembly and coverage | CC BY-SA 3.0 (our edit must be BY-SA) | FTP `valkaama.com`, user `f00f318a`, password `valkaama` (published at http://www.valkaama.com/index.php?page=sources) |
| 5 | **Mixkit** sports/dance clips + music | Beat detection and cutting on the beat | Mixkit Free License: commercial use, no attribution. **Avoid "Restricted License" items** | https://mixkit.co |

## By capability

**Talking head / interview cleanup**
- FOSDEM talks (above).
- Blender Conference talks: https://video.blender.org. BCON26 talks are CC BY-SA; skip any video whose
  licence reads "Unknown".
- NASA SVS canned interviews: https://svs.gsfc.nasa.gov/gallery/live-shots-gallery/.
- DVIDS interview packages: https://www.dvidshub.net. Public domain; free account for high-res; military
  markings must be obscured in promo use.

**Rough cut from B-roll (visual search, cut detection, highlights)**
- NASA SVS B-roll reels (slated, silent).
- Pexels creator series (one shooter, one trip).
- Coverr: https://coverr.co. Free commercial use; no AI training, no resale.
- Netflix *El Fuente*: https://opencontent.netflix.com (4K60 10-bit Y4M, CC BY 4.0; very large).

**Colour grading**
- Pexels Apple Log + Apple LUT (plays directly).
- Tears of Steel EXR plates: https://media.xiph.org/tearsofsteel/tearsofsteel-footage-exr/. 4K scene-linear
  EXR, CC BY 3.0; showcase/tutorial use only, not ads. Credit "(CC) Blender Foundation / mango.blender.org".
- Netflix *Sparks* OCF: Sony F55 RAW, 61 GB, CC BY 4.0. Transcode first.
- ASC StEM2 *The Mission*: https://dpel.aswf.io/asc-stem2/. A finished short that explicitly permits
  "software and hardware product demonstrations" with its copyright notice.

**Music-driven edits**
- Mixkit clips + music.
- Pixabay Music: https://pixabay.com/music/. Some tracks are in YouTube Content ID; keep the licence certificate.
- Incompetech: https://incompetech.com. Free with the credit line the site generates.

**Dubbing / translation**
- NASA interviews (transcripts included).
- Tears of Steel film with separate FLAC dialogue.
- FOSDEM talks.

**Narrative / multi-take**
- Valkaama.
- Tears of Steel shot plates.
- Netflix *Sparks* (3 takes).

**Archival / public domain**
- Apollo 16mm onboard films: https://archive.org/details/Apollo1116mmOnboardFilm.
- NASA Image & Video Library: https://images.nasa.gov.
- Prelinger Archives: https://archive.org/details/prelinger. Licence per film.
- Wikimedia Commons video: licence per file.

## Rejected (and why)

- **RED sample R3D**: "internal testing purposes only".
- **ARRI sample footage**: workflow evaluation only; ask digitalworkflow@arri.de before publishing.
- **Blackmagic BRAW gallery**: no licence stated.
- **EditStock**: the free projects are sold out, demos need the paid Business licence, and every work must
  show their logo.
- **RawFootage Lab**: YouTube-hosted and not rights-cleared.
- **TED**: CC BY-NC-ND, so no edits.
- **YouTube CC-BY videos**: downloading them breaks YouTube's terms.
- **AMI Meeting Corpus**: full-resolution video needs an ordered drive.
- **Netflix Meridian/Chimera/Nocturne**: finished masters only.
- **cinestudy.org**: 404.
- **Not yet checked**: Sony, Panasonic and Canon official log sample pages.

## Our own footage

- **RedAssay Attest demo takes.** 4K choreographed recordings of a working product UI, with cursor and 3D
  camera; see `../case-studies/redassay-attest/`. Recorded by us, from a demo the RedAssay team built.
  Ask them before publishing it outside bay's own material.
