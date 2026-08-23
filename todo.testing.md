# bay — needs testing

Things that are **built but unproven**, and how to prove them. This file exists because "it
compiles", "CI is green" and "it works" are three different claims, and the gap between them is
where the bugs that reach users live.

An entry leaves here only when something *ran* and was observed — not when it was reasoned about.

Companions: [`todo.completed.md`](todo.completed.md) (done, with evidence) ·
[`todo.pending.md`](todo.pending.md) (not built) · [`todo.md`](todo.md) (index)

---

## 1. Windows at runtime — nothing has ever been executed there

**Highest priority.** The build is green and produces an 11 MB zip
(`bay.exe` 27 MB + `README.txt`), but *running* it is unverified in every respect that matters.

### What the CI actually verifies

`.github/workflows/windows.yml` checks exactly this, and no more:

- `bay.exe` exists in the bundle
- exactly one `.exe` in the folder
- the PE subsystem byte is `2` (GUI, so no console window appears behind the editor)
- `bay.exe --help` exits 0 and prints usage
- `bay.exe --agents` exits 0

No `cargo test`. No provisioning. No archive extraction. No venv build. No window ever opens —
a headless runner cannot.

### What to try, in order

1. **Launch `bay.exe`.** Does a window appear with no console behind it? Does the project
   launcher render?
2. **"Install video tools (57 MB)"** in the toolbar. This is the whole zero-install claim, and
   it has never run on Windows. Watch for: the BtbN zip extracting `bin/ffmpeg.exe` and
   `bin/ffprobe.exe` out of a nested directory, the progress bar moving, and a render working
   afterwards.
3. **`bay.exe --mcp` from a terminal.** See §2 below — this is where I most expect trouble.
4. **"Install narration (1.2 GB)"**. The uv/venv path has never executed on Windows anywhere.
   Specific risk: `archive.rs` unpacks the CPython tree with `entry.unpack` and
   `preserve_permissions`; a symlink member would need privilege on Windows. I believe the
   Windows CPython build has none, but that is a belief, not a test.
5. **Narrate something.** Exercises the sidecar spawn, `Scripts\python.exe` resolution, and the
   weight download.

### What is at least correct on paper

Read and verified statically, so the failure modes above are the *remaining* risk rather than the
whole surface: ffmpeg+ffprobe come from one BtbN zip pinned for `windows-x86_64`; `uv` and
CPython `install_only` are pinned too; `Scripts\python.exe` is used in both
`bay-provision/src/speech.rs` and `manifest.rs`; zip members use forward slashes as the format
requires; `candidate_names` appends `PATHEXT` so `ffmpeg.exe` resolves; `is_executable` returns
true on non-unix.

---

## 2. Does `println!` panic on Windows when stdout is a console?

**Open question, and the CI no longer covers it.**

The first Windows run failed at `bay.exe --help`: non-zero exit, no output. The next run passed.
Between them **two things changed**, and the evidence does not separate them:

1. `--help` switched from `println!` (which **panics** on a failed write) to a helper that
   ignores write errors.
2. The smoke test switched from `& $exe --help` — output going to pwsh's console — to
   `& $exe --help 2>&1 | Out-String`, which connects stdout to a **pipe**.

Since the passing run printed 1472 characters, the write plainly *succeeded*, which means
`println!` would not have panicked under that invocation either. So the likelier story is that
the original failure was specific to writing to a **console handle after `AttachConsole`**, and
the new invocation sidesteps that path rather than fixing it.

**Why it matters:** if that is right, the other 25 `println!`/`eprintln!` call sites still panic
in the bare-console case — which is exactly how a user runs `bay --mcp` or `bay --agents` from a
terminal.

**How to settle it:** on a Windows machine, from a real console (not piped, not redirected):

```
bay.exe --help
bay.exe --agents
bay.exe --mcp
```

If any exits non-zero or prints nothing, the remaining call sites need the non-panicking helper.
If all three behave, the CI change alone explains the original failure and the helper can stay as
cheap insurance.

---

## 3. Live provisioning tests — skipped by default, run them before releasing

Two network-backed tests exist and pass on macOS, but they are opt-in, so a normal `./test.sh`
proves nothing about provisioning end to end:

