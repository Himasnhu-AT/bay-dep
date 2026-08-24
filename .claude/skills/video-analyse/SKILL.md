---
name: video-analyse
description: Turn a reference video into an edit template that bay can build against. Use when someone has a video they want matched, copied, or learned from — "make it look like this", "here's our last episode", "analyse this reel", "match this channel's style", "why does theirs look better than mine" — or when they have a finished cut and want to know what to fix. Emits a prompt to paste into Gemini along with the video (Gemini watches video; you do not), then turns what comes back into a template of concrete numbers the bay skill builds from.
---

# video-analyse

You cannot watch a video. Gemini can. This skill is the round trip: **you write the questions,
the user runs them, and you turn the answers into numbers a build can use.**

That division matters. A reference video is the only place the real answers live — how long a
shot is held, when a lower third arrives, how loud the bed sits under a voice. Guessing them is
how an edit comes back "close but not right" with nobody able to say why.

## The loop

1. **Ask what the video is for.** Two different jobs, two different prompts:
   - **Reference** — "make mine like this". The output is a template to build against.
   - **Critique** — "what's wrong with mine". The output is a defect list, ranked.
2. **Emit the prompt** (below). Give it as one block the user can copy, with the links or file
   names already filled in. Say plainly that they should paste it to Gemini *with the video
   attached*, and paste the whole reply back.
3. **Read the reply into a template** — `template.json`, the schema below.
4. **Build from the template, not from the transcript of the conversation.** Load the `bay`
   skill and pass it the template. Every field it fills is a decision you no longer guess.
5. **Close the loop.** Render, then run the *critique* prompt on your own output against the
   same reference. Two numbers moving in the right direction is the whole point.

## Writing the prompt

Rules that decide whether the answer is usable:

- **Demand timestamps and units.** "The cuts are fast" is unusable; "median 5.2 s, shortest 1.4 s"
  builds. Every question must name the unit it wants back — seconds, dB, percent of frame height.
- **Ask for a cut list, not a description.** A log of `timestamp | what changed | why` for the
  first few minutes is worth more than any amount of prose about pacing.
- **Ask for the rule, not just the instances.** After the log, ask *when* they cut wide, *when*
  they hold. That is the part that generalises to footage Gemini has not seen.
- **Ask what would look wrong.** "Name the five things that would read as off-brand" surfaces
  the constraints nobody writes down, and it is the section that most often changes a build.
- **Make it say when it cannot tell.** Loudness in LUFS from a YouTube link is a guess; a
  confident wrong number is worse than an admitted gap. Require an explicit `uncertain` list.
- **One video per prompt.** Two videos in one prompt come back averaged.

Cover, in this order, and only what the deliverable needs: opening seconds · shot grammar and a
cut list · on-screen type (exact strings, position as % of frame, timing) · colour · audio ·
motion and effects · and for vertical, the crop strategy and caption style. Finish by asking for
a one-page style sheet and the off-brand list.

## The template

What you write after reading the reply. Values are examples of *shape*, not defaults — every one
comes from the video.

```json
{
  "source": { "url": "...", "duration": "...", "analysed": "..." },
  "format":  { "aspect": "...", "frameRate": "...", "delivery": "..." },
  "opening": { "coldOpen": true, "titleCard": false, "firstCutSeconds": null },
  "shots":   { "angles": [], "medianSeconds": null, "shortestSeconds": null,
               "wideRule": "", "interjectionRule": "" },
  "cutList": [ { "at": "", "angle": "", "why": "" } ],
  "type":    { "lowerThirds": [ { "line1": "", "line2": "", "inAfterSeconds": null,
                                  "holdSeconds": null, "animation": "" } ],
               "position": "", "faceNotes": "" },
  "colour":  { "look": "", "shadows": "", "highlights": "", "skin": "" },
  "audio":   { "integratedLufs": null, "truePeakDb": null, "bed": "", "roomNotes": "" },
  "motion":  { "punchIns": [], "transitions": "" },
  "vertical":{ "crop": "", "captionStyle": "", "captionPosition": "" },
  "offBrand": [],
  "uncertain": []
}
```

**Rules for filling it in.** Leave a field `null` rather than inventing it — a null is a question
you can still ask, and a wrong number is one nobody will re-check. Anything in `uncertain`
belongs in `null`, not in the field. Copy on-screen text **exactly**, including spelling that
looks wrong: it is a name more often than it is a typo.

## Handing it to bay

The template maps onto the build, not onto prose:

| Template | What it decides |
|---|---|
| `format.frameRate` | `project_create` — pass the numerator **and** denominator, never a rounded whole number |
| `type.faceNotes` | the kit: check the families resolve before committing one |
| `shots.medianSeconds`, `shots.wideRule` | the switching rules, and what you check the result against afterwards |
| `type.lowerThirds[].inAfterSeconds` | when each name appears, measured from when that person starts speaking |
| `colour.*` | which look, and how much of it |
| `audio.integratedLufs`, `truePeakDb` | the render's loudness target — then verify the rendered file, not the setting |
| `offBrand` | the list to re-read before you call it finished |

**Where the reference and the brief disagree, the brief wins** — say which you followed and why.
A house style is evidence of what they have done, not instruction for what they want next.

## When NOT to use this

- **You have the source files.** Probe them. A measurement off the master beats an estimate off
  a compressed upload every time — use this for *taste*, not for specs you can read directly.
- **The user wants something new.** A reference is a floor, not a ceiling, and matching one is
  the wrong goal when they asked to be surprised.
