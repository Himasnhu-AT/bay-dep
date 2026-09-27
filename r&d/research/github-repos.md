# Open-source repos that edit video for engagement

*Researched 2026-09-27. Stars, last push and licence come from the GitHub API on that date. Defaults were read from each repo's source or docs, not from blog posts.*

## Summary

The open-source field splits into three layers. **Signal cutters** (auto-editor, jumpcutter, unsilence) make a keep/drop decision per frame from loudness, then pad and smooth it. Their numbers are small and worth copying exactly. **Clip factories** (OpenShorts, AI-Youtube-Shorts-Generator, ClipsAI, FunClip, MoneyPrinterTurbo, OpenMontage) chain the same pipeline: transcribe, have an LLM score the moments, reframe to 9:16, then add karaoke captions, hook text and B-roll. bay already covers most of that pipeline except **reframing** and **audio-level silence cutting**. **Academic work** (Moment-DETR/QVHighlights, UniVTG, Lighthouse, SnapUGC) gives per-clip saliency scores and a real engagement target (watch percentage) instead of an LLM's guess. The biggest gaps in bay: (1) subject/speaker-aware reframing, (2) a deterministic silence/filler detector feeding `remove_range`, (3) automatic punch-in placement, (4) SFX/sound design, and (5) music-energy-aware cut density.

## 1. Silence cutting / jump cuts

