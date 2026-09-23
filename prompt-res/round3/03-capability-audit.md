> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# 03 — Capability-and-gaps audit (code read, Aug 15 2026)

Produced for round 3 by an exploration agent reading the workspace. Code, not docs, was treated
as the source of truth — the repo's own counts have drifted (24 / 26 / 55 / 65 tools claimed in
various documents; `tools.rs` currently advertises **70**).

## Executive verdict

bay is no longer "a compositor with a timeline." The 70-tool MCP surface covers project
creation, precise clip edits, keyframe animation with 14 easings and per-key easing, a 33-move
registry, `animate_many` with stagger, one transition, real ducking, static masks/crop, LUTs and
six generated looks, shot detection, beat and silence analysis, four-provider stock search with
SigLIP re-ranking, Kokoro TTS with ~54 voices and word-synced captions, SRT/VTT in/out, style
kits, provenance/roles, `check`, snapshots, and gated loudness-normalized export.

It still falls short of "give it a task and it accomplishes a good video autonomously" in four
decisive areas:

1. **It cannot understand spoken footage.** No transcription, diarization, semantic transcript
   search, dialogue editing, OCR, object/action recognition, or temporal video embedding.
2. **Its editorial model is shallow.** One scene, no compound clips, no speed changes, no
   roll/insert/overwrite/range edits, no track management API, one transition type.
3. **Its visual vocabulary is narrow.** Filled rects/ellipses; four scalar effects + LUT; static
   masks; no paths, strokes, gradients, shadows, text stroke/plate, rich runs, per-word
   animation, motion tracking, stabilization, chroma key, 3D, or motion blur.
4. **Its quality gate mostly inspects authored metadata, not rendered pixels.** Collisions, ugly
   crops, wrong stock, frozen footage, and many typography failures are only caught if an agent
   manually snapshots and looks.

## What MCP still cannot do (selected)

- **Timeline/editorial:** track add/reorder/mute/lock, insert/overwrite, slip-preserving-position
  and roll verbs, ripple trim, range selection, link/unlink picture+sound, group move, compound
  clips, multiple sequences, undo/redo over the wire, waveform/timecode sync, multicam.
- **Retime:** no speed change, ramp, reverse, freeze, frame hold, interpolation.
- **Transitions:** cross-dissolve only. No wipe/push/slide/dip-to-color/luma/whip.
- **Visual:** no paths/lines/arrows, stroke/outline, gradients, shadows, text stroke/shadow/
  plate, rich text runs, per-word/char animation, auto-fit, adjustment layers, keyframed effect/
  crop/mask params, tracking, stabilization, chroma key, 3D, motion blur, grain/vignette/glow.
- **Audio:** no EQ, compressor, limiter, denoise, de-esser, pan, time-stretch, dialogue
  isolation, stem separation. Normalization is export-stage only.
- **Analysis:** no STT, word alignment for imported dialogue, diarization, transcript search or
  cuts, OCR, face/person recognition, action recognition, shot quality scoring, highlight
  detection, duplicate-shot detection, automatic J/L cuts. No `contact_sheet` despite the skill
  referencing contact sheets.

## Top 20 missing capabilities, ranked for "give it a task"

1. Speech-to-text with word timestamps
2. Semantic temporal video understanding (sampled-frame/video embeddings, OCR, descriptions)
3. Rendered-pixel quality loop (contact sheets, collision/freeze/crop/contrast checks)
4. Task-to-storyboard/plan artifact (nothing exists between prompt and ~45 tool calls)
5. Robust automatic asset pipeline (search → evaluate → diversify → crop → license → fallback)
6. Playback-speed and time remapping
7. Transcript-based editing and diarization
8. Group/parent/camera transforms
9. Paths, strokes, lines, arrows, charts
10. Richer transitions
11. Keyframable effects, masks, crops
12. Motion/face tracking and stabilization
13. Real audio post (EQ/comp/limit/denoise/pan/speech enhancement)
14. Rich typography and text animation (stroke, shadow, plates, runs, auto-fit, per-word)
15. Compound clips, multiple sequences, reusable scenes
16. First-class track and edit-point operations
17. Multicam, waveform sync, J/L cuts
18. Adjustment layers and reusable style/effect presets
19. 3D/perspective and render-time motion blur
20. Cross-platform, multi-document, authenticated runtime architecture

