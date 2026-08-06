# Narration and subtitles

vii speaks with [Kokoro](https://github.com/hexgrad/kokoro) (82M params, Apache-2.0) and turns
what it said into captions. Because Kokoro reports **per-word timestamps**, captions are
synchronised to the audio rather than estimated from character counts.

---

## Architecture: a sidecar, never linked

Kokoro is Python + torch — about 2 GB of runtime. Linking that into an editor is the wrong
trade, so it runs as a separate process, exactly as ffmpeg already does.

```
opencut-mcp ──▶ opencut-speech::SpeechEngine ──HTTP+token──▶ vii-kokoro.py ──▶ Kokoro (torch)
                 lifecycle, wire protocol                     model held hot
```

The lifecycle is lifted from the transcription sidecar in the meeting assistant
(`stt/transcribe-server`), which solved the same problem for Whisper. `SpeechEngine::ensure()`:

1. reuses a child that is alive **and** answers an authenticated health probe;
2. kills and replaces one that is alive but unhealthy — otherwise every later call pays the
   same long timeout;
3. refuses to start if an untrusted process already holds the port, rather than stomping it;
4. polls readiness in a bounded loop instead of sleeping a fixed guess, and reports the
   child's stderr if it dies early.

Two things guard the process boundary:

- **A bearer token** in `VII_KOKORO_TOKEN`, checked on every request. Binding to loopback is
  not treated as authentication — any local process could otherwise drive it. The token is
  per-vii-process, which is why a sidecar left over from an earlier run is reported as
  `PortBusy` rather than silently reused.
- **`VII_KOKORO_PARENT_PID`**, so a crashed editor cannot leave a multi-gigabyte model
  resident. The sidecar polls and exits when its parent is gone.

`Studio` owns **one** `SpeechEngine` for its whole lifetime. Constructing one per call would
spawn and kill the model on every line — the exact cost the sidecar exists to avoid.
`shutdown_if_idle` gives the memory back after a quiet period.

### What differs from the Whisper integration

The meeting assistant ships a revision-pinned, SHA-256-verified model catalogue. Kokoro fetches
its own weights into the HuggingFace cache on first use, so there is no catalogue here — the
first `narrate` call on a cold machine downloads the model, which is why the readiness timeout
is 180s rather than a few seconds.

---

## Setup

`./build.sh` provisions it. The step is idempotent — a machine that already has it pays one
interpreter start (~20 ms), not a dependency resolve — so it is safe on every build.

```bash
./build.sh                       # desktop + mcp + speech sidecar
SKIP_SPEECH=1 ./build.sh         # skip it; everything but narration still works

./script/setup-speech.sh          # provision on its own
./script/setup-speech.sh --check  # report status, install nothing (exit 1 if absent)
./script/setup-speech.sh --force  # rebuild the venv from scratch
```

A speech-provisioning failure does not fail the build. An editor that cannot speak is still an
editor, and the narration tools report the real reason at call time.

Under the hood that is:

```bash
uv venv --python 3.12 ~/.local/share/vii/kokoro-venv
uv pip install --python …/bin/python kokoro soundfile
# misaki's English G2P uses spaCy; pre-installed so the sidecar never shells out at runtime
uv pip install --python …/bin/python "en_core_web_sm @ <spacy-models release wheel>"
```

Optional: `brew install espeak-ng` for out-of-dictionary English words and some non-English
languages.

Overrides: `VII_KOKORO_PYTHON`, `VII_KOKORO_SCRIPT`, `VII_KOKORO_PORT`.

Check it: the `speech_status` MCP tool reports availability and the voice catalogue, and says
what to do when it is missing rather than just failing.

---

## The tools

| Tool | What it does |
|---|---|
| `speech_status` | Is Kokoro available here, and which voices can it speak? |
| `narrate` | Speak text, place the audio, and lay word-synced captions under it. |
| `subtitles_add` | Read an SRT/VTT file and place every cue as a caption. |
| `subtitles_export` | Write the timeline's captions back out as SRT or VTT. |
| `subtitles_to_video` | An `.srt` in, a playable `.mp4` out — optionally narrated. |

`narrate` does audio and captions in one call **on purpose**: both come from the same
synthesis, so they cannot drift apart. Splitting them would make drift possible for no gain.

```jsonc
// narrate
{ "text": "Averages add. Money compounds.", "start": 19.55,
  "voice": "af_heart", "speed": 1.06,
  "captionY": 0.79, "captionFontFamily": "Helvetica Neue", "maxWords": 5 }
```

It returns `endSeconds`, so a caller can check a line fits its scene before committing —
which is how the closing line of the volatility-drag reel was caught overrunning the music
bed by 0.62s.

### Caption grouping

`CueStyle` holds the decisions that make captions readable:

| Field | Default | Why |
|---|---|---|
| `maxWords` | 4 | 3–5 words reads at thumb size |
| `minCaptionSeconds` | 0.7 | a caption faster than this cannot be read |
| `maxCaptionSeconds` | 3.0 | forces a break in a long unbroken run |
| `gapSeconds` | 0.45 | a silence this long is a pause: break the caption there |

Two rules that only show up on screen:

- A short cue is extended **only into genuinely free time** — stretching blindly would put two
  captions on screen at once.
- Holes *smaller* than `gapSeconds` between consecutive captions are closed. A caption ends on
  its last word, so two captions of one sentence otherwise leave the inter-word silence
  between them, which reads as a blink. A hole at or above `gapSeconds` is a real pause and is
  left alone, because there the caption *should* clear.

---

## Verified end to end

The volatility-drag reel now carries Kokoro narration and word-synced captions:

- 6 narration lines, 36 spoken words, 10 caption cues, all placed through the MCP server
- the music bed ducked to 0.30 so the voice sits on top
- `subtitles_export` writes `volatility-drag.srt` alongside the MP4

Two defects the build surfaced, both now covered by tests:

1. **Punctuation was being emitted as words.** Kokoro gives `,` a real timestamp, so it
   arrived as a caption token and skewed the words-per-line count.
2. **Captions blinked mid-sentence.** A 0.12s hole between two captions of one sentence — the
   natural silence between words — cleared the screen for four frames.

---

## Limits

- **Kokoro has no voice cloning and no SSML.** Emphasis and pacing come from punctuation and
  the `speed` parameter only.
- **`AudioElement` has no trim**, so a narration clip always plays from its head. The export
  mixer already threads a `trim_start` through; the field is what is missing.
- **Captions are text elements**, so they inherit vii's text rendering: no per-word highlight
  within a caption, and no outline or drop shadow behind the type. On a busy frame that means
  choosing a clear band rather than relying on a scrim.
- **No ducking automation.** The music bed's level is set once; vii cannot yet dip it under
  speech automatically.
