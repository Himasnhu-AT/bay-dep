/launch-film Make a ~48-second product launch film for Sage from the media I just dropped in. Sage is an agentic AI assistant that lives at the top of your Mac and actually does things. The panel at the top of the screen is called the Halo — never call it a notch, and never use the words "perry" or "notchview" anywhere. Claim only what the footage shows: no invented numbers, customers, prices, dates, URLs or "available now".

LOOK — white, premium, smooth, like an Apple product film:
- Canvas #F5F5F7 (set it as the timeline background; no black anywhere, no dips to black). Type in Inter (in the pool): headlines #1D1D1F weight 600, tracking about −0.035em; supporting lines #6E6E73 weight 500; one accent word per scene in system blue #007AFF, never a whole line.
- Sizes from the scale: 165 px hook statements and the end-card name, 102 px feature headlines, 63 px secondary, 39 px supporting.
- Text never covers the UI: put it in clear canvas space beside or above the product (the takes have room above and around the Halo), or on the canvas between shots.
- Motion rules from the launch-film skill: words rise out of a mask on [.165,.84,.44,1]; exits whip out on [.72,0,.18,1]; one spring only; keep the product straight — no rotation, gentle push-ins only (scale 1.00 → 1.05 across a shot), and crop so the fake menu-bar text at the very top edge of the Halo takes never shows cut off.

MEDIA (in the pool)
- Takes, 2880×1620, 60 fps, rendered frame by frame (smooth; clicks are exact):
  - 01-halo-expand (8.5 s): the cursor hovers the top centre, the Halo morphs down; Home: Now Playing, Keep Awake, Up next · Standup in 8 min (Join), CPU, Memory, Battery. Click at 3.54 s.
  - 02-halo-tabs (9 s): Keep Awake toggled, then the tab bar — Tray, Clipboard, Cloud (today's to-dos, one ticked; notes).
  - 03-halo-alert (6.5 s): the Halo collapses; an alert live-activity slides out: "Send the Q3 roadmap · Due at 5:00 PM".
  - 04-ask-agent (11 s): typing "check my battery and set volume to 30"; the agent's steps stream (Thinking → Running tool get_battery → result → set_volume → Complete: "Battery is at 82%… Volume is now 30%"). Clicks at 1.39 and 7.73 s.
  - 05-settings-model (10 s): Settings › Model: provider ChatGPT (subscription), model and reasoning-effort pickers; a focus on "Using your ChatGPT subscription".
  - 06-settings-permissions (10 s): Permissions — "Grant everything" turns every row to Allowed — then Connectors (Google, GitHub, Slack, Notion, Linear…).
  - 00-icon-card.png and icon-tile-transparent.png: the Sage app icon for the end card.
- Sound (original, generated for this film): music-bed-110bpm.wav (56 s, 110 BPM, 4/4), sfx-click.wav, sfx-whoosh.wav, sfx-bell.wav.

THE CLOCK
- detect_beats on the music; the grid is 110 BPM from 0 s, a bar is about 2.18 s. Cut only on bar lines, one idea per bar. 22 bars (about 48 s). Fade the music over the last bar.

STORYBOARD (bars from 0)
- Bars 0–1, hook on the bare canvas: "Your Mac." then "On command." — one statement per bar, rising out of a mask; accent on "command".
- Bars 2–4, the Halo: 01-halo-expand. Headline "Meet the Halo." then "Everything, one hover away." Land the expand on a bar.
- Bars 5–6: 02-halo-tabs — "Tray. Clipboard. Cloud." one word per beat as the tabs change.
- Bars 7–10, it acts: 04-ask-agent. "Ask." (bar 7) → "It acts." (bar 8, as the tool steps stream) → hold on Complete: "Done." Click sfx on the clicks; a soft whoosh into the shot.
- Bar 11: 03-halo-alert — "It keeps you on time."
- Bars 12–13: 05-settings-model — "Runs on your ChatGPT subscription." (accent "your").
- Bars 14–15: 06-settings-permissions — "Grant once." then "Connect everything."
- Bars 16–18, the rush: a quick montage of the best moments from the takes, one per beat in bar 18, building.
- Bars 19–21, end card on the canvas: the Sage icon, then "Sage" at 165 px beside it, then "Your Mac, on command." at 39 px below — and, if it reads well, make the "Sage" wordmark a subtle 3D moment (a .brf <scene3d> <text3d> that turns a few degrees into place, lit softly, no fog) — keep it premium, not gimmicky. Bell sfx as the name lands.

Check every scene with preview_frame and a frame_grid (text inside the frame, never over the UI, the product straight, nothing black), then export with streaming loudness to /Users/himanshu/Movies/bay-rnd/sage/after.mp4.