## Documentation/skill drift (material, not cosmetic)

- **The skill claims check codes that current `check.rs` does not implement** (`no-response`,
  `bottom-dead`, `frozen` are plan-stage; the implemented set is 25 codes including
  `dead-plate`, `broken-continuity`, `no-hook`, `empty-container`, `unreadable-dwell`-family,
  `raw-style`, `style-drift`). A quality-gate overclaim teaches agents to rely on a gate that
  is not there.
- **`references/tools.md` says it is generated but drops merged schema fragments** — `brief`/
  `kit`/`customKit`, `role`, `tone`, duck fields, caption fragments are missing from the doc an
  agent actually reads.
- **Tool-count drift is pervasive** (24/26/55/65/70 across docs, site, recipe). One running
  build advertised 51 of 55 tools — `sfx_*`/`sound_add` missing at runtime was diagnosed in
  round 2 as a packaging bug that got misread as a taste failure.
- **Built-in templates carry literal colors/sizes/positions**, bypassing the kit — a second
  visual system inside the tool that exists to prevent second visual systems.
- **Kokoro speech-rate calibration drift**: skill prose says ~2.5–2.99 w/s; engine comments
  measure ~3.30. Narration budgeting inherits the error.

## Architecture risks

- **macOS-first, macOS-proven.** Windows packaging exists but nothing on that platform has been
  exercised (todo.testing.md). Linux is explicitly unsupported. Candle/Metal gap forces SigLIP
  onto CPU.
- **Single window, single document, single scene, fixed port 7333.** No multi-project agent
  session, no variant editing side-by-side, no conflict leases (Stage 3 unbuilt).
- **Loopback is not authentication.** Origin checks block browsers, but any local process can
  invoke tools that read/write arbitrary paths. No token, no capability scoping.
- **Runtime weight:** ~1.2 GB speech + ~780 MB vision; sidecar lifecycle is hand-built
  (supervisor generalization is a stated prerequisite for the assistant).
- **Absolute media paths** make projects non-portable by default (`library_collect` is opt-in).
- **Preview/export divergence risk**: the compositor renders preview; export incorporates
  ffmpeg expressions and encoding.
- **Legacy `vii` path still wins** over `bay` for the project library on machines where it
  exists (todo.pending.md) — a data-loss shaped bug.

## Evidence from real builds

- **wicks-v2** (the round-2 forensics): 188 elements, 69/73 text in Menlo, 90% of animation on
  opacity, 76 three-frame pops, backwards duck, `check` returned `ok:true` with 242 warnings of
  which 127 were false — the agent rationally ignored the channel and shipped. The project also
  rendered 61s of a 155s timeline and ended mid-sentence; `check` cannot see render duration.
- **podcast-cut**: silence detection, shot detection and SigLIP speaker labeling produced a real
  67.8s clip from a 6:13 interview — but the decisions lived in an external Python script, and
  the README itself states the other half of podcast editing (filler words, false starts) needs
  speech-to-text, "which bay does not have — bay-speech speaks, it does not listen."
- **reel-recipe / wall-street-1929 / loaf-of-bread**: every build found defects only by looking
  at PNGs; recurring blockers were missing paths/strokes/charts, weak frame-to-frame motion,
  and (for music) unresolved rights.

## Bottom line

> bay exposes a capable low-level editor, but the agent is still expected to supply most of the
> editorial intelligence. The MCP surface can execute a detailed plan; it cannot yet derive the
> plan from raw footage and a goal, evaluate the rendered result perceptually, or revise at the
> semantic level. "Give it a task and it accomplishes it" is currently true mainly for
> constrained infographic/assembly tasks, not general video editing.
