# Editing video with bay

bay is a video editor whose project model is exposed to you directly. Everything you do lands in
the same document a person is looking at, undoably, and they see it happen. There is no separate
"agent mode" — you are editing their timeline.

## The model, in four sentences

An **asset** is a thing you imported: a video, an image, a sound, a piece of text, an HTML
composition. An **item** is one placement of an asset on a timeline — where it starts, how long
it runs, and which part of the source it reads. One asset backs many items, so trimming or moving
a clip never touches the media behind it. A **track** stacks items: later video tracks draw over
earlier ones, and audio tracks mix in parallel.

That split decides which tool changes what. `edit_item` changes one placement: its timing,
position, look, and text styling. `edit_asset` changes the asset, and so every placement at once —
which is only two things: its name, and for a text asset the words it draws. Fixing a typo in a
title with `edit_asset` fixes it everywhere that title appears; the result's `usedBy` lists every
item the change reached. Duration, size and frame rate were measured from the file and are not
settable at all.

## Time is frames. Always.

Every time you give a tool is a **frame index at the timeline's own rate**, never seconds. A
30fps timeline's frame 90 is three seconds in; a 24fps timeline's frame 90 is three and three
quarter seconds in. `read_project` tells you the rate.

The one exception is where you read *into a source*: `sourceStartSeconds` on `edit_item` is in
seconds, because a source has its own frame rate that the timeline does not control. Read it back
with `inspect_item`, which reports `sourceStartSeconds` and `sourceRemainingSeconds` in the same
unit you set them.

## Start by looking

bay opens on a projects screen with no project open, and while it shows, every tool but
`list_projects` and `open_project` is refused — `read_project` included — with a message saying
so. `list_projects` gives the file paths; open the one the user means with `open_project`, or ask
which. Once a project is open, bring new files into its media pool with `import_media`, by
absolute path, and check each returned asset's `error` before placing it.

Call `read_project` first, every time. It gives you the timeline id, the rate, the tracks, and
every item with its id. Item ids are not guessable and not stable across sessions — copy them
from what you just read, never invent one. You may pass the first 10 characters of an id; if that
is ambiguous the refusal names the candidates.

`preview_frame` renders one frame and hands it back as an image. **Use it.** It is the only way
you can see what you have made, and it is the difference between reporting that a cut works and
knowing it does. Render a frame either side of every cut you make. `set_playhead` to where you
are working, so the user's view follows yours.

## What `preview_frame` cannot see

It is one still, and it is honest about some of its limits and silent about others. Before you
tell the user an edit is right, know which question the picture actually answered.

- **Sound.** It renders pictures only. A cut in the middle of a word, a music bed at the wrong
  level, a clip that should be muted — none of it is in the image. Judge audio from the
  words — `transcribe` reads a clip's speech on this Mac with whisper.cpp and gives each line
  its timing — the volumes in `inspect_item`, or by asking.
- **Motion.** One frame cannot show a jump cut's jolt, a dissolve that runs too long, an animation
  that stutters, or a clip playing at the wrong speed. Render frames either side of a change, and
  say that you checked stills rather than playback.
- **Anything outside that frame.** A frame is evidence about itself. A caption correct at frame 75
  can overflow at frame 90 when the line changes; a clip framed well at its start can drift out of
  frame by its end.
- **The wrong typeface.** A substituted font looks deliberate. The result reports it under
  `textWarnings` (`the requested font is not installed`), along with text shrunk to fit or cut
  off — read those, because the picture will not show them.
- **Work still in progress.** A composition still rendering or media still loading is left out of
  the picture, and the result says `incomplete: true` with the items it is missing. Do not judge
  that frame; call again in a moment.
- **Exact colour.** The image is a JPEG. It is fine for "is the grade warmer" and wrong for "is
  this exactly `#11D1A0`" — read the values back from `inspect_item` instead.
- **Fine detail.** The image is at most 640 pixels on its long edge, so a 1080p frame is shrunk to
  a third. Hairline strokes, small type and one-pixel misalignments may not survive; the result
  reports `canvas` beside the image size so you can scale positions yourself.

## Removing things: two different operations

`delete_items` removes whole clips. With `ripple: true` it closes the gap on the tracks it
removed from — and desynchronises every other track, which it will tell you it did.

`remove_range` removes a **span of time** across every unlocked track at once, splitting whatever
straddles the bounds. This is the one you want for cutting a recording: it can take the middle
out of a single long take, which `delete_items` cannot express at all, and it cannot put picture
and sound out of step because every track moves by the same number of frames. `fromFrame` is the
first frame removed and `toFrame` is the first frame kept, so two calls sharing a bound remove
exactly the union.

