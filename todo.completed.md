# bay — completed

What is built, shipped and verified. Each entry says what it was, what it does now, and **what
proves it** — a claim here without evidence behind it is the thing this file exists to prevent.

Companions: [`todo.pending.md`](todo.pending.md) (not built yet) ·
[`todo.testing.md`](todo.testing.md) (built but unproven) · [`todo.md`](todo.md) (index)

| | |
|---|---|
| Engine | shapes, per-axis scale + anchors, 8 easings, full text typography, audio in export |
| MCP | 65 tools over HTTP/stdio; snapshot, render, timeline introspection |
| Speech | Kokoro sidecar, word-level timestamps, SRT/VTT in and out, `subtitles_to_video` |
| Vision | SigLIP in-process; find a picture by describing it, and fetch it from the open archives |
| Runtimes | bay installs its own ffmpeg and Kokoro — weights included — from a pinned, hash-verified manifest |
| Platform | menu bar, Cmd+Q/W/M/S, quit saves the open project, `BUNDLE=1 ./run.sh` for the real .app |
| Agents | one owner of `:7333`, discoverable via `bay --agents`; conflicts name what holds it |
| Build | `./build.sh` builds the one binary, `bay`; runtimes are the app's job, not the build's |
| Skill | `.claude/skills/bay/` — an agent can drive the editor unassisted |
| Tests | 967 passing, and the suite is deterministic |

---

## Finding a picture by describing it

**The problem, concretely.** Ask Wikimedia Commons for "Barings Bank" and the first result is a
Barclays branch on Baring Road in Beaconsfield. The words match perfectly and the photograph is
of nothing to do with the subject, because the search is over filenames and wikitext. An archive
that answers with the filename rather than the picture cannot be used to illustrate anything
without a human opening every result.

Three crates, and the value is in the composition rather than in any one of them:

- **`bay-vision`** — SigLIP image/text embeddings, in-process via Candle. No sidecar, no
  interpreter, so visual search does not depend on the 1.2 GB speech component. Provisioned as
  the `vision` component: Google's own Apache-2.0 checkpoint, pinned to a commit, 815 MB.
- **`bay-stock`** — search and download over Wikimedia Commons and Openverse (keyless), with
  Pexels and Unsplash wired and dormant until a key exists. Every result is licensed for use in
  a video; ND, NC and SA are filtered out before the caller sees them.
- **`bay_agent::illustrate`** — the join, in the one crate both the editor path and the headless
  server route through, so the same verb cannot behave two ways.

Six tools: `vision_status`, `stock_status`, `stock_search`, `stock_fetch`, `stock_credits`,
`image_rank`. 59 → 65.

**What proves it.** `assets/loaf-of-bread/` — a 78 s short built entirely from images this
found. Its `sources.json` is the twenty-five it chose out of an archive it re-ranked, and
`MANIFEST.md` records the measurements. 967 tests pass, up from 870; 81 of the new ones are in
these two crates and every one runs without a network, a GPU or a model. The live path is proven
separately by the video: `stock_search "hyperinflation 1923 Germany"` re-ranked the archive's
tenth result to first.

**Three things worth keeping in mind.**

1. **The archive and the encoder want opposite inputs.** Commons wants two keywords and returns
   *nothing at all* for a sentence; SigLIP wants the longest, most concrete description you can
   write. That is why `stock_search` takes both `query` and `describe`, and it is not a
   convenience — passing a sentence as `query` returns zero results, measured.
2. **Scores are not calibrated and must not be read as confidence.** SigLIP's sigmoid training
   leaves the signal in the *ordering* and in the gap between the best and the median. Every
   result set carries a `separation`, and a separation near zero means the archive has nothing
   matching the query — search for something else rather than placing the top hit.
3. **The tool proposes; a person picks.** It put an East German party headquarters first for
   "Reichsbank", and a 1933 antisemitic boycott photo first for a query about shop windows.
   Both were caught by looking at a contact sheet. Nothing here should be wired to place an
   image without someone seeing it, which is the same position `shots_detect` already takes.

