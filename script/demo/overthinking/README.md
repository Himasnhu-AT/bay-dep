# The overthinking cut

One phone video, edited end to end through the agent surface, with every animation timed from
the video's own transcript.

```
ffmpeg -i <source>.mp4 -vn -ac 1 -ar 16000 audio.wav
whisper audio.wav --model base --language en --word_timestamps True --output_format json
python3 gen.py          # transcript -> six HyperFrames compositions + plan.json
node build.mjs          # drives bay over CDP: import, place, preview, export
```

`gen.py` is the point. Nothing in it is hand-timed: `word_at("everyone")` is a lookup into
Whisper's word list, and it **fails loudly** if the word is not in the transcript, because a
caption synced to a word nobody said is synced to nothing. Recut the video, regenerate, and
the graphics follow.

It also decided the *edit*, not just the overlay. The first pass cut 10s-25s to make the video
shorter; reading the transcript showed that span is the history and the "everyone has become an
overthinker" turn — the spine of the argument. The finished cut removes nothing.

## Layout, which the rendered frames decided

The subject sits centre-frame from roughly y=450 to y=1500: face, glasses, hand, mic. Graphics
live in the band above the head and captions in the band below the chin, and nothing crosses the
middle. That is not a style rule, it is what the first render showed — `TOO MUCH INPUT` landed
across his eyes and red bars fell through his hair like a glitch. Look at the frames.

## Why this is checked in

Same reason `script/demo` is. Making one video with the product found four defects the unit
suite could not reach, every one of them a wrong picture rather than an error:

- `seekScript` called the composition timeline's setter as a getter (`tl.time()`, GSAP's
  convention). For a hand-rolled timeline that is `time(undefined)`, which reset the page
  microseconds after it was painted. Whether the capture beat the wipe was a race: the first
  seek into a fresh window was correct and every later one came back blank. A full-length
  caption track rendered its first frame and then nothing for forty seconds.
  Now guarded by `test/app/compositions.mjs` — every other fixture there uses GSAP, whose
  `time()` really is a getter, which is exactly why this survived.
- `preview_frame` could not converge on a frame carrying two compositions: `renderFrame` builds
  a fresh `CompositionPool` per call, so retrying never accumulated anything, and the exporter's
  `settle()` was never called on the preview path.
- The `unresolved` list named compositions that were rendering fine, because it asked the
  `MediaPool` about assets the `CompositionPool` owns.
- `inspect_item` reported neither `crop` nor `variables`, both of which `edit_item` accepts.

A fifth is still open: the full-length export writes 1438 frames and the container holds 1437.
Not a systematic off-by-one — a 100-frame range exports exactly 100.
