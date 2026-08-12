# Craft — what a move, a kit, an asset and a sound are FOR

## Three things this skill will never tell you to do

Each is here because the rule it forbids was measured against real video, and each one **ranks the
worst video we have made above the references we admire.** They are the only thing standing
between this rewrite and a repeat of the last one.

- **Never mandate a non-flat background, a gradient, or grain.** R2 is 79–97 % one blush colour for
  57 s; R1 is flat black; both grounds are *flatter* than ours (noise σ 0.22–1.19 and 0.43–0.66 vs
  our 0.62–0.67). The mandated version produces a purple radial mesh behind monospace type —
  our worst video with one more layer.
- **Never use bitrate, distinct-frame count, or keyframe count as a motion proxy.** wicks-v2 has
  the *highest* mean bitrate of the four (343 kbps) and 90.6 % distinct frames, while 60.2 % of
  consecutive frame pairs differ by ≤ 2/255 everywhere. The bits are dither in the card fill.
- **Never ration a decision because it repeats.** A tool refusing a family it has seen 20 times
  punishes correct behaviour, is satisfiable for free by a third family on one 12 px label, and
  converts a design decision into a rationed resource — the exact mechanism that produced 19
  easings and 47 durations.

The general form: **a metric that a bad video can max out is a metric that certifies bad video.**
When you are tempted to satisfy a rule by adding variety, add meaning instead.

## The kit

`project_create` commits a kit. It owns family, size, weight and colour; you pass `role` and
`tone` and it resolves them. `add_text` and `add_shape` no longer take a font name or a hex, and
this is the single largest change in the skill, because of what it fixes: of 73 text elements in
the video that caused this rewrite, 72 were set *smaller* than the tool's own default, and every
family, size and colour in it was a literal copied out of the old reference files.

- **Tone is `ink`, `dim` or `accent`.** The accent means *this one thing matters*. Used on
  everything it is decoration; used once a beat it is a pointer.
- **Contrast is the kit's job, not yours** — but the composited result is still measurable, and a
  large element close in tone to what is under it is `dead-plate` whatever the kit says.
- **A custom kit is legal and is strictly more work**: several families that actually resolve, a
  real size ratio between the largest and smallest tier, an accent genuinely far from the ink, and
  declared framings including one that puts weight low in the frame. Take an offered kit unless
  the brief has a reason.
- **`fonts_check` before you commit a custom kit.** A family that is not installed does not fall
  back gracefully — the resolver drops the *family* and keeps the weight, so an unavailable face
  silently becomes an unrelated one that survives every automated check.

## Moves

A move is a named entry in the registry — its duration and its curve are properties of the move,
not arguments you supply, and every one is long enough to read as motion rather than a pop.
`animate(move: …)` instantiates one; `animate_many` runs one across a group with a stagger.

- **Opacity may ride a move; it may never lead one.** A fade is not motion, it is an appearance.
  Every registry move carries a geometric channel.
- **A small vocabulary used with intent is the goal**, not variety. Several distinct moves each
  doing real work; not one move everywhere, and not a rotation table — a rotation satisfies a
  distribution exactly the way a sprinkle satisfies a count.
- **Entrances are not the interesting half.** What an element does *after* it arrives — responding
  to the next arrival, making room, leaving — is what separates a composition from a slide stack.
- **Hand-written keyframes still work** and are reported per channel as `off-vocabulary-motion`
  with the element id. Use them for something the registry genuinely cannot express, and expect to
  see it named in the report.
- **A move that encodes a magnitude must not overshoot.** A bar that springs past its own number
  displays a false value for the length of the overshoot; `value-overshoot` is an error, and the
  registry's settling moves are monotone by construction.

## Assets

An asset is what makes a frame about something. A drawn explainer — shapes, type, a diagram built
from primitives — is legitimate and can be excellent; an *empty* one is the failure. The
acquisition paths, each with its call:

- **`media_import` then `add_image` / `add_video`** for anything on disk. Import probes the real
  duration, so you never guess one.
- **`shots_detect`** on footage you have not watched: it returns the stretches between cuts, which
  you place with `add_video` and slip with `element_source`.
- **`template_place`** for lower thirds, kickers and end cards — the placement and timing are the
  tedious part, and `templates_list` shows the text slots each one takes.
- **`add_shape` and `add_text`** to draw the thing itself. Bars, columns, rules, dots, a diagram.
- **`crop_set`** to reframe landscape footage into a vertical canvas — `scaleX`/`scaleY` distort,
  crop chooses.

Three facts that keep drawn data honest:

