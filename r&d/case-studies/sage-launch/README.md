# Case study: Sage launch film — UI takes

**Sage** is an agentic AI assistant that lives at the top of your Mac ("The Agentic AI Assistant for
your Mac"; short line "Your Mac, on command."). The top UI is the **Halo**. These are the UI takes
bay's agent will cut a ~50 s film from. Recorded 2026-09-28.

## Takes (`~/Movies/bay-rnd/sage/takes/`)

All 2880×1620, 60 fps, rendered by `tools/render-frames.mjs` (virtual clock, 2 motion-blur
sub-frames), light appearance, flat camera (no tilt), the film.js cursor. Click times are source
seconds from `clicks/<take>.json` (the frame where the cursor presses and the ring pops).

| File | Length | On screen | Clicks (s) |
|---|---|---|---|
| `01-halo-expand.mp4` | 8.5 s | Desktop with menu bar; the collapsed Halo (a "Standup in 8 m" live activity) at top centre. The cursor hovers it, it springs open on Home: Now Playing ("Afterglow", playing), status list. Keep Awake switched on ("Until stopped"). The cursor rests on Join. Camera pushes 1.0 → 1.38, pinned to the top edge. | Keep Awake 3.54 |
| `02-halo-tabs.mp4` | 9 s | Halo open. Tray (3 files), Clipboard (4 cards), Cloud (Today to-dos + Notes); ticks "Send the Q3 roadmap to the team" (strikes through). Slow push 1.32 → 1.4. | not logged (see below): Tray ≈0.9, Clipboard ≈2.9, Cloud ≈4.7, to-do ≈6.2 |
| `03-halo-alert.mp4` | 6.5 s | Halo open on Cloud, closes to the black shape, camera pushes in (1.32 → 1.96); an alert live activity slides out: "Send the Q3 roadmap · Due at 5:00 PM". No cursor. | none (alert fires ≈2.4) |
| `04-ask-agent.mp4` | 11 s | Halo Ask tab. Types "check my battery and set volume to 30", Enter. Steps stream: Thinking → Running Tool get_battery → Tool Result (82%) → Running Tool set_volume(30) → approval card "Set Volume" → **Allow once** → Tool Result "Output volume is 30%." → Complete. | input 1.39, Allow once 7.73 |
| `05-settings-model.mp4` | 10 s | Settings window on the desktop. Sidebar → Model: ChatGPT (subscription), Signed in; model GPT-5.1 → GPT-5.1 Codex, Reasoning effort Default → High. → Cloud: the row "Model · Using your ChatGPT subscription (plus)" lifts out while the rest blurs; camera pushes onto it. | not logged: Model ≈1.0, model ≈2.3, effort ≈3.4, Cloud ≈5.0 |
| `06-settings-permissions.mp4` | 10 s | Settings: Permissions → **Grant everything** (each row turns Allowed, "Everything is allowed") → Connectors → Connect on GitHub (turns Connected / Disconnect). | not logged: Permissions ≈1.0, Grant ≈2.4, Connectors ≈5.4, Connect ≈7.2 |
| `00-icon-card.png` | still | App icon on white (2880×1620), soft shadow, centred. `icon-tile-transparent.png` is the icon alone with alpha. | |

"Not logged" means the take's script was still running when the render ended, so no click log was
written. The last action is on screen in every take; the ≈ times are from the drafts at the same
timings and should be checked on the frame (cursor shrink + ring).

## How they were made

- `tools/takes-sage.js` (setups + choreography) and `tools/take-sage.sh <take> <window> <seconds> [file]`,
  against Sage's dev build (`pnpm dev`, localhost:1420, in-browser mock). Nothing in the Sage repo was
  changed; everything is done to the page at runtime.
- **Look:** light appearance, dev bar hidden, a generated soft gradient wallpaper (no third-party
  images), a plain menu bar ("Finder File Edit …", "Mon Sep 28 9:41 AM"), CSS zoom 2 (Halo) / 2.6
  (Settings). Settings gets macOS traffic lights, which the real shell draws natively.
- **Data scrubbed in the mock:** no names, emails or addresses. Device "MacBook Pro", ChatGPT account
  shows "(plus)" only, connectors say "Connected". The clipboard's Terminal item and name + address
  were replaced, "Priya"/"Sam"/"Mom"/"Jo" removed from to-dos and notes. The Fast actions pane is
  hidden in the sidebar, and every paragraph naming Telegram is hidden (Cloud's "What syncs" notes).
- **Scripted Ask run:** the mock's own agent run talks about Safari URLs and has no volume flow, so
  `sageMock.submit` is replaced for this take by steps that match the typed prompt, and the
  approval uses the Halo's real approval card (the Allow once / This session / Always / Deny one).
- **Renderer fix, in `tools/film.js`:** under render-frames, `requestAnimationFrame` fires about
  three times per virtual frame and its timestamp advances 16.7 ms each time, so the cursor, which
  was timed from rAF's timestamp, moved ~3× too fast (measured: rAF 383 ms vs performance.now 133 ms
  over 25 callbacks). `moveTo` now reads `performance.now()`. This probably explains the "timers run
  at ~0.7×" note in `tools/README.md` for the Attest takes.

## Things that look wrong, or that the edit should know

- **The approval card is the cloud-approval UI.** In the product, "Allow once" is the card for
  actions the *server* agent asks about; a local Mac action gets an inline Approve/Cancel. I used it
  because the brief asked for "Allow once", and I hid its "from your server · N min left" line,
  because it would contradict a local run. Ask the Sage team if that's acceptable.
- **The card appears above the input and pushes the steps down**, which is the app's real layout.
- **Ask's placeholder rotates** ("Toggle dark mode…", "Send a message to Mom…") after submit. It's the app's own copy, but "Mom" is a person word.
- **The Halo's glass is the dev CSS stand-in** (a blur), not native Liquid Glass. On the light
  wallpaper the expanded panel is very pale. In 03, the close snaps to black instead of fading
  through grey (the grey slab was a dev-only artefact).
- **The Halo is small at the start of 01** (a 370 px black shape at the top of the frame). That's
  intentional, as an establishing shot; the push in makes it readable by ~2 s.
- **Settings footer copy** under ChatGPT Subscription says "Undocumented first-party path; for personal
  use." It's visible in 05; crop or push past it if it matters.
- **The icon source is 512 px.** The card shows it upscaled ~1.45×. It is soft at full size, and the
  image has glow particles that read as noise on white.
- The Halo takes are framed top-pinned, leaving the lower ~45% of the frame as clean wallpaper for
  text. Settings takes are the window centred with ~10% wallpaper around it.
