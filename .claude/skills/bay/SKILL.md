---
name: bay
description: Build and render videos with bay, a native GPU video editor driven over MCP. Use when someone wants to make a video, reel, short, explainer, infographic video, data-driven motion graphic, animated chart, title card, or subtitled clip — or says "make a video about", "turn this into a reel", "animate this data", "add narration", "burn in subtitles", "turn this SRT into a video". Composes type, shapes, images, video and audio on a real timeline, speaks scripts with Kokoro text-to-speech, and encodes MP4. Prefer bay over HTML/CSS/browser-screenshot pipelines when the output is a video file.
---

# bay

A native video editor you drive with tool calls. You build a timeline — text, shapes, images,
clips, audio — animate it, **look at rendered frames**, and encode an MP4. bay composites on the
GPU and encodes through ffmpeg. There is no browser, no HTML, no screenshot loop.

**bay owns the values; you own the decisions.** The project's kit resolves family, size, weight
and colour from the `role` and `tone` you give an element. The move registry resolves duration
and curve from the move you name. That is deliberate: an agent that picks its own sizes picks
small ones, and an agent that picks its own curves picks one. Spend your attention on what the
piece is about, what each beat says, and what carries across the seam between them.

## How you call it

bay is an MCP server. **Call its tools directly.** The tool prefix follows the name the server
was registered under — `mcp__bay__project_create`, `mcp__vii__project_create`. Look for
`project_create` in your tool list and use whatever prefix it carries; every tool named in this
skill is written bare for that reason. **The live schema is the authority on arguments** — read
the tool's own description before you call it, not a copy of it.

If no such tool exists at all, bay is not registered yet:

```bash
open -a bay                                  # or: bay --mcp   for no window
export BAY_MCP_TOKEN="$(<"$HOME/Library/Application Support/bay/mcp-token")"
claude mcp add --transport http bay http://127.0.0.1:7333/mcp \
  --header "Authorization: Bearer $BAY_MCP_TOKEN"
```

MCP servers load at session start, so a server registered now is available **next** session.
For CLI and skill installation in Claude Code, Cursor, or OpenClaw, see
[references/installation.md](references/installation.md).

**Two ways to serve, same tools, same port.** `bay` (the editor) serves agents from the window,
so your edits land in the timeline the user is watching and undo with their keystroke. `bay --mcp`
has no window — batch renders, or a machine with no display. They cannot both hold 7333, and
**never start a second server on another port**: it is an address nothing can reach. `bay --agents`
says what holds the port. A window that is already open is where your edits go — `project_info`
first, and ask before you `project_create` over someone's work.

**You can install what is missing yourself.** `runtime_status` names it and its size;
`runtime_install` fetches it and returns a job id. A render that fails for want of ffmpeg, or a
narration for want of Kokoro, is never a reason to tell the user to install something. A GPU
adapter is the one thing bay cannot provide. `render`, `narrate`, `subtitles_to_video` and
`shots_detect` return a job id — poll `job_status` until `finished`, then read `result`.
`runtime_remove` tears down only the selected component under bay's managed runtime directory;
it never removes a system ffmpeg, Python, or user media.

## The loop

1. **`project_create`** — canvas, the **kit**, and the **format**. `formats_list` says what
   bay knows and what declaring one changes: a format only ever relaxes checks, only ones it
   names a reason for, and a relaxed check still runs and still reports — as a note carrying
   that reason. Undeclared suspends nothing, which is the right answer when none of them fits. A vertical reel is portrait at 30; landscape is
   the other way up. The kit is committed to the project before anything is placed.
2. **Write the beats before the elements.** `marker_add` every beat, the turn and the payoff.
   Beats are how `check` reads the piece and how the mix is judged. See
   [references/structure.md](references/structure.md).
