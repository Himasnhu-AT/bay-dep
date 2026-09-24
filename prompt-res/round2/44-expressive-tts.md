> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# Expressive local TTS for bay

**Question asked:** the narration voice is flat and bland; find expressive, emotional, local,
open-source TTS to replace it.

**Answer, up front:** a model swap is the *third* most valuable thing available, and every
option that beats Kokoro on expressiveness costs something bay currently depends on. The
measurements below show the flat read is mostly **an authoring failure bay's own tool surface
makes unavoidable** — one `narrate` call per paragraph, one `speed` for the whole paragraph, no
way to author a pause, and no feedback on the rate that came out. Fix that first; it is a week
of work against a 4 GB download, and it moves the needle further.

Everything here that says "measured" was measured on this machine on 2026-08-12, against the
real narration WAVs from `wicks-v2.mp4` and against Kokoro running in bay's own venv. Anything
I could not verify is marked **unverified**.

---

## 1. What bay actually exposes today (established from source)

`bay-speech` drives a Kokoro sidecar over loopback HTTP (`script/bay-kokoro.py`,
`rust/crates/bay-speech/src/engine.rs`). The whole synthesis surface is:

```
speak_normalized(text, voice, speed, lang_code, out_path, peak_db)
```

and the `narrate` MCP tool (`rust/crates/bay-mcp/src/tools.rs:821-845`) exposes exactly:

| parameter | what it controls |
|---|---|
| `text` | what is said. **Punctuation is the only prosody channel.** |
| `voice` | one of 54 Kokoro voices |
| `speed` | one scalar, applied to the *entire* utterance |
| `langCode` | pronunciation language |
| `start`, `volume` | placement and one flat gain for the clip |
| `peakDb` | per-utterance peak normalization, default −2.0 dBFS |
| `audioPath`, `captions` + 8 caption-style keys | output plumbing |

The suspicion in the brief is confirmed and is slightly worse than stated. There is:

- **no emphasis** — not per-word, not per-phrase, at any level;
- **no pitch control** at all;
- **no pause authoring** — you cannot ask for a beat of a given length anywhere;
- **no per-sentence direction** — `speed` is one number for the whole call;
- **no style or emotion conditioning** of any kind;
- **no SSML** — Kokoro's tokenizer is a 178-token phoneme vocabulary via G2P; markup is not
  parsed, it is *pronounced* or dropped.

`narrate` returns `endSeconds`, `durationSeconds`, `words` (a count) and the cues. **It does not
return the delivered speaking rate**, so an authoring agent has no way to know whether the read
came out at 150 or 220 words per minute, and nothing in `bay-core/src/check.rs` measures it —
the only audio checks are `no-bed`, `flat-mix`, `silent` and `gain-above-unity`, all of which
are about the *mix*, none about the *read*.

`bay-provision/manifest.json` pins Kokoro as: `hexgrad/Kokoro-82M` at commit
`f3ff3571791e39611d31c381e3a41a3af07b4987`, **Apache-2.0**, `kokoro-v1_0.pth` 327,212,226 bytes
+ config + 54 voice `.pt` files ≈ 328 MB of weights, inside a `speech` component whose declared
`diskBytes` is **1,555,479,286 (1.56 GB)** once CPython, uv and torch are counted.

The manifest's enforced invariants (`rust/crates/bay-provision/src/manifest.rs:400-505`) are the
real bar any new model has to clear:

- 64-char lowercase hex SHA-256, non-zero byte size, `https://`, and **no mutable URL** —
  `/latest/`, `master-latest`, `releases/latest` are rejected by name;
- licence string non-empty and not containing `nonfree`;
- **`every_shipped_target_can_render_and_speak` requires the `speech` component to resolve
  artifacts for `macos-aarch64`, `macos-x86_64` AND `windows-x86_64`.**

That last one is the constraint nobody mentions and it decides the architecture: **an MLX-only
model cannot be the `speech` component**, because MLX does not exist on Intel Mac or Windows. A
new expressive engine is therefore an *additional* component, not a replacement — or that test
has to be renegotiated deliberately.

---

## 2. The measured failure — it is not only "flat", it is rushed

Source: the 6 `narrate` calls recovered from the producing session
(`~/.claude/projects/-Users-himanshu-codes-synthai-vii/1ba87d60-….jsonl`) and the WAVs still on
disk. Four of the six WAVs are byte-authentic to this project (durations match the project's
element durations exactly at 120,000 ticks/s); two were overwritten by a later session and are
excluded from level measurements.

### Every call was identical

All nine `narrate` calls (six lines, three retakes) passed **`voice: af_heart`, `speed: 1.06`,
`volume: 1.15`** — identical, every time. `peakDb` was never passed. There is no per-line
decision anywhere in the video.

### The delivered rate, per line

| line | start | duration | words | **WPM** |
|---|---|---|---|---|
| "Hours of trading, thousands of prints…" | 0.80 s | 5.00 s | 14 | 168 |
| "Ask how violent a session was…" | 9.00 s | 5.38 s | 15 | 167 |
| "Reach says nothing about path…" | 18.80 s | 10.30 s | 29 | 169 |
| "Take the net move out of the total…" | 33.80 s | 6.98 s | 22 | 189 |
| "That is why two sessions…" | 46.00 s | 4.62 s | 14 | 182 |
| **"The body tells you where it ended. The wick tells you what it cost."** | 55.60 s | 3.88 s | 14 | **217** |

Total 36.15 s of narration in 61.01 s = 59.2 % speech density. Mean **179 WPM**.

Three things fall out of that table:

1. **179 WPM against a genre standard of 130–160.** Explainer/educational voiceover sits at
   130–150 WPM for teaching content and 150–160 for product/promo; 170–190 is *ad* pace. This
   read is at ad pace throughout.
2. **The payoff line is the fastest line in the video, by 28 %.** The thesis of the whole piece —
   "the body tells you where it ended, the wick tells you what it cost" — is delivered at 217 WPM.
   A human narrator does the opposite: the last line is where you slow down. Nothing chose this;
   it is what Kokoro's duration predictor happens to do to a short line at `speed: 1.06`.
3. **The rate drifts 167 → 217 with `speed` held constant at 1.06.** The author has no control
   over the delivered rate and no report of it. Setting one `speed` does not set one pace.

