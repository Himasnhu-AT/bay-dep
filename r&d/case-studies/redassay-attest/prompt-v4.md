Remake the launch film for RedAssay Attest from the media I just dropped in. RedAssay is a cybersecurity company; Attest is its SOC 2 / ISO 27001 readiness product for startups. It turns framework requirements into controls, tasks and policies, works out readiness from real evidence, and every status explains why.

The owner's review of the last version:
- the clicks were sometimes off
- the animation stuck
- the dashboard was tilted where it should have been straight to read

This version is **white, premium and smooth**, like an Apple product film:
- a light canvas, dark ink type
- frosted glass
- soft shadows
- nothing ever tilted while there is text to read

The footage has been re-rendered frame by frame, so its motion is perfectly smooth and its click times are exact. Keep your own motion equally calm and continuous. Claim only what the footage shows: no invented numbers or customers, no URL, no "available now".

MEDIA (all in the pool)
- Takes. All are 2880×1620, 60 fps, with motion blur, light theme, straight.
  - In every take except endbg, the product sits in the right part of the picture.
  - A **frosted glass card** floats on the left, at about x 61–752 px and y 76–1004 px in 1920×1080 terms. It is where your text goes.
  - hookbg (8 s): the dashboard drifting slowly behind the glass card. No cursor.
  - reveal (7.5 s): the product materializes out of the grey canvas (a blur and fade clearing), settles, then the glass card arrives. The camera pushes toward the "Why it isn't 100%" list, and the cursor clicks Add evidence.
  - why (8 s): the reason list; one reason lifts out while the rest blurs; the cursor clicks Approve.
  - cascade (7.5 s): three quick Add evidence clicks, then a smooth move to the readiness ring climbing.
  - policies (8.5 s): the cursor clicks Approve v1.0, then Publish v1.0.
  - people (9 s): three employees sign and their rows update.
  - risk (6 s): tight on the 5×5 risk matrix, easing out; the cursor selects a risk.
  - climb (7 s): a slow push on the readiness ring as it climbs 75% → 95%.
  - endbg (8 s): the finished dashboard at 95%, small and centred, drifting. No glass card.
- Exact click times in the source (seconds; the cursor presses and a ring pops on that frame): reveal 2.68; why 1.78; cascade 0.37, 0.58, 0.78; policies 0.48, 2.01; people 0.48, 2.10, 3.72; risk 0.51
- Sound:
  - music-happy-beats-vol10.mp3: 60 s, about 110 BPM.
  - sfx-click.wav
  - sfx-reveal-hit.wav
  - sfx-payoff-bell.wav
- Font: Inter (variable, wght 100–900). Use it for all type.

LOOK
- Canvas: #F5F5F7. Set the timeline background to it, and use it for any full-frame colour.
- Type:
  - Headlines are #1D1D1F, weight 600, tracking about −0.035em.
  - Supporting lines are #6E6E73, weight 500.
  - One accent, #E5484D, on one word or mark per scene, never a whole line.
- Text lives inside the glass card:
  - left edge at x ≈ 120 px, vertically centred on the card (y ≈ 540)
  - one hero line (up to two lines) plus at most one supporting line
  - sizes from the scale: 102 px for feature headlines, 63 px for secondary headlines, 39 px for supporting lines, 165 px for the hook statements and the logo
- Keep the product straight: no rotation keyframes on any clip. Your camera on top of the footage is a gentle push only: scale 1.00 → 1.04 across the shot, with left/top so it aims at the product side. Linear ease.
- No black anywhere. No dips to black; hard cuts only.

THE CLOCK
- Run detect_beats on the music.
- The steady grid is 110 BPM from 0 s. The last run found detection drifting in the intro, so use the grid.
- A bar is 4 beats (about 2.18 s). Cut only on bar lines, one idea per bar.
- 24 bars (about 52 s). Fade the music out over the last bar.

