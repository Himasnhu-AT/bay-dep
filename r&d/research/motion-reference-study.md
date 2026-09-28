# Motion graphics: what the good ones actually do

Studied 2026-09-28, frame by frame at 15 fps, after the owner called our motion graphics "straight up
trash". Sources:
- **A**: `~/Downloads/telegram-cloud-document-5-6181441456390021188.mp4`, 19.2 s, 1280×720. A
  motion reel written in code ("every frame of this reel was written in code").
- **B**: `~/Documents/2026-09-28 16.15.24.mp4`, 15 s. A repost of a reel Claude generated from one
  prompt: *"You're a world-class motion designer, and this is your 15-second résumé reel. Make it
  dynamic and confident: open with a striking hook in the first second, build through a sequence
  of distinct techniques (typography, shape play, camera moves, colour shifts), and land on a
  clean, memorable final frame. Pacing should feel like it's cut to music. Go crazy."*
- **perry**: `/Users/himanshu/codes/perry/film/perry.html`: an 885-line canvas program, the
  launch spot we keep citing.

**The finding that matters:** all three are *programs that draw every frame*. None of them is
screen recordings with captions laid over the top, which is what we have been making. Both
reference reels were written by a model. The gap is how we brief and what we let the agent build,
not what the model can do.

## 1. Architecture (perry, read in full)

- One `<canvas>`, 1920×1080. `renderFrame(t)` calls the scene function that owns `t`, as
  `scene(ctx, t, localT)`. Scenes are pure functions of time: no state, no timers. So any frame
  can be rendered on its own, which is what makes export deterministic.
- **The clock:** `BPM → BT (beat) → BAR`, and a scene list `[[bar, fn], …]` with hard cuts on bar
  lines. Everything inside a scene is timed in beats or seconds from its start.
- **Tokens:** a palette object (paper, mist, ink, ink2, ink3, hairline, one accent), one sans
  (variable) and one mono. Nothing is picked ad hoc inside a scene.
- **Three curves and one spring, used everywhere:**
  - `blur (.25,.46,.45,.94)`: blur-in words.
  - `rise (.165,.84,.44,1)`: masked rises and reveals.
  - `whip (.72,0,.18,1)`: exits and camera slides.
  - `SPRING(stiffness 420, damping 32)`: everything that pops in (bubbles, cards, logos).
- **Motion blur:** each frame is 4 sub-frames across a half-frame shutter, averaged. Fast moves
  smear the way a camera sees them.
- **The UI is redrawn in code, not recorded:** a phone with the Telegram chat (bubbles, typing
  dots, keyboard keys that press and collapse, pills, time stamps), an approval card, cards with
  shadows, a cursor that whips to a button and presses. Because it is drawn, every element can be
  choreographed. A bubble springs in and pushes the column up; a key press starts a reply; a
  clock *flips* 7:59 → 8:00 with a masked roll.
- **Sound is in the same file:** a score (kick, clap, hats, bass, plucks, pads on Am–F–C–G,
  sidechain pump) and **foley locked to picture events**: every bubble gets a send or receive
  sound, every pill a pop, every press a click; swells lead into cuts, an impact lands the logo.