If a locked track holds content after the cut, the result names it under `desyncedTracks` with
how many frames adrift it now is. That is not a warning to skim — say so, or fix it.

## Refining a cut: slip, slide and roll

`edit_item` moves one edge of one clip. `trim_item` does the three trims that change *what plays*
without changing how long the program is, and each keeps a different thing still:

- **slip** — the clip stays where it is; it shows a different part of its source. Positive
  `deltaFrames` shows later footage.
- **slide** — the clip moves with its content unchanged, and the clips either side absorb it: the
  one before lengthens or shortens at its out-point, the one after at its in-point. Nothing
  downstream shifts. A gap on one side absorbs the move up to its size. A clip touching nothing on
  either side cannot slide — that is a plain move, so use `edit_item` `from`.
- **roll** — the cut between two abutting clips moves: the outgoing clip ends later and the
  incoming starts later by the same amount. `edge: "start"` rolls the cut before the clip instead
  of the one after it.

All three spend footage beyond the clips' visible range, and a clip must keep at least one frame.
When a move does not fit, the call is **refused, never clamped**, and the refusal gives the legal
`deltaFrames` range and which clip ran out. Pass `deltaFrames: 0` to ask for the range without
changing anything.

A transition stays on its cut through all three, because every cut that existed still exists. What
can change is how much footage each side has left to spend on it; the result's `transitions` and
`warnings` say when a dissolve is now shorter than you asked for.

## Captions

`add_captions` places a whole set of timed lines in one call: each cue becomes a text item on a
**new** video track above every other, so the captions draw over the picture and can be hidden
or deleted as one track. Pass either `cues` — `[{ fromFrame, toFrame, text }]` in timeline
frames, for lines you timed yourself — or `srt`, the text of an SRT or WebVTT file (or
`@./captions.srt`), which bay converts from wall clock at the timeline's rate. `offsetFrames`
shifts the lot, for captions of a clip that starts partway in.

With no transcript or subtitle file, make the cues: `transcribe` with the clip's `itemId` runs
whisper.cpp locally (nothing is uploaded) and returns cues already in timeline frames, shifted and
clipped to what the clip plays — pass them straight to `add_captions` as `cues`, no offset. The
first run on a Mac with no speech model downloads one (~150 MB) unless the user turned that off in
Settings; if whisper.cpp or a model is missing, the error says what the user must do there. Pass
that on — never invent the words.

Cues share one track, so they may not overlap. An overlap refuses the **whole** call, naming both
cues (by position, and by line for a file) and the frame that would fix it; nothing is placed.
Lines overlapping by less than a frame round onto the same frame and are accepted. Markup such as
`<i>` is stripped, because a caption draws in one style.

The look is white on a translucent plate in the lower third, sized to the frame; `style` takes the
same fields as `edit_item` `text` and applies them to every caption. Afterwards each caption is an
ordinary text item: restyle one with `edit_item`, and reword a line everywhere it repeats with
`edit_asset` — identical lines share one text asset.

## Markers are notes in time

`add_marker` puts a labelled flag on the timeline at a frame (the playhead if you omit it), and
`read_project` returns every marker on every later call, in frame order. Use them to remember
what you found before you act on it — the laugh, the chapter break, the cut to check — and to
leave the user points to review. They show on the ruler; the user adds one with `M`.

A marker belongs to the program, not to a clip, so moving or replacing clips leaves it alone.
It moves only when time itself does: `remove_range` slides markers after the cut up with the
footage, and one inside the removed span lands on the cut rather than vanishing. `remove_marker`
takes one away.

## Cutting to music

`detect_beats` with the music's `itemId` finds its tempo, every beat, the first beat of each bar
(`downbeats`) and where it drops out — all in timeline frames for that clip, so a beat is a frame
you can pass straight to `split_at`, `trim_item`, `place_asset` or `edit_item`. It runs on this Mac
and is kept on the file, so asking again is free. Land ordinary cuts on beats and the big ones on
downbeats; `framesPerBeat` tells you how far a nudge of one beat is. A drop-out of kind
`percussion` starts on the first beat the drums *do not* play — that frame is "the drop", where a
reveal lands; `silence` is where the level itself falls away.

`markers: "downbeats"` (or `"beats"`) also returns a list ready for `add_marker`'s `markers`, which
places them all in one undo step so the user can see the grid. Once a file has been analysed, a
drag or trim in the timeline snaps to its beats and to every marker.

`downbeats` is empty when no beat of the bar is clearly accented; do not invent one. Low
`confidence` (under ~0.3) means there is no steady beat — say so rather than cutting to a guess.
The tempo can come back at half or double what a musician would count when the eighth notes are
played as hard as the beats; if the user names a tempo, check `bpm` against it.

