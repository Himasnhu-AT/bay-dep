Make the launch film for RedAssay Attest from the media I just dropped in. RedAssay is a cybersecurity company; Attest is its SOC 2 / ISO 27001 readiness product for startups. It turns framework requirements into controls, tasks and policies, works out readiness from real evidence, and every status explains why.

Two earlier versions were too plain: text centred on black cards, product shots that sat still, and UI that did not appear until 7 seconds in. This version should feel like a real motion-design launch spot. Build it on the music's clock, compose text beside the product, and keep something moving in every frame. Claim only what the footage shows: no invented numbers or customers, no URL, no "available now". The footage is the product's working demo for a fictional company, "Northwind Labs".

MEDIA (all in the pool)
- Takes. All are 4K screen recordings, with the camera moves and the cursor already in them. Every take frames the product in the RIGHT half of the picture, turned toward the left, and a black fade keeps the left 40% clean for your text.
  - hookbg (8 s): the dashboard drifting, tilted, no cursor. Background for the opening bars.
  - reveal (7 s): the dashboard swings up from a steep 3D tilt and settles on the right, pushes toward the "Why it isn't 100%" list, and the cursor clicks Add evidence.
  - why (7.5 s): the reason list; one reason lifts out while the rest blurs; the cursor clicks Approve.
  - cascade (7 s): three quick Add evidence clicks, then a fast pan to the readiness ring climbing to 50%.
  - policies (8 s): the Policies table; the cursor clicks Approve v1.0, then Publish v1.0.
  - people (9 s): the People list; three employees sign and their rows update.
  - risk (5 s): tight on the 5×5 risk matrix, pulling out; the cursor selects a risk.
  - climb (7 s): a push-in on the readiness ring as it climbs 75% → 95%. No cursor.
  - orbit (8 s): the finished dashboard at 95%, small and centred, turning slowly. Background for the end card.
- Click times in the source (seconds, about ±0.1; confirm each on the frame where the cursor presses and a white ring pops): reveal 4.4; why 3.4; cascade 1.8, 2.5, 3.2; policies 2.2, 4.5; people 2.2, 4.3, 6.3; risk 4.5.
- Sound:
  - music-happy-beats-vol10.mp3: 60 s, about 110 BPM.
  - sfx-click.wav: a UI click.
  - sfx-reveal-hit.wav: a soft impact.
  - sfx-payoff-bell.wav: a bell.
- Font: Inter (variable, wght 100–900). Use it for all type.

THE CLOCK
Run detect_beats on the music. A bar is 4 beats (about 2.18 s). Cut only on bar lines, with hard cuts, no dissolves. One idea per bar. The film is 24 bars (about 52 s); fade the music out over the last bar.

STORYBOARD (bars, from bar 0)
- Bar 0, hook: hookbg on the right. In the left column, one statement per beat, each replacing the last:
  - "New customer."
  - "Wants SOC 2."
  - "Now what?"
  Set at 165 px, weight 600, white.
- Bar 1: hookbg continues. "You have a spreadsheet." rises in (102 px). On beat 3, a red line (#EF4444) draws across "spreadsheet".
- Bar 2, logo, on pure black, centred at about 57% height:
  - A small red dot pops in on the spring.
  - "Attest" rises in beside it (165 px, 600).
  - "by RedAssay" fades up 10 px underneath, 0.35 s later (39 px, weight 500, 55% white).
  - sfx-reveal-hit lands on the dot.
- Bar 3, on black: a slot machine of three promises in one line-high window, one per beat: "Controls." → "Evidence." → "Policies." The last one stays.
- Bars 4–6: reveal. The swing settles on the right (sfx-reveal-hit as it settles), then the click. Left column: "SOC 2 readiness," / "from real evidence." (two lines, 102 px) rises in at bar 5.
- Bars 7–8: why. Left: "Every status" / "explains why."
- Bars 9–10: cascade. Left: "Evidence," / "collected."
- Bars 11–12: policies. Left: "Approved." / "Published."
- Bars 13–14: people. Left: "Everyone" / "signs."
- Bar 15: risk. Left: "Risk, scored."
- Bars 16–17, the payoff (this lands near 62% of the film): climb. The ring rises to 95%, and sfx-payoff-bell hits on the frame it lands. Left column, only after it lands: "19 of 20" / "criteria met." at 63 px, with "19 of 20" in red.
- Bars 18–19: montage. 8 cuts of one beat each, taken from the best action moments in the takes: the swing settling, the lifted reason, a click, the ring climbing, Publish, a row signing, the matrix pull-out, 95%. Each gets a click or hit on its cut.
- Bars 20–23, end card: orbit, dimmed to about 35%. The same lockup as bar 2 returns, then "Compliance, without the spreadsheet." (39 px, 500, 70% white) fades up underneath on the next beat. Hold to the end.

MOTION RULES (the look; follow exactly)
- Headlines: a masked word rise. Each word sits in a clipping group one line tall and travels up 1.1× its size into place in about 17 frames on the curve [0.165,0.84,0.44,1], words 2 frames apart, no fade.
  - They start within 3 frames of their bar's cut.
  - They leave upward in about 8 frames on [0.72,0,0.18,1], finishing just before the next cut.
  - Exits are at least twice as fast as entrances.
- Objects that pop (the red dot, the "19 of 20" line) use one spring: stiffness 420, damping 32, rising about 15 px, scale 0.94 → 1. No other springs, and never outElastic or outBounce. Use only these two curves and this one spring in the whole film.
- Type:
  - Display text is weight 600, tracking about −0.04em. Left-column text starts at x ≈ 192 px and is vertically centred on the frame.
  - One hero line plus at most one supporting line per scene.
  - Red appears on one word or mark only, never a whole headline.
- Something alive in every frame:
  - Every footage clip gets a slow 2D push on top of its own camera move. Keyframe scale 1.00 → 1.05 across the shot, with left/top so the push aims at the product side. Use a linear ease.
  - In the text-only bars (2 and 3), give the red dot a small pulse on each beat, decaying within the beat.
- If a take reads too dark, lift its brightness a little (about 1.15), rather than letting the product disappear into black.

SOUND
- Music on A1, fading out over bar 23.
- All effects on A2, 10–20 dB under the music:
  - sfx-click on every cursor press frame
  - sfx-reveal-hit on the logo dot and on the reveal settle
  - sfx-payoff-bell on 95%, and softly on the end-card lockup

PROCESS
1. First, reply with your style sheet and a bar-by-bar shot list: each bar's footage, camera, text, where the text sits and how big it is. Then build it without waiting.
2. Build.
3. Review pass 1:
   - preview_frame at the start, middle and end of every bar. Check:
     - text sits in the clean left column and never touches the product
     - every entrance starts on its cut
     - no still frames and no black flashes
   - Fix what you find.
4. Review pass 2: frame_grid over the whole timeline (36 cells), then fix again. List what you changed in each pass.
5. Export with export_timeline to /Users/himanshu/Movies/redassay-launch/RedAssay-launch-film-v3.mp4 (mp4, quality best, loudness streaming). Poll track_export until it is complete, then report bar by bar what is on screen, plus anything you could not do as asked.
