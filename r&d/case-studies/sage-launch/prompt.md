/launch-film Design a ~48-second launch film for Sage. Treat it as motion design, not an edit: one canvas program that redraws Sage and choreographs it. Read bay://guide/motion-design first and build from its kit. Take your time: plan it, build it, look at it, and rebuild it. Three or more passes is expected.

WHAT SAGE IS: an agentic AI assistant that lives at the top of your Mac and actually does things. Tagline: "The Agentic AI Assistant for your Mac". Short line: "Your Mac, on command."

HARD RULES:
- The panel at the top of the screen is the **Halo**. Never call it a notch, and never write "perry" or "notchview" anywhere.
- Claim only what Sage does and what the reference footage shows: no invented numbers, customers, prices, dates or URLs.
- ChatGPT: say "your ChatGPT subscription". Never "official", "partnered" or "powered by OpenAI", and no OpenAI logos.
- For approvals, use Sage's local confirmation step: a step bubble reading "confirmation required" with Approve / Deny, clicked Approve.

REFERENCE (in the pool; draw from these, don't lay them over the film):
- **01-halo-expand**: collapsed, the Halo is a pure-black capsule at the top centre. It morphs down into a Liquid-Glass panel. Its Home tab shows a Now Playing card (art, title "Afterglow", scrubber, prev/play/next) and a status list: Keep Awake toggle; Up next · Standup in 8 min with Join; CPU and Memory bars; Battery 82%.
- **02-halo-tabs**: the tab bar (Tray, Clipboard, Cloud). Cloud shows today's to-dos, one of them ticked, and notes.
- **03-halo-alert**: a live activity slides out of the collapsed capsule: "Send the Q3 roadmap · Due at 5:00 PM".
- **04b-ask-agent**: the Ask flow, "check my battery and set volume to 30". Steps stream: Thinking → Running tool get_battery → result "82%, on battery, 5h 12m left" → set_volume → Complete "Battery is at 82%… Volume is now 30%".
- **05-settings-model** and **06-settings-permissions**: macOS-style Settings.
  - Model: provider "ChatGPT (subscription)".
  - Permissions: "Grant everything" turns every row to Allowed.
  - Connectors: Google, GitHub, Slack, Notion, Linear.
  - Don't show the footer under ChatGPT Subscription.
- **00-icon-card.png / icon-tile-transparent.png**: the Sage app icon.
- **Sound**: music-bed-110bpm.wav (110 BPM, 4/4, 56 s), sfx-click.wav, sfx-whoosh.wav and sfx-bell.wav. All original.
- **Font**: Inter.woff2 (variable).

frame_grid those takes until you can redraw the Halo accurately: proportions, radii, glass, type sizes and the real labels.

LOOK: white and premium, like an Apple product film.
- Canvas #F5F5F7 and ink #1D1D1F; one accent, system blue #007AFF.
- Inter for statements (600, tracking about −0.035em), a serif italic for one human line, and mono for tiny labels if you use chrome.
- The glass is frosted white with a hairline and a soft shadow. The collapsed Halo is pure black.

THE IDEA TO BUILD AROUND: **the Halo is the protagonist.**
- It is born as a dot at the top centre in the first second, and becomes the black capsule.
- Every scene is the Halo becoming something: the glass panel, a tab, an Ask field, a step list, an alert, a settings row.
- It ends as the capsule shrinking back to a dot that becomes the end card.
- No fades. Morph the Halo from state to state, and give every change an on-screen cause: a cursor press flips a toggle; Approve makes the volume slider move to 30 and the battery count to 82%; "Grant everything" cascades each row to Allowed.
- At least one transition must carry meaning.

SHAPE (a starting point; improve on it):
1. A hook in bar 0: the dot → the capsule, with "Your Mac." then "On command." (accent on "command").
2. Meet the Halo: it morphs into the glass panel; Home comes alive (the Now Playing scrubber moving, CPU and Memory jittering); the cursor toggles Keep Awake.
3. "Everything, one hover away.": the tabs, with Tray / Clipboard / Cloud whipping between them and a to-do ticked.
4. "Ask. It acts. You approve.": typing, the steps springing in, the confirmation, Approve, and the results counting in.
5. "It keeps you on time.": it collapses, and the alert slides out.
6. "Runs on your ChatGPT subscription.", then "Grant once. Connect everything.", told with the permissions cascade.
7. A fast montage, one beat each, of what Sage showed.
8. End: the capsule → a dot → the Sage icon, "Sage" at 165 px, and "Your Mac, on command." Hold it at least 2 bars.

TIMING: detect_beats on the music; cut on bar lines, about 22 bars. Place each sfx on the timeline at the frame your code says the press, pop or landing happens, under the music. Fade the music over the last bar.

When it's right, export with streaming loudness to /Users/himanshu/Movies/bay-rnd/sage/after.mp4. Then describe the film beat by beat and list what each of your review passes changed.