## Many clips at once: the script

When an edit touches many clips — tightening a whole cut, reordering shots, rewording every
title — call `read_script`, edit the markdown it returns, and hand it back to `apply_script`. bay
applies the difference as one undo step and returns what changed. Deleting, reordering, moving,
trimming, slipping and retitling are supported; anything else is refused with its line number.
The format and the exact rules are in `bay://guide/script`.

## Transitions belong to the cut, not the clip

`add_transition` joins two clips that already abut. A transition needs footage on **both** sides
of the cut to play: the outgoing clip keeps running a little past its out point and the incoming
starts a little early, so both need source beyond the visible edit. That spare footage is called
a handle.

Omit `durationInFrames` and bay picks about a second, or the most the handles allow. Every result
carries `maxDurationInFrames`, so you learn the ceiling without having to violate it. If what you
asked for did not fit, the result says which side ran out of footage, in a sentence you can
repeat to the user.

Seven kinds: `cross-dissolve`, `dip-to-black`, `dip-to-white`, `wipe`, `push`, `slide`, `iris`.
The dips pass through solid colour at the midpoint; the rest cross-fade. Audio follows the
picture, except on a dip, where both sides go silent at the middle because that is what a dip
means.

## Sound: J/L cuts and ducking

`edit_item` `audioLeadFrames` is a J-cut: the clip's sound starts that many frames before its
picture, reading footage from before its in-point — the next shot's sound arriving under the
current one (15 frames at 30 fps is a common half second). `audioTrailFrames` is the L-cut, the
sound running on past the picture. Both spend handles like a transition does, are clamped to the
footage there is, and are set aside on a cut that already has a transition; the result says when
either happens, with the numbers. Fades apply to the sound's own edges, so give a lead 3–4 frames
of `fadeInFrames` or it clicks in under the previous shot.

`duck: { keyTrackId, amountDb, attackFrames, releaseFrames }` pulls a clip down under another
track — the music bed under the dialogue track. It follows the key track's clips being *present*,
not their loudness, so the preview and the export duck identically; the dip is complete as the
key starts and a pause inside a dialogue clip stays ducked. 6 dB is light, 12 firm.

## Animation: keyframes

`edit_item` `keyframes: { property: [{ frame, value, ease? }] }` animates opacity, left, top,
width, height, rotation, `scale` (a zoom about the centre) and volume. A keyed property takes its
value from its keys at every frame — its static field no longer draws, and setting it while keys
exist is warned about. **`frame` is item-relative**: 0 is the clip's first frame, `durationInFrames`
its end; for timeline frame T use `T - from`. The result's `animation` reads each property back
in timeline frames, so check it there.

- Push in 4% over a 150-frame clip: `{ scale: [{ frame: 0, value: 1 }, { frame: 150, value: 1.04 }] }`.
- Fade a title up over half a second: `{ opacity: [{ frame: 0, value: 0 }, { frame: 15, value: 1 }] }`.
- Ride the music down to −12 dB from 0:10 to 0:14 (clip at 0, 30 fps): `{ volume: [{ frame: 285, db: 0 },
  { frame: 300, db: -12 }, { frame: 420, db: -12 }, { frame: 435, db: 0 }] }` — volume keys take `db`.

`ease` shapes the segment *from* that key to the next: `linear` (default), `hold`, `in`, `out`,
`inOut`, or a cubic-bezier `[x1, y1, x2, y2]`. Each property you name is replaced whole; `null`
removes it, `keyframes: null` removes all. Keys move with the clip; trimming its head keeps them on
the same footage; `split_at` and `remove_range` divide them so each piece animates exactly as the
whole did; speed and slip leave them where they are. Fades, transitions and ducking still multiply
on top of an animated opacity or volume.

## Looks

`edit_item` carries `adjustments` (brightness, contrast, saturate, hueRotate, blur, grayscale,
sepia, invert) and `blendMode` (fifteen of them). Fields merge, so setting `saturate` leaves a
previously set `blur` alone. Out-of-range values are refused rather than clamped, because a clamp
reads back as the number you asked for having been accepted.

Two things the result will warn you about, because neither is visible from the numbers: setting
every adjustment to its identity value (it is stored and changes nothing), and a blend mode on
the lowest video track (there is nothing beneath it, so every mode looks the same).

## Colour grade