- **Building blocks worth copying** (names from perry.html): `words()` (per-word masked rise with
  an optional whip exit), `blurWords()` (per-word focus-in), `rise()`, `springIn()`, `tnum()`
  (tabular numbers that don't jitter while counting), `wrap()`, `beatK()` (a pulse on every beat),
  the letter-scatter "forgets." exit (per-letter rotation, blur and drift driven by a hash), the
  slot-machine carousel for three promises, and the half-beat montage with progress ticks.

## 2. The vocabulary (A and B, frame by frame)

**A protagonist.** B keeps one orange dot the whole way through:
- it is the keyframe handle, then rides the easing curve;
- it becomes the dot of the "i" in *motion* → *timing* → *feeling*;
- it becomes a toggle knob, then a progress pill;
- the pill collapses to a line, which becomes a chart baseline;
- the dot is the highlighted bar, then a cube in a 3D field, then a galaxy that collapses back into
  the dot;
- the dot ends as the full stop in "Claude.".

A starts from a dot and ends in a dot. The eye always has one thing to follow.

**Transitions are morphs or match cuts, never fades.**
- A line draws, grows ticks, thickens into a pill, and the pill expands to fill the frame with the
  next scene's colour.
- A "1" becomes an I-bar.
- The "O" of MOVE becomes a black disc, fills with dots, and expands into a full-screen dot grid.
- Dots become squares in a rotation wave that spreads from the centre, then diamonds, then pills
  along a flow field, then a stream, then a point.
- A point bursts into about 3,200 particles as a rotating 3D sphere, which becomes a ribbon, then
  the word CLAUDE, then speed lines.
- A whip-pan with a horizontal smear lands on the next scene.
- A word squashes flat into a line, the line into a dash, the dash into a dot.

**Transitions carry meaning.** B's bars grow as a bell curve labelled *velocity*, then re-flow into
an S-curve labelled *position*: the running total of velocity. A render pill goes "Rendering reel"
→ "Render complete ✓" before collapsing. The motion says something true.

**Type.**
- **Extreme scale contrast:** full-frame heavy grotesk (MAKE, THINGS, BOLD) against tiny mono HUD
  labels.
- **Two voices:** heavy sans for statements, serif italic for the human line (*with intent.*,
  *Showreel 2026*, *feeling*).
- **Techniques:**
  - masked rise;
  - scramble decode (`C → JM → E#TA → CLU50 → CLAUXQ → CLAUDE`, and "3,200 PARTICLES / ONE
    IDEA");
  - letters flying along an arc (MOVE, CLAUDE with orbiting comet trails);
  - word roll, where the new word pushes the old one up through a mask;
  - motion-blur and outline echo trails on hard entrances;
  - an underline that draws under the landed word.

**Colour.** A changes the flat background on nearly every beat (orange, grey, black, white, lime,
orange, black), always one ink colour on it. B is monochrome dark with a single accent. Both keep
the accent to *one* colour.

**Depth, in code.**
- A: a particle sphere; raymarched glossy metaballs that pass in front of and behind the word
  DEPTH and merge; UI cards that exit by tilting apart in 3D.
- B: bars extrude into boxes, and the camera tilts into a cube field with a wave and orange
  ripples.

**UI as motion.** A's dashboard cards spring in one after another. The cursor clicks a toggle (a
ring pulse), and *because of that* the number counts +0% → +248%, a line chart draws, a gauge fills
0 → 99%, bars grow, and "Render" becomes "Done". Every state change has an on-screen cause.

**Chrome.** A frames everything in a HUD: corner brackets, tiny mono metadata ("CLAUDE / MOTION
REEL 2026", a running timecode, "1920 × 1080 / 60 FPS", a section label like "03 / PARTICLES"), and
a tick ruler that fills as the reel plays. It makes 19 s of unrelated techniques read as one piece.

**Rhythm.**
- About one technique per beat or bar. A 2-frames-per-word montage near the end (BOLD / RHYTHM /
  precise. / rings / FAST / halftone / ALIVE).
- The hook lands inside the first second.
- The end frame is clean and holds 2–3 s. B's end card is "Claude." plus one sans line and one
  serif italic line, nothing else.

## 3. What we did wrong, specifically

- We briefed an **edit** (cut screen recordings, put captions over them) and called it motion
  graphics. The references are **motion design**: the product is redrawn and choreographed.
- There was no protagonist and no continuity between shots: every cut was a reset.
- Text was a label on top of the picture, when it should be a moving element that turns into the
  next thing.
- One easing curve, fixed durations, fades. No springs, no motion blur, no whips, no morphs.
- Nothing on screen *caused* anything.
- The agent had no time or bandwidth: default reasoning effort, a 37-minute turn cap, and a brief
  that asked it to assemble clips rather than design and iterate.

## 4. How to brief it now

- **Ask for a program, not an edit:** one HTML composition, a single canvas, drawn as a pure
  function of `t`, with perry's architecture (clock, tokens, three curves, one spring, sub-frame
  motion blur, scene list). Screen recordings are reference for drawing the UI, not footage.
- **Name the protagonist** and require every scene to *become* the next.
- **Rebuild the product's key UI in code,** simplified and exact in proportion, so it can be
  choreographed; every state change has an on-screen cause.
- **Require meaning in at least one transition** (a before and after, a count, a cause and
  effect).
- **Give it bandwidth:** high effort, a long turn, and permission to iterate. Write, render a
  frame grid, look, fix, and repeat, several passes before export.
- **Keep the chrome and the palette disciplined:** one accent, two type voices, and a clean end
  frame that holds.
