# The `apple` category

Apple's launch films shoot software the way they shoot hardware: as an object, in a void, lit,
with the camera always moving slowly and one idea per shot. This file makes that a category you
can pick, the way `/brag` picks `polished` or `cinematic`, and says what it means in frames and
milliseconds, not adjectives. "Clean and premium" is not a direction; every tool claims it.

It is written in `/brag`'s tone format (energy, voice, typography, pacing, hook, highlights,
outro, transitions) so it slots into that system, then adds the two things a tone line cannot
hold: how to shoot a UI, and a 60-second structure.

---

## Tone card

**Energy:** Quiet confidence. The product is the loudest thing on screen, and it never shouts.

**Voice:** No narrator, or a short, warm read. The claims are declaratives with a full stop.
Superlatives are earned by what is shown, never by what is said.

**Typography:** One family. Apple uses SF Pro Display, which is licensed only for Apple
platforms, so a third-party film uses **Inter Display / Inter Tight** (the same proportions).
Semibold (600) for headlines, regular for the rare second line. Sentence case, with a period at
the end. Tracking tight at display sizes (−0.02 to −0.035em), leading ~1.05. A headline fills
10–14% of frame height and runs two to five words. There are no bullets or paragraphs, and at
most one supporting line under a headline.

```
Compliance.
Without the spreadsheet.
```

**Colour:** Pure black `#000` or Apple's off-white `#F5F5F7`, with white or `#1D1D1F` text. **One**
accent, taken from the product itself, used on a single word or one UI element per shot. A
gradient appears only as a text fill on the one hero word, and only once in the film. No mesh
gradients, glows, particles or lens flares.

**Pacing:** Long shots with slow moves, and hard cuts between them. A type card holds
1.2–2.0 s. A UI shot runs 3–7 s. The film breathes: a beat of near-black and silence before the
reveal is worth more than any animation.

**Hook style:** The tension, stated in the fewest possible words. Or a macro crop of the product
so close you cannot yet tell what it is, pulling back to reveal it.

**Highlight style:** A type card naming the capability, then a hard cut into the UI doing it.
The card makes the claim and the UI proves it, never the other way round.
```
Evidence, collected.   →   upload lands, three controls flip to Met
```

**Outro style:** A wordmark alone, centred, holding 2–3 s. Then one line: `Available now.` and a
URL. Silence after the last music hit.

**Transitions:** A hard cut on the beat is the default. A zoom-through into a screen or element
carries continuity across a cut. A dip to black marks a section change. No slides, wipes, spins
or whip pans.

---

## Motion numbers

| Thing | Value |
|---|---|
| Default ease | expo/quint out, about `cubic-bezier(0.16, 1, 0.3, 1)` |
| Springs | critically damped. No visible overshoot or bounce, ever |
| Text entrance | rise 24–40 px, blur 12→0 px, opacity 0→1, 0.7–0.9 s, per-line stagger 80 ms |
| Word-by-word reveal | only for the hero line, 60–90 ms per word |
| Text exit | faster than the entrance (0.3–0.4 s), blur up and fade. Never slide off |
| Camera drift | every shot pushes in 1.00→1.04–1.08 over its length, linear or ease-in-out. Nothing is ever perfectly static |
| Parallax | window, UI layers and type on separate depths. The foreground moves 1.5–2× the background |
| Counting numbers | tabular figures. Ease out, so the count lands and settles |

---

## Shooting the software

This is where Apple's films differ most from a screen recording, and where a launch film most
often looks amateur.

1. **The window is an object.** Float it on the void with a large, soft, low-opacity shadow
   (blur ~80 px, y-offset ~40 px, 35–50% black). It enters tilted (rotateX 10–18°,
   slight rotateY) and settles flat as the camera pushes in. No desktop, dock, menu bar or
   browser chrome, unless the chrome is the point.
2. **Crop hard.** After the establishing shot, go in to 200–300% on the one element that
   matters: the number, the row, the toggle. The frame edge cuts through the rest of the UI,
   which is fine. Half the shots in the film should be crops.
3. **Focus pull.** To point at something without a cursor, dim everything else to 30–40%
   brightness and add a slight blur (4–8 px), while the subject stays sharp and may lift 1.02× with
   its own shadow.
4. **The UI animates itself.** Rows arrive, chips change colour, a ring fills, a number counts.
   Show no cursor, or a minimal one moving in a single smooth arc with no jitter. Typing is
   character by character at a constant rhythm.
5. **Real data, believable data.** A fictional company with realistic names, dates and counts.
   No lorem, no "test", no empty states (unless the empty state is the "before" shot), and no
   warning toasts.
6. **Match cuts.** The number on the dashboard becomes the giant type card. A policy row
   becomes the phone screen where the employee signs it. The element survives the cut.
7. **Devices.** A MacBook-less floating window for the admin, and a bare phone-sized screen with
   rounded corners and no hardware bezel for the second actor, shown side by side for the
   cause → effect beat.
8. **Dark UI shoots better on black, and light UI on `#F5F5F7`.** Pick one per film.

---

## Sound

The film is music-led. Use one track that builds, with cuts on the beat, and pull the music
out for about half a second before the reveal. Keep UI sounds soft (clicks and ticks at −24 to
−30 dB under the music) and only on actions the eye is already on. One low hit lands on the
wordmark. Voice is optional. If used, keep it short and warm, and never have it read the text on
screen.

---

## 60-second structure

| Time | Beat | Content |
|---|---|---|
| 0–5 s | Cold open | A macro crop of the product, or a two-to-four-word tension line, on black |
| 5–10 s | Turn | One line naming the problem. Then silence |
| 10–14 s | Reveal | The name or wordmark, then a hard cut into the hero UI, establishing shot, tilted, settling |
| 14–44 s | Showcase | 4 capabilities × ~7 s: type card (1.5 s), then a UI shot with a crop, focus pull and self-animation |
| 44–52 s | Climax | The cause → effect moment, two screens side by side, the payoff number landing |
| 52–60 s | Close | Wordmark, `Available now.`, URL, final hit, silence |

At 30 s, keep the reveal, two capabilities and the climax. At 15 s, keep the reveal, the
climax and the close.

---

## Never

Glowing blobs, purple gradients or particle fields. Feature-card grids, bullets, emoji or stock
people. A cursor wandering around a full screenshot. A static frame. Text sliding in from the
side. Bounce. More than one accent colour. Claims the UI does not prove. An AI result the
product cannot actually produce on camera.
