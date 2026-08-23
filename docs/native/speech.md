# Narration and subtitles

bay speaks with [Kokoro](https://github.com/hexgrad/kokoro) (82M params, Apache-2.0) and turns
what it said into captions. Because Kokoro reports **per-word timestamps**, captions are
synchronised to the audio rather than estimated from character counts.

---

## Architecture: a sidecar, never linked

Kokoro is Python + torch — about 2 GB of runtime. Linking that into an editor is the wrong
trade, so it runs as a separate process, exactly as ffmpeg already does.

```
bay-mcp ──▶ bay-speech::SpeechEngine ──HTTP+token──▶ bay-kokoro.py ──▶ Kokoro (torch)
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

- **A bearer token** in `BAY_KOKORO_TOKEN`, checked on every request. Binding to loopback is
  not treated as authentication — any local process could otherwise drive it. The token is
  per-bay-process, which is why a sidecar left over from an earlier run is reported as
  `PortBusy` rather than silently reused.
- **`BAY_KOKORO_PARENT_PID`**, so a crashed editor cannot leave a multi-gigabyte model
  resident. The sidecar polls and exits when its parent is gone.

`Studio` owns **one** `SpeechEngine` for its whole lifetime. Constructing one per call would
spawn and kill the model on every line — the exact cost the sidecar exists to avoid.
`shutdown_if_idle` gives the memory back after a quiet period.

### What differs from the Whisper integration

Nothing, now. The meeting assistant ships a revision-pinned, SHA-256-verified model catalogue,
and so does bay: the Kokoro weights are 56 pinned artifacts in `manifest.json`, fetched at
commit `f3ff357` with a digest each, installed under `runtime/models/kokoro/` and handed to the
sidecar with `--model-dir`.

Kokoro *used* to fetch its own weights into the HuggingFace cache on first use, which is why the
readiness timeout was once 180s. That was the gap in the zero-install promise: `runtime_install
speech` showed a bar for ~1.2 GB and then the first `narrate` on a cold machine silently pulled
another ~339 MB inside one blocking call, with no bar, no byte count and stdout discarded. The
install total now covers everything it will fetch, and `HF_HUB_OFFLINE=1` is set on the sidecar
once the weights are on disk, so a missing file fails loudly rather than quietly downloading.

An install that predates the pin keeps working: `--model-dir` is only passed when the weights
are actually there, and offline mode is only set alongside it.

---

## Setup

**The app installs this itself.** Press "Install narration (1.2 GB)" in the toolbar, or call the
`runtime_install` MCP tool with `component: "speech"`. bay downloads `uv` and a CPython 3.12,
both pinned by SHA-256, builds the venv under `<data>/runtime/kokoro-venv`, and installs kokoro
into it. Nothing has to be on the machine first — not `uv`, not a Python, not Homebrew. See
[`bay-provision`](../../rust/crates/bay-provision/) for how that is verified.

Setting it up by hand is a *development* convenience, not a requirement for anyone else:

```bash
./build.sh                       # also provisions the dev venv, idempotently
SKIP_SPEECH=1 ./build.sh         # skip it; everything but narration still works

./script/setup-speech.sh          # provision on its own (needs uv on PATH)
./script/setup-speech.sh --check  # report status, install nothing (exit 1 if absent)
./script/setup-speech.sh --force  # rebuild the venv from scratch
```

bay looks for a usable interpreter in `BAY_SPEECH_VENV`, then its own provisioned venv, then
`~/.local/share/bay/kokoro-venv` (where the script above puts it), then the platform data
directory. That list has exactly one definition, in `bay_provision::speech`, because when the
"where do I run it" and "is it installed" answers drifted apart the symptom was narration
reporting *not installed* beside a working 858 MB environment.

A speech-provisioning failure does not fail the build. An editor that cannot speak is still an
editor, and the narration tools report the real reason at call time.

Either way, what gets built is:

```bash
uv venv --python <pinned CPython 3.12> --no-project <venv>
uv pip install --python …/bin/python kokoro soundfile
# misaki's English G2P uses spaCy; pre-installed so the sidecar never shells out at runtime
uv pip install --python …/bin/python "en_core_web_sm @ <spacy-models release wheel>"
```

Optional: `brew install espeak-ng` for out-of-dictionary English words and some non-English
languages.

Overrides: `BAY_KOKORO_PYTHON`, `BAY_KOKORO_SCRIPT`, `BAY_KOKORO_PORT`.

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
  "voice": "af_heart", "targetWordsPerSecond": 2.5,
  "captionStyle": "plain", "captionY": 0.79, "captionAlign": "left" }
```

It returns a job id whose `result.endSeconds` lets a caller check a line fits its scene before committing —
which is how the closing line of the volatility-drag reel was caught overrunning the music
bed by 0.62s. The result also carries `wordsPerSecond` and `wordsPerMinute`: what the read
**actually** came out at, against the rate that was asked for.

### The read's rate

`speed` is a multiplier nobody can plan in. `speed: 1.0` is **3.30 words a second** measured
through this path — a 198 wpm gabble — while the old skill documented 2.5, so every duration an
agent budgeted was out by a fifth. State the rate instead:

| Field | Default | Why |
|---|---|---|
| `targetWordsPerSecond` | 2.5 | 150 wpm, the middle of the broadcast band. bay derives `speed` from it |
| `speed` | derived | the raw multiplier, if a caller insists. Overrides the target |

**A clip over 8.0 s is refused**, before the synthesis where the word count already says so and
after it where the voice disagreed. The refusal lists the script's own sentences, because the
fix is always to narrate them as separate clips.

### Caption style

Eleven caption arguments used to exist. They are one:

| Field | Default | Why |
|---|---|---|
| `captionStyle` | `plain` | `quiet` \| `plain` \| `loud` — how loud the spoken word is on screen. The committed style kit answers the face, the size, the weight and the colour |
| `captionX` / `captionY` | the kit's `lower-third` framing | where the block sits. Both were unsettable, which is why 38 caption elements in one project shared x = 0.08 |
| `captionAlign` | the kit's framing | `left` \| `center` \| `right` |

`captionFontSize`, `captionColor`, `captionFontFamily`, `captionFontWeight`, `captionLayer`,
`captionFade`, `maxWords`, `minCaptionSeconds`, `maxCaptionSeconds` and `gapSeconds` are
**refused, not ignored** — the error names what decides that value now.

### Caption grouping

What a caption has to clear to be readable is a fact about reading, not a parameter of the
video, so `CueStyle` is engine-owned:

| Rule | Value | Why |
|---|---|---|
| words a line | 4 (2 under `loud`) | 3–5 words reads at thumb size |
| minimum on screen | 0.833 s | the BBC's floor; 8 cues in one project were under it |
| minimum per word | 0.30 s | 18 cues ran over 17 characters a second |
| a pause breaks a caption | 0.45 s | a caption should never span a silence |
| a full stop breaks a caption | always | two cues in one project carried the end of one sentence and the start of the next |
| caption fade | 0.28 s | 8.4 frames at 30 fps. At the old 0.12 s it was a three-frame pop, and 76 of them shipped |

Four rules that only show up on screen:

- A short cue is extended **only into genuinely free time** — stretching blindly would put two
  captions on screen at once.
- Holes *smaller* than the pause threshold between consecutive captions are closed. A caption
  ends on its last word, so two captions of one sentence otherwise leave the inter-word silence
  between them, which reads as a blink. A hole at or above it is a real pause and is left
  alone, because there the caption *should* clear.
- A cue that still cannot be given enough time absorbs an adjacent **orphan** — a run shorter
  than a full line, in the same sentence, with no pause between them. Merging two full lines
  would preserve their seconds per word exactly and only double the words on screen.
- Sentence ends come from the script, not from the word list: the sidecar drops
  punctuation-only tokens (it has to, or every comma becomes a caption), so the two are walked
  together and matched on letters alone.

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
- **Captions are text elements**, so they inherit bay's text rendering: no per-word highlight
  within a caption, and no outline or drop shadow behind the type. On a busy frame that means
  choosing a clear band rather than relying on a scrim.
- **No ducking automation.** The music bed's level is set once; bay cannot yet dip it under
  speech automatically.
