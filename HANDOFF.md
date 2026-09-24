# HANDOFF — bay (for the next agent, 2026-09-24)

Read `CLAUDE.md` fully first; every rule there applies (never `git add -A`, no Prettier, build before
probing, prove tests fail against the bug, cp/rm are interactive aliases → /bin/cp -f, /bin/rm -f).
Then `docs/testing.md` and `test/app/README.md`.

## State of the branches
- `feat/hyperframes` = the integration branch. Everything verified is merged here (last: 2d5ab2d access
  + waitlist kept). Gates green at merge: typecheck, 1379+ tests, build, app probes.
- **Unmerged worktree branches (WIP, verify before merging):**
  - `worktree-agent-ae6e41f9171615aaa` — **keyframes** (committed + merged with feat/hyperframes in
    the branch). Gates green (1416 tests). App probes on the merged build: keyframes 25/25, grade 35,
    cut-playback 13, mcp 62, brf 15 PASS; **audio-finish (3 FAIL) and transition-audio (5 FAIL) FAILED
    and export-vs-preview CANNOT MEASURE** in one run — first check whether it is the known intermittent
    silent-audio flake (rerun 3× in a fresh instance) or a real regression from keyframes touching
    `src/shared/audio-gain.ts` / `volumeMayBeAudible` / `audio-graph.ts`. Do NOT merge until those pass.
  - `worktree-agent-a65fa5cbd222ac851` — **release**: Developer ID signing ("Developer ID Application:
    Himanshu . (38QXSRV6AP)"), notarization via keychain profile `xcnotarize`
    (`xcrun notarytool ... --keychain-profile xcnotarize`), DMG + signed zip, in-app auto-updater
    (electron-updater, generic feed URL from config, UNSET → Settings shows "Updates: releasing soon").
    No hosting chosen yet (owner will host on Google Drive / App Store later). Do not publish anything.
  - `worktree-agent-add8d5bc6efbf239c` — **ffmpeg**: LGPL ffmpeg 8.x from source (script/build-ffmpeg.sh),
    H.264/HEVC via VideoToolbox (libx264 is GPL), re-verify every ffmpeg path.
  - `worktree-agent-ad75e621443e6beef` — **loose ends**: audio-silence soak probe, menu.mjs Import/Save As
    sheets, unrun test.md §2 cases, Firebase email quota.
  - `worktree-agent-a747e923b9ac4ac87` — **detach audio + font import**.
  Each agent was told to leave a `WIP:` commit with a status; read `git log -3` on each branch.
- Not pushed: the owner pushes. If this doc is on a remote, the owner pushed it.


## UPDATE (after the first handoff): merged into feat/hyperframes
- Merged and verified on the combined tree: loose-ends, detach-audio + fonts, LGPL ffmpeg 8.1.3, and
  keyframes (HEAD 3ccf50d). Combined gates: build ok, 1474/1474 tests, 0 skipped. App probes all pass:
  keyframes, detach-audio, audio-finish, transition-audio, export-vs-preview, grade, mcp, brf, fonts,
  cut-playback.
- Still open: **release** (worktree-agent-a65fa5cbd222ac851), still running. It must merge the new
  vendored-ffmpeg layout and sign `Contents/Resources/ffmpeg/*`.
- **TRAP: the ffmpeg binaries are gitignored** (built from pinned source by `script/build-ffmpeg.sh`,
  into `vendor/ffmpeg/<platform>-<arch>/`). A fresh checkout has none, and then 22 ffmpeg tests SKIP,
  so the suite reads green. Run the build script first, and always check `skipped 0`.
- Worktrees: only the active/locked ones are kept. Stale ones are removed; their branches remain.

## FINAL STATUS OF EACH WIP BRANCH (read this first; written at shutdown)
Suggested merge order: **loose-ends → keyframes → detach-fonts → ffmpeg → release**.
- `worktree-agent-ad75e621443e6beef` (**loose-ends**, 40f3342): DONE, gates green (1380).
  - Real silent-audio cause: Chromium remembers a failed media load per URL + CORS mode, so the
    8afacd6 CORS retry never succeeded. The fix retries at `bay://…?retry=N` (mediaRetry.ts retryUrl).
    audio-soak.mjs: 36/36; without the fix 4/4 forced-error sweeps went silent.
  - menu.mjs rewritten: the "dead" items were the instrument (a global Escape into the user's foreground
    app, and the Space not yet switched).
  - brfCode #evict fix: a 9th .brf module used to be recorded as a timeout.
  - test.md §2 filled in.
  - Firebase email-link quota is **5/day on Spark** (25k/day with billing). Tell the owner.
  - Left: CLAUDE.md notes on the Space/global-keystroke trap and the per-URL media failure memory.
- `worktree-agent-ae6e41f9171615aaa` (**keyframes**): DONE, 1416 tests. The audio-finish/transition-audio
  failures on its merged build are very likely the silent-audio bug fixed in loose-ends (the detach-fonts
  agent saw the same failures on plain 38cfab4). Merge loose-ends first, then re-run those probes.
- `worktree-agent-a747e923b9ac4ac87` (**detach audio + font import**, 801a0cf).
  - Features done: probes detach-audio 20/20; fonts pass, including reopening after a restart.
  - Last full test run had 2 fails (undo-step gate), since fixed in that file.
  - Re-run the full typecheck/test/build, the Part B mutations, and graft build.
  - Security finding: `media/import.ts adoptAssets` calls allowPath on every project asset path,
    bypassing `admissibleFromProject` (dot-folder refusal for shared .bay files). Fix it.
- `worktree-agent-add8d5bc6efbf239c` (**ffmpeg**, de162f5): LGPL FFmpeg 8.1.3.
  - Built from pinned source with script/build-ffmpeg.sh (binaries gitignored: run the script to
    produce vendor/ffmpeg/*).
  - h264_videotoolbox at q 53/72/79 (≥ x264 CRF 28/20/16 by SSIM/PSNR/VMAF on 5 clips).
  - FFmpeg 8 needs `setparams` for the colour tags.
  - NOT run yet: full test, build, app probes, bundle; capabilities.test fixes; the export_timeline
    description still says CRF. NOTICE names hyattherate2005@gmail.com as the LGPL source-offer contact.
- `worktree-agent-a65fa5cbd222ac851` (**release**, 6cd159d): signed + notarized + stapled DMG built and
  verified (spctl "accepted, Notarized Developer ID"). Entitlements are allow-jit only. The packaged
  app passed 11/11 features through the packaged MCP with a test account; the gate works and the
  BAY_ACCESS bypass is ignored.
  - Updater built with feed `UPDATE_FEED=null` → "Updates: releasing soon".
  - NOT done: the 0.1.0→0.1.1 update proof (use `--app-name bay-reltest`, since Squirrel relaunches
    without args).
  - The DMG is at that worktree's `release/bay-0.1.0-arm64.dmg`; it is gitignored and must be rebuilt
    on another machine with `pnpm release:signed`, which needs the owner's keychain.
  - Merge it AFTER ffmpeg, then re-verify: its ffmpeg paths assume the npm package.

## What is left (priority order)
1. Verify + merge the 5 branches above (keyframes first; fix the audio probe failures).
2. **Wave 2** (not started; all build on keyframes): grade hue qualifier + sharpen + curves UI;
   quick wins (freeze frame, SRT/VTT export, track solo, JKL + I/O marks + range export, range
   markers); agent tools (silence/filler detect, scene detect, denoise, stabilise — vidstab is GPL,
   scopes-as-numbers); FCPXML + ProRes/HEVC export; `.brf` React components (Remotion-style);
   move HTML templates/subtitles onto `.brf`. Gap list with effort: `docs/research/editor-features.md`.
   Real-edit gaps: `/Users/himanshu/codes/dodle/studio/video/films/urban-shinobi/final/urban-shinobi-v3-bay-report.md`.
3. Held deps: Vite 8 waits for stable electron-vite 6; website TS7/ESLint 10 wait on plugins.
4. Website: stale "Where it actually is" paragraph on the home page (Rust-era limits). Deploy target
   bay.everholt.com (not deployed yet; the app's sign-in page lives there).

## Access system (invite-only)
- Firebase project `bay-editor-app` (Spark). Admin = **hyattherate2005@gmail.com** (verified email).
  Rules in `firebase/firestore.rules`; `cd firebase && pnpm test` (emulator via scripts/with-java.sh,
  needs Homebrew openjdk) and `pnpm mutate`. Deploy: `pnpm run deploy` (owner action). Live rules were
  last verified identical to the committed file (ruleset 6f57688d).
- Access = admin grant (/admin page: waitlist approve or "grant an email") or in-app referral (≤5).
  Waitlist kept; the site shows "Releasing soon" instead of a download.
- Desktop gate in main (`src/main/auth/`). **Dev/probe bypass: `BAY_ACCESS=dev`** (unpackaged only).
  `./run.sh` sets it; `./run.sh --gate` shows the real gate.
- E2E with throwaway accounts (no email sent): see the lead's `e2e-accounts.mjs` pattern — create
  pre-verified users via Identity Toolkit admin API with the owner's firebase CLI token, POST
  {state,idToken,refreshToken} to the app's loopback with `Origin: https://bay.everholt.com`.
  ALWAYS delete test accounts + docs afterwards and verify deletion.

## How to test (the four gates)
```bash
pnpm install && pnpm build          # build FIRST (MCP proxy tests fail/hang on a missing/stale bundle)
pnpm typecheck && pnpm test         # read the exit code; also grep 'cancelled'/'skipped'
# isolated app instance for probes (never port 9222 / session `bay` — that's the owner's):
mkdir -p ~/.bay-wt/NAME && BAY_ACCESS=dev ./node_modules/.bin/electron . --user-data-dir=$HOME/.bay-wt/NAME \
  --remote-debugging-port=PORT --disable-renderer-backgrounding --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows &
# confirm the log says "MCP socket listening at ~/.bay-wt/NAME/..." before anything else
agent-browser --session NAME --cdp PORT find text "Create new project" click   # fresh profile has no project
PORT=PORT node --import ./src/test-hooks.mjs test/app/<probe>.mjs
```
Core probe set: mcp, brf, brf-export, brf-sandbox, grade, audio-finish, transition-audio,
export-vs-preview, cut-playback (TAKES=<dir of clips>), keyframes, beats (BEATS_AUDIO=…),
playback-probe, compositions. Delete every ~/Movies/bay/*.bay YOUR instance created; kill only your PID.

## How to fix bugs here (what worked this session)
1. **Reproduce with a measurement, not a guess** — sample pixels/levels; add a positive control
   proving the instrument can see the effect (several "bugs" today were broken instruments).
2. **Measurement traps found today:**
   - Decode exports with zimg (`zscale=min=709:rin=limited:m=709:r=full,format=rgb24`), not swscale
     (−2 level bias in bundled ffmpeg 6.1).
   - A media element loaded without crossOrigin plays SILENCE through Web Audio (fixed: mediaRetry.ts).
   - Hidden windows stall playback → launch with the --disable-*backgrounding flags; probes report
     CANNOT MEASURE, never FAIL, on a stalled sweep.
   - Timeline source time is whole µs → seek FRAME_EDGE_SECONDS past (sync.ts), or you get the previous frame.
   - `importPaths` imports without adding to the project; use the `import_media` tool.
   - `location.reload()` is blocked by bay's navigation guard; reload via CDP `Page.reload`.
   - menu.mjs must target the app on PORT (lsof) — it once drove another instance's Save As.
3. **Fix in a worktree**, write a unit test that FAILS on the bug (assert the mutation applied),
   restore, re-run gates, then an app probe labelled PREVIEW or EXPORT (they are different paths).
4. **Merge**: commit on the branch (explicit paths), `git merge feat/hyperframes` into it, resolve,
   re-run all gates + probes on the merged build, then `git merge --ff-only` into feat/hyperframes.

## Deliverables made this session (outside the repo)
- Gym Buddy launch film (accepted): /Users/himanshu/codes/openGym/marketing/launch-video/final/
- Urban Shinobi v2 (ffmpeg) + v3 (built in bay): /Users/himanshu/codes/dodle/studio/video/films/urban-shinobi/final/
