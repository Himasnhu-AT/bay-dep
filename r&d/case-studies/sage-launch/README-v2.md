# Case study: Sage launch film — UI takes, v2

v2 re-records every take against the latest Sage build (Liquid Glass Halo in light and dark,
live moments, the model chip, the System-Settings-style Settings), after the Sage team's review of
v1 (`README.md`). Recorded 2026-09-28 against Sage `ea1505a` (the model-chip fix), except
`06-settings-model`, which was rendered against `c0fbe50` just before it. The two differ only in
the chip menu, which 06 does not show.

## Takes (`~/Movies/bay-rnd/sage/takes-v2/`)

All 2880×1620 at 60 fps, rendered by `tools/render-frames.mjs` (virtual clock, 2 motion-blur
sub-frames), with a flat camera (no tilt) and the film.js cursor. Click times are source seconds
from `clicks/<take>.json`: the frame where the cursor presses and the ring pops.

TAKES_TABLE

Stills of each key state are in `stills/`. They are the reference bay's agent redraws from.

STILLS_TABLE

Brand:
- `00-logo-card.png`: `logo-1024.png` at 640 px, centred on white with a soft shadow (downscaled, never upscaled).
- `wordmark.png`: `wordmark.svg` rendered by Chrome at 10× (1723×640, transparent), so "Sage" is set in SF Pro.

## How they were made

`tools/takes-sage-v2.js` plus `TAKES=takes-sage-v2.js tools/take-sage.sh <take> <window> <seconds> <file>`.
A take name ending in `-dark` is the same take in the dark appearance. Nothing in the Sage repo
was changed; everything is done to the page at runtime:

- **Look:** a light or dark appearance, the dev bar hidden, a generated gradient wallpaper (light
  or dark), and a plain menu bar. Settings is a window with traffic lights, which the shell draws natively.
- **Data rules:**
  - No names, emails or addresses. The Mac is "MacBook Pro", ChatGPT accounts show no address and connectors say "Connected".
  - No GitHub: the GitHub connector is removed, the clipboard's PR link is now a Wikipedia link, and "Review PR #128" is now "Review the launch deck". Any paragraph naming GitHub or Telegram is hidden.
  - The Fast actions pane is hidden in the sidebar.
- **Blurred:** the Cloud pane's fixed server host, `backend-sage.himanshuat.com`, carries a
  person's name, so it is blurred (`filter: blur(6px)`) wherever it shows.
- **Not doctored:** the cloud approval card renders exactly as Sage draws it ("from your server ·
  10 min left" included), and the ChatGPT Subscription footer in Model is left as is (crop it in the edit).
- **Scripted:** the Ask run's steps match the typed prompt (the mock's own run talks about Safari),
  the live moments are driven through the mock (`power(true)` for plug-in, `play()` for a track
  change), and the meeting is moved 30 min out in `03`, because a meeting within 10 min outranks both moments.

## What happened, and what looks wrong

- **The model-chip menu was clipped in the Halo** (it opened below the chip, inside a shape with
  `overflow: hidden` and a height measured without it). I reported it; Sage fixed it in `ea1505a`.
  Checked after the fix at 1440×810: the menu (y 167–407) now sits inside the grown Halo (bottom
  421) and scrolls internally (267/240 px), so nothing is clipped.
- **The first v2 renders hung** when that fix landed mid-render: Vite reloaded pages that were
  paused on virtual time. Don't edit the app while takes render; restart `pnpm dev` first.
- The Halo's glass is the dev build's CSS stand-in (a blur), not native Liquid Glass.
- Ask's placeholder rotates ("Send a message to Mom…"). This is the app's own copy.
- About's privacy note mentions "TypeSafe fast actions" in running text; `07` frames Resource usage.
NOTES
