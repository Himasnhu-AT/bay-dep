# Editor parity — brief shared by every engineer on this wave

You are one of six engineers working in parallel on **bay** (Electron/React/TypeScript video editor). The owner pointed at the open-source editor Drift and said "this is a full-fledged video editor, the kind I want". An audit of Drift against bay is at `r&d/research/drift-audit.md` in the main checkout (`/Users/himanshu/codes/synthai/vii/r&d/research/drift-audit.md` — it is untracked, so read it from that absolute path). Your stream is one of its ranked gaps; **read your section and the paragraph above the specs ("One architectural fact governs most of these" and "ffmpeg build") before writing code.**

## Licence — binding
Drift is GPL-3.0; bay is commercial. Build from the behaviour the audit describes. **Never open Drift's source, shaders, presets or assets**, and copy nothing from it. Write shaders and DSP from first principles / textbook formulas.

## Setup (in this order)
1. Your worktree starts from stale `main`: run `git merge --ff-only feat/editor-parity` (your branch has no work yet; it must fast-forward).
2. `pnpm install`.
3. Link ffmpeg or ~70 tests silently skip: `ln -s /Users/himanshu/codes/synthai/vii/vendor/ffmpeg/darwin-arm64/{ffmpeg,ffprobe} vendor/ffmpeg/darwin-arm64/` and the same for `darwin-x64`.
4. `pnpm build` **before** `pnpm test` (the mcp suite hangs without `out/`). Baseline: 3242 tests, 0 fail, 5 skipped, exit 0.

## Rules (CLAUDE.md is the law; these are the ones that bite here)
- Read `CLAUDE.md` first. Explicit `git add <paths>`, never `-A`/`.`. No Prettier. pnpm. `/bin/cp -f`, `/bin/rm -f`. Quote globs in zsh.
- `src/shared/` is the contract, written first. Every project mutation goes through the store's `edit()`. A new action goes in its slice and in `EditorActions`.
- **`.bay` changes are additive**: new *optional* fields only, absent = today's behaviour, so an untouched project saves byte-identical. No rename/retype.
- **One mapping, one implementation.** Preview, `preview_frame` and export must go through the same code for anything that changes the picture. Audio is two paths (Web Audio preview, ffmpeg export) — every audio feature needs a measured preview-vs-export comparison, and a test through the real ffmpeg.
- An identity/default value must cost nothing (resolve to no pass / `'none'`).
- A wrong frame must be reported, never a clean `done` (`notePending`, `#placeholder`, `gradeIssues`).
- A tool is a file in `src/shared/tools/` + a `handlers` entry, then `pnpm gen:tools`. The in-app agent must be able to do everything the UI can: every feature gets an agent surface (a field on `edit_item` or a small tool) with a description that says when to use it, and errors that say how to retry.
- An ffmpeg filter/encoder your code writes must be in `script/build-ffmpeg.sh`'s `REQUIRED_*` (the binary already has the ones the audit lists) so `capabilities.test.ts` guards it.
- Tests: assert from the requirement; pair each refusal with its nearest passing twin; prove at least four guards by mutation (assert the mutation landed, see the test fail, restore, re-run baseline). `pnpm test` cannot load anything importing `electron` — keep logic where tests reach.
- **Do not launch the app, `./run.sh`, or any Electron instance.** One verifier does that later on an isolated instance. Finish on `pnpm typecheck`, `pnpm build`, `pnpm test` (read the exit code), and write an executable checklist of what must be checked in the running app (and, where it helps, an unrun probe under `test/app/` marked as unrun).
- UI: match the surrounding components (`src/renderer/src/components/`, the inspector's existing tabs) — same tokens, same control primitives; no new design language. Every control labelled; keyboard reachable.

## Five other streams are editing nearby — expect and minimise conflicts
Streams: (1) video effect stack, (2) autosave/recovery + small timeline items, (3) shape masks, (4) audio effects, (5) reverse + speed ramps, (6) text styling + animation presets. Hot shared files: `src/shared/project.ts`, `src/renderer/src/engine/compositor.ts`, `src/renderer/src/store/types.ts`, the inspector, `src/shared/tools/edit-item.ts`, the generated tool indexes. Keep your edits to those files small and append-only where you can (new fields at the end of an interface, new branches rather than rewrites), put your real code in new files of your own, and do not reformat or reorder anything you are not changing. Before you finish: `git fetch . && git merge feat/editor-parity` (other streams may have landed), resolve your own conflicts, regenerate (`pnpm gen:tools`), and re-run the three gates.

## Finish
Commit on your worktree branch with explicit paths (every new file — `committed-imports.test.ts` fails on an untracked import target; run `pnpm test` after committing). Repo-style message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

Report (concise): branch + commit; what a user can now do, and what the agent can now do (tool/field names with one example call); what you deliberately left out of the spec and why; test count before/after and the mutations with outcomes; the in-app verification checklist; any decision the owner must make.
