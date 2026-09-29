# Lessons from "The prompt behind Claude's music video"

Source: `~/Downloads/claude-animation-prompt.pdf` (by @thesakshamnagar). It reproduces @donaldjewkes's
prompt for a 2:21 music video that Claude (Opus 5.5) made in about 12 hours, and adds a shorter starter
version. The prompt and video belong to @donaldjewkes. This note keeps only what transfers to bay.

## What made it work

**A studio, not a prompt.** Claude had:
- the song, and an earlier JavaScript version of the video (`JohnHeibel/PDoomVideo`) as a starting repo
- image generation (fal), video generation (Seedance 2.5) and sound (ElevenLabs)
- a folder of past work and a compendium of motion references

The prompt is only the brief; the tools and references carry the rest.

**Plan before animating.** The starter prompt says: "write a shot list: for every lyric line, what we see,
where the lyric text sits on screen and how big it is". Then "pick one coherent visual style and write it
down as a short style sheet (palette, textures, typography, character look) before making anything".

**The hook is huge text.** "Keep the opening 5 seconds especially bold, with big on-screen lyrics as the
hook."

**Text is composed into the shot.**
- "where we want to have lyrics be really big and really present, so the background can be less busy
  there, and you can position the characters perhaps on the right as lyrics appear on the left".
- "Have some variance": sometimes subtitle-like, sometimes huge.

**Generate a base, then draw over it.** Generated video is "a strong foundation of a base" for
JavaScript animation drawn on top, "like that animation technique where you shoot first in traditional
film and then draw over top of it".

**Verification loops.**
- "build out the right verification loops … confirm that the audio is properly synced up".
- "watch the entire video multiple times, take screenshots at individual parts, and think about if
  something is really up to the bar".
- "Tell me what you changed after each review pass."

**Rigour against jarring cuts.** "Sometimes when things cohere together, it can be jarring or abrasive
because the thought work has not been done beforehand … be really rigorous in planning of composition
and timing."

**Anti-slop taste direction.** "I don't want you to produce something that is GPT slop … I wouldn't fit
too heavily to Pixar … anchor to visual references that people will be able to understand."

## What we changed in bay because of it

- The `launch-film` skill (`src/shared/skills.ts`) now starts by writing a **style sheet and a shot
  list**: each beat's seconds, footage, camera move, on-screen text, and where that text sits and how
  big it is.
- It asks for **huge text over moving product in the first 2 s**, and **varied text size** (huge for the
  hook and payoff, subtitle-like elsewhere) that keeps busy picture clear.
- It ends with **two review passes** (stills per shot, then a full `frame_grid`), listing the changes made
  in each pass.

## Applying it to the RedAssay Attest film (v3)

Findings in v2 that the PDF would have caught:
- UI first appears at 7.3 s: two black cards open the film.
- Text is always centred on black, never composed against the picture.
- The cursor is too small to read.
- There was one review pass.

v3 brief direction:
1. Open on the tilted, moving dashboard with the hook line **huge on the left third**, UI on the right.
2. Write a style sheet and shot list first.
3. Mix full-bleed kinetic words with subtitle-size captions set against the UI.
4. Add a click-ring overlay.
5. Review twice.

Pair it with `perry-film-motion.md` for the text technique.