### The skill's own budgeting constant is wrong

`narration.md` tells the agent Kokoro at `speed: 1.06` runs "roughly 2.5 words/second including
pauses" (150 WPM). Measured: **2.99 words/second (179 WPM)**, ~20 % faster. Every line the agent
budgets against that constant comes out short, and the fix the skill offers for overruns is
"raise `speed`" — pushing further away from the genre.

### Within a line, nothing moves

Loudness range per line, EBU R128 (`ffmpeg -af ebur128`):

| line | integrated | **LRA** |
|---|---|---|
| narration-1 | −25.8 LUFS | 1.0 LU |
| narration-3 | −25.8 LUFS | 1.3 LU |
| narration-4 | −25.9 LUFS | 0.9 LU |
| narration-6 | −25.9 LUFS | 2.0 LU |

**0.9–2.0 LU of internal dynamic range.** Human explainer narration runs 4–8 LU within a
paragraph. ~1 LU is the numeric signature of a monotone read, and it is the same defect
EVIDENCE.md §10 records for the mix (LRA 3.5 LU overall) showing up one layer down.

### The single most useful measurement: Kokoro pads every chunk

Head and tail silence in the shipped WAVs:

| file | duration | head silence | tail silence | internal pauses > 0.2 s |
|---|---|---|---|---|
| narration-1 | 5.00 s | 0.325 s | 0.423 s | 0.32, 0.40 |
| narration-3 | 3.88 s | 0.302 s | 0.395 s | 0.30, 0.36 |
| narration-4 | 5.38 s | 0.312 s | 0.455 s | 0.30, 0.34 |
| narration-6 | 4.62 s | 0.309 s | 0.461 s | 0.30, 0.24 |

Confirmed against fresh synthesis: **Kokoro emits ~0.30–0.38 s of leading and ~0.44–0.50 s of
trailing silence on every chunk it is handed, regardless of chunk length** — ~0.77 s of dead air
per `narrate` call — and **every sentence break inside a chunk is a fixed ≈0.30 s** whatever the
punctuation.

Three consequences, all load-bearing:

- Of the "36.15 s of narration" in this video, **≈4.6 s is padding Kokoro inserted** and ≈3.8 s
  is its fixed inter-sentence beat. Actual articulation is ≈27.8 s for 108 words = **≈233 WPM**.
  The voice is not speaking at 179 WPM with expression; it is machine-gunning at 233 WPM and
  being spaced out by uniform, identical silences. That is exactly what "synthetic" sounds like.
- **Every pause in the video is the same length.** There is no beat before the payoff because
  Kokoro does not have one.
- **Any per-phrase narration scheme must trim this padding**, or authored beats stack on top of
  0.77 s of model silence and the read drags. This is the concrete reason a naive "just call
  `narrate` per sentence" makes things worse, and it is why this has to be handled in
  `bay-speech`, not left to the agent.

### One thing that is fine

`peakDb` normalization works. Files generated on 2026-08-12 peak at exactly −2.0 dBFS. The
shipped video's files peak at −7.0 to −8.3 dBFS, i.e. **`wicks-v2.mp4` was rendered by a build
that predated the feature** — this is not a live bug, and the 5–6 dB deficit in that video is
already fixed on `main`.

But peak normalization is not loudness normalization. Peak-normalising all four authentic lines
to exactly −2.0 dBFS and re-measuring gives integrated loudness of −19.5, −19.6, −20.8, −20.9
LUFS — a **1.4 LU spread** that a listener hears as the level drifting line to line. Normalising
to integrated LUFS instead removes it by construction. That is a one-line change with a measured
benefit (§5.4).

---

## 3. The landscape — open-weight TTS that can run locally on Apple Silicon

Licences verified against the Hugging Face model API and the licence files themselves, not
against blog posts. Several widely-recommended models turn out to be non-commercial.