3. **`media_import`** — bed, footage, stills. Returns real probed durations. `shots_detect` finds
   the cuts in footage you have not watched. **No pictures of your own?** `stock_search` searches
   the open archives and orders the results by what is *in* the frame, `stock_fetch` brings one
   down, and `media_import` takes it from there. Three things about it:
   - It takes **two** strings and they want opposite things. `query` is keywords for the archive,
     which matches filenames — two or three words, and a sentence returns nothing at all.
     `describe` is what the picture should show, and the longer and more concrete the better.
   - Read `separation` before you trust the order. Near zero means nothing in the archive matches
     and you should ask a different question, not place the top hit.
   - **Look at what it picked.** It has put an East German party headquarters first for
     "Reichsbank". It proposes; you choose.

   It is also the one tool in bay that sends anything off the machine, and `stock_credits` is
   what you owe afterwards. **`kind: "audio"`** searches CC music the same way — that is where a
   bed comes from when you have none. `library_save` keeps the ones you chose under names you
   pick, and `library_collect` copies a whole collection beside a project so the piece travels as
   one folder.

   **`audio_beats`** gives a track's tempo, its first beat and every beat in seconds, so a cut
   can land *on* the music. Read `confidence` before `bpm`, and `candidates` before you commit to
   a grid that has to end on the last beat.

   **A recorded conversation is its own format** — see
   [references/multicam-podcast.md](references/multicam-podcast.md) before cutting one.
   **`silence_detect`** finds the dead air in a recorded take — the first thing anyone does to an
   interview. Its threshold is measured off the material, not typed. `keepRanges` is the shape of
   the edit. Note that **`add_video` carries no audio**: the picture and the sound are separate
   elements, so an edit made only of video clips exports silent.
4. **`add_text` / `add_shape`** with a `role` and a `tone`; **`add_image` / `add_video`** for
   anything you imported; **`add_audio`** for the bed. Images letterbox by default — pass
   **`cover: {width, height}`** to fill a rectangle of the canvas instead, and bay crops the
   source to that shape for you.
5. **`animate`** — name a registry `move`. `animate_many` runs one move across a group, staggered:
   that is the verb for kinetic type, a list, or any set that arrives together. Hand-written
   keyframes still work and are reported per channel as `off-vocabulary-motion`, so the cost of
   leaving the vocabulary scales with how far you leave it.
6. **`narrate`** — speak the script and lay word-synced captions. Returns cues and an end time.
7. **The bed and the sound.** A bed under the whole runtime ducked against the narration, and a
   sound under every significant move. Not a finishing touch — see
   [references/craft.md](references/craft.md).
8. **`check`** — then the gate below. Costs nothing, needs no GPU.
9. **`check_frames`** — the picture-level gate: frozen arrangements, anchor scale and whether the
   lower frame is alive. It needs a GPU and says `unevaluated` rather than pretending to pass.
10. **`contact_sheet` and actually Read the PNG.** With no times bay picks two reproducible,
   jittered samples per beat. Paths are resolved by the *server* process, so pass an absolute one.
11. **`render`** — it runs `check` first and refuses on an error. `timeline` dumps everything
    placed, so re-read your own work instead of keeping a parallel copy in your head.

## The gate before you render

Numbered because it is in order, and because everything numbered in this skill's history was
executed and everything narrated was approximated. `check` names the number for each; none of
these is satisfied by adding an element.

1. **`check` returns `status: clean` and an empty `skipped`.** A suite that could not run has not
   passed — install what it names and run it again.
2. **Nothing big is nearly invisible.** A large element close in tone to what is under it reads as
   a stain, not a panel: `dead-plate`. Fix with `tone`, or delete it.
3. **No container is empty.** A shape that holds nothing for a stretch reads as a failed load:
   `empty-container`. Put the marks in, or take the shape out.
4. **The first half-second carries the piece.** `no-hook` compares it against the video's own
   median. `add_text(role: "hook")` at the kit's largest tier, opaque, on frame one.
5. **Consecutive beats share an element that changed.** `broken-continuity`. Keep the id and
   `animate` it across the seam; a rebuilt beat loses its id and is a carousel card.
6. **When something arrives, something already there answers it.** `no-response`. `animate` a
   positional or scale move on an incumbent — not opacity, and not its own stagger group.
7. **Every text is on screen long enough to read.** `unreadable-dwell` does the arithmetic;
   `element_trim` fixes it.
8. **Motion comes from the registry.** `off-vocabulary-motion` lists any channel that does not.
   Several distinct moves, each doing real work — not one move everywhere, and not a rotation.