| Repo | Licence · ★ · last push | What it does | Technique worth copying | Borrow? |
|---|---|---|---|---|
| [WyattBlue/auto-editor](https://github.com/WyattBlue/auto-editor) | Unlicense · 5.4k · 2026-09 | Cuts or speeds up "inactive" sections. Exports to Premiere, Resolve, FCP and Shotcut timelines. | Audio threshold **0.04** linear (about −28 dBFS). Margin **0.2 s** added each side of loud sections. `--smooth 0.2s,0.1s`: mincut **0.2 s** (shorter silences are kept) and minclip **0.1 s** (shorter loud blips are dropped). Motion method: threshold 0.02 with blur 9, analysed at 400 px width. Methods combine with boolean logic (`audio or motion`). | **Yes.** It is the reference algorithm. Unlicense, so it can be ported freely. |
| [carykh/jumpcutter](https://github.com/carykh/jumpcutter) | MIT · 3.1k · 2024 (dormant) | The original jump-cutter. | `silent_threshold` **0.03** (about −30 dBFS, measured against the clip's peak), `frame_margin` **1** frame, `silent_speed` 5 (999999 means cut). | Idea only. Superseded. |
| [lagmoellertim/unsilence](https://github.com/lagmoellertim/unsilence) | MIT · 594 · 2023 | Speeds up silences instead of cutting them. | `silence-level` **−35 dB**, `silence-time-threshold` **0.5 s**, `short-interval-threshold` **0.3 s**, `stretch-time` **0.25 s** (pads audible intervals), `minimum-interval-duration` 0.25 s. Silent parts play at **6×** and **0.5×** volume. | **Yes** as a "speed up pauses" mode (bay has item speed). Good for tutorials. |
| [mifi/lossless-cut](https://github.com/mifi/lossless-cut) | GPL-2.0 · 44k · 2026-09 | Lossless trimmer with silence/black/scene detection via ffmpeg `silencedetect`/`blackdetect`. | Exposes ffmpeg's `noise`/`duration` knobs to the user rather than hiding them. | No. GPL, and bay has its own cutter. |

## 2. Long-form → shorts (highlights, virality)

| Repo | Licence · ★ · last push | What it does | Technique | Borrow? |
|---|---|---|---|---|
| [mutonby/openshorts](https://github.com/mutonby/openshorts) | custom · 5.7k · 2026-09 | Self-hosted Opus Clip: shorts, hook text, B-roll, publishing. | The LLM returns **3–15 moments of 15–60 s** each, using transcript **plus scene boundaries**. Four reframe modes per scene: TRACK (MediaPipe + YOLOv8 face track), GENERAL (blurred-background fit), **SPLIT** (two speakers stacked, captions on the seam) and SCREENCAST. | **Yes**, the mode taxonomy and "captions on the seam". Do not copy code (licence unclear). |
| [Anil-matcha/AI-Youtube-Shorts-Generator](https://github.com/Anil-matcha/AI-Youtube-Shorts-Generator) | MIT · 5.2k · 2026-09 | Ranks clips with an LLM, then crops with face tracking. | Rubric: hooks, emotional peaks, "opinion bombs", revelations, conflict, quotable lines, story peaks, practical value. Each pick returns **score + hook line + one-sentence reason**. Overlapping picks are **deduped by score**. | **Yes.** Add `hook`/`reason` and overlap-dedupe to `mark_highlights`. |
| [ClipsAI/clipsai](https://github.com/ClipsAI/clipsai) | MIT · 543 · 2024 | Finds topic segments, plus speaker-aware 9:16 resize. | **TextTiling on sentence embeddings** (smoothing width 3, max pooling) with clips of **15–900 s**. Resize uses pyannote diarization and face detection: min segment **1.5 s**, **13 samples per segment**, face margin 20 px, min scene 0.25 s. | **Yes.** Topic-boundary snapping is a deterministic complement to LLM picks. |
| [modelscope/FunClip](https://github.com/modelscope/FunClip) | MIT · 6.3k · 2026-09 | LLM clipping over an SRT, plus speaker-ID clipping (CAM++). | "Clip everything speaker X says" and hotword-biased ASR. | Partial. Speaker-targeted cuts need diarization, which bay lacks. |
| [harry0703/MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) | MIT · 126k · 2026-09 | Topic → script → stock B-roll → TTS → subtitles. | Stock clips chosen by LLM keywords per sentence, with the clip length set to the sentence's TTS length. | No. Faceless-content farm, not editing. |

## 3. Captions with word timing

| Repo | Licence · ★ · last push | What it does | Technique | Borrow? |
|---|---|---|---|---|
| [m-bain/whisperX](https://github.com/m-bain/whisperX) | BSD-2 · 24k · 2026-09 | Whisper with wav2vec2 forced alignment, VAD batching and pyannote diarization. | Words aligned by **phoneme forced alignment**, not Whisper's token times. VAD pre-segmentation cuts hallucination. | **Yes** for diarization and alignment quality, if whisper.cpp `-ojf` times drift. |
| [jianfch/stable-ts](https://github.com/jianfch/stable-ts) | MIT · 2.3k · **archived 2026** | Stabilises Whisper timestamps and regroups segments into caption lines. | `suppress_silence` snaps word edges out of detected silence (`q_levels` 20). `min_word_dur` **0.1 s**. A regroup grammar splits on punctuation and gaps, then merges short lines. | **Yes**, the silence-snapping idea (clean word edges also give cleaner cuts). Archived, so port it rather than depend on it. |
| [linto-ai/whisper-timestamped](https://github.com/linto-ai/whisper-timestamped) | AGPL-3 · 2.8k · 2026-08 | Word times from cross-attention DTW, with per-word confidence. | Per-word **confidence** can flag misheard words before they are burned in. | Idea only (AGPL). |
| [remotion-dev/template-tiktok](https://github.com/remotion-dev/template-tiktok) | Remotion licence · 282 · 2026-09 | TikTok-style captions. | Words are paged with `combineTokensWithinMilliseconds` = **1200 ms**. The source comments say 200 ms gives one word at a time and 1500 ms a line. | **Yes.** Expose "page length (ms)" on bay's subtitle designs. |

## 4. Reframing / speaker tracking

| Repo | Licence · ★ · last push | What it does | Technique | Borrow? |
|---|---|---|---|---|
| [google-ai-edge/mediapipe — AutoFlip](https://github.com/google-ai-edge/mediapipe/tree/master/mediapipe/examples/desktop/autoflip) | Apache-2.0 · 37k · 2026-09 (AutoFlip is legacy) | Saliency-aware reframing. | Tiered signal scores: face landmarks **0.85–0.9**, full face 0.8–0.85, human **0.75–0.8**, pet/car 0.7–0.75, generic object 0.1–0.2 (any tier can be marked `is_required`). Shot detection uses `min_shot_span` **0.2 s**. `motion_stabilization_threshold_percent` **0.5**: if the subjects move less than that, the camera stays **stationary**; otherwise it pans or tracks. `max_scene_size` 600 frames. | **Yes.** Port the design: per-shot camera-mode choice, with the priorities as data. |
| [KazKozDev/auto-vertical-reframe](https://github.com/KazKozDev/auto-vertical-reframe) | MIT · 21 · 2026-04 | 9:16 reframing. | PySceneDetect `AdaptiveDetector` per scene, YOLOv11-seg + ByteTrack, a subject-ranking model (face/pose/saliency), then a **path optimizer** that smooths pan and zoom. | Yes, the pipeline shape. Small project. |
| [TaoRuijie/TalkNet-ASD](https://github.com/TaoRuijie/TalkNet-ASD) / [Junhua-Liao/Light-ASD](https://github.com/Junhua-Liao/Light-ASD) | MIT · 505 / 191 | Active-speaker detection from audio and face tracks. | Picks *which* face is talking, which is the input a podcast reframe needs. Light-ASD is roughly 1M parameters and runs on CPU. | **Yes.** Needed for multi-person reframe. |

## 5. LLM editing agents / programmatic pipelines

| Repo | Licence · ★ · last push | What it does | Technique | Borrow? |
|---|---|---|---|---|
| [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage) | AGPL-3 · 61k · 2026-09 | Agentic production system: 12 pipelines, 700+ skill files. | "Retrieval-first B-roll". Production knowledge is kept as skill files, which is the same bet bay made. | Idea only (AGPL). Skim its skill list for missing know-how. |
| [FireRedTeam/FireRed-OpenStoryline](https://github.com/FireRedTeam/FireRed-OpenStoryline) | Apache-2.0 · 3.4k · 2026-07 | An LLM plans the edit, with human-in-the-loop and reusable "Style Skills". | Style captured as a reusable skill (pacing, captions, music) applied across projects. | **Yes**, the "style skill" idea for bay skills. |
| [HKUDS/VideoAgent](https://github.com/HKUDS/VideoAgent) | MIT · 1.9k · 2026-07 | Agent framework for video understanding, editing and remaking. | Builds the workflow automatically from the tool graph. | Low. Research. |
| [video-db/Director](https://github.com/video-db/Director) | MIT · 1.5k · 2026-01 | Chat agents over a video DB: search, clip, dub, subtitle. | Index once, then compose edits from semantic search hits. | Already covered by SigLIP search. |
| [notivn/AIEV](https://github.com/notivn/AIEV) | MIT · 123 · 2026-09 | Claude directs HyperFrames and Remotion: karaoke subs, kinetic type, SFX, ducked music. | A curated **SFX set placed by the LLM** at cuts and emphasis. Music auto-ducks under speech. | **Yes**, the SFX-library pattern. |
| [Zulko/moviepy](https://github.com/Zulko/moviepy) | MIT · 15k · 2026-08 | Python compositing that most pipelines above are built on. | Nothing bay lacks. | No. |

## 6. Punch-ins, sound design, beat sync

| Repo | Licence · ★ · last push | What it does | Technique | Borrow? |
|---|---|---|---|---|
| [Merserk/BeatSync-Engine](https://github.com/Merserk/BeatSync-Engine) | AGPL-3 · 61 · 2026-07 | Automatic AMV/music-video cutting. | Per-beat curves: RMS, brightness, flux, **kick/clap/bass/hat**, impact. Sections (intro/verse/chorus/drop/build/outro) set **cut density**: calm sections hold, drops cut fast. Cuts favour downbeats and bar/phrase anchors and are **quantized to output frames**. Clips are ranked by motion, quality and action score, with VLM tags matched to section mood. | **Yes**, the method (AGPL, so re-implement). This is the step after `detect_beats`. |
| [chrislema/videoeditor](https://github.com/chrislema/videoeditor) | none · 16 · 2026-04 | 8-step talking-head pipeline with face-centred zooms. | Zoom anchored on the Haar face centre so a punch-in never crops the face. | Idea only (no licence). |
| [bisheshabramhacharya/clipping-factory (PR #76)](https://github.com/bisheshabramhacharya/clipping-factory/pull/76) | — | Opt-in "zoom cuts". | Punch-in candidates are **loudness bursts and emphasis-word onsets**, kept **sparse** from the episode's energy profile. | **Yes**, the candidate rule. |
| [hkchengrex/MMAudio](https://github.com/hkchengrex/MMAudio) | MIT (code) · 2.3k · 2026-02 | Video → synchronized Foley/SFX generation. | Generates audio for a clip on its own, with no prompt required. | Maybe, as a `generate_sfx` provider (check model weights licence). |
| [elevenlabs/examples — video-to-sfx](https://github.com/elevenlabs/elevenlabs-examples) | MIT · 627 · 2026-09 | Video → SFX prompt → SFX API. | **4 frames at 1 s intervals** go to a VLM, which writes the SFX prompt. | **Yes.** Fits bay's ElevenLabs provider. |
| [siddharthvaddem/openscreen](https://github.com/siddharthvaddem/openscreen) | MIT · 40k · 2026-06 | Screen Studio clone with click-driven auto-zoom. | Clicks are clustered; consecutive clicks **pan instead of re-zooming**, with glide-in, hold and ease-out. | Only for screen recordings. The clustering rule applies to punch-ins too. |

## 7. Academic: highlight detection and engagement

| Repo | Licence · ★ | What it gives | Borrow? |
|---|---|---|---|
| [jayleicn/moment_detr](https://github.com/jayleicn/moment_detr) (QVHighlights) | MIT · 353 | About 10k videos, query → moment spans, with **per-2 s-clip saliency on a 1–5 scale**. It set up the standard "saliency curve" evaluation. | Frame `find_highlights` output as a saliency curve. |
| [wjun0830/QD-DETR](https://github.com/wjun0830/QD-DETR), [showlab/UniVTG](https://github.com/showlab/UniVTG) | custom / MIT | Query-dependent saliency. UniVTG unifies moment retrieval, highlights and summarization over CLIP features. | Could run on bay's SigLIP embeddings for query-driven highlights. |
| [line/lighthouse](https://github.com/line/lighthouse) | Apache-2.0 · 272 · 2026-09 | Packaged MR/HD library with pretrained weights, audio moments included. | **Best entry point** if bay adds a learned highlight scorer. |
| [dasongli1/SnapUGC_Engagement](https://github.com/dasongli1/SnapUGC_Engagement) (ECCV'24) + [sunwei925/LMM-EVQA](https://github.com/sunwei925/LMM-EVQA) | none / — | 90k Snapchat shorts labelled with **NAWP (normalized average watch %)** and **ECR (engagement continuation rate)**. Visual, music and text features. An LMM ensemble won the ICCV'25 challenge. | Use NAWP/ECR as the name of what the rubric predicts, and as an offline eval set. |

## Techniques to adopt in bay

1. **`detect_silence` → `remove_range`.** Port auto-editor's algorithm: linear threshold **0.04** (let the user set dB; unsilence uses −35 dB and jumpcutter about −30 dBFS relative to peak), **0.2 s** margin each side, drop silences shorter than **0.2 s** and loud blips shorter than **0.1 s**. Return ranges and let the agent apply them through `remove_range`, so the cuts stay sync-safe.
2. **"Speed up pauses" alternative:** silences at **6×** and **0.5×** volume, audible sections padded **0.25 s**, intervals under **0.3 s** merged (unsilence).
3. **Snap cut points to word edges using the silence map** (stable-ts `suppress_silence`, `min_word_dur` 0.1 s). Transcript cuts then never clip a consonant.
4. **Filler and retake removal** from the transcript ("um", "uh", "like", repeated starts), shown as proposed `remove_range` spans. helenlpang/talking-head-video-editor uses an LLM for retake detection.
5. **Highlights:** give each pick a `hook` and `reason`. Dedupe overlapping picks by score. Default to **3–15 picks of 15–60 s**. Snap boundaries to TextTiling topic breaks (ClipsAI) *and* to `detect_cuts` shot boundaries (OpenShorts).
6. **Reframe tool** (AutoFlip design). Per shot, pick a signal from the tiers (face 0.85–0.9 > human 0.75–0.8 > object 0.1–0.2). Keep the camera **stationary** when subject motion stays under the **0.5** threshold; otherwise output a smoothed pan path as the keyframed position bay already has. Add modes: track, blurred fit, **split for two speakers**, screencast.
7. **Active-speaker selection** (Light-ASD, CPU-sized) so the reframe follows the person talking. Sample about **13 frames per ≥1.5 s segment** (ClipsAI).
8. **Caption paging:** expose a page window. **1200 ms** is Remotion's TikTok default, 200 ms gives one word, 1500 ms a line. Put captions on the seam in split layouts.
9. **Auto punch-in planner.** Candidates are loudness bursts and emphasis-word onsets. Keep them sparse (for example, at most one per sentence and none within about 2 s of a cut, **our guess, to be tuned**). Anchor the zoom on the face centre, and pan between clustered candidates instead of re-zooming (openscreen).
10. **Energy-aware beat editing:** extend `detect_beats` with per-beat RMS/kick/impact curves and section labels. Cut density follows the section. Prefer downbeats and phrase anchors. Quantize cuts to frames (BeatSync-Engine).
11. **SFX:** a whoosh/riser/impact library placed at transitions and punch-ins, plus `generate_sfx` (ElevenLabs: 4 frames at 1 s → prompt; MMAudio locally). Duck music under speech (bay has ducking).
12. **Engagement vocabulary:** state the rubric's target as watch-through (NAWP) and continuation (ECR), not "virality".

## Gaps in bay

- **No reframing / subject tracking.** `set_canvas` changes the canvas but nothing keeps the speaker in frame. This is the most common feature across every shorts repo.
- **No audio-level silence detector.** Transcript sentences exist, but non-speech pauses, breaths and dead air have no deterministic detector.
- **No diarization / active speaker.** This blocks speaker-targeted clips (FunClip), split layouts and reframing.
- **No filler-word or retake detection.**
- **No automatic punch-in placement.** The keyframes exist, but nothing plans them.
- **No SFX generation or library.** `generate_speech` exists; sound effects and music beds do not.
- **Beat detection without energy or sections**, so there is no cut-density control.
- **No hook text overlay helper** (OpenShorts and AI-Shorts both generate a hook line). `.brf` could render it, but nothing proposes the line.
- **No learned highlight or engagement score.** It is all LLM rubric. Lighthouse or SnapUGC could supply an offline check.

## Sources

auto-editor options/edit docs (auto-editor.com/ref/options, /ref/edit); jumpcutter `jumpcutter.py`; unsilence `ParseArguments.py`; ClipsAI `clipfinder.py`, `resize.py`; mediapipe `autoflip_graph.pbtxt`; remotion template-tiktok `src/CaptionedVideo/index.tsx`; stable-ts, whisperX, OpenShorts, BeatSync-Engine, AI-Youtube-Shorts-Generator, FunClip, auto-vertical-reframe READMEs; the SnapUGC paper (arXiv 2410.00289) and the LMM engagement paper (arXiv 2508.02516); plus every repo URL in the tables above.