**ShareAlike is an explicit, per-call opt-in.** ND is refused because an edit is a derivative
work and NC because bay cannot know how a film will be used — those are flat refusals. SA is
different: it does not restrict the edit, it obliges the *finished film* to carry the same
licence. Refusing it outright made the best historical material invisible (the Bundesarchiv
released its Weimar photographs as CC BY-SA 3.0 de, so the default policy returns none of them);
accepting it silently would make someone's film copyleft without telling them. So
`licence: "allow-sharealike"` turns it on for one call and the result carries a
`licenceWarning` saying what it costs.

**Two pre-existing bugs fixed while here.** `runtime_install`'s component enum was a hardcoded
`["video", "speech"]` and had already drifted — `sfx` shipped as a component no agent could
legally ask for. It is now derived from the manifest. And Commons writes an unknown author as a
tooltip span wrapping the word plus the same word again, so stripping tags produced
`UnknownUnknown` in generated credit lines.

---

## Provisioning — the user installs nothing

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
throwaway data directory and then *runs* the resulting `ffmpeg -version` (~15s), and
`BAY_PROVISION_LIVE_SPEECH=1` builds the venv and asserts `kokoro` imports (~72s). Both are
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

### Nothing tells a user to install a toolchain

An audit of the claim above found it broken in four user-visible places, all now fixed:

- `bay-speech/engine.rs` — the `NotInstalled` error is what a user actually hits the first time
  they ask for narration on a clean machine, and it told them to run `uv venv --python 3.12 …`
  and `uv pip install kokoro soundfile`. Now names `runtime_install` and the toolbar button.
- `bay-mcp/narration.rs` — `speech_status` said the same, and pointed at `docs/native/speech.md`,
  which does not ship with the binary. This was the headless copy of a hint already fixed on the
  in-app bridge path; the two being separate is how one stayed wrong.
- `script/bundle-windows.ps1` — the `README.txt` *inside the distributed zip* listed ffmpeg and
  "Python 3.12 with the kokoro package" under REQUIREMENTS, with a link to ffmpeg.org.
- `bay --help` — "Needs ffmpeg on PATH", with no mention that bay installs it.

A guard test scans `bay-speech`'s sources for `uv venv`, `uv pip install`, `pip install` and
`astral.sh` outside comments, and was checked to *fail* when the old wording is put back. The
previous guard only covered one function in `bay-provision`, which is exactly how two of these
slipped past it.

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

The spaCy wheel must be explicit or `misaki` shells out to pip at *runtime*. **espeak-ng needs
no system install**: `espeakng-loader` ships the library inside its wheel. kokoro 0.9.4 requires
Python `>=3.10,<3.13`, so **3.12 is the ceiling**; torch's macOS wheels are `macosx_14_0_arm64`,
so **macOS 14+**.

**Measured footprint:** `uv` 17.7 MB download / 52 MB on disk · CPython 3.12 (pbs, arm64) 25 MB /
73 MB · kokoro venv (torch etc.) 858 MB · Kokoro-82M weights 327 MB + 0.5 MB per voice
(Apache-2.0). So **~57 MB to render**, **~1.2 GB more to narrate**.

*Two things the build corrected from the plan.* bay fetches python-build-standalone directly
rather than through `uv python install`, because the verified downloader already existed and one
download path is easier to reason about than two — `uv` is kept for resolving wheels. And the
pinned macOS ffmpeg is a 28 MB zip per binary: ~57 MB to download for both, ~130 MB on disk.

</details>

---

## Naming — `opencut` → `vii` → `bay`

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

**Not done by the rename:** the checkout directory is still `synthai/vii`, the GitHub repo is
still `Himasnhu-AT/vii`, and `dist/` held `vii.app` / `vii.exe` from an older build. All outside
the source tree — `mv`, a repo rename and a rebuild — and none affect what a user installs.

---

## Live agent editing — Stage 1

