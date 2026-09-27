# Case study: RedAssay Attest launch film

**What it is.** A 60 s launch film for **RedAssay Attest**, a SOC 2 / ISO 27001 readiness platform. It is a
product of RedAssay, a cybersecurity company whose main product is an AI pentest agent. bay's in-app
agent built the film from a brief; we supplied the footage. The film is also the first recorded "agent
edits a whole video" run for a bay release video.

**Why it matters for R&D.** It is our first end-to-end test of brief → footage → agent → export, and v1
vs v2 is a clean before/after on how much the brief and the footage decide the result.

## Timeline (2026-09-26 → 27)

1. **Footage v1.** Screenshots and plain screencasts of RedAssay's `/demo` page (a client-only mock with
   real scoring logic, built by the RedAssay session at `~/codes/cyber/comp`). Recorded at 4K with CSS zoom 2.
2. **Film v1.** `prompt-v1.md` asked for an Apple grammar (`../../research/apple-launch-style.md`). Two
   takes were weak: the ring stopped at 75%, and toasts covered the controls. Both were re-recorded, and
   `prompt-v1-retakes.md` swapped them in.
   - Result: `~/Movies/redassay-launch/RedAssay-launch-film.mp4`.
   - Verdict (the owner): **"way too plain"**, meaning static crops and fades.
3. **Research** (`../../research/motion-graphics-launch.md`) led to three changes: interactivity, real
   camera movement and tactile sound.
4. **Footage v2.** Eight choreographed takes recorded with `../../tools/film.js` + `takes.js`: a visible
   cursor clicking real buttons, 3D camera swings, tilts, pans and push-ins, and a depth-of-field focus
   pull. All at 4K, ~60 fps. Click times were logged per take (+≈0.7 s offset to source time).
5. **Film v2**, recorded end to end:
   - bay went from new project → rename → CDP file drop of 13 assets → brief typed → agent run.
   - The agent was stopped mid-run to send `prompt-v2-rename.md`. The product name "Attest" was chosen
     then; a SOC 2 report is an attestation.
   - The agent built the timeline and exported. Result: `~/Movies/redassay-launch/RedAssay-launch-film-v2.mp4`.

## Outputs (outside git: media is too big)

| File | What |
|---|---|
| `~/Movies/redassay-launch/RedAssay-launch-film.mp4` | v1, 60 s, −14 LUFS |
| `~/Movies/redassay-launch/RedAssay-launch-film-v2.mp4` | v2, 60 s, 1080p, −14.1 LUFS |
| `~/Movies/redassay-launch/v2/*.mp4` | 8 choreographed 4K takes, SFX, music, font |
| `~/Movies/redassay-launch/demo/` | v1 takes and stills |
| `~/Movies/bay-release/bay-agent-run-redassay.mp4` | 35.7 min recording of bay's window over CDP |
| `~/Movies/bay-release/bay-agent-run-timelapse-60s.mp4` | the same run at 36× |
| `bay-run-marks.txt` (here) | timestamps of each milestone in the long recording |
| bay project | `~/Movies/bay/` (v1 saved as "Shy Tan Lynx.bay"; v2 project "RedAssay Launch Film") |

## Lessons

- **The footage sets the ceiling.** v1's plainness came from static screen captures, not from the agent.
  bay's agent is 2D-only, so camera work has to be baked into the footage or done in a composition.
- **The brief decides the floor.** Specific numbers (easing curves, stagger in ms, dB levels, click
  frames) came back implemented. Vague asks did not.
- **Missed rule:** UI should appear inside ~2 s. v2 shows it at 7.3 s because our storyboard opened with
  cards.
- **The cursor reads small at 1080p:** 96 px at 4K becomes 48 px on screen. Make it ~1.5× larger, or add a
  click ring in the edit.
- **bay's viewer barely shows the picture during an agent run** (the playhead sits on a black card), so
  the release recording is mostly panel text. For release footage, make the viewer follow the agent's edits.
- **bay won't send a message mid-turn.** Stopping and re-briefing works: the agent keeps its context.
- **Recording traps:**
  - `agent-browser` can silently detach from bay (a blank `about:blank` browser). Re-`connect
    http://127.0.0.1:9222` and check `tab` first.
  - A static page emits one screencast frame, so capture stills with `screenshot`.
  - zsh does not word-split `$var` (use arrays or `${=var}`).
