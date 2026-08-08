# bay — roadmap

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

## 2. Provision everything bay needs · **DONE**

The goal was **the user installs nothing**, and that is now true. `bay.app` is still one binary,
an icon and a plist; what it depends on, it installs itself, on request.

| | the user must |
|---|---|
| Rust | nothing — compiled away |
| ffmpeg + ffprobe | nothing — "Install video tools (57 MB)", or `runtime_install` |
| Python + Kokoro | nothing — "Install narration (1.2 GB)", or `runtime_install` |
| Kokoro weights | nothing — fetched into `<data>/models` on first narrate |
| A GPU adapter | this one bay cannot install |

**What shipped.** A `bay-provision` crate: a manifest of every artifact pinned by version and
SHA-256, a streaming downloader that hashes as it writes and discards anything that does not
match, zip/tar.gz extraction that stages and renames so a half-install is never mistaken for a
whole one, and the Kokoro venv built in Rust by driving the `uv` and CPython it just fetched.
`bay_paths::tools` grew a Managed tier so a provisioned ffmpeg wins over a system one.
`runtime_status` / `runtime_install` expose it to agents; a toolbar button exposes it to people.

**Verified end to end**, not just unit-tested: `BAY_PROVISION_LIVE=1` provisions into a
throwaway data directory and then *runs* the resulting `ffmpeg -version` (30s), and
`BAY_PROVISION_LIVE_SPEECH=1` builds the venv and asserts `kokoro` imports (39s). Both are
skipped by default and a skip is never reported as a pass.

**Judgement calls worth keeping.**

- **Provisioning stays user-initiated.** Detect → say what and how big → wait. A first-run
  auto-download is bay making a network call on its own behalf.
- **A machine that already works is offered nothing — if what it has is good enough.** Status
  asks "can bay decode and speak", not "is it in bay's directory", so a current Homebrew ffmpeg
  is used rather than downloading 57 MB on top of it. But "it exists" is not evidence it behaves
  like the build bay was tested against, which is the one way a release still breaks after
  pinning: ship, and a user's 2019 ffmpeg fails a feature that worked everywhere in testing. So
  a copy bay did not install has to clear `minimumVersion` in the manifest, and a build that
  will not say what version it is (a git master snapshot) does not clear it. Below the floor,
  bay reports video as not installed and offers the build it was tested with. Above it, the copy
  is used *and named* — `runtime_status` says "you are on 8.1.2; bay is tested against 9.0"
  rather than implying they are the same thing. Verified against real binaries: 8.1.2 accepted,
  a real 6.0 refused.
- **What was installed is written down.** `<runtime>/installed.json` records each artifact's
  name, pinned digest, source URL and the files it placed, so a bug report can name the exact
  build without asking the user to run anything, and a later check can tell that a file was
  replaced or truncated. The receipt never outranks the filesystem — deleting the runtime
  directory must not leave bay insisting everything is fine.
- **The digest is the trust anchor**, not the URL and not TLS. That is what makes it safe to
  fetch macOS ffmpeg from a personal domain (`ffmpeg.martin-riedl.de`); all four macOS hashes
  were checked against the publisher's own `.sha256` at pin time.
- **Only redistributable builds.** The obvious ffmpeg source (`eugeneware/ffmpeg-static`) is
  built `--enable-nonfree`, which nobody may redistribute; the pinned builds are GPL-3.0 with no
  nonfree flag, and a test fails the build if a nonfree artifact is ever added.
- **Pinned URLs must be immutable.** BtbN's `latest` tag is rebuilt in place daily and would
  break the pin within a day, so a test rejects `latest`-shaped URLs.

**Still open.** Linux is not covered — bay ships macOS and Windows, and an unsupported platform
says so rather than pretending. The Windows path is pinned and unit-tested but has not been run
on Windows. There is no "uninstall / reclaim disk" button yet, though everything lives under one
directory specifically so there can be.

<details>
<summary>The research this was built on — kept because it is why the design is what it is.</summary>