| model | licence (verified) | params / on-disk | Apple Silicon | speed | expressive control | word timings | verdict for bay |
|---|---|---|---|---|---|---|---|
| **Kokoro-82M** (incumbent) | **Apache-2.0** ✓ | 82 M / **328 MB** weights (1.56 GB component) | PyTorch CPU/MPS | **≈12× realtime measured** (0.32 s for 3.9 s audio, 1.4 s load) | `speed` only, whole-utterance. No emotion, no SSML, fixed 0.30 s sentence beat | **native, per-word** | ships today; ceiling is real but under-exploited |
| **Chatterbox-Turbo** | **MIT** ✓ | 350 M T3 / **≈4.0 GB** fp32 (t3 1.92 + s3gen 1.06 + meanflow 1.06 GB) | `device="mps"`; MLX port exists (v2/v3 only) | unverified on M-series; Nano is "3× realtime on 8 CPU cores" per Resemble | `exaggeration` 0–2 (scales pitch+energy+rate together), `cfg_weight`, paralinguistic `[laugh] [chuckle] [cough]` | **none** | strongest MIT expressive option — but see watermark, below |
| **Chatterbox-Nano** | **MIT** ✓ | 110 M / **≈3.0 GB** | same | 3× realtime, 8 CPU cores (publisher) | same as Turbo | none | the CPU/Windows-viable Chatterbox |
| **Chatterbox-Multilingual V3** | **MIT** ✓ | 500 M / 2.71 GB (MLX) | MLX port `mlx-community/chatterbox-multilingual-v3` | unverified | `exaggeration`, `cfg_weight`, 23 languages | none | multilingual variant; no paralinguistic tags |
| **Qwen3-TTS CustomVoice 1.7B** | **Apache-2.0** ✓ | 1.7 B / **2.70 GB (6-bit MLX)**, 4.52 GB bf16 | **native MLX** | **1.67× realtime batch-1, 4.26× at batch 4** (mlx-audio, 6-bit); 85 ms TTFB; 3.88 GB RAM | **`instruct=` natural-language style prompting** + 9 built-in named speakers (2 English: `Ryan`, `Aiden`) | none (but `Qwen3-ForcedAligner-0.6B` in the same library, +1.28 GB) | best *directable* permissive model |
| **Qwen3-TTS VoiceDesign 1.7B** | **Apache-2.0** ✓ | 1.7 B / 4.52 GB bf16 | native MLX | unverified | design a voice from a text description | none | interesting, less reproducible run to run |
| **Orpheus-3B** | **Apache-2.0** ✓ | 3 B / ~6 GB bf16 (GGUF quants exist) | via llama.cpp / LM Studio | ~200 ms streaming latency (publisher) | inline `<laugh> <chuckle> <sigh> <cough> <sniffle> <groan> <yawn> <gasp>` | none | paralinguistic only; no rate/pitch/emphasis. Wrong controls for explainer |
| **Sesame CSM-1B** | **Apache-2.0** ✓ | 1 B / MLX port `mlx-community/csm-1b` | native MLX | unverified | conversational context conditioning + reference audio | none | built for dialogue turns, not read narration |
| **Dia-1.6B** | **Apache-2.0** ✓ | 1.6 B / MLX `Dia-1.6B-fp16` | native MLX | unverified | `[S1]/[S2]` speaker tags, `(laughs)` nonverbals, audio conditioning | none | dialogue model; single-narrator read is not its job |
| **VibeVoice-1.5B** | MIT weights, but **"research and development purposes only"** per Microsoft | 1.5 B / ~3 GB | unverified | unverified | long-form (90 min), 4 speakers | none | **disqualified: Microsoft embeds an *audible* disclaimer in every output** |
| **Higgs Audio v2** | Boson Community Licence (Llama-3-derived; attribution + "Built with Higgs Materials" + derivative-naming duty) | ~6 B / ~12–15 GB | MLX q6/q8 ports exist | unverified | scene-description prompts, speaker tags, reference audio | none | usable commercially but heavy and legally noisy |
| **Higgs Audio v3** | **research and non-commercial** ✗ | 4 B | MLX port | — | inline control tokens | none | **licence rules it out** |
| **IndexTTS-2** | bilibili Model Use Licence — commercial OK **below** 100 M MAU / RMB 1 B revenue | ~2 B+ | unverified | unverified | **8-dimension emotion vector**, emotion-from-text, emotion-from-audio, **explicit duration control** | unverified | *technically* the best control surface found. Custom licence + unverified Apple Silicon story |
| **F5-TTS** | **CC-BY-NC-4.0** ✗ | 336 M | — | — | — | — | **non-commercial** |
| **OpenAudio S1-mini** (Fish) | **CC-BY-NC-SA-4.0** ✗ | 0.5 B | — | — | emotion/tone markers | — | **non-commercial** |
| **Spark-TTS-0.5B** | **CC-BY-NC-SA-4.0** ✗ | 0.5 B | — | — | — | — | **non-commercial** |
| **XTTS-v2 (Coqui)** | **Coqui Public Model Licence — non-commercial** ✗ | — | — | — | style transfer by cloning | — | **non-commercial, and Coqui shut down Jan 2024 so no licence can be bought** |
| **Zonos-v0.1** | Apache-2.0 ✓ | 2 B | **Linux + NVIDIA only** (publisher) | — | emotion (happy/anger/sadness/fear), speaking rate, pitch std, fmax | — | best-documented conditioning vector; **wrong platform** |
| **Supertonic-3** | OpenRAIL | 99 M | ONNX everywhere, incl. Swift/iOS | "faster than realtime" on CPU | 10 inline expression tags | unverified | **repo being archived 2026-07-23, no further support** |
| **Kani-TTS-370M** | **conflicting**: card badge says Apache-2.0, HF metadata says `lfm1.0` | 370 M | unverified | ~1 s for 15 s audio on RTX 5080 | — | — | ambiguous licence = cannot pin |
| **CosyVoice2-0.5B** | Apache-2.0 ✓ | 0.5 B | unverified | unverified | instruction-following, fine-grained tags | unverified | plausible; not investigated deeply, low HF traction (4.2 k dl) |
| **MegaTTS3** | Apache-2.0 ✓ | — | unverified | unverified | accent/intensity control | unverified | ByteDance gated the WaveVAE encoder; low traction (308 dl) |
| **Parler-TTS mini v1** | Apache-2.0 ✓ | ~880 M | unverified | unverified | **natural-language description prompt** (the original of this idea) | none | superseded by Qwen3-TTS on quality; project quiet since Nov 2024 |
| **Piper** | MIT ✓ | ~20–60 M/voice | ONNX, everywhere, very fast | ≫ realtime | none | none | faster and *flatter* than Kokoro; a downgrade here |
| **MeloTTS** | MIT ✓ | VITS2 | MLX port | fast | `speed` only | none | lateral move from Kokoro |
| **StyleTTS2** | code MIT; LJSpeech checkpoint has no licence declared | — | — | — | style vector, diffusion sampler | none | Kokoro *is* a StyleTTS2 derivative; no upgrade path |
| **KittenTTS nano** | Apache-2.0 ✓ | ~25 M | MLX port | very fast | none | none | smaller and flatter |

### What that table says

- **The permissive expressive field is three names**: Chatterbox (MIT), Qwen3-TTS (Apache-2.0),
  Orpheus (Apache-2.0). Everything else is either non-commercial, wrong-platform, abandoned, or
  no better than Kokoro.
- **Every one of them loses word-level timestamps.** Kokoro's `pred_dur` is why bay's captions
  cannot drift from its audio — the single best property of the current narration path, and it
  is a property of Kokoro's architecture (explicit duration prediction), not of TTS generally.
  Autoregressive token models do not have it. Replacing Kokoro means adding a forced aligner
  (`Qwen3-ForcedAligner-0.6B-8bit`, Apache-2.0, 1.28 GB) or shipping worse captions.
- **Chatterbox watermarks its output.** "Every audio file generated by Chatterbox includes
  Resemble AI's Perth neural watermark… nearly 100 % detection accuracy." It survives MP3
  encoding and editing. That is not a manifesto violation — nothing leaves the Mac — but a studio
  whose pitch is *your machine, your files, nothing phones home* embedding a third party's
  identifying mark in the user's exported video is a product decision that must be made
  deliberately and disclosed, not absorbed as a dependency detail.
