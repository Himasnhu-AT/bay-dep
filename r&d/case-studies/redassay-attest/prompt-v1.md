/motion-graphics Build a 60-second launch film for RedAssay, made exactly the way Apple makes its launch films. Everything you need is already in the media pool. Build the whole edit on the timeline, check it frame by frame, and do NOT export — I'll review first.

PRODUCT
RedAssay is SOC 2 / ISO 27001 readiness for startups. It turns framework requirements into controls, tasks and policies, works out readiness from real evidence, and every status explains why. The footage is its working demo for a fictional company, "Northwind Labs". Show only what the footage shows: no invented numbers, customers or testimonials, no AI features, no URL, no "available now".

MEDIA (all in the pool)
- Music: happy-beats-business-moves-vol-10 (exactly 60.0 s, ~110 BPM). It runs the whole film on A1. Run detect_beats on it and put every cut on a beat.
- Font: Inter (variable; wght 100–900, opsz 14–32). Use it for ALL type.
- Recordings, 3840×2160 (the UI is rendered at 2x, so crops up to ~200% stay sharp):
  t1-overview-climb: the dashboard as evidence lands and readiness climbs 0→19%, with toasts
  t2-ring-jump: the readiness ring animating 0→75%, then 75→95%
  t3-controls-evidence: the Controls list as evidence is added and controls flip to Met
  t4-policies-approve-publish: a policy approved, then published
  t5-people-signing: the People list as employees sign, rows updating
- Stills, 3840×2160: t9-overview-0 (0% readiness with "Why it isn't 100%" reasons), t8-overview-95, t6-risks (5×5 risk matrix + register), t10-controls-95, t11-policies-95, t12-people-95, t7-vendors.
- Ignore everything under app-real (01-setup-flow and the other plain screenshots). The demo footage replaces them.

THE APPLE GRAMMAR (follow it literally)
- Canvas 1920×1080, 30 fps, pure black #000 background. One accent: RedAssay red (#EF4444 or close to it), used on at most one word or element per shot. No gradients, glows, particles, emoji, bullets or card grids.
- Type: Inter semibold (wght 600), sentence case, ending in a period. Tight tracking (about −0.03em), leading ~1.05. A headline is 2–5 words, about 110–150 px tall, alone on black. At most one smaller supporting line (wght 400, ~40 px, 60% white).
- Text entrance: rise 30 px + fade over ~0.8 s with expo-out easing (fast start, long gentle settle). Per-line stagger 80 ms; word-by-word only for the opening line. Text exits faster (~0.35 s fade). Nothing slides in from the side. No bounce or overshoot.
- Every shot moves. The UI clips get a slow push-in (scale up 4–8% over the shot, keyframed on layout.scale), so nothing is ever static.
- Shoot the UI like an object. After the first establishing shot, crop hard: scale the 4K clip so ONE element fills the frame (the ring, a row, the matrix) at ~150–200%, and position it so that element is the subject. Half the UI shots should be crops like this.
- Type card, then proof: a black card names the capability (~1.5 s), then a HARD CUT to the UI doing it. Default to hard cuts on the beat. Use a dip to black only between sections. No slides, wipes or spins.
- Contrast: hold near-black and quiet before the reveal, then the energy goes up through the showcase.

STORYBOARD (seconds; snap each cut to the nearest beat)
1. 0–4 — Cold open on black. Word by word: "Your first enterprise deal wants SOC 2."
2. 4–7 — Second card: "You have a spreadsheet." Hold. Then a dip to black and a beat of silence-feel before the reveal.
3. 7–10 — Macro: t9-overview-0 cropped hard onto the "0%" readiness ring, slow push-in. This is the "before".
4. 10–13 — Reveal: the wordmark "RedAssay" (Inter 600, white) with a small red dot to the left of it, as in the product's logo. Under it, one line: "SOC 2 readiness, worked out from real evidence."
5. 13–19 — Establishing shot: t1-overview-climb, the whole dashboard at ~92% scale, centred on black, pushing in slowly as readiness starts to climb.
6. 19–26 — Card "Every status explains why." → t9-overview-0 cropped onto the "Why it isn't 100%" list, pushing in.
7. 26–33 — Card "Evidence, collected." → t3-controls-evidence cropped onto the rows flipping to Met.
8. 33–40 — Card "Policies, approved and published." → t4-policies-approve-publish cropped onto the policy row changing state.
9. 40–46 — Card "Risk, scored." → t6-risks cropped onto the 5×5 matrix, slow push-in.
10. 46–54 — Climax. Card "Everyone signs." → t5-people-signing cropped onto the rows updating. Then hard cut on a strong beat to t2-ring-jump cropped onto the ring as it rises to 95%. The number landing is the payoff of the film.
11. 54–60 — Close on black: the red dot + "RedAssay" wordmark, then "Compliance, without the spreadsheet." fading in under it. Hold to the end. The music ends at 60.0 s.

HOW TO BUILD
- Write the type cards and the wordmark as .brf modules (write_brf) with font "Inter", weight 600. Put the words in export const vars so I can change them later. One module per card is fine, or one module for all the cards on their own track.
- Place and trim the clips on V1 at the times above. Crops and push-ins go through edit_item (layout position/scale plus layout.scale keyframes).
- After each section, check it with preview_frame at the start, middle and end of each shot: nothing clipped, no text colliding with UI, crops land on the right element, type readable. Fix before moving on.
- At the end, run frame_grid over the whole timeline (36 cells) and tell me, beat by beat, what is on screen and anything you couldn't do the way this brief asks. If a technique here isn't possible in bay, pick the closest honest alternative and tell me. Don't fake it.
