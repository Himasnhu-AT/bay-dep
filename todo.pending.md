# bay — pending

Work that is **not built**. Sized S/M/L/XL by effort; **Risk** flags what could make the estimate
wrong. Nothing here is started unless it says so.

Companions: [`todo.completed.md`](todo.completed.md) (done, with evidence) ·
[`todo.testing.md`](todo.testing.md) (built but unproven) · [`todo.md`](todo.md) (index)

## Order I would take them

| | Item | Size | Why now |
|---|---|---|---|
| 1 | [Windows, actually exercised](todo.testing.md) | S | The build is green but nothing on that platform has been *run*. Not a build task — see the testing file. |
| 2 | [Text → audio button](#text--audio--timeline) | S | Narration is one press away from any machine now, so this is no longer gated on setup — and a GUI user currently has no way to narrate at all. |
| 3 | [Two-stage seek](#two-stage-seek-for-windowed-decode) | M | The design piece windowed decode was missing. Its prerequisite — the export decode intent — has landed, so the planner is now the right shape to build on. |
| 4 | [Document types + Open Recent](#feeling-like-a-mac-app--what-is-left) | S | The rest of "feels like a Mac app": project files get an icon and open on double-click. |
| 5 | [Disk reporting + `runtime_remove`](#provisioning--what-is-still-open) | S–M | Now worth doing: the Kokoro weights moved under `runtime/`, so there is finally one directory to measure and reclaim. |
| 6 | [Assistant, read-only first](#assistant-a-local-llm-that-can-edit-the-project) | L | The next substantial feature; wants the sidecar supervisor generalised first. |

**Closed on `fix/pending-sweep`,** with evidence in [`todo.completed.md`](todo.completed.md):
export decoding from the preview cache, the 20-second tool ceiling, the unpinned Kokoro weight
download, the three render-path panics, and the sidecar that could outlive its parent.

**Deliberately not doing yet:** Linux (macOS and Windows only, and an unsupported platform says
so rather than pretending), multiple windows, Stage 3 edit-conflict leases, and vision until the
palmier premise is verified.

---

## `check` reports false positives — 52% of one real run

**Found 2026-08-12** by reading the project behind `wicks-v2.mp4`
(`project-1786466680050.json`, 188 elements): `check` returned **242 warnings, `ok: true`**, and
**127 of them were wrong**. The agent shipped anyway, which is the correct response to a report
that is half noise — and the reason the real findings in the same report went unread.

| Bug | Size | Detail |
|---|---|---|
| **`small-text` measures the wrong number** | S | It computes `font_size × transform.scale × scale_y` (`check.rs:262`). The renderer computes `font_size × canvas_height / 1080` (`bay-preview:1689`) and uses `transform.scale` for the **layout box**, not the glyph size. On a 1920 canvas it understates by 2.4×: a 26pt kicker at `scale: 0.744` renders 46px and is reported as 19px. **67 of 69 findings were false.** Fix: mirror the renderer's formula, and add a test that pins the two together so they cannot drift again. |
| **`invisible` ignores the animation** | S | It reads `transform.opacity <= 0` (`check.rs:349`) without consulting the `opacity` channel. Every correctly-authored fade-in sets base opacity 0 and animates up — so the check fires on the house entrance pattern. **60 of 60 findings were false.** Fix: flag only when the base is zero *and* no channel raises it. |
| **`overlap` fires on overlay lanes** | S | 92 findings, all decoratives layered on one overlay lane on purpose. The rule is right for the main picture lane and wrong everywhere else. Fix: restrict to the main lane, or drop to a note off-main. |

A check that cries wolf gets turned off, and then it is worth nothing on the run that matters —
which is stated in this file's own tests and was not honoured by the checks that predate them.

## `check` cannot see how much of the timeline will be rendered

**Found 2026-08-12, same run.** The project is **155s long; it was rendered with
`duration: 61`.** 48 of 119 visual elements — including `W = R − |r|`, the thesis of the brief —
start after 61s and are in no frame of the output. The video ends mid-sentence. `check` passed
it clean, because nothing in the model says what the render will ask for.

Size: **S.** Options, in order of preference: have `render` refuse (or loudly warn) when
`duration` truncates a non-empty timeline; and give `check` an optional `duration` argument so
"what will actually ship" can be linted before it is encoded. The second is what an agent would
reach for; the first is what protects someone who never calls `check`.

Related, and the deeper authoring failure: the brief asked for 60 seconds and the agent wrote
90s of narration across 6 clips. Budgeting is documented (`narration.md`, words ≈ seconds × 2.5)
and was not applied. Worth a `check` finding of its own — **speech longer than the timeline it
sits in, or a timeline far longer than the brief** — since it is mechanically detectable.

## Projects still resolve to the legacy `vii` path

**Found 2026-08-12.** `project_list` reports its root as
`~/Library/Application Support/vii/projects`. The rename to bay was supposed to migrate this
(`bay-paths/src/lib.rs:103` and its tests cover the case), but on this machine the `vii`
directory exists and still wins, so new projects are being written into the old brand's folder.

Size: **S–M.** It is not just cosmetic: `bay.app` and a `vii` directory disagreeing about where
projects live is how someone loses work at the next rename, and the fallback quietly makes the
migration test's guarantee untrue in practice. Decide whether the resolver should prefer `bay`
once it exists and migrate on first write, and make the live behaviour match whatever the tests
claim.

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
