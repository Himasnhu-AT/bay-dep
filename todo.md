# vii — roadmap

Items are sized S/M/L/XL by build effort. **Risk** flags what could make the estimate wrong.
Nothing here is started unless marked otherwise.

---

## 1. Button: text → audio → timeline · **S**

A field and a button in the inspector: type a line, pick a voice, get a narration clip on the
audio lane with word-synced captions.

The engine work is done — `narrate` already speaks, places the clip, and lays captions from
one synthesis so they cannot drift. This is UI wiring plus a voice picker fed by
`speech_status`.

- Needs a background-work story: synthesis takes 1–5s and must not block the render thread.
  Same shape as the existing decode-off-the-render-path work.
- Voice preview (speak one sample line) is worth having; it is the difference between picking
  a voice and guessing at a name like `am_fenrir`.

**Open question:** where does it live — the inspector, a dedicated Captions/Audio tab, or the
toolbar? Palmier uses a 3-way icon rail (Media / Captions / Audio); we have a hardcoded
200px media column.

---

## 2. Button: download models · **M**

A models pane: what is installed, what it costs on disk, download / remove, with progress.

Today Kokoro self-downloads into the HuggingFace cache on first `narrate`, which means the
first narration silently blocks for minutes on a cold machine and there is no way to see or
reclaim the space.

- Needs a **model registry** — id, name, size, license, revision-pinned URL, SHA-256. The
  meeting assistant's `speech_models.rs` is the reference: every artifact size- and
  hash-verified before it can be selected.
- Needs resumable download + progress events into the UI, and a disk-usage readout.
- Should cover every model we add: Kokoro, the assistant LLM, the vision model.

**Risk:** Kokoro fetches its own weights through the `huggingface_hub` Python client. Either
we pre-fetch into the same cache path and let it find them, or we take over the download and
point `HF_HOME` at our directory. The second is cleaner and testable.

---

## 3. Assistant: a local LLM that can edit the project · **L**

A chat panel. Ask questions about the project, and ask for changes — "make the title bigger",
"cut the dead air at the start", "move the captions up".

**Why vii is well shaped for this:** every edit already goes through `Command` → reversible
`ProjectPatch`. If the model's tool calls lower into `Command`, its edits are undoable with
the same Cmd+Z as a human's, and the history stays coherent. An assistant that mutated the
project directly would be a second, unauditable edit path — worth refusing on principle.

- **Model: Gemma 3.** The 4B/12B instruction-tuned variants are multimodal (text + vision),
  which means *one* sidecar could serve both this and item 4. Worth deciding deliberately
  rather than adding two model runtimes.
- Runtime: llama.cpp (GGUF, Metal) as a sidecar, same lifecycle as the Kokoro one — bearer
  token, parent-PID watchdog, idle eviction. Ollama is the faster path but adds a dependency
  we do not control.
- The tool surface it drives should be the **MCP tool set we already have**, not a parallel
  API. That keeps one contract for agents and the in-app assistant.

**Risk:** a 4B model reliably emitting correct tool calls is the whole bet. Needs an eval set
of real editing requests before we trust it with destructive operations. Start read-only
(answer questions about the timeline), then allow edits behind a confirm step.

---

## 4. Vision: understand what is in the media · **L**

Two genuinely different jobs, and they want different models:

**(a) Search and auto-tagging — SigLIP.** An image-text embedding model. Embed every imported
frame once, then text-query the media library ("the shot of the whiteboard"), find near
duplicates, and group similar shots. Cheap per frame, no generation. Google's SigLIP (or
SigLIP 2) is the right tool here; CLIP is the older equivalent.

**(b) Description and Q&A — a VLM.** "What is happening in this clip?", "does this frame have
a face in it?", auto-generating alt text or a shot list. This needs a generative
vision-language model — Gemma 3 4B/12B multimodal would cover it, reusing item 3's runtime.

Both need frame extraction, which vii already does via the ffmpeg sidecar.

> **Premise check — do this first.** This was suggested on the basis that palmier has a vision
> model. My gap audit found **no vision model there**: their ML surface is Apple
> SpeechAnalyzer / cloud transcription, WeSpeaker voice embeddings for speaker ID, VAD, beat
> detection and denoise — all audio. There *is* a `chat/` directory in their project package,
> but the audit deliberately excluded palmier's AI surface per the original scope note, and
> there is no local clone. **Clone palmier-pro and verify before building on this.**

**Risk:** the useful unit is not "a frame" but "a shot". Without shot-boundary detection,
embedding every Nth frame gives redundant, noisy results. That may be a prerequisite item.

---

## 5. Rename to vii · **DONE**

No `opencut` in crate names, binaries, identifiers, docs, scripts or CI. Crates are
`vii-core`, `vii-project`, `vii-preview`, `vii-ui`, `vii-text`, `vii-audio`, `vii-speech`,
`vii-mcp`, `vii-agent`, `vii-desktop`; there is exactly one binary, `vii`, and `vii --mcp`
serves the same engine headlessly.

**Two deliberate exceptions, both flagged rather than decided silently:**

- **`LICENSE` keeps "Copyright 2025-2026 OpenCut".** The licence is MIT and requires that
  notice be retained in all copies. Removing it would make distribution non-compliant. This is
  a legal constraint, not branding — the product is still called vii everywhere a user can
  see.