- **Chatterbox needs a reference clip.** `model.generate(text, audio_prompt_path=…)`. The repo
  ships `conds.pt` (169 KB) as a built-in default conditioning, but the documented path is
  cloning. Qwen3-TTS ships *named speakers* and needs no clip at all — which sidesteps the
  consent question entirely for the default path (see §4, cloning).

### Explicitly rejected: cloud TTS

ElevenLabs v3, Cartesia Sonic, OpenAI TTS and Google Chirp3-HD all beat every model above on
expressiveness, and several honour real SSML `<break time="450ms">` and `<emphasis>`.
**They are not an option.** Sending the user's script to a datacenter to be spoken violates
belief 1 (your Mac is not a thin client) and belief 5 (privacy is a property of the software) in
`MANIFESTO.md`, and it would make bay's narration require an account and a network. The tradeoff
being refused is real and worth naming: **bay is choosing a measurably less expressive voice in
exchange for the script never leaving the machine.** That is the correct trade for this studio,
and the honest way to describe the gap is not "our local TTS is as good" — it is "our local TTS
is behind, and here is what we do about it."

---

## 4. Expressive control, decomposed

"Emotion" is the wrong unit. Here is what a 60-second explainer actually needs, and who has it.

| control | why it matters here | who has it |
|---|---|---|
| **Authored pause, specific duration, specific place** | The beat before the payoff is the single most valuable device in teaching content. Measured above: bay currently has exactly one pause length, 0.30 s, everywhere. | **Nobody, in any local open model.** No open-weight neural TTS honours SSML `<break>`. IndexTTS-2's duration control is per-utterance token count, not per-gap. **This is won on the timeline, not in the model** — see §6. |
| **Emphasis on one word** | The highest-value control for teaching. "The loss lands on a **bigger** balance." | **Nobody.** Not Chatterbox, not Qwen3-TTS, not Orpheus. Approximations: split the phrase and re-time it; or drop the rate on the clause containing the word so the word lands late. |
| **Rate, per line** | The mechanism by which a read stops being monotone. | Kokoro `speed` ✓ (measured linear in duration). Qwen3-TTS via `instruct` ("slowly", "unhurried") — directional, not numeric. Chatterbox: `exaggeration` raises rate as a side effect, which is worse than no control. IndexTTS-2: explicit token-count duration. |
| **Pitch** | Register variation between sections. | Zonos (`pitch_std`) — wrong platform. Nobody else exposes it. Post-hoc `asetrate`+`atempo` in ffmpeg can shift pitch without changing rate; crude but real and available today. |
| **Energy / level, per line** | Cheapest expressive lever there is, and bay already has it. | bay: `volume` per clip + `animate` on `volume`. **Used at a constant 1.15 on all six clips.** |
| **Categorical emotion** | Marginal for explainer. You want "measured", "wry", "certain" — not "angry". | IndexTTS-2 (8-dim vector) — custom licence. Zonos (4 emotions) — wrong platform. Chatterbox `exaggeration` is one scalar of *intensity*, not a choice of affect. |
| **Natural-language style prompt** | The best fit for this genre: "read this like a documentary narrator, unhurried, certain." | **Qwen3-TTS `instruct=`** (Apache-2.0, MLX-native) — the only permissively-licensed, Apple-Silicon-native model with it. Parler-TTS had it first but is behind and quiet. |
| **Reference-clip style transfer** | Match a house voice across a catalogue. | Chatterbox, CSM, Higgs, XTTS, IndexTTS-2, OmniVoice. |
| **Paralinguistic tokens** (breath, laugh, sigh) | **For this genre: a gimmick.** A documentary explainer does not need a `[chuckle]`. A *breath* before a key line is genuinely useful; a laugh is not. Chatterbox/Orpheus/Supertonic offer laughs and coughs; none offers a controllable breath at a chosen point. | Chatterbox `[laugh] [chuckle] [cough]`; Orpheus 8 tags; Supertonic 10 tags incl. `<breath>` (archived). |
| **SSML** | — | **None of them.** Kokoro rejects it outright (178-token phoneme vocabulary). The LM-based models take plain text with inline bracket tags at best. Any documentation promising SSML in a local open model is describing a wrapper that strips it. |

### The consent dimension of voice cloning — flag, not resolved

Chatterbox, XTTS, CSM, Higgs and IndexTTS-2 all clone a voice from 5–10 seconds of reference
audio. If bay exposes that, bay ships the ability to make a named person say something they did
not say, entirely offline, with no rate limit and no provider to appeal to. Two observations for
whoever decides:

- Microsoft's answer for VibeVoice was an **audible disclaimer** in every output. Resemble's was
  an **inaudible watermark**. Both concluded a mitigation was mandatory. Neither is free — the
  first destroys the product, the second puts a third party's mark in the user's file.
- **bay can decline the question entirely by choosing a model with built-in speakers.** Kokoro
  (54 voices) and Qwen3-TTS CustomVoice (9 named speakers) both work with no reference clip.
  That is a genuine argument for Qwen3-TTS over Chatterbox that has nothing to do with quality.

This needs a studio position before any cloning-capable model ships. It is not mine to make.

---

## 5. What makes narration not bland — independent of the model

This section is worth more than §6 and costs a fraction as much.

### 5.1 Pace: the number bay is missing

| genre | WPM |
|---|---|
| teaching / tutorial / complex concept | **130–150** |
| explainer, product, "clear with momentum" | **150–160** |
| energetic ad / hype | 170–190 |
| **`wicks-v2.mp4`, measured** | **179 mean, 217 on the payoff line** |

Measured Kokoro rate response for the payoff line (14 words), `af_heart`:

| `speed` | duration | WPM | synth time | RTF |
|---|---|---|---|---|
| 0.80 | 4.97 s | 169 | 0.53 s | 9.3× |
| 0.90 | 4.25 s | 198 | 0.34 s | 12.4× |
| 1.00 | 3.95 s | 213 | 0.32 s | 12.4× |
| **1.06** (what shipped) | 3.88 s | **217** | 0.32 s | 12.0× |
| 1.15 | 3.73 s | 226 | 0.30 s | 12.3× |

**`speed: 1.06` is ad pace. The explainer register for Kokoro is `speed` ≈ 0.70–0.80, not
1.0–1.15.** The skill currently tells the agent "around 1.0–1.15 suits a reel" and, when a line
overruns, "raise `speed`" — both push toward 220 WPM. That advice is the proximate cause of the
rushed read and it costs nothing to change.