**Do not freeze Python.** Researched and rejected: PyInstaller with torch lands ~2.6 GB, and
TorchScript needs `.py` source that a frozen app does not have (pyinstaller#5673, still open);
Nuitka disables `torch.jit` in standalone mode (#2500); PyOxidizer is dead by its maintainer's
own words (#741, "possibly dead"). All three also require signing dozens of nested dylibs under
the hardened runtime. Freezing trades a solved problem for an unsolved one and does not even
win on size.

**Ship a real interpreter instead.** `uv` is one static binary — 17.7 MB per platform, and
`otool -L` shows only macOS system libraries, nothing to install alongside it. It installs
python-build-standalone (MPL-2.0), which is **relocatable — verified** by copying a tree to an
arbitrary path and running it: `sys.prefix` resolves from the executable, every stdlib C
extension imports, OpenSSL is statically linked. (One residual: `sysconfig.get_config_var
("prefix")` stays stale, which only matters when compiling extensions from source.)

Verified isolation — with `UV_PYTHON_INSTALL_DIR` set, `uv python list --only-installed`
returned nothing despite five managed Pythons in HOME. It is a real redirect, not an extra
search path. `--no-bin --no-registry` keep PATH and the Windows registry untouched.

```
uv python install 3.12 --install-dir <data>/python --no-bin --no-registry   # UV_CACHE_DIR=<data>/cache
uv venv --python <data>/python/.../bin/python3.12 --no-project <data>/kokoro-venv
uv pip install kokoro soundfile "en_core_web_sm @ <wheel url>"
```

The spaCy wheel must be explicit or `misaki` shells out to pip at *runtime* —
`setup-speech.sh` already does this, and the reason is worth keeping when it moves into Rust.
**espeak-ng needs no system install**: `espeakng-loader` ships the library inside its wheel.
kokoro 0.9.4 requires Python `>=3.10,<3.13`, so **3.12 is the ceiling**; torch's macOS wheels
are `macosx_14_0_arm64`, so **macOS 14+**.

**Measured footprint** (this machine, and the HF API):

| | |
|---|---|
| ffmpeg static, macOS | ~80 MB on disk (26 MB zip) |
| `uv` | 17.7 MB download, 52 MB on disk |
| CPython 3.12 (pbs, arm64) | 25 MB download, 73 MB on disk |
| kokoro venv (torch etc.) | 858 MB |
| Kokoro-82M weights | 327 MB + 0.5 MB per voice (Apache-2.0) |

So **~80 MB to render**, **~1.2 GB more to narrate**. That split should be the UI: ffmpeg
blocks the core product, speech is opt-in.

**Provisioning must be user-initiated.** A first-run auto-download is bay making a network call
on its own, which is exactly what the manifesto rules out. Detect → say what is missing and how
big → the user chooses. `uv python install --mirror` exists if we would rather serve the
tarballs ourselves than send users to github.com.

**Integrity is not optional.** Every artifact is pinned by version + SHA-256 in a manifest in
this repo, verified before install, never trusted from the network. `uv` publishes a `.sha256`
per asset; python-build-standalone publishes one `SHA256SUMS` per release. A downloaded binary
also needs its macOS quarantine attribute cleared or it will not execute.

`bay_paths::tools` already has a "bundled beside the binary" tier that nothing uses yet — the
managed directory slots in there with no call-site changes.

**Done:** weights now go to `<data>/models` via `HF_HOME` on the child, with telemetry and
implicit-token off. They were landing in the shared `~/.cache/huggingface` (11.5 GB on the
dev machine) where bay could neither measure nor remove them.

*Two things the build corrected from the plan above.* bay fetches python-build-standalone
directly rather than through `uv python install`, because the verified downloader already
existed and one download path is easier to reason about than two — `uv` is kept for resolving
wheels, which is what it is best at. And the measured ffmpeg figure was low: the pinned macOS
build is a 28 MB zip per binary, ~57 MB to download for both and ~130 MB on disk.

</details>

---

## 3. Assistant: a local LLM that can edit the project · **L**

A chat panel. Ask questions about the project, and ask for changes — "make the title bigger",
"cut the dead air at the start", "move the captions up".

**Why bay is well shaped for this:** every edit already goes through `Command` → reversible
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

Both need frame extraction, which bay already does via the ffmpeg sidecar.

> **Premise check — do this first.** This was suggested on the basis that palmier has a vision
> model. My gap audit found **no vision model there**: their ML surface is Apple
> SpeechAnalyzer / cloud transcription, WeSpeaker voice embeddings for speaker ID, VAD, beat
> detection and denoise — all audio. There *is* a `chat/` directory in their project package,
> but the audit deliberately excluded palmier's AI surface per the original scope note, and
> there is no local clone. **Clone palmier-pro and verify before building on this.**

**Risk:** the useful unit is not "a frame" but "a shot". Without shot-boundary detection,
embedding every Nth frame gives redundant, noisy results. That may be a prerequisite item.

---

## 5. Naming — `opencut` → `vii` → `bay` · **DONE**

Two renames, both complete. No `opencut` and no `vii` in crate names, binaries, identifiers,
docs, scripts or CI. Crates are `bay-core`, `bay-project`, `bay-preview`, `bay-ui`, `bay-text`,
`bay-audio`, `bay-speech`, `bay-mcp`, `bay-agent`, `bay-provision`, `bay-desktop`; there is
exactly one binary, `bay`, and `bay --mcp` serves the same engine headlessly. The bundle is
`bay.app` / `dev.bay.editor`, the MCP server registers as `bay`, and environment overrides are
`BAY_*`.

**What the second rename had to protect.** A user's projects, agent registry and up to 1.2 GB of
provisioned runtime live under `~/Library/Application Support/vii`. Moving that path without
looking would have opened the app on an empty project library — working exactly as designed, and
indistinguishable from having lost the work. So `bay_paths::data_dir` prefers the new directory
but falls back to the old one when only the old one exists, and nothing is copied or moved: a
`fs::rename` is one interrupted copy away from being a data-loss bug, and there is no version of
that trade worth taking for a directory that works where it is. Same for the Kokoro venv, which
the old setup script wrote to `~/.local/share/vii/kokoro-venv` — still searched, because dropping
it would have reported narration as missing on every machine that had it, with a 1.2 GB
re-download as the apparent fix. Both paths are covered by tests that inject the filesystem, so
the migration is exercised on a machine that has neither directory.

**Two deliberate exceptions, both flagged rather than decided silently:**

- **`LICENSE` keeps "Copyright 2025-2026 OpenCut".** The licence is MIT and requires that
  notice be retained in all copies. Removing it would make distribution non-compliant. This is
  a legal constraint, not branding — the product is called bay everywhere a user can see.
- **`dep/` has since been deleted entirely**, so the only remaining reference to the upstream
  name is the licence notice above.

**Not done by the rename:** the checkout directory is still `synthai/vii`, and `dist/` still
holds `vii.app` / `vii.exe` from an older build. Both are outside the source tree — `mv` and a
rebuild — and neither affects what a user installs.

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
`bay --agents` says what is open.

**The bridge serves all 22 tools with the window open.** `render`, `narrate`, `media_import`
and `subtitles_to_video` run on GPUI's background executor with their own wgpu device; what
they produce comes back as `Command`s applied on the main thread, so an agent's narration
undoes with the same Cmd+Z as a human edit. Nothing suggests closing the app.

**The endpoint has exactly one owner, and it is always discoverable.** `claude mcp add` writes
`http://127.0.0.1:7333/mcp` into the client's configuration and it stays there, so the port is
treated as a contract: one process serves it, and a conflict is resolved by *naming the owner*,
never by moving. Three things were wrong here and are now fixed:

- **A headless `bay --mcp` never registered**, so `bay --agents` printed "No bay window is open.
  Start one with: bay" while that server was answering the very endpoint being asked about —
  and following the advice walked straight into the conflict. Everything that serves now
  registers, with its kind and pid.
- **The conflict advice was `bay --mcp --port 0`.** An OS-assigned port produces a server no
  configured client can reach, so it looked like a fix and was not one. Every message now names
  what holds the port — an editor window and its project, another headless bay and its pid, or
  something that is not bay (with the `lsof` line to find it) — and a test asserts that no
  advice, for any combination, ever mentions `--port`.
- **An editor that lost the port degraded silently.** The reason went to stderr only, which
  someone who launched from Finder never sees: agent tools quietly did nothing, indistinguishable
  from a broken build. The window now carries the reason.

`--port` survives for what it is actually for — a second checkout, or CI — and both `--help` and
the startup line say that a non-default port is unreachable by a client registered for 7333.

**Still open:**

- **Stage 3 — conflict.** No leases yet. If you are dragging a clip and the agent edits the
  same one, last write wins with no "keep mine / use the agent's" card.
- **Taking over an idle owner.** If a headless server is running but doing nothing, the only
  answer today is the `kill <pid>` bay prints. A `--takeover` that asks the owner to stand down
  over MCP would be friendlier, and is only safe once the owner can report whether it is mid-render.
- **Multiple windows.** Deliberately not supported yet. When it matters, the shape is: each
  window claims its own port, and a router on the fixed port forwards to a chosen one so there
  is still a single `claude mcp add`. The registry (`bay-agent::registry`) already lists
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

## 5d. Feeling like a Mac app — menus and lifecycle · **P0 DONE**, rest open

Triggered by two symptoms — no Dock logo, and Cmd+Q doing nothing — and a question: should bay
adopt Tauri to get native behaviour? **No.** Researched and rejected on three independent grounds,
any one of which is sufficient:

1. **Manifesto constraint #4** is literally "no web view pretending to be an app". Tauri is a
   WKWebView.
2. **Technically blocked.** A Tauri window's content view *is* the webview. Hosting a wgpu surface
   under it is an open upstream problem ([tauri#8246], [#11944], [#9220]); the only shapes that
   work are per-frame CPU readback — the exact copy this architecture forbids — or reimplementing
   the compositor in WebGPU, which is the JS stack bay was forked from and **deleted**.
3. **It would not have helped.** Tauri's menus are AppKit underneath, same as GPUI's. The cost
   would have been rewriting ~5,900 LOC of `bay-ui` to reach a feature set that was a day's work
   where we already were.

**What was actually wrong.** Nothing framework-shaped. `cx.set_menus()` was never called, and
GPUI invokes AppKit's `setMainMenu:` from that one place — so `NSApp.mainMenu` stayed nil and
there was no menu bar *at all*: no Cmd+Q, Cmd+W, Cmd+M, Cmd+H, no Services, and no OS Edit menu
(the thing that gives text fields standard Cut/Copy/Paste). `on_window_closed` was never
registered either, so closing the last window left the process alive.

**Shipped.** A `bay-ui/src/menus.rs`: bay / File / Edit / Timeline / Window / Help, with Edit
built from `MenuItem::os_action` so AppKit gets the real selectors. Quit, Close, Minimize and
Save are bound and handled; the rest dispatch actions the editor already defines, so there is no
second implementation to drift. Closing the last window now quits, and `on_app_quit` writes the
open project — Cmd+Q bypasses the "‹ Projects" button, which was the only path that used to save,
so the menu bar would otherwise have *introduced* a way to lose work.

**Two mistakes worth remembering**, both of which compiled and looked right:

- A menu item gets its key equivalent from the *keymap*. `MenuItem::action("Quit bay", Quit)`
  with no `cmd-q` binding renders a correct-looking item that does nothing — the menu bar
  appeared and Cmd+Q still did not quit.
- Window actions cannot be handled with `cx.on_action` at app level. A keystroke is dispatched
  while the window is mid-update, so its slot in `cx.windows` is empty and `update_window`
  returns "window not found"; with the `Result` discarded it fails in total silence. They belong
  on the root element, where `Window` is already in scope. Cmd+W was wired and dead until this.

Verified by driving the running app through the Accessibility API: menu bar reads
`Apple, bay, File, Edit, Timeline, Window, Help`, the Edit menu carries macOS's own Writing
Tools / Dictation items (proof it is a real OS Edit menu), Quit shows its ⌘Q, and both Cmd+Q and
Cmd+W end the process.

**The missing logo was never a bug.** `./run.sh` is `cargo run` — a bare Mach-O with no
`Info.plist`, and macOS gives such a process no Dock icon and no app name. `script/bundle-mac`
already produces the real thing. `BUNDLE=1 ./run.sh` now builds and launches `bay.app`, and the
plain path prints a line saying what it is not, so nobody debugs this again.

**Still open, in order:**

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

[tauri#8246]: https://github.com/tauri-apps/tauri/issues/8246
[#11944]: https://github.com/tauri-apps/tauri/discussions/11944
[#9220]: https://github.com/tauri-apps/tauri/issues/9220

---

## 6. Bug: a sidecar can outlive its parent · **S**

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

## Cross-cutting: there is no ML runtime story yet

Items 2, 3 and 4 all need model weights on disk and an inference process. Today there is
exactly one such sidecar (Kokoro) and its lifecycle was hand-written. Before adding a second
and third, the shared pieces are worth pulling out:

- a **sidecar supervisor** — spawn, authenticated health probe, kill-and-replace when
  unhealthy, port-occupied refusal, bounded readiness poll, parent-PID watchdog, idle
  eviction. All of this exists in `bay-speech::SpeechEngine` and is not speech-specific.
- a **model registry + downloader** — **done**, as `bay-provision`. A new model is a manifest
  entry plus a component, and it inherits the digest verification, the resume-safe staging, the
  background job and the progress UI for free. Items 3 and 4 should add entries, not plumbing.
- a policy on **which runtime**: llama.cpp for GGUF text+vision, plus something for SigLIP
  embeddings (ONNX Runtime, or Candle if we want it in-process).

The downloader half of this is no longer in the way. Generalising the *sidecar supervisor* is
still worth doing before a second and third model process exist.

---

## Suggested order

1. **Text → audio button** (S) — small, immediately useful, proves the UI↔speech path.
   Narration is now one button-press away from any machine, so this is no longer gated on the
   user having set anything up.
1b. **Document types + Open Recent** (S, item 5d) — the rest of "feels like a Mac app", now that
   the menu bar and lifecycle are in. Small, and it is what makes a project file double-clickable.
2. ~~Model download pane~~ — **done** (item 2). The sidecar supervisor still wants generalising.
3. **Verify the palmier vision premise** — cheap, and it decides whether item 4 is real.
4. **Assistant, read-only first** (L) — questions about the project, no edits.
5. **Assistant edits behind a confirm step**, lowered into `Command` so undo works.
6. **Vision**, whichever half survives the premise check.

---

## Already shipped

| | |
|---|---|
| Engine | shapes, per-axis scale + anchors, 8 easings, full text typography, audio in export |
| MCP | 24 tools over HTTP/stdio; snapshot, render, timeline introspection |
| Speech | Kokoro sidecar, word-level timestamps, SRT/VTT in and out, `subtitles_to_video` |
| Runtimes | bay installs its own ffmpeg and Kokoro from a pinned, hash-verified manifest |
| Platform | menu bar, Cmd+Q/W/M/S, quit saves the open project, `BUNDLE=1 ./run.sh` for the real .app |
| Agents | one owner of `:7333`, discoverable via `bay --agents`; conflicts name what holds it |
| Build | `./build.sh` builds the one binary, `bay`; runtimes are the app's job, not the build's |
| Skill | `.claude/skills/bay/` — an agent can drive the editor unassisted |
| Tests | 385 passing, and the suite is deterministic |

---

## Where this actually stands

Read this first; the sections above are the detail.

**Shipped and verified end to end** — items 2, 5, 5b (Stage 1), 5d (P0), plus the naming and
the deterministic suite. A user gets one binary, installs nothing, and the app fetches ffmpeg
(~57 MB) and narration (~1.2 GB) on request with a progress bar.

**Next, in the order I would take them:**

| | Item | Size | Why now |
|---|---|---|---|
| 1 | Windows build, actually run | S | Pinned and unit-tested, never executed on Windows. `.github/workflows/windows.yml` is `workflow_dispatch`; `./script/build-windows` triggers it and downloads the zip. Nothing else can be trusted on that platform until this passes once. |
| 2 | Kokoro weight download progress (5e) | S–M | The one place the "no silent waits" promise still breaks — see below. |
| 3 | Text → audio button (1) | S | Narration is one press away from any machine now, so this is no longer gated on setup. |
| 4 | Document types + Open Recent (5d) | S | The rest of "feels like a Mac app": project files get an icon and open on double-click. |
| 5 | Sidecar outliving its parent (6) | S | A real leak, cheap to close. |
| 6 | Assistant, read-only first (3) | L | The next substantial feature; wants the sidecar supervisor generalised first. |

**Deliberately not doing yet:** Linux (macOS and Windows only, and an unsupported platform says
so), multi-window, Stage 3 edit conflict leases, and vision (item 4) until the palmier premise is
verified.

---

## 5e. Kokoro weights download with no progress · **S–M**

The gap in the zero-install promise. `runtime_install speech` shows a progress bar for the
~1.2 GB it fetches, but the **~330 MB of model weights are not part of that** — they are pulled
by `huggingface_hub` inside the Python sidecar the first time `narrate` runs, into `<data>/models`
via `HF_HOME`. bay sees none of it: `SpeechEngine::ensure` just waits on a readiness poll with a
180-second budget, and the only reason that timeout is 180s rather than a few seconds is that it
has to cover this download.

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

Either way the readiness timeout should drop back to something that means "the model failed to
load" rather than doubling as a download budget.

**Related, smaller:** the "Install …" button lives only in the *editor* toolbar
(`editor_view.rs:runtime_offers`), not on the project launcher. Someone who opens bay and looks
at the project list is told nothing about what is missing until they open a project. Not fatal —
you have to open a project to do anything — but the launcher is where a first run actually
starts, and it is the natural place to say "video tools are not installed yet".