The app hosts the MCP server; tool calls cross a channel and are applied on the GPUI main
thread, so an agent's edit appears in the timeline immediately and undoes with ⌘Z. Measured
against the running app: reads p99 **0.31 ms**, writes p99 **0.86 ms** — the budget was one
frame (16 ms).

**Single-window on purpose, for now.** A second launch raises the open window instead of
starting a rival, so there is never ambiguity about which document the agent is editing. The
bound port is the lock; liveness is decided by trying to bind it, not by pid — a pid can be
recycled, a free port cannot lie, so a killed window never locks the next launch out.

**The bridge serves all 24 tools with the window open.** `render`, `narrate`, `media_import`
and `subtitles_to_video` run on GPUI's background executor with their own wgpu device; what
they produce comes back as `Command`s applied on the main thread, so an agent's narration
undoes with the same Cmd+Z as a human edit. (With a caveat that is *not* fixed — see
[`todo.pending.md`](todo.pending.md), slow tools time out at 20s.)

### The endpoint has exactly one owner, and it is always discoverable

`claude mcp add` writes `http://127.0.0.1:7333/mcp` into the client's configuration and it stays
there, so the port is treated as a contract: one process serves it, and a conflict is resolved by
*naming the owner*, never by moving. Three things were wrong and are now fixed:

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
Verified against a live headless server, an editor-registered port, and a foreign holder.

---

## Feeling like a Mac app — menus and lifecycle (P0)

Triggered by two symptoms — no Dock logo, and Cmd+Q doing nothing — and a question: should bay
adopt Tauri to get native behaviour? **No.** Rejected on three independent grounds, any one of
which is sufficient:

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
plain path prints a line saying what it is not, so nobody debugs this again. Confirmed on the
bundled app: process name `bay`, `background only = false` (real Dock presence).