Where to slow down, concretely: the last clause of the piece, the sentence that names the
mechanism, and the first line after a hard visual cut. Where to speed up: enumerations and any
clause the picture already carries.

**Why a constant rate reads as synthetic even from a good model:** human speech rate varies
±25 % *within* a paragraph — it accelerates through given information and decelerates into new
information. A constant rate strips the listener of the cue that tells them what matters. bay
delivers a constant `speed` *parameter* and, worse, a rate that drifts in the wrong direction
(167 → 217, ending fastest). Neither is a choice.

### 5.2 Writing for a machine to read

A model cannot put emphasis where the sentence gives it nowhere to land. Four rules that change
what any TTS can do with a line:

1. **Put the operative word last.** Kokoro, like every duration-predicting model, lengthens and
   drops pitch on the final stressed syllable of a clause. "The loss lands on a bigger balance"
   gets emphasis on *balance*; "A bigger balance is what the loss lands on" gets it on *on*.
   Rewrite until the word you want emphasised is the last content word.
2. **One clause per breath, ≤ 14 words.** The shipped script's third line is 29 words in one
   `narrate` call and comes out as 10.3 s of unbroken delivery. Nothing in it can be pointed at.
3. **Full stops, not commas, at every real beat.** Measured: Kokoro gives ~0.30 s at a sentence
   boundary and nothing at a comma. A comma buys no pause at all. If you want a beat, end the
   sentence — or, better, end the `narrate` call (§5.3).
4. **Never write a number the frame already shows.** Already in `narration.md` and it is right;
   it also happens to be the rule that most improves the *sound*, because it removes the
   list-like clauses TTS reads worst.

### 5.3 Chunking: per-phrase synthesis is the whole ballgame

Currently: 6 clips / 61 s. The right unit is **the phrase — 6 to 14 words — not the paragraph.**

I ran the A/B. Version A reproduced the shipped narration exactly (36.15 s, 108 words, 179 WPM
— identical to the shipped audio, confirming the harness). Version B synthesised the same 108
words as **17 phrases** with authored per-phrase `speed` (0.62–0.80) and authored gaps
(0.14–0.55 s), placed on a timeline.

Result: 60.20 s gross. Subtracting the measured per-chunk padding (17 × ≈0.77 s ≈ 13.1 s) gives
**≈47.1 s of actual speech = ≈137 WPM** — squarely in the teaching band, with 12 authored beats
of five different lengths where there were previously only fixed 0.30 s ones.

What per-phrase synthesis buys:

- **rate per phrase** — the only way to slow the payoff and keep the setup moving;
- **an authored gap of a chosen length in a chosen place** — the control no model exposes;
- **level per phrase** — drop 1.5 dB into a parenthetical, come back up for the point;
- **retakes of one line** without re-rendering the paragraph. The producing session already did
  this three times, so it is a workflow that exists and is cheap.

What it costs:

- **17 clips instead of 6.** Manageable, but the timeline gets busier and `check`'s per-element
  reasoning sees more elements. Group them or tag them as one narration lane.
- **17 × 0.77 s of padding that must be trimmed**, or the read drags — this is the trap, and it
  belongs in `bay-speech`, not in the agent's head.
- **Synthesis time.** Measured 12× realtime; 47 s of speech is ~4 s of compute. Irrelevant.
- **Caption assembly across chunks.** The sidecar already handles per-chunk timestamp offsets
  (`script/bay-kokoro.py:172`); it needs the same across `narrate` calls.

Corollary that matters for the whole round: **this is the mechanism by which the "beat before the
payoff" becomes possible at all.** It is not a nicety on top of a model swap; it is the thing a
model swap cannot give you.

### 5.4 Level and processing

**Normalise to LUFS, not to peak.** Measured: the four authentic lines peak-normalised to
exactly −2.0 dBFS still land at −19.5 / −19.6 / −20.8 / −20.9 LUFS — a **1.4 LU spread**, audible
as level drift. Loudness-normalising removes it by construction. `narrate` should target
integrated loudness (≈ −19 LUFS for the stem, ceiling −2 dBTP) and keep `peakDb` only as an
escape hatch.

**A hard ceiling worth knowing:** Kokoro outputs **24 kHz mono**. Measured spectral content —
mean level is −26.4 dB full-band, −45.8 dB above 10 kHz, −55.8 dB above 11.5 kHz. There is
nothing above ~11 kHz. No treatment can add air that was never synthesised; a 24 kHz voice will
always sound smaller than a 48 kHz one. (Chatterbox and Supertonic output higher rates; Supertonic
44.1 kHz. Qwen3-TTS output rate **unverified**.)

**Tested chain** (every filter confirmed present in the pinned FFmpeg 9.0):

```
highpass=f=85,
equalizer=f=250:t=q:w=1.0:g=-2,      # de-mud
equalizer=f=3200:t=q:w=1.2:g=2.5,    # presence / consonant clarity
deesser=i=0.4:m=0.5:f=0.5,
acompressor=threshold=-20dB:ratio=3:attack=5:release=140:makeup=2,
alimiter=limit=0.891:level=disabled, # -1 dBTP
loudnorm=I=-19:TP=-2:LRA=7
```

Measured on narration-1: −25.8 LUFS / LRA 1.0 → **−16.2 LUFS / LRA 0.8** (I tested at I=−16;
use −19 for a stem that still has a bed to sit over).

**Be clear about what this does and does not do.** It makes the voice present, consistent and
loud enough. **It made LRA go 1.0 → 0.8 — compression makes a flat read flatter.** Processing
cannot manufacture expression. It is worth doing, it is not the fix, and anyone reporting "we
added a voice chain, the mix scores better" has repeated the exact error EVIDENCE.md's
meta-finding describes.

### 5.5 The bland read is partly a mix problem

From EVIDENCE.md §10: zero volume keyframes in the entire project; ducking implemented by
slicing the bed into 13 segments with stepped constant gains, the un-ducked state at `vol = 2.0`
(+6 dB, above unity), producing LRA 3.5 LU overall.

