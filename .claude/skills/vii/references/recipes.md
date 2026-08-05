# Recipes

Worked patterns. Copy the shape, change the content.

Calls are written `tool { args }` for brevity — each one is a direct
`mcp__vii__<tool>` tool call with that argument object.

---

## 1. Minimum viable reel

```jsonc
project_create { "width": 1080, "height": 1920, "fps": 30, "background": "#0E0E12" }
fonts_check   { "families": ["Helvetica Neue", "Menlo"] }

add_text { "id": "hook", "start": 0, "duration": 3,
           "content": "One idea.", "fontSize": 96, "color": "#EDECE6",
           "fontFamily": "Helvetica Neue", "fontWeight": 700,
           "x": 0.089, "y": 0.40, "anchorX": 0, "anchorY": 0, "scale": 0.744 }

animate { "elementId": "hook", "property": "opacity", "easing": "ease-out",
          "keys": [{ "t": 0, "value": 0 }, { "t": 0.4, "value": 1 }] }

snapshot { "at": 1.5, "path": "/tmp/check.png", "scale": 0.5 }   // then LOOK at it
render   { "path": "/tmp/out.mp4" }
```

---

## 2. The house entrance (rise + fade, settling on a beat)

Every text reveal in a good reel is this. `at` is chosen so the element **settles** on the
beat, not starts on it.

```python
DUR = 0.52
at  = beat_time - clip_start - DUR      # settle exactly on the beat

animate { "elementId": id, "property": "y", "easing": "power-out",
          "keys": [{"t": 0,        "value": (y + 34)/1920},
                   {"t": at,       "value": (y + 34)/1920},
                   {"t": at + DUR, "value": y/1920}] }

animate { "elementId": id, "property": "opacity", "easing": "ease-out",
          "keys": [{"t": 0,            "value": 0},
                   {"t": at,           "value": 0},
                   {"t": at + DUR*0.7, "value": 1},
                   {"t": clip_dur,     "value": 1},
                   {"t": clip_dur+0.45,"value": 0}] }   // crossfade out
```

The leading `t: 0` key holds the element off-screen until its cue — without it the element is
visible from the moment it starts.

---

## 3. Grouped column chart

See [charts.md](charts.md) for the reasoning. Skeleton:

```python
BASE, COL_W, COL_MAX = 1040, 170, 420
cols = [("100", 100, "START", "#EDECE6"),
        ("150", 150, "+50%",  "#8A93A3"),
        ("75",   75, "−50%",  "#FF5B5B")]

# 1. baseline rule first, so columns sit on it
add_shape { "x": 96/1080, "y": BASE/1920, "anchorY": 0,
            "scaleX": 760/1080, "scaleY": 3/1920, "color": "#606070" }

# 2. a gridline at the starting value — this is what shows 75 < 100
add_shape { "y": (BASE - COL_MAX*100/150)/1920, "anchorY": 0.5, "color": "#73737E", ... }

# 3. columns, staggered
for i, (value_label, value, caption, colour) in enumerate(cols):
    cx     = 200 + i*270
    height = COL_MAX * value / 150
    add_shape { "id": f"col{i}", "x": cx/1080, "y": BASE/1920,
                "anchorX": 0.5, "anchorY": 1.0,
                "scaleX": COL_W/1080, "scaleY": height/1920, "color": colour }
    animate  { "elementId": f"col{i}", "property": "scaleY", "easing": "power-out",
               "keys": [{"t": 0, "value": 0},
                        {"t": 0.55 + i*0.26, "value": 0},
                        {"t": 0.55 + i*0.26 + 0.62, "value": height/1920}] }

# 4. caption then value BELOW the axis, centred on the column
```

---

## 4. Narrated explainer

```jsonc
speech_status {}                       // confirm before planning around it

// music bed, ducked for voice
media_import { "path": "bed.mp3" }
add_audio    { "mediaId": "…", "start": 0, "duration": 21.429, "volume": 0.14 }

// one line per scene; check endSeconds fits before moving on
narrate { "text": "The loss lands on a bigger balance than the gain did.",
          "start": 10.85, "voice": "af_heart", "speed": 1.06, "volume": 1.15,
          "captionY": 0.79, "captionFontSize": 38, "captionFontFamily": "Helvetica Neue",
          "maxWords": 4, "captionLayer": 12 }
// → { endSeconds: 14.10, words: 11, cues: [...] }

subtitles_export { "path": "out.srt", "format": "srt" }
render           { "path": "out.mp4", "duration": 21.429 }
```

Then verify the mix — see [narration.md](narration.md#levels).

---

## 5. Subtitle file → video, in one call

```jsonc
subtitles_to_video {
  "path": "script.srt", "output": "out.mp4",
  "width": 1080, "height": 1920, "background": "#0E0E12",
  "narrate": true, "voice": "af_heart",
  "captionFontFamily": "Helvetica Neue", "captionY": 0.45, "captionFontSize": 52
}
```

Check the returned `overruns` — spoken lines that ran past the next cue's start.

---

## 6. Verifying before you ship

**Step 1 — look at one frame per scene.** One `snapshot` call each, then Read each PNG. This
is the step that catches real defects, and there is no substitute for it.

```jsonc
snapshot { "at": 2.6,  "path": "/tmp/f1.png", "scale": 0.5 }
snapshot { "at": 6.9,  "path": "/tmp/f2.png", "scale": 0.5 }
snapshot { "at": 14.2, "path": "/tmp/f3.png", "scale": 0.5 }
// …then Read every one of them.
```

**Step 2 — sweep for dead air.** Measuring ink across ~70 frames is arithmetic over a batch,
so this one is a script:

```bash
python3 scripts/inkcheck.py --at 4.286 8.571 10.714 15.0 19.286
```

**Step 3 — confirm the encoded file is what you think it is.**

```bash
ffprobe -v error -show_entries stream=codec_type,codec_name -of default=nw=1 out.mp4
ffmpeg -nostdin -i out.mp4 -af volumedetect -f null /dev/null 2>&1 | grep volume
ffmpeg -nostdin -v error -y -ss 12 -i out.mp4 -frames:v 1 /tmp/encoded.png   # then Read it
```

Never report a render as verified on the strength of the `render` tool's own JSON. It tells
you ffmpeg exited zero, not that the file contains what you intended. Pulling a frame out of
the *encoded file* is what proves the export path matches the preview path.