- **`dep/` has since been deleted entirely**, so the only remaining reference to the upstream
  name is the licence notice above.

---

## 5b. Live agent editing — Stage 1 **DONE**, Stages 2–3 open

The app hosts the MCP server; tool calls cross a channel and are applied on the GPUI main
thread, so an agent's edit appears in the timeline immediately and undoes with ⌘Z. Measured
against the running app: reads p99 **0.31 ms**, writes p99 **0.86 ms** — the budget was one
frame (16 ms).

**Single-window on purpose, for now.** A second launch raises the open window instead of
starting a rival, so there is never ambiguity about which document the agent is editing. The
bound port is the lock; liveness is decided by trying to bind it, not by pid — a pid can be
recycled, a free port cannot lie, so a killed window never locks the next launch out.
`vii --agents` says what is open.

**Still open:**

- **Stage 2 — slow tools.** `render`, `narrate` and `snapshot` are refused while the app is
  open, because running them on the main thread would freeze the editor for seconds. They need
  an export worker thread with its own wgpu device, progress and cancel. Until then: close the
  app and run them headlessly.
- **Stage 3 — conflict.** No leases yet. If you are dragging a clip and the agent edits the
  same one, last write wins with no "keep mine / use the agent's" card.
- **Multiple windows.** Deliberately not supported yet. When it matters, the shape is: each
  window claims its own port, and a router on the fixed port forwards to a chosen one so there
  is still a single `claude mcp add`. The registry (`vii-agent::registry`) already lists
  windows, so the groundwork is there.

---

## 5c. Windows builds must happen on Windows — not a choice

Tried and ruled out, so nobody re-tries it:

- **Windows containers on macOS: impossible.** Docker Desktop runs a Linux VM; Windows
  containers need a Windows kernel. No image fixes this.
- **`cargo-xwin` cross-compile from macOS: blocked by gpui 0.2.2.** It gets all the way to
  gpui itself and then fails on `shaders_bytes.rs: No such file`. The cause is in gpui's
  `build.rs`:

  ```rust
  Ok("windows") => {
      #[cfg(target_os = "windows")]   // <- HOST os, not target
      windows::build();               //    compiles the HLSL shaders
  }
  ```

  The branch matches on the *target*, but its body is `cfg`'d on the *host*, so the shader
  compilation is silently omitted when cross-compiling and the include fails later. Fixing it
  means patching gpui.

**So the options are:** a Windows runner in CI (what `release.yml` does), a local Windows VM,
or a gpui fork. CI is the cheap one — the Windows runner bills at 2x and only runs on a tag.

---

## 6. Bug: a sidecar can outlive its parent · **S**

The Kokoro sidecar's parent-PID watchdog polls `os.kill(ppid, 0)` and exits when that fails.
Observed a sidecar still holding port 7431 long after every test process was gone, which then
failed an unrelated test with `PortBusy`.

Two plausible causes, both worth closing:

- **PID reuse.** If the OS recycles the parent's pid, `kill(pid, 0)` succeeds forever and the
  watchdog never fires. Recording the parent's *start time* alongside its pid, and comparing
  both, makes the check exact.
- **The watchdog thread never started** — it is only spawned when `VII_KOKORO_PARENT_PID` is
  set and numeric, and nothing reports when it is not.

Belt and braces: have the sidecar exit on an idle timeout of its own, so it cannot outlive
anything indefinitely regardless of what happened to its parent.

---

## Cross-cutting: there is no ML runtime story yet

Items 2, 3 and 4 all need model weights on disk and an inference process. Today there is
exactly one such sidecar (Kokoro) and its lifecycle was hand-written. Before adding a second
and third, the shared pieces are worth pulling out:

- a **sidecar supervisor** — spawn, authenticated health probe, kill-and-replace when
  unhealthy, port-occupied refusal, bounded readiness poll, parent-PID watchdog, idle
  eviction. All of this exists in `vii-speech::SpeechEngine` and is not speech-specific.
- a **model registry + downloader** (item 2), shared by every model.
- a policy on **which runtime**: llama.cpp for GGUF text+vision, plus something for SigLIP
  embeddings (ONNX Runtime, or Candle if we want it in-process).

Doing item 2 first, and generalising the speech sidecar while doing it, makes 3 and 4 much
smaller.

---

## Suggested order

1. **Text → audio button** (S) — small, immediately useful, proves the UI↔speech path.
2. **Model download pane** (M) — and generalise the sidecar supervisor while building it.
3. **Verify the palmier vision premise** — cheap, and it decides whether item 4 is real.
4. **Assistant, read-only first** (L) — questions about the project, no edits.
5. **Assistant edits behind a confirm step**, lowered into `Command` so undo works.
6. **Vision**, whichever half survives the premise check.

---

## Already shipped

| | |
|---|---|
| Engine | shapes, per-axis scale + anchors, 8 easings, full text typography, audio in export |
| MCP | 21 tools over HTTP/stdio; snapshot, render, timeline introspection |
| Speech | Kokoro sidecar, word-level timestamps, SRT/VTT in and out, `subtitles_to_video` |
| Build | `./build.sh` ships both binaries + provisions the speech venv, idempotently |
| Skill | `.claude/skills/vii/` — an agent can drive the editor unassisted |
| Tests | 195 passing |