A voice that never gets out of a bed's way — and a bed that never gets out of the voice's — reads
as flat *whatever the voice is doing*. The two interact: a bed that steps down 6 dB the instant a
line starts and steps back the instant it ends draws a box around every line and makes identical
lines sound even more identical. A bed that rides down over ~250 ms and back over ~600 ms, with
the duck depth varying by line, makes the *same* narration sound directed.

**bay already supports this and it was not used.** `animate` accepts `volume` on an audio clip
(`bay-mcp/src/tools.rs:308,342`), and `bay-audio` supports a per-clip level curve
(`bay-audio/src/lib.rs:67-71`). The fix is one bed element with keyframes derived from the
narration's real word timings — which bay has, because Kokoro reports them. Nothing needs to be
built.

Recommended relationship, with the voice stem at −19 LUFS: bed ducked to **12–14 dB** below the
voice during speech, recovering to **6–8 dB** below between lines (not to unity, and never above
it), with an attack around 200–300 ms and a release around 500–700 ms so the recovery is heard as
music breathing rather than a gate opening.

---

## 6. The recommendation

### First choice — keep Kokoro; build the authoring surface it never had

**Not because Kokoro is good. Because the measurements say the model is not the binding
constraint yet, and the work that fixes it is also work every future model needs.**

Justification against the criteria:

- **Manifesto:** unchanged. Local, no telemetry, already offline-pinned (`HF_HUB_OFFLINE`).
- **Licence:** Apache-2.0, already pinned by commit SHA. Nothing to renegotiate.
- **Size:** +0 bytes. Every alternative costs 2.5–4.5 GB on top of the current 1.56 GB.
- **Apple Silicon:** 12× realtime measured, 1.4 s cold load, and it works on Intel Mac and
  Windows — which the manifest's `every_shipped_target_can_render_and_speak` test requires and
  no MLX model can satisfy.
- **Expressive control:** this is where it loses, and the honest accounting is that of the seven
  controls in §4, **per-phrase rate, authored pause, per-phrase level and script structure are
  four of them, and all four are reachable with Kokoro today.** Emphasis, pitch and style
  prompting are not, and will not be.
- **Integration effort:** contained inside `bay-speech` + `narrate` + `narration.md`. No new
  artifact, no new licence, no new provisioning target.

**What would make me wrong:** if after per-phrase narration, correct pace, LUFS normalisation
and real ducking, the read still sounds mechanical in a side-by-side — then the ceiling is the
model and the second choice earns its download. That test is cheap and should be run.

### Second choice — add Qwen3-TTS-CustomVoice as an optional expressive engine on Apple Silicon

**Coexists with Kokoro; does not replace it.**

- **Apache-2.0** — the cleanest licence of anything with real expressive control, and the only
  permissive model offering **natural-language style direction** (`instruct=`), which is exactly
  the control this genre wants.
- **9 built-in named speakers, no reference clip** — sidesteps the cloning-consent question for
  the default path entirely. Chatterbox cannot say this.
- **No watermark.** Chatterbox cannot say this either.
- **Native MLX**, 2.70 GB at 6-bit, 1.67× realtime batch-1 and **4.26× at batch 4** — and
  per-phrase narration is inherently a batch of 17 short lines, so the batching benefit is
  exactly aligned with the architecture in §5.3.
- **Costs:** English speakers are only `Ryan` and `Aiden` (thin); no word timings, so captions
  need `Qwen3-ForcedAligner-0.6B-8bit` (Apache-2.0, +1.28 GB); Apple-Silicon-only, so it cannot
  be the `speech` component; output sample rate **unverified**; `instruct` is directional, not
  numeric — it will not reliably hit 145 WPM, so per-phrase rate control still has to come from
  splitting and re-timing.

**Third choice — Chatterbox-Turbo (MIT).** Better raw naturalness than Qwen3-TTS by reputation
(unverified head-to-head), a real intensity knob, and paralinguistic tags. Ranked below because
of three specific things, not vibes: **the PerTh watermark in every exported file**, the
**reference-clip-first design** with its consent question, and **`exaggeration` raising speaking
rate as a side effect** — which is a control that fights the single measured defect. Reconsider
if the watermark can be disabled in a way Resemble sanctions, or if a listening test puts it
clearly ahead.

**Would switch to IndexTTS-2** if the bilibili licence is cleared by someone qualified and its
Apple Silicon story turns out to be real. It is the only model found with an 8-dimension emotion
vector *and* explicit duration control — on paper the best control surface in open weights. Both
of those are unverified and both are blocking.

---

## 7. The integration spec

### 7.1 `narrate`'s new parameter surface

Additive; every existing call keeps working. The unit changes from paragraph to **line**, and a
line is a list of **phrases**.

```jsonc
{
  "start": 55.6,
  "voice": "af_heart",
  "engine": "kokoro",           // new; "qwen3-custom" when the second engine lands
  "targetWpm": 142,             // new; bay solves for `speed` per phrase (see 7.3)
  "loudnessLufs": -19.0,        // new; replaces peakDb as the default. peakDb stays, deprecated
  "treat": true,                // new; run the §5.4 chain before the clip hits the timeline
  "phrases": [                  // new; the paragraph form stays valid and is treated as one phrase
    { "text": "The body tells you where it ended.", "wpm": 150, "gapAfter": 0.55 },
    { "text": "The wick tells you what it cost.",   "wpm": 128, "gain": 1.5,
      "instruct": "unhurried, certain, landing on the last word" }   // ignored by kokoro
  ]
}
```

Per-phrase keys: `text` (required), `wpm` (overrides `targetWpm`), `gapAfter` seconds (**the
authored pause — the control no model has**), `gain` dB relative to the line, `instruct`
(honoured by an engine that has style prompting, ignored with a note by one that does not —
never silently dropped).

Returns, per phrase and for the line: `startSeconds`, `endSeconds`, **`deliveredWpm`**,
`articulationWpm` (padding removed), `trimmedHead`/`trimmedTail`, `integratedLufs`, and the cues.
**`deliveredWpm` is the important one** — today the agent flies blind, which is how the payoff
line ended up at 217.

### 7.2 `manifest.json` — what the second engine needs

Kokoro needs no manifest change. For Qwen3-TTS, the entry follows the existing `kokoro-model`
shape exactly (immutable `resolve/<commit-sha>/` URLs, per-file SHA-256, per-target builds):

