/motion-graphics Make a 60-second launch film for RedAssay from the media I just dropped in. The first version of this film was too plain: static screenshots with fades. This one must feel alive: interactive, with real camera movement, kinetic type, and sound on every action. Build it, check it, then export it.

PRODUCT
RedAssay is SOC 2 / ISO 27001 readiness for startups. It turns framework requirements into controls, tasks and policies, works out readiness from real evidence, and every status explains why. The footage is its working demo for a fictional company, "Northwind Labs". Claim only what the footage shows: no invented numbers, customers or testimonials, no URL, no "available now".

MEDIA (all in the pool)
The eight takes are 4K (3840×2160) screen recordings. The camera moves (3D tilts, swings, pans, push-ins) and a visible cursor clicking real buttons are already in the footage.
- reveal.mp4 (≈7 s): the dashboard swings up from a steep 3D tilt and settles, then the cursor clicks "Add evidence".
- why.mp4 (≈8 s): the "Why it isn't 100%" list; one reason lifts out while the rest blurs (depth of field); the cursor clicks Approve.
- cascade.mp4 (≈8 s): three quick "Add evidence" clicks, then the camera pans across to the readiness ring as it climbs to 50%.
- policies.mp4 (≈9 s): tilted Policies table; the cursor clicks "Approve v1.0", then "Publish v1.0".
- people.mp4 (≈9.5 s): tilted People list; three employees sign and their rows update.
- risk.mp4 (≈5 s): tight on the 5×5 risk matrix, pulling out into a tilt; the cursor selects a risk.
- climb.mp4 (≈7 s): push-in on the readiness ring as it climbs 75% → 95%. No cursor.
- orbit.mp4 (≈8 s): the finished dashboard at 95%, turning slowly in 3D.
- Sound: music-happy-beats-vol10.mp3 (exactly 60 s, ~110 BPM) runs the whole film. sfx-click.wav (UI click), sfx-reveal-hit.wav (soft impact), sfx-payoff-bell.wav (bell).
- Font: Inter (variable, wght 100–900). Use it for all type.
Click times in the source (seconds; approximate, so confirm each by finding the frame where the cursor shrinks and a white ring expands): reveal 5.0; why 3.9; cascade 1.9, 2.7, 3.4; policies 2.35, 4.8; people 2.35, 4.5, 6.6; risk 5.05.

WHAT THE RESEARCH SAYS WORKS (apply all of it)
- UI on screen within the first few seconds; the hook states the problem, never a logo.
- The camera never stops. On top of the moves already in the footage, give every UI clip its own 2D camera: keyframe scale (1.00 → 1.06–1.10) and left/top together, so it drifts toward where the action is (the cursor's target, the changing number). Use bezier eases like [0.45,0,0.55,1] for drifts and [0.16,1,0.3,1] for arrivals. Scale is about the clip's centre, so keyframe left/top alongside it to aim the push.
- Tactile sound: every cursor click gets sfx-click on its exact frame, quiet (about −12 dB under the music). sfx-reveal-hit on the wordmark reveal and on the 3D swing settling. sfx-payoff-bell as the ring lands on 95%, and again softly on the final wordmark.
- Cut rhythm accelerates: longer shots early (6–8 s), shorter through the showcase, then a rapid montage of 0.5–0.7 s cuts on consecutive beats just before the end (exponential cut acceleration). All cuts land on beats; run detect_beats on the music first.
- Kinetic type, not slides. Write every card as a .brf with font "Inter":
  - Headlines: wght 600, white, about 120 px, sentence case with a period, tracking −0.03em.
  - Split by word (split="word"). Each word rises 40 px, blurs in from 14 px to 0, and scales 1.08 → 1 with outExpo over 0.7 s, staggered 70 ms. Exits are faster (0.3 s), blurring up and fading.
  - One key word per card in RedAssay red (#EF4444).
  - Cards sit on pure black, 1.2–1.6 s each, and hard-cut into the proof shot.
- One accent colour (red), no gradients, glows or emoji. Nothing slides in from the side, and no bounce.

STORYBOARD (seconds; snap every cut to the nearest beat)
1. 0–3.3 Hook: "Your first enterprise deal wants SOC 2." word by word, "SOC 2" in red.
2. 3.3–5.5: "You have a spreadsheet." Then a red line draws across "spreadsheet" (path draw, left to right, 0.4 s, outExpo).
3. 5.5–7.6 Reveal: the wordmark, a small red dot plus "RedAssay" in Inter 600, scaling 1.1 → 1 with a blur-in, and sfx-reveal-hit. Under it, at wght 400 and 60% white: "SOC 2 readiness, worked out from real evidence."
4. 7.6–14: reveal.mp4 from the start: the 3D swing, then the click. Add a 2D drift toward the "Why it isn't 100%" list.
5. 14–21: card "Every status explains why." → why.mp4 (focus pull + Approve).
6. 21–28: card "Evidence, collected." → cascade.mp4 (three clicks, then the pan to the ring).
7. 28–35: card "Policies, approved and published." → policies.mp4.
8. 35–41: card "Everyone signs." → people.mp4.
9. 41–45.5: card "Risk, scored." → risk.mp4.
10. 45.5–51.5 Payoff: climb.mp4. The ring rises to 95% under the push-in; the bell hits on the landing. Hold 95% (freeze the last frame if needed).
11. 51.5–54.5 Montage: 5–6 cuts of 0.5–0.6 s on consecutive beats, taken from the best action moments (the swing settling, the lifted reason, the ring climbing, Publish, a row signing, the matrix), each with a click or hit.
12. 54.5–60 Close: orbit.mp4 dimmed to about 35% opacity behind the wordmark (dot + "RedAssay"), then "Compliance, without the spreadsheet." blur-ins beneath it on the next beat. The music ends at 60.0 s.

HOW TO WORK
- Tracks: footage on V1, cards and wordmark on V2, music on A1, all SFX on A2.
- After each section, check preview_frame at the start, middle and end of each shot: type must never collide with UI, clicks must line up with their sounds, and nothing may flash black between shots.
- When the whole timeline is built, run frame_grid over it (36 cells) and fix what you find.
- Then export it with export_timeline to /Users/himanshu/Movies/redassay-launch/RedAssay-launch-film-v2.mp4 (mp4, quality "best", loudness "streaming"), poll track_export until it is complete, and tell me beat by beat what is on screen, plus anything you could not do as asked.
