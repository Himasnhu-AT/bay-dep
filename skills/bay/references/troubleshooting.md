# Troubleshooting

## Tool errors and what they actually mean

| Message | Cause | Fix |
|---|---|---|
| `no GPU adapter available` | headless box with no Vulkan/GL driver | bay can build a timeline but cannot composite. Nothing to do but run somewhere with a GPU. |
| `ffmpeg failed to encode …` | ffmpeg missing, or an audio asset does not resolve | check `which ffmpeg`; check every `mediaId` resolves to a file that still exists |
| `font family "X" is not installed` | typo, or the font is a `.woff2` | `fonts_check` first. cosmic-text reads ttf/otf/ttc, **not woff2** — a woff2 in your assets folder is invisible to it. |
| `no media asset "X"` | `add_*` before `media_import` | import first; use the returned `mediaId` |
| `"wobble" is not animatable` | wrong property name | one of `opacity, scale, x, y, rotation, scaleX, scaleY` |
| `an animation needs at least two keyframes` | single-key channel | a start and an end |
| `Kokoro is not installed: …` | no venv at the expected path | follow the message, or set `BAY_KOKORO_PYTHON` |
| `port 7334 is held by a process that does not accept this session's token` | a sidecar from an earlier bay run | `pkill -f bay-kokoro.py`, or set `BAY_KOKORO_PORT` |
| `there are no captions on the timeline to export` | `subtitles_export` before `narrate`/`subtitles_add` | add captions first |
| `no cues found — is this really an SRT or VTT file?` | the file has no `-->` lines | it isn't a subtitle file |

---

## Symptoms with no error

These are the dangerous ones — the call succeeds and the frame is wrong.

### Nothing appears where I put it
Text draws from its box's **top-left**, and `scale` sets the box. With the default
`anchorX/Y: 0.5` the box is *centred* on `(x, y)`, so the text starts half a box up and left.
For pixel placement use `anchorX: 0, anchorY: 0`.

### An element is visible before its cue
An `animate` channel clamps to its first key outside the key range. Without a leading
`{ "t": 0, "value": 0 }`, opacity is 1 from the element's start. Add the hold key.

### A bar inflates from its middle instead of growing
Default `anchorX` is 0.5. Set `anchorX: 0` (grow right) or `anchorY: 1` (grow up).

### A rounded bar looks like a pointed lens
Fixed in the engine — shape rasters now match the layer aspect. If you see it, you are on an
old build; rebuild with `cargo build --release -p bay-desktop`.

### Text reflows instead of scaling when I animate `scale`
Fixed — the raster is built at the element's **base** scale and scaled as an image. Old builds
sized the raster from the animated value, making `scale` a wrap box. Rebuild.

### The chart track is invisible
It measures under 3:1 against the ground, or you faded it with `opacity`. See
[layout.md](layout.md#measure-contrast-dont-eyeball-it).

### Captions blink mid-sentence
Fixed — holes below `gapSeconds` are closed. On an old build, raise `minCaptionSeconds`.

### A caption orphans its last word
Too many words for the box. Drop `maxWords` to 4 and `captionFontSize` to ~38.

### The reveal feels late against the music
You passed the beat time as the animation's start. An entrance of duration `d` settling on
beat `b` must start at `b − d`.

### The voice is buried under the music
Kokoro is quiet (≈ −26 dBFS mean) versus a typical bed (≈ −17 dBFS). Duck the bed to ~0.14 and
keep `peakDb` normalization on. Target 10–15 dB separation and measure it.

### The last narration line is cut off
It ran past the render `duration`. `narrate` returns a job id; poll `job_status` until
`finished`, then compare `result.endSeconds` to the end before rendering.

### Snapshots go somewhere unexpected
Paths are resolved by the **server** process, whose cwd is wherever it was started. Use
absolute paths.

---

## Still missing from bay

Do not promise these; design around them.

| Gap | Consequence | Workaround |
|---|---|---|
| **Masks** | no wipe reveals — the compositor has a JFA mask pipeline but the preview passes `mask: None` | rise + fade entrances |
| **Path / polyline** | no line charts, no equity curves | columns, or a stepped bar series |
| **Stroke / outline** | fills only; no ring charts or outlined tracks | a filled track behind a filled bar |
| **Per-character text animation** | a text element is one layer | one element per word, staggered |
| **Text auto-fit** | a too-long string silently wraps | snapshot and check; size by hand |
| **Rotation about the anchor** | `anchorX/Y` govern placement only; rotation is about the quad centre | position after rotating |
| **Audio trim** | a clip always plays from its head | pre-trim the file with ffmpeg |
| **Automatic ducking** | the bed's level is set once | duck it manually; see narration.md |
| **Text colour animation** | colour is not an animatable channel | two elements, cross-faded |

---

## Verifying a render

The `render` tool's JSON tells you ffmpeg exited zero. It does **not** tell you the file
contains what you intended. Always confirm independently:

```bash
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate \
        -of default=nw=1 out.mp4
ffmpeg -nostdin -i out.mp4 -af volumedetect -f null /dev/null 2>&1 | grep volume
ffmpeg -nostdin -v error -y -ss 12 -i out.mp4 -frames:v 1 /tmp/frame.png   # then look
```

Extracting a frame from the **encoded file** — not just a `snapshot` — is what proves the
export path matches the preview path.
