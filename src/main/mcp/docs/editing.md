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

## Time is frames. Always.

Every time you give a tool is a **frame index at the timeline's own rate**, never seconds. A
30fps timeline's frame 90 is three seconds in; a 24fps timeline's frame 90 is three and three
quarter seconds in. `read_project` tells you the rate.

The one exception is where you read *into a source*: `sourceStartSeconds` on `edit_item` is in
seconds, because a source has its own frame rate that the timeline does not control. Read it back
with `inspect_item`, which reports `sourceStartSeconds` and `sourceRemainingSeconds` in the same
unit you set them.

## Start by looking

Call `read_project` first, every time. It gives you the timeline id, the rate, the tracks, and
every item with its id. Item ids are not guessable and not stable across sessions — copy them
from what you just read, never invent one. You may pass the first 10 characters of an id; if that
is ambiguous the refusal names the candidates.

`preview_frame` renders one frame and hands it back as an image. **Use it.** It is the only way
you can see what you have made, and it is the difference between reporting that a cut works and
knowing it does. Render a frame either side of every cut you make.

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

## Looks

`edit_item` carries `adjustments` (brightness, contrast, saturate, hueRotate, blur, grayscale,
sepia, invert) and `blendMode` (fifteen of them). Fields merge, so setting `saturate` leaves a
previously set `blur` alone. Out-of-range values are refused rather than clamped, because a clamp
reads back as the number you asked for having been accepted.

Two things the result will warn you about, because neither is visible from the numbers: setting
every adjustment to its identity value (it is stored and changes nothing), and a blend mode on
the lowest video track (there is nothing beneath it, so every mode looks the same).

## HTML compositions

bay renders HyperFrames compositions as clips. Write an HTML file whose root carries
`data-composition-id`, `data-duration` in seconds, and an explicit pixel size, and which registers
one **paused** GSAP timeline at `window.__timelines["<that id>"]`. bay seeks that timeline and
photographs the result, so the picture must be a function of time and nothing else.

Read the composition resources beside this one before writing one. The rules that bite are
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

## Errors are instructions

Every refusal from bay is written so you can act on it: it names the candidate ids, the clip you
collided with, the range that was occupied, or the number that was out of bounds. Read it and
adjust. If a refusal does not tell you what to do next, that is a bug in bay worth reporting, not
a reason to guess again.

## Things that will trip you

- **An id you did not read from bay does not exist.** Every id comes from `read_project`,
  `browse_assets` or the result of the call that created the thing.
- **Splitting on a clip's edge does nothing**, because it would make a zero-length clip. Split
  strictly inside.
- **A locked track refuses edits.** The refusal names it; tell the user rather than working
  around it.
- **`undo` reverses one step**, and one step is one tool call — a tool that made several changes
  undoes all of them together, not the last one.
- **Placing a clip where one already is is refused**, with the occupied range in the message.
  Find free time or another track.
