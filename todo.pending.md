# bay — pending

Work that is **not built**. Sized S/M/L/XL by effort; **Risk** flags what could make the estimate
wrong. Nothing here is started unless it says so.

Companions: [`todo.completed.md`](todo.completed.md) (done, with evidence) ·
[`todo.testing.md`](todo.testing.md) (built but unproven) · [`todo.md`](todo.md) (index)

## Order I would take them

| | Item | Size | Why now |
|---|---|---|---|
| 1 | [Export renders from the preview cache](#export-renders-from-the-480px-preview-cache) | M | **Correctness.** Every video export is upscaled from a ≤480px cache, and on a long clip from as few as 2 fps. A 4K export is not 4K. Verified in the code, not a suspicion. |
| 2 | [Windows, actually exercised](todo.testing.md) | S | The build is green but nothing on that platform has been *run*. Not a build task — see the testing file. |
| 3 | [Slow tools time out at 20s](#slow-tools-time-out-against-the-open-editor-at-20s) | S–M | **Blocker.** Any render or narration over 20s returns a false "the editor did not answer in time" while the work carries on invisibly. A first narrate cannot possibly fit. |
| 4 | [Kokoro weight download has no progress](#kokoro-weights-download-with-no-progress) | S–M | The other place the "no silent waits" promise breaks, and it compounds the one above. |
| 5 | [The render path can still panic](#the-render-path-can-still-panic) | S | Two `expect`/`assert_eq!` on the live path contradict the rule that bad input must degrade, not abort. Cheap. |
| 6 | [Text → audio button](#text--audio--timeline) | S | Narration is one press away from any machine now, so this is no longer gated on setup — and a GUI user currently has no way to narrate at all. |
| 7 | [Document types + Open Recent](#feeling-like-a-mac-app--what-is-left) | S | The rest of "feels like a Mac app": project files get an icon and open on double-click. |
| 8 | [Sidecar can outlive its parent](#a-sidecar-can-outlive-its-parent) | S | A real leak, cheap to close. |
| 9 | [Two-stage seek](#two-stage-seek-for-windowed-decode) | M | The design piece windowed decode was missing. Wants the export fix (1) landed first, since both touch decode planning. |
| 10 | [Assistant, read-only first](#assistant-a-local-llm-that-can-edit-the-project) | L | The next substantial feature; wants the sidecar supervisor generalised first. |

**Deliberately not doing yet:** Linux (macOS and Windows only, and an unsupported platform says
so rather than pretending), multiple windows, Stage 3 edit-conflict leases, and vision until the
palmier premise is verified.

---

## Export renders from the ≤480px preview cache

**M · correctness**

There is one decode plan and both preview and export use it. `plan_decode`
(`bay-preview/src/lib.rs:279`) scales every video clip down to `VIDEO_MAX_WIDTH = 480`
(`:267`) and, to keep a long clip inside `VIDEO_MEMORY_BUDGET`, lowers the sample rate as far as
`VIDEO_MIN_FPS = 2.0` rather than truncating it. `export_video` then calls `self.render(...)` at
the *export* width and height (`:768`), which composites those cached frames — so a 4K export is
a ≤480px cache upscaled 8×, and on a long clip the same decoded frame is repeated for up to half
a second at a time.

The budget policy itself is right and was a deliberate fix (truncation used to freeze a clip past
~15s on its last frame). The bug is that a memory ceiling written for a preview window silently
became the ceiling for the delivered file.

What it wants is a decode *intent*: preview keeps today's budget, export plans at source
resolution and source frame rate and streams rather than caching a whole clip in RAM — a 4K
export cannot hold its frames under a 192 MB budget and must not try.

- `await_decodes` (`:631`) is already the explicit barrier export waits on (`:762`), so the
  sequencing point exists; it is the *plan* that needs to differ, not the ordering.
- Test: export a clip whose source is wider than 480, and assert the output frame is not a
  scaled-up 480px image — a checkerboard or fine text source makes the difference measurable
  rather than a matter of opinion.

Found by reading Gausian, which plans decode per intent; the defect is ours and predates it.

---

## The render path can still panic

**S**

`CLAUDE.md` says the render path cannot panic on bad input, and two live-path sites do:

- `bay-gpu/src/context.rs:719` — `upload_rgba_texture` asserts `rgba.len() == width*height*4`.
  A short or mis-sized buffer aborts the process instead of dropping the frame.
- `bay-gpu/src/context.rs:800` — `.expect("device.poll(Wait) failed during texture readback")`
  turns a device loss during readback into a crash. Device loss is a thing that happens to
  laptops that sleep, not bad input, and it should surface as a failed frame.

(Two more at `:539`/`:543` are wasm-only canvas import; lower priority but the same shape.)

Both want a fallible signature and a degrade policy — return `Option`/`Result` and let the caller
show the last good frame. The NaN/±inf and tiny-canvas tests already establish the pattern to
extend.

---

## Two-stage seek for windowed decode

**M** — wants [export decode intent](#export-renders-from-the-480px-preview-cache) landed first

The design piece M9 was missing. On a seek, return the nearest **keyframe** immediately, tagged
inaccurate, and let the exact frame land behind it when its decode completes. Scrubbing then
responds at keyframe latency instead of full-decode latency, and the UI knows which of the two it
is holding — so an inaccurate frame can never be mistaken for a final one, and export (which
awaits decodes) never sees one at all.

The tag is the load-bearing part: without it this is just a race that occasionally shows the
wrong frame.

Both this and the export fix change decode planning, so doing them in the other order means
writing the planner twice.

---

## Slow tools time out against the open editor at 20s

**S–M · blocker**

`serve_attached_connection` sends **every** `tools/call` through
`bridge.call(call, ATTACHED_TIMEOUT)`, and `ATTACHED_TIMEOUT` is a flat 20 seconds
(`bay-mcp/src/server.rs:198,228`). Slow tools answer only when their worker finishes
(`bay-ui/src/app_view.rs`), so any `render`, `narrate`, `media_import` or `subtitles_to_video`
that takes longer than 20 seconds returns:

> the editor did not answer in time — it may be showing a modal dialog

which is false, unactionable, and arrives while the work carries on invisibly. `slow.rs` itself
documents these as taking "seconds to minutes". A first `narrate` on a clean machine cannot fit:
the model download alone exceeds it.

The timeout's own doc comment explains it as covering a native file dialog stalling the main
thread, which is a fast-tool concern. Options:

- Give slow tools their own budget, or none — they are already answered asynchronously, so the
  timeout is protecting against a hang the async path has already ruled out.
- Better: hand slow tools a job id immediately and let the caller poll, the same shape
  `runtime_install` already uses. That also fixes "no progress for a 4-minute render".

The job-id shape is the better fix for a second reason: **export today has no progress, no cancel
and no atomic finalize.** `export_video` (`bay-preview/src/lib.rs:762`) loops every frame writing
into ffmpeg's stdin with no way to observe or stop it, and on a broken pipe it `break`s and
returns whatever ffmpeg managed to write — a truncated MP4 at the destination path, indistinguishable
from a good one. Routing export through the existing `bay-provision/src/jobs.rs` registry (the
same one `runtime_install` uses) closes the timeout, the frozen window and the truncated file in
one change: encode to a temp path, rename on success, delete on cancel or failure.

**No test covers this** — the bridge tests all use fast tools. Whatever the fix, it wants a test
that runs a deliberately slow tool through the attached path.

---

## Kokoro weights download with no progress

**S–M**

The gap in the zero-install promise. `runtime_install speech` shows a progress bar for the
~1.2 GB it fetches, but the **~330 MB of model weights are not part of that** — they are pulled
by `huggingface_hub` inside the Python sidecar the first time `narrate` runs, into `<data>/models`
via `HF_HOME`.

An audit corrected the first reading of *where* the cost lands: the sidecar is spawned with only
`--host`/`--port`, never `--preload`, so `script/bay-kokoro.py` builds the `KPipeline` lazily
*inside* `POST /speak`. `/health` therefore answers in about a second and `READY_TIMEOUT` (180s)
is never the constraint — the download sits under `SPEAK_TIMEOUT` (300s), inside one blocking
tool call. The comment on `engine.rs:29-31` still says otherwise and is stale.

Nothing escapes either: the child is spawned `.stdout(Stdio::null())` and its stderr is only read
if the process *dies*, so HuggingFace's own progress bars go straight to a discarded pipe.

So the first narration on a clean machine is a multi-minute wait with no bar, no byte count and
no explanation — and on a slow connection it fails with a timeout that looks like a bug.

Options, roughly in order of preference:

- **Fetch the weights in `bay-provision` like everything else.** They are a pinned artifact on
  HuggingFace with a known digest, so they fit the existing manifest, downloader and progress UI
  exactly, and `speech` stops having a hidden second phase. Then set `HF_HUB_OFFLINE=1` on the
  sidecar so it can only use what was fetched, which also makes the "no surprise network calls"
  claim true rather than nearly true.
- Or have the sidecar report download progress back over its existing HTTP channel, and surface
  that in the same job UI.

Either way `READY_TIMEOUT` should drop back to meaning "the model failed to load" rather than
doubling as a download budget.

---

## What a GUI-only user still cannot reach

**S each**

Everything below works over MCP and is missing or wrong in the window:

- **The progress bar reads "100% of 43 MB" for the whole multi-minute venv build**, because
  `jobs.rs` parks `done_bytes = total_bytes` during a `Progress::Step`. uv also runs under
  `UV_NO_PROGRESS=1` with `.output()`, so the four step messages are the only signal there is.
  (The test that was meant to cover this tests the wrong branch — see
  [`todo.testing.md`](todo.testing.md).)
- **There is no narrate affordance at all in the UI.** A GUI-only user can install narration and
  then has no way to use it — narration is MCP-only. That is what the text→audio button is for,
  and it is a stronger reason to build it than "it would be nice".
- **While an install runs, every offer is hidden**, so the second component cannot be queued.
- **The "Install …" button lives only in the editor toolbar** (`editor_view.rs:runtime_offers`),
  not on the project launcher. Someone who opens bay and looks at the project list is told
  nothing about what is missing until they open a project — and the launcher is where a first run
  actually starts.

---

## Provisioning — what is still open

- **No way to see or reclaim the disk.** `Report::to_json` reports components and tools but never
  a size actually measured, and there is no `runtime_remove` tool and no UI. `receipt.rs` already
  knows every installed file *and its byte size* and is simply never surfaced. `diskBytes` is the
  manifest's static estimate, still reported as 1.2 GB even when speech turned out to be
  satisfied by a venv somebody else installed.
- **It is not one directory.** The Kokoro weights go to `data_dir()/models` (`HF_HOME`), which is
  *outside* `runtime_dir()` — so "delete the one directory bay downloaded into" leaves ~330 MB
  behind, uncounted. Either move the weights under `runtime/` or teach the reporting about both.
- **Linux is not covered.** bay ships macOS and Windows; an unsupported platform says so rather
  than pretending. Adding it is pinning three more artifact sets, not new design.

---

## Feeling like a Mac app — what is left

**S each**, in order:

- **`CFBundleDocumentTypes` + `UTExportedTypeDeclarations`** in `bundle-mac`, plus
  `cx.on_open_urls`, so a project file gets bay's icon in Finder and opens on double-click. This
  is most of what remains between "has a menu bar" and "feels like a Mac app".
- **Open Recent** (`cx.add_recent_document`) — needs the document type above to be worth much.
- **`NSMicrophoneUsageDescription` / `NSCameraUsageDescription`** *if* capture is ever in scope.
  Cheap now; a signing scramble if added late.
- **Dock menu** (`set_dock_menu`: New Project, Open Recent) and `on_reopen` (clicking the Dock
  icon with no window should reopen one).
- **`reveal_path`** after an export, so "where did it go?" is a click.
- **System dark mode** via `window_appearance` — the theme is currently fixed.

---

## Text → audio → timeline

**S**

A field and a button in the inspector: type a line, pick a voice, get a narration clip on the
audio lane with word-synced captions.

The engine work is done — `narrate` already speaks, places the clip, and lays captions from
one synthesis so they cannot drift. This is UI wiring plus a voice picker fed by `speech_status`.

- Needs a background-work story: synthesis takes 1–5s and must not block the render thread.
  Same shape as the existing decode-off-the-render-path work.
- Voice preview (speak one sample line) is worth having; it is the difference between picking
  a voice and guessing at a name like `am_fenrir`.

**Open question:** where does it live — the inspector, a dedicated Captions/Audio tab, or the
toolbar? Palmier uses a 3-way icon rail (Media / Captions / Audio); we have a hardcoded
200px media column.

---

## Live agent editing — Stages 2–3

- **Stage 3 — conflict.** No leases yet. If you are dragging a clip and the agent edits the
  same one, last write wins with no "keep mine / use the agent's" card.
- **Taking over an idle owner.** If a headless server is running but doing nothing, the only
  answer today is the `kill <pid>` bay prints. A `--takeover` that asks the owner to stand down
  over MCP would be friendlier, and is only safe once the owner can report whether it is
  mid-render.
- **Multiple windows.** Deliberately not supported yet. When it matters, the shape is: each
  window claims its own port, and a router on the fixed port forwards to a chosen one so there
  is still a single `claude mcp add`. The registry (`bay-agent::registry`) already lists windows,
  so the groundwork is there.

---

## A sidecar can outlive its parent

**S**

The Kokoro sidecar's parent-PID watchdog polls `os.kill(ppid, 0)` and exits when that fails.
Observed a sidecar still holding port 7431 long after every test process was gone, which then
failed an unrelated test with `PortBusy`.

Two plausible causes, both worth closing:

- **PID reuse.** If the OS recycles the parent's pid, `kill(pid, 0)` succeeds forever and the
  watchdog never fires. Recording the parent's *start time* alongside its pid, and comparing
  both, makes the check exact.
- **The watchdog thread never started** — it is only spawned when `BAY_KOKORO_PARENT_PID` is
  set and numeric, and nothing reports when it is not.

Belt and braces: have the sidecar exit on an idle timeout of its own, so it cannot outlive
anything indefinitely regardless of what happened to its parent.

---

## `grid` advisory — blocked upstream

**blocked**

`grid` 0.18.0 (medium — integer overflow in `Grid::expand_rows` reaching undefined behaviour
through a safe API) cannot be fixed here. The fix is `grid` 1.0.1, a major bump, and the path is
`bay-ui → gpui 0.2.2 → taffy 0.9.0 → grid 0.18.0` — verified with `cargo tree -e normal` to be a
real dependency compiled into the shipped binary, not a dev-only one. It moves when taffy bumps
and gpui picks that up.

Not worth a `[patch]` override: taffy would have to compile against a major-version-changed API,
and the reachable risk is a layout engine overflowing on absurd row counts, which bay never
supplies. Recheck when gpui is next updated — the gpui version is already pinned for the wgpu
freeze, so this rides along with that decision rather than being its own.

---

## Assistant: a local LLM that can edit the project

**L**

A chat panel. Ask questions about the project, and ask for changes — "make the title bigger",
"cut the dead air at the start", "move the captions up".

**Why bay is well shaped for this:** every edit already goes through `Command` → reversible
`ProjectPatch`. If the model's tool calls lower into `Command`, its edits are undoable with
the same Cmd+Z as a human's, and the history stays coherent. An assistant that mutated the
project directly would be a second, unauditable edit path — worth refusing on principle.

- **Model: Gemma 3.** The 4B/12B instruction-tuned variants are multimodal (text + vision),
  which means *one* sidecar could serve both this and vision. Worth deciding deliberately
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

## Vision: understand what is in the media

**L** — and see [`todo.testing.md`](todo.testing.md): the premise is unverified.

Two genuinely different jobs, and they want different models:

**(a) Search and auto-tagging — SigLIP.** An image-text embedding model. Embed every imported
frame once, then text-query the media library ("the shot of the whiteboard"), find near
duplicates, and group similar shots. Cheap per frame, no generation.

**(b) Description and Q&A — a VLM.** "What is happening in this clip?", "does this frame have
a face in it?", auto-generating alt text or a shot list. Gemma 3 4B/12B multimodal would cover
it, reusing the assistant's runtime.

Both need frame extraction, which bay already does via the ffmpeg sidecar.

**Risk:** the useful unit is not "a frame" but "a shot". Without shot-boundary detection,
embedding every Nth frame gives redundant, noisy results. That may be a prerequisite item.

---

## Cross-cutting: there is no ML runtime story yet

The assistant and vision both need model weights on disk and an inference process. Today there is
exactly one such sidecar (Kokoro) and its lifecycle was hand-written. Before adding a second
and third, the shared pieces are worth pulling out:

- a **sidecar supervisor** — spawn, authenticated health probe, kill-and-replace when
  unhealthy, port-occupied refusal, bounded readiness poll, parent-PID watchdog, idle
  eviction. All of this exists in `bay-speech::SpeechEngine` and is not speech-specific.
- a **model registry + downloader** — **done**, as `bay-provision`. A new model is a manifest
  entry plus a component, and it inherits the digest verification, the resume-safe staging, the
  background job and the progress UI for free. The assistant and vision should add entries, not
  plumbing.
- a policy on **which runtime**: llama.cpp for GGUF text+vision, plus something for SigLIP
  embeddings (ONNX Runtime, or Candle if we want it in-process).

The downloader half is no longer in the way. Generalising the *sidecar supervisor* is still worth
doing before a second and third model process exist.