```jsonc
{
  "id": "qwen3-tts-customvoice",
  "name": "Qwen3-TTS CustomVoice 1.7B (6-bit MLX)",
  "source": "https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit",
  "license": "Apache-2.0",
  "format": "raw",
  "install": "files",
  "builds": [ { "target": "macos-aarch64",
    "url": "https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit/resolve/<COMMIT-SHA>/model.safetensors",
    "sha256": "<shasum -a 256 of the download>",
    "bytes": 0, "files": [ /* … */ ] } ]
}
```

Real values I verified, for whoever pins it:

| artifact | licence | total repo size |
|---|---|---|
| `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit` | Apache-2.0 | **2,696.1 MB** |
| `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16` | Apache-2.0 | 4,520.2 MB |
| `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit` | Apache-2.0 | 1,973.6 MB |
| `mlx-community/Qwen3-ForcedAligner-0.6B-8bit` (captions) | Apache-2.0 | 1,276.5 MB |
| `mlx-community/chatterbox-fp16` (for comparison) | MIT | 2,576.6 MB |
| `mlx-community/chatterbox-multilingual-v3` | MIT | 2,713.1 MB |

The per-file SHA-256 values must be computed at pin time from the actual download — I did not
download the weights, so **I have not verified any digest** and none should be copied from here.
Note the commit SHA must be substituted for `main`: `resolve/main/…` is mutable and the existing
`no_pinned_url_is_a_mutable_tag` test will not catch it (it only rejects `/latest/`), so **that
test should be extended to reject `/resolve/main/`** — a real gap the Kokoro pins happen not to
hit because they already use a commit SHA.

Component sizing: a `speech-expressive` component would be **≈4.0 GB** (engine 2.70 + aligner
1.28) on top of the existing 1.56 GB `speech`. That is the honest number to show the user, and
it is a lot — which is itself an argument for the first choice.

`every_shipped_target_can_render_and_speak` must keep passing: leave `speech` = Kokoro for all
three targets, and register `speech-expressive` as macOS-aarch64-only. The test iterates
`["video", "speech"]` explicitly, so it will not fail — but it should gain an assertion that at
least one speech component covers every target, or the invariant silently weakens.

### 7.3 What changes in `bay-speech`

1. **`trim_padding()`** — strip Kokoro's measured 0.30–0.38 s head and 0.44–0.50 s tail, using
   the first and last word span the sidecar already returns rather than a level threshold. This
   is the prerequisite for everything else; without it authored gaps stack on model silence.
2. **`speed` solver.** `duration ∝ 1/speed` (confirmed in `kokoro/model.py:108`:
   `duration = sigmoid(duration).sum(-1) / speed`), so a target WPM is one synth-and-correct
   round trip: synthesise at 0.85, measure trimmed WPM, rescale, re-synthesise. At 12× realtime
   a second pass costs ~60 ms per phrase. Clamp `speed` to 0.55–1.30 and report when the clamp
   binds instead of silently missing the target.
3. **`speak_line(phrases) -> Line`** — synthesise each phrase, trim, apply `gapAfter`, apply
   per-phrase `gain`, concatenate word spans with correct offsets, and return one contiguous
   utterance plus per-phrase metadata. **Keep it in `bay-speech`, not `bay-mcp`** — the GPUI app
   and any headless client need it equally (CLAUDE.md: never put logic in the UI crate a headless
   client would need).
4. **LUFS normalisation** replacing peak as the default, via the ffmpeg bay already requires;
   degrade to peak normalisation with a message when ffmpeg is absent, per the existing
   graceful-skip rule.
5. **Optional treatment chain** (§5.4) behind `treat`, applied to the assembled line.
6. **An `Engine` trait** — `speak(text, voice, rate_hint, style) -> (wav, Option<word_spans>)` —
   so a second engine is a new impl and not a fork of the sidecar protocol. Kokoro returns
   `Some(spans)`; an aligner-backed engine fills them in.

### 7.4 What `narration.md` would then say

Replace three things outright:

- **"Kokoro at `speed: 1.06` runs roughly 2.5 words/second"** → measured 2.99 w/s; and the whole
  budgeting section moves from words-per-second to **target WPM**, with the table from §5.1 and
  the explicit statement that **130–150 WPM is the register and `speed` ≈ 0.70–0.80 is where
  Kokoro delivers it.**
- **"A full stop buys a real pause; a comma buys a short one."** → measured: a full stop buys a
  fixed ≈0.30 s and a comma buys nothing. **Pauses are authored with `gapAfter`, not punctuation.**
- **"Fix by starting earlier, shortening the line, or raising `speed` — in that order."** →
  raising `speed` is removed as a remedy. The order becomes: cut a clause the picture already
  carries; start earlier; shorten the beat. **Never speed up to fit.**

Add:

- **Write in phrases.** One `narrate` call per line, `phrases` inside it, 6–14 words each.
- **Put the operative word last** (§5.2), with the before/after example.
- **Slow the payoff.** The last line of the piece takes the lowest WPM in the video. Name it as a
  rule, because the measured failure is precisely the inverse.
- **The beat is a number.** `gapAfter: 0.5` before the payoff, `0.2` between clauses of one
  thought, `0.0` inside a phrase.
- **Level is a decision, per phrase.** Not `volume: 1.15` six times.
- **Duck the bed with keyframes on one element** — cross-reference `audio.md`, and state that
  slicing a bed into segments with stepped gains is the failure mode, not the technique.

### 7.5 Coexistence

**Kokoro stays.** It is the only engine that runs on all three shipped targets, the only one with
native word timings, it is 328 MB against 2.7–4.5 GB, it is 12× realtime against 1.67×, and its
licence is already cleared and pinned. A second engine is an opt-in component the user is offered
and never gets by surprise — which is what `bay-provision` is for.

The right shape is **Kokoro as the default and the fallback; an expressive engine as an upgrade
on Apple Silicon**, selected per `narrate` call via `engine`, with `speech_status` reporting which
engines are installed and what controls each honours. An `instruct` passed to Kokoro must produce
a visible note, never silence.

---

## 8. The ceiling — honestly