1. **Chrome measures against the container it sits on, not against the ground.** A gridline that
   passes contrast against the canvas and disappears against the card it is drawn on is invisible,
   and this is the most common way a chart becomes an empty box.
2. **A value channel never overshoots** — see above. `anchorX`/`anchorY` pin the origin so a
   `scaleX` move grows a bar from its baseline rather than from its middle.
3. **The numeric example comes before the symbolic form.** Show the case, then the rule. A formula
   that arrives first is a frame the viewer waits out.

## Audio

Audio is roughly half of perceived quality and it is where bay's output has measured furthest from
professional work. Three requirements; a narrated video missing one is not finished.

**1. A bed under the whole runtime.** bay does not synthesise music — `media_import` a file,
`add_audio` it, and `fade_set` both ends, because every audio edit without a fade is a click.
`element_source` slips the in-point on a clip already placed, so a bed can start at the drop
without moving. If there is genuinely no music available, say so in what you report rather than
shipping silence and calling it done.

**2. A sound under every significant move.** `sfx_add` synthesises at whatever length you ask,
which is the reason to prefer it to a sample: a downloaded whoosh is either cut off or trailing.
`sfx_list` and `sfx_search` are the catalogue; `sound_add` places a recorded one at the file's own
length. Two rules: **the sound is the same length as the move it covers**, and **it starts
slightly before the move** — the ear resolves onsets faster than the eye resolves motion, so a
sound that starts on the same frame reads as late. A riser goes entirely before the reveal and
*ends* where the thing appears. Keep the count honest: a stagger group is one sound, not one per
element. Vary `tone` between neighbours and keep overlapping sounds in different frequency ranges;
two sounds fighting for one band is what "muddy" means.

**3. A mix that moves.** The bed ducks under the voice and comes back up between lines — a flat
level is the actual cause of every "the music drowns out the narrator". Duck against `narrate`'s
returned cue times, not guesses: look for duck parameters on `audio_set` in this build, and
otherwise `animate` the `volume` channel on the bed. Fast in, slower out, deep enough to hear the
difference. Splitting the bed into many clips at stepped gains is the hack that silences the
check; it is also what produced a duck that ran backwards, with the music-only stretches louder
than the narration.

The gate is **positional, not a level**: narration windows must measure louder than the gaps, the
bed must stay audible *in* the gaps, and the loudest moment in the piece must land on the `payoff`
marker placed before any audio existed. Do not chase dynamic range as a number — the reference we
admire most is flatter than our worst video.

`render` normalises the mix; pass a preset rather than tuning by hand, and use the mastering
preset only when handing the file to another editor, never for something being posted. The preset
is a request to ffmpeg, not proof — verify on the encoded file, and remember that gain cannot
invent loudness that is not in the mix:

```bash
ffmpeg -nostdin -i out.mp4 -af loudnorm=print_format=json -f null -   # read input_i, input_tp
```

## Narration

**The voice must not read the screen.** If the frame shows the numbers, narration that speaks them
teaches nothing and hands the viewer two copies of one message to process at once. The picture
carries the numbers; the voice carries what the picture cannot — the causation, the consequence,
the "so what". Test it: read the script end to end with the video off. It should be a complete
explanation that never speaks a single on-screen figure.

- **Budget by rate, and use the measured one.** Kokoro runs about **2.99 words/second** including
  pauses at normal speed — the figure this skill carried for a year was 2.5, a 20 % planning error
  that shipped a read far faster than intended. Better: give `narrate` a target words-per-second
  and let it pick `speed`, then check the returned rate and end time against the beat you wrote it
  for. Fix an overrun by starting earlier or cutting a clause the picture already carries.
- **One clip is one thought.** Long synthesis runs are rejected; a sentence that will not fit is
  two `narrate` calls, which also gives you a real pause between them and a place for the turn.
- **Punctuation is the only prosody there is.** No SSML, no cloning, no emphasis marks. A full
  stop buys a real pause, a comma a short one. `speech_status` lists the voices and language
  codes; call it before planning around narration at all.
- **Captions come from the same synthesis as the audio**, so they cannot drift, and their styling
  comes from the kit. Never author a caption element by hand or reuse a caption id — captions are
  marked as tool-authored, and every distribution `check` computes partitions on that.
- **`subtitles_add` places an existing SRT or WebVTT**; `subtitles_export` writes the timeline's
  captions back out; `subtitles_to_video` takes a subtitle file and gives back a rendered MP4,
  reporting the cues whose spoken audio overran rather than truncating them silently.