```
BAY_PROVISION_LIVE=1 cargo test -p bay-provision --test live_install video_provisions
BAY_PROVISION_LIVE=1 BAY_PROVISION_LIVE_SPEECH=1 cargo test -p bay-provision --test live_install
```

The first provisions into a throwaway data dir and then *runs* `ffmpeg -version` (~15s). The
second builds the venv and asserts `kokoro` imports (~72s). A skip is never reported as a pass.

**Their known limit was** that the speech half asserted only that `kokoro` **imports** — it
never spoke, so nothing exercised the weight download. That is closed: the weights are pinned
artifacts now, and the test asserts the model, its config and all 54 voices are on disk.

Also run the strict gate, which turns GPU/ffmpeg skips into failures:

```
STRICT=1 ./test.sh
```

---

## 4. Tests that exist but test the wrong thing

- **The install progress bar.** `editor_view.rs` has a test for `describe_progress` that builds a
  job state with `total_bytes: 0` — a value a real job never has. So the only branch covered is
  the reassuring one, and the actual behaviour (reading "100% of 43 MB" through a multi-minute
  venv build) is untested. Fix the test with the state a real job produces.
- ~~**The attached-bridge timeout.**~~ Closed: budgets are per tool class, the slow tools return
  a job id instead, and a bridge test now drives a deliberately slow tool through the attached
  path.

---

## 5. Verify the palmier vision premise before building on it

Vision was proposed on the basis that palmier-pro has a vision model. A gap audit found **no
vision model there**: their ML surface is Apple SpeechAnalyzer / cloud transcription, WeSpeaker
voice embeddings for speaker ID, VAD, beat detection and denoise — all audio. There *is* a
`chat/` directory in their project package, but the audit deliberately excluded palmier's AI
surface, and **there is no local clone** — confirmed: nothing under `~/codes` matches, and the
three palmier documents `docs/native/parity-status.md` cites are not in the repo either.

Cheap to settle, and it decides whether the vision item is real at all. Clone palmier-pro and
look before committing to either half.

---

## 6. Cross-platform paths tested only by simulation

These are correct by unit test with an injected environment, which is the right design — but
simulation is not execution, and the Windows half has never run on Windows:

- `bay_paths::resolve_data_dir` — the `USERPROFILE`/`LOCALAPPDATA` rules, and the `vii` → `bay`
  legacy fallback that keeps an existing user's projects reachable.
- `bay_paths::tools` — the Finder-`PATH` problem, the Managed tier, `PATHEXT` handling.
- `bay-provision::manifest::plan` — what a half-installed Windows machine would do.

Worth one pass on a Windows box confirming the data directory lands in `%LOCALAPPDATA%\bay` and
that a pre-rename directory is adopted rather than ignored.

---

## 7. Landed on `fix/pending-sweep` but not yet observed in the real app

Everything below has tests and was measured on this machine. What it has *not* had is a human
using the built app, which is a different claim.

- **Device loss on the render path.** `read_texture_bgra` returns `None` instead of panicking,
  and each caller degrades — the live preview keeps its last good frame. The `None` branch is
  tested; **an actual device loss is not**, because it cannot be induced portably. To settle it:
  sleep a laptop mid-playback, or unplug an eGPU, and confirm the preview freezes on its last
  frame rather than crashing.

- **Streaming export under memory pressure.** Export holds one source-resolution frame per
  on-screen clip — 33 MB each at 4K. A 1080p export was measured (1.76s, 3.5 MB); a 4K export
  with several overlapping clips has not been. Watch peak RSS during one.

- **The job contract against a real external agent.** `render`/`narrate`/`subtitles_to_video`
  return a job id now, and the seven contract documents were updated together. No agent outside
  this repository has driven the new shape yet. Run a real reel end to end through
  `mcp__bay__*` and confirm the poll loop reads naturally.

- **A provisioned-from-scratch speech install.** The weights were verified by pointing the
  sidecar at a hand-laid-out directory and synthesising offline. The full path —
  `runtime_install speech` fetching all 56 artifacts into `runtime/models/kokoro/` — is covered
  by `BAY_PROVISION_LIVE_SPEECH=1` and should be run once before releasing.