STORYBOARD (bars, from bar 0)
- Bar 0, hook: hookbg. Inside the glass card, one statement per beat, each replacing the last:
  - "New customer."
  - "Wants SOC 2."
  - "Now what?"

  165 px, dark ink.
- Bar 1: hookbg continues. "You have a" / "spreadsheet." (102 px). On beat 3, a line in #E5484D draws across "spreadsheet".
- Bar 2, logo, on the plain #F5F5F7 canvas, centred at about 57% height:
  - A small #E5484D dot pops in on the spring, with sfx-reveal-hit.
  - "Attest" rises in beside it (165 px, 600, #1D1D1F).
  - "by RedAssay" fades up 10 px underneath, 0.35 s later (39 px, 500, #6E6E73).
- Bar 3, on the canvas: a slot machine of three promises in one line-high window, one per beat: "Controls." → "Evidence." → "Policies." (102 px). The last one stays.
- Bars 4–6: reveal. It materializes, then the glass card arrives. Once the card is in (about 2 s into the take), "SOC 2 readiness," / "from real evidence." rises inside it. sfx-reveal-hit as the product settles; a click on the press.
- Bars 7–8: why. "Every status" / "explains why."
- Bars 9–10: cascade. "Evidence," / "collected."
- Bars 11–12: policies. "Approved." / "Published."
- Bars 13–14: people. "Everyone" / "signs."
- Bar 15: risk. "Risk," / "scored."
- Bars 16–17, the payoff: climb. The ring lands on 95% with sfx-payoff-bell on that frame. Then, inside the card, "19 of 20" (165 px, with "19" in #E5484D) and "criteria met." (63 px) under it, springing in after the landing.
- Bars 18–19: montage. 8 one-beat cuts of the best action moments in the takes, each with a click or hit on its cut: the materialize settling, the lifted reason, a click, the ring climbing, Publish, a row signing, the matrix, 95%.
- Bars 20–23, end card:
  - endbg at about 30% opacity over the canvas.
  - The lockup from bar 2 returns, centred.
  - "Compliance, without the spreadsheet." (39 px, 500, #6E6E73) fades up underneath on the next beat.
  - A soft sfx-payoff-bell. Hold to the end.

MOTION RULES (follow exactly)
- Headlines: a masked word rise. Each word sits in a clipping group one line tall and travels up 1.1× its size into place in about 17 frames on [0.165,0.84,0.44,1], words 2 frames apart, no fade.
  - They start within 3 frames of their cut, or of the card arriving in reveal.
  - They leave upward in about 8 frames on [0.72,0,0.18,1], finishing just before the next cut. Exits are at least twice as fast as entrances.
- Pops (the dot, "19 of 20") use one spring: stiffness 420, damping 32, rising about 15 px, scale 0.94 → 1.
- Use no other springs, no outElastic or outBounce, and only these two curves in the whole film.
- In the canvas-only bars (2 and 3), the red dot gives a small pulse on each beat that decays within the beat.

SOUND
- Music on A1, fading out over bar 23.
- Effects on A2, 10–20 dB under the music:
  - sfx-click on every press (use the exact times above)
  - sfx-reveal-hit on the logo dot and the reveal settle
  - sfx-payoff-bell on 95%, and softly on the end card

PROCESS
1. Reply first with your style sheet and a bar-by-bar shot list. Then build without waiting.
2. Review pass 1: preview_frame at the start, middle and end of every bar. Check:
   - every word sits inside the glass card, in dark ink, readable
   - nothing is tilted
   - every entrance starts on its cut
   - every click sound lines up with its ring
   - nothing sits still and nothing flashes
   Fix what you find.
3. Review pass 2: frame_grid over the whole timeline (36 cells), then fix again. List what you changed in each pass.
4. Export with export_timeline to /Users/himanshu/Movies/redassay-launch/RedAssay-launch-film-v4.mp4 (mp4, quality best, loudness streaming). Poll track_export until it is complete, then report bar by bar, plus anything you could not do as asked.