`adjustments` are CSS filters; a real grade is `edit_item { grade }`, drawn by the GPU through the
same compositor as preview, `preview_frame` and export — what `preview_frame` shows is what the
file gets. It runs in a fixed order: temperature/tint → lift/gamma/gain → saturation → curves →
LUT → halation → vignette → grain. Fields merge; `null` removes the grade or any one group.

    edit_item { itemId, grade: {
      lift: { r: 0.01, g: 0.015, b: 0.03 },          # teal shadows: small numbers, ±0.03 is visible
      gain: { r: 0.02, g: -0.008, b: -0.012 },       # amber highlights
      temperature: 200, saturation: 0.95,             # ~200 K warmer
      curves: { master: [[0, 0.04], [0.8, 0.795], [1, 0.965]] },   # lifted blacks, soft shoulder
      halation: { amount: 0.18, threshold: 0.86, radius: 10 },     # warm glow on practicals only
      grain: { amount: 0.12, size: 1 }, vignette: { amount: 0.2 } } }

- **Curves** are ffmpeg's: per channel, then master, points `[input, output]` in 0..1. Leave out an
  end and `(0,0)`/`(1,1)` are supplied. An ffmpeg `curves=r='0/0.036 0.25/0.25'` ports as
  `r: [[0, 0.036], [0.25, 0.25]]`.
- **LUTs**: `import_media` a `.cube` file — it comes back `kind: "lut"`, not placeable — then
  `grade: { lut: { assetId, intensity } }`. A malformed file imports with `error` naming the line.
- **Halation** is screened in RGB and tinted warm (`color`, default `#FF8C40`); keep `threshold`
  around 0.85 so skin and mid-tones never glow. **Grain** is animated per frame and deterministic,
  drawn at output resolution. Both are measured in timeline pixels.
- Grades apply to picture clips only (video, image, gif, html, brf) — text is refused. An all-neutral
  grade is stored, warned about, and costs nothing. `inspect_item` reports `grade` and `gradeActive`;
  `preview_frame` reports `gradeWarnings` if a grade could not run (a missing LUT asset, no WebGL2).

## HTML compositions

bay renders HyperFrames compositions as clips. Write an HTML file whose root carries
`data-composition-id`, `data-duration` in seconds, and an explicit pixel size, and which registers
one **paused** GSAP timeline at `window.__timelines["<that id>"]`. bay seeks that timeline and
photographs the result, so the picture must be a function of time and nothing else.

Read the composition resources beside this one before writing one, and check what you wrote with
`read_composition` before placing it — it lists every fault, including the ones that still
render. The rules that bite are
collected there, but three are worth repeating here because each renders as a *wrong picture*
rather than an error:

- **Nothing may reach the network.** bay blocks remote origins with no message on the page, so a
  CDN script tag renders as a still frame and a remote font silently substitutes. Vendor
  everything next to the composition and reference it by relative path.
- **The root must have an explicit width and height in pixels**, or it collapses and you get an
  empty frame.
- **`data-duration` is seconds.** `data-duration="5000"` is not five seconds.

`remove_range`, transitions, adjustments and blend modes all work on a composition clip exactly
as they do on video.

## Exporting

`export_timeline` renders the timeline to a file and returns a job id at once; poll
`track_export` on a sensible interval until it reports the output path. Check that result before
telling the user it is done. `complete: false` means some frames of the file are wrong: written
before a graphic on them (a `.brf`, a composition) had rendered, or with a clip whose grade could
not be applied. The `warning` names the frames and what is wrong on them, and
`incompleteFrames.items` / `incompleteFrames.gradeIssues` list each with its frame ranges. That
file is not correct: follow the warning (export again, or fix the grade first) rather than
reporting it.

`loudness: "streaming"` (−14 LUFS, −1 dBTP; also `"podcast"`, `"broadcast"`, or
`{ integratedLufs, truePeakDb }`) masters the audio: a linear gain and a true-peak limiter,
re-measured on the *encoded* file until it lands, because the codec moves the peaks. It is off
unless asked, so a file plays at the level the preview did. When done, `track_export` reports what
the delivered file measures; `status: "missed"` means it did not converge and says by how much.

## Errors are instructions

Every refusal from bay is written so you can act on it: it names the candidate ids, the clip you
collided with, the range that was occupied, or the number that was out of bounds. Read it and
adjust. If a refusal does not tell you what to do next, that is a bug in bay worth reporting, not
a reason to guess again.

## Things that will trip you

- **An id you did not read from bay does not exist.** Every id comes from `read_project`,
  `browse_assets` or the result of the call that created the thing.
- **`split_at` on a clip's edge does nothing**, because it would make a zero-length clip. Split
  strictly inside.
- **A locked track refuses edits.** The refusal names it; tell the user rather than working
  around it.
- **`undo` reverses one step**, and one step is one tool call — a tool that made several changes
  undoes all of them together, not the last one.
- **Placing a clip where one already is is refused**, with the occupied range in the message.
  Find free time or another track.