[tauri#8246]: https://github.com/tauri-apps/tauri/issues/8246
[#11944]: https://github.com/tauri-apps/tauri/discussions/11944
[#9220]: https://github.com/tauri-apps/tauri/issues/9220

---

## Windows builds must happen on Windows — a closed decision

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

**So the options are:** a Windows runner in CI, a local Windows VM, or a gpui fork. CI is the
cheap one — `.github/workflows/windows.yml`, `workflow_dispatch` only, triggered by
`./script/build-windows`, which also downloads the zip back.

A Windows build **has now run green** and produced an 11 MB zip containing `bay.exe` (27 MB) and
`README.txt`. What that does and does not prove is in [`todo.testing.md`](todo.testing.md) — the
runtime behaviour on Windows is still unverified.

---

## The test suite is deterministic

Three causes, found one at a time, each hiding the next:

- The registry tests claimed the **real** port 7333, so any `bay --mcp` running on the machine
  failed them — a test failing for reasons outside the repository teaches people to re-run until
  green, which is how a real failure gets ignored.
- The first fix moved to a private port picked from **40000–60000**, which overlaps the range
  macOS hands out for ephemeral ports (`net.inet.ip.portrange.first` = 49152). Still failed
  ~1 run in 6.
- `live()` reaps by rebinding, and **macOS returns `EADDRINUSE` for ~5 ms after a socket
  closes** — measured: the rebind immediately after `drop` fails, the one 5 ms later succeeds.
  So a just-closed window briefly still looked open.

Now: the port is resolved rather than hardcoded, tests take a private one below 49152, and
reaping is asserted with a bounded retry rather than on the first call. `port_free`'s doc records
the kernel behaviour, because production has the same property — it errs towards "alive", which
is the safe direction.

**Verified:** 30 consecutive `bay-agent` runs and 10 consecutive full gates clean, including with
7333 deliberately held by another process.

---

## Dependency advisories — three of four fixed

Dependabot flagged four crates. Three moved within semver and are fixed:

- **`rustls-webpki` 0.103.10 → 0.103.13** (high — DoS via panic on a malformed CRL). This one
  mattered most: it is reached through `ureq → rustls`, the TLS the provisioning downloader uses.
  The SHA-256 pin still governs *what* gets installed, but a panic in certificate handling
  happens before that check runs.
- **`quinn-proto` 0.11.14 → 0.11.16** (high — remote memory exhaustion).
- **`rand` 0.8.5 → 0.8.7 and 0.9.2 → 0.9.5** (low — unsoundness with a custom logger).

`wgpu` stays pinned at `=29.0.1`; the lockfile change touched 9 packages, none in the GPU stack.
Confirmed by GitHub: 7 open alerts → 1. The survivor is `grid`, which cannot be fixed here — see
[`todo.pending.md`](todo.pending.md).

---

## The pending sweep — five defects, closed

Landed together on `fix/pending-sweep`. Each one contradicted something the repo says about
itself, which is why they went first.

### Export decoded from the ≤480px preview cache

`plan_decode` scaled every clip to 480px wide and, on a long clip, dropped the sample rate to
2 fps to stay inside a 192 MB budget; `export_video` then composited those cached frames at the
export size. A 4K export was a 480px cache upscaled 8×, and a 10-minute clip repeated each
decoded frame 15 times.

Decode now has an intent. Preview keeps that plan byte for byte; export plans at source
resolution and the delivered frame rate and **streams**, holding one frame per on-screen clip.

**Proof:** 1px vertical stripes at 960×540, exported 1:1, luma standard deviation — source
127.5, before **1.5** (averaged to flat grey), after **126.2**. The 2px version of that test
passed against the bug (2px lands exactly on Nyquist under a 2:1 downscale and survives), which
was measured rather than assumed and is written into the test. Cost, measured: a 1080p 5s@30
export takes 1.76s producing 3.5 MB against 0.95s producing 0.78 MB — the old path was fast
because it was encoding a blurry upscale.

### Three panics on the live render path

`upload_rgba_texture` asserted its buffer length, the readback `expect`ed `device.poll`, and
`bay-preview` `expect`ed the compositor pass — the third was not in the write-up and was found
while fixing the other two. A bad texture now drops one layer and the frame still draws; a
failed readback fails the frame and each caller degrades on its own terms.

**Proof:** table-driven short/long/zero-dimension uploads return `None` on a live device, and
the device stays usable afterwards. Device loss itself is unproven — see `todo.testing.md`.

### Slow tools cut off at 20 seconds

Every `tools/call` shared one 20-second budget chosen for a native file dialog, so any render
over 20s returned "the editor did not answer in time" while the render carried on and its
result was applied to the document anyway.

Budgets are per tool class now, and `render`, `narrate` and `subtitles_to_video` return a job
id instead of holding the call open — the shape `runtime_install` had proved. A render reports
`fraction` per encoded frame and stops when cancelled, leaving no partial file.

**Proof:** the bridge test `todo.testing.md` asked for (every previous one used a fast tool);
`timeout_for` walked against the real `slow_tools()` list; cancel and progress asserted through
a real export. Seven published contract documents changed with it.

### Kokoro weights fetched mid-narrate with no progress

`runtime_install speech` reported "installed" and then the first `narrate` silently pulled
~339 MB inside one blocking call with its stdout discarded. The weights are now 56 pinned
artifacts at commit `f3ff357`, installed under `runtime/models/kokoro/`, with
`HF_HUB_OFFLINE=1` on the sidecar once they are there.

**Proof:** the sidecar with `--model-dir` and offline mode synthesised 2.02s of real audio with
word timings and no network. The live install test asserts the model, config and all 54 voices
land — it previously asserted only that the venv imports kokoro, so it would have passed
throughout the bug.

### A sidecar outliving its parent

The pid watchdog is defeated by pid reuse and armed silently or not at all. The sidecar now
blocks on a pipe bay holds, which the OS closes however bay dies, including `kill -9`; behind
it an idle timeout, and behind that the original pid check. An unsupervised sidecar says so.

**Proof:** four tests that run on a bare `python3` (the kokoro import is lazy), verified to fail
when the pipe watchdog is disabled.