**Local open-weight TTS in 2026 still sounds noticeably synthetic for long-form narration, and
no model in §3 changes that.** The specific gaps, from the evidence above:

- **No local open model can place a pause of a chosen length at a chosen point.** Not one. This
  is the highest-value control for explainer content and it is simply absent from the field.
- **No local open model can emphasise a named word.** Also absent, across the board.
- **SSML is not honoured anywhere.** Every "SSML support" claim I chased was a wrapper stripping
  tags before inference.
- **Style prompting is directional, not numeric.** `instruct="unhurried"` will not deliver 145
  WPM; it will deliver *slower than whatever it would otherwise have done*, which you cannot
  budget a 61-second timeline against.
- **The controls that do exist are often the wrong ones.** Chatterbox's `exaggeration` raises
  speaking rate as a side effect. Orpheus and Supertonic offer laughs and coughs. Those are
  controls for character voice acting, not for teaching.

Against that, here is what the measurements say the actual defect was:

| defect | measured | fixed by a model swap? |
|---|---|---|
| 179 WPM mean, 217 on the payoff | yes | **no** — set the rate |
| Payoff line fastest in the video | yes | **no** — author it |
| Every pause exactly 0.30 s | yes | **no** — no model offers this; the timeline does |
| ~0.77 s of unaccounted padding per call | yes | **no** — trim it |
| LRA 0.9–2.0 LU per line | yes | **partly** — a better model gives maybe 3–5 LU |
| 1.4 LU level drift between lines | yes | **no** — normalise to LUFS |
| `volume: 1.15` on all six clips | yes | **no** — that is an authoring decision |
| Bed ducked by slicing, +6 dB between lines | yes | **no** — keyframe it |
| 24 kHz band limit, nothing above 11 kHz | yes | **yes** — this one genuinely needs a new model |
| Timbre reads as TTS | yes | **yes, partly** |

**Eight of ten are authoring and mix problems.** The two that a model swap actually fixes are the
sample-rate ceiling and some of the timbre — worth having, worth 4 GB eventually, not worth
doing first and not worth doing instead.

So the truthful ranking of expected improvement per unit of effort is:

1. **Per-phrase synthesis with authored rate, gaps and level** — the largest single gain, no
   download, contained in `bay-speech`.
2. **Script written for speech** (operative word last, ≤14-word clauses, cut to fit the pace
   rather than speeding up to fit the runtime) — free, and it raises the ceiling of every
   subsequent step.
3. **Real ducking + LUFS normalisation + the voice chain** — cheap, measurable, and the reason a
   flat read sounds flatter than it is.
4. **A model swap.**

One last caution, in the spirit of this round's meta-finding. **Do not turn this into a metric an
agent can satisfy.** "Number of distinct `speed` values used" would be gamed within one video
exactly as 19 easings and 47 durations were. If a check is added, check the *distribution against
the genre*: delivered WPM per line inside 125–165 with the final line at or below the piece's
median; every authored gap present and none of them all-equal; and no line whose articulation
rate (padding removed) exceeds 200 WPM. Those are properties a good read has and a gamed one
cannot fake, because they are measured on the rendered audio rather than on the parameters that
produced it.

---

## Sources

- [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) · [Curb Your Expectations: Data & Architecture Limitations](https://huggingface.co/hexgrad/Kokoro-82M/discussions/69) · [hexgrad/kokoro](https://github.com/hexgrad/kokoro)
- [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox) · [ResembleAI/chatterbox](https://huggingface.co/ResembleAI/chatterbox) · [chatterbox-turbo](https://huggingface.co/ResembleAI/chatterbox-turbo) · [Perth watermarker](https://github.com/resemble-ai/perth)
- [Blaizzy/mlx-audio](https://github.com/Blaizzy/mlx-audio) · [Qwen3-TTS README](https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/tts/models/qwen3_tts/README.md)
- [Qwen3-TTS-12Hz-1.7B-CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice) · [VoiceDesign](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign)
- [IndexTTS2 (arXiv 2506.21619)](https://arxiv.org/abs/2506.21619) · [IndexTeam/IndexTTS-2 licence](https://huggingface.co/IndexTeam/IndexTTS-2/raw/main/LICENSE.txt)
- [microsoft/VibeVoice-1.5B](https://huggingface.co/microsoft/VibeVoice-1.5B) · [bosonai/higgs-audio-v2](https://huggingface.co/bosonai/higgs-audio-v2-generation-3B-base) · [higgs-audio-v3](https://huggingface.co/bosonai/higgs-audio-v3-tts-4b)
- [canopyai/Orpheus-TTS](https://github.com/canopyai/Orpheus-TTS) · [Zyphra/Zonos-v0.1](https://huggingface.co/Zyphra/Zonos-v0.1-transformer) · [nari-labs/Dia-1.6B](https://huggingface.co/nari-labs/Dia-1.6B) · [sesame/csm-1b](https://huggingface.co/sesame/csm-1b)
- [SWivid/F5-TTS](https://huggingface.co/SWivid/F5-TTS) · [fishaudio/openaudio-s1-mini](https://huggingface.co/fishaudio/openaudio-s1-mini) · [SparkAudio/Spark-TTS-0.5B](https://huggingface.co/SparkAudio/Spark-TTS-0.5B) · [coqui/XTTS-v2](https://huggingface.co/coqui/XTTS-v2) · [Coqui XTTS licence analysis](https://aimodels.org/ai-blog/coqui-xtts-license-cpml-open-source/)
- [supertone-inc/supertonic](https://github.com/supertone-inc/supertonic) (archival notice) · [nineninesix/kani-tts-370m](https://huggingface.co/nineninesix/kani-tts-370m)
- [FFmpeg filter documentation](https://ffmpeg.org/ffmpeg-filters.html) · [Two-pass loudnorm](https://dev.to/masonwritescode/two-pass-loudness-normalization-with-ffmpeg-loudnorm-the-right-way-1nm3)
- [SSML support across TTS providers](https://picovoice.ai/blog/ssml-text-to-speech/) · [Explainer voiceover pacing](https://voicebros.com/en/blog/explainer-video-voice-over-guide) · [AI voiceover speed by genre](https://channel.farm/blog/how-to-choose-ai-voiceover-speed-tone-youtube-video-genres)