9. **`check_frames` returns `status: clean` and an empty `skipped`.** `frozen` rejects a static
   arrangement, `anchor-scale` requires one dominant visual event, and `bottom-dead` wants real
   non-caption content low in frame rather than a hairline or caption band.
10. **The mix is positional.** Narration windows must be louder than the gaps, the bed must stay
    audible in the gaps, and the loudest moment must land on the `payoff` marker you placed in
    step 2 — before any audio existed.
11. **You looked.** Read the contact sheet, then snapshot any panel that needs full-size
    inspection. Every defect worth catching is invisible to a lint and obvious in a frame.

`render({ignoreChecks: true, reason: …})` exists and stamps your reason into the file. It is a
written claim, not a suppression: fixing is nearly always cheaper than justifying.

## Non-obvious things that will bite you

- **Coordinates are fractions of the canvas.** Centre is half and half. Layers stack upward from
  the bottom one.
- **`anchorX`/`anchorY` decide which point of an element sits at `(x, y)`.** This is what makes
  charts possible: pin a bar's left edge and animating `scaleX` grows it rightward instead of
  outward from its middle.
- **Keyframe times are relative to the ELEMENT's start**, not the timeline's.
- **For text, `scale` is the box the type is laid out in**, and text draws from the box's
  top-left. Two consequences, both of which have shipped as bugs:
  - `scale` **never** changes the glyph size — only the role does. Shrinking `scale` to make a
    headline smaller narrows the box instead, and the type wraps to one character per line.
  - With `anchorY: 0.5` the *box* is centred, so a full-width box puts your first line roughly
    0.45 of the canvas **above** where you asked. Use `anchorY: 0` and treat `y` as the top of
    the text, or measure the offset once on a snapshot and subtract it.
- **Land reveals ON the cue, don't start them on one.** Passing a cue time as an animation's start
  makes the element *begin* moving there and arrive late.
- **A mask is a stencil over the canvas, not over the layer.** `mask_set` does not inherit the
  element's transform — which is exactly what makes a wipe possible: hold the mask still, move the
  element under it.
- **Only transforms are animatable** (`opacity, scale, x, y, rotation, scaleX, scaleY`, and
  `volume` on audio). Colour, blur, letter-spacing and mask geometry are one-shot state changes,
  so plan the move around what is a channel.
- **A dialogue edit ticks at every join until you smooth it.** Consecutive speech clips are
  butt-joined, and a cut in the dialogue is not a cut in the room: the noise floor and the timbre
  change between one sample and the next. There is no click to find, which is why it survives a
  listen on speakers and not headphones. `audio_smooth` crossfades every seam, and `room_tone`
  lays the room under the whole cut — the first fixes how fast you cross a join, the second what
  the two sides sound like, and an edit that only got one of them still sounds wrong.
- **Edit in place.** `element_trim`, `element_source`, `element_split`, `element_move`,
  `transform_set` and `text_update` all keep the id and the animation. Deleting and re-adding
  loses both, and the id is what continuity is measured on.

| Read | For |
|---|---|
| [references/structure.md](references/structure.md) | beats, roles, the hold, the turn, the landing |
| [references/craft.md](references/craft.md) | what a move, a kit and an asset are FOR; audio; narration |
| [references/archive-reel.md](references/archive-reel.md) | the **archive reel** — a named format: portrait, no voice, archival stills cut to a beat grid. Every number, and the six things that go wrong |
| [references/product-film.md](references/product-film.md) | the **product film** — a named format: type, shapes and rebuilt interfaces on a flat canvas, cut to music. What the genre is made of, how to build each piece, and the six things it does that bay cannot |
| [references/multicam-podcast.md](references/multicam-podcast.md) | the **multicam podcast** — a named format: two or three locked-off cameras on one conversation, a mic per speaker, an hour of it. Speaker attribution, switching rules, matching the cameras, and which of `check`'s complaints to believe |
| [references/tools.md](references/tools.md) | the generated tool index |

## When NOT to use bay

- **The deliverable is a web page, not a file.** bay emits MP4s.
- **You need a browser to render something** — a live site, a DOM screenshot, a WebGL scene.
- **You need per-character text animation, gradients, text stroke, or a group/parent transform.**
  bay has none of these. Say so rather than approximating them with dozens of elements.
