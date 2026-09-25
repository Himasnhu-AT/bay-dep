# Format: product ad and UGC ad

A 15–60 second video that makes someone want a product. Either polished (product shots,
motion graphics, music) or UGC-style (a person talking to a phone camera about something they
use). Both follow the same argument.

## Goal

**Hook → problem → proof → offer → call to action.** Every shot must move that argument
forward. A pretty picture that proves nothing is a wasted second.

## Structure and timing (30 s)

| Beat | Time | What is on screen |
|---|---|---|
| Hook | 0–3 s | the result, a bold claim, or a relatable problem — moving from the first frame |
| Problem | 3–8 s | the pain the viewer recognises |
| Proof | 8–22 s | the product in use, a before/after, a number, a real customer |
| Offer | 22–26 s | what they get, price or discount as typography |
| CTA | 26–30 s | one action: shop, download, sign up — with the product on screen |

Scale for 15 s (drop the problem to one line) or 60 s (more proof, not a longer hook).

## Picture roles

Give every shot a job and do not repeat a job back to back:

- **Context** — who uses this, where.
- **Proof** — the product doing the thing; before and after; the result.
- **Detail** — a close-up of the product, texture, the label.
- **Screen** — the literal app or site state, for software.
- **Type** — a number, a price, a claim, drawn as a graphic.

## Pacing

- Cuts every 1.5–3 s for a polished ad; a UGC ad lets the speaker run longer (3–6 s) with
  cutaways for proof.
- The hook's first frame is already in motion. No logo sting first.
- Music under a UGC ad sits low; duck it under speech (`edit_item` `duck`).

## Captions and safe areas

- Captions show only what is spoken. Price, offer and CTA are separate typography, larger, held
  long enough to read (at least 1.5 s per short line).
- Vertical placements: nothing important in the bottom ~20% or on the right edge. The product
  and CTA sit in the middle.

## Truth rules

- The exact product, packaging, logo, price and UI come from files the user supplies. A
  generated image may show a lifestyle scene or a mood; it must never stand in for the real
  product or invent claims, reviews or customers.
- If generation is part of the job, read `bay://guide/generation` first and state the cost.

## Tools, in order

1. `browse_assets` — what product shots, logos and footage exist. Ask for anything missing
   (the product image, the offer, the CTA).
2. Write the beat list with times and show it to the user in two or three lines.
3. For UGC: `transcribe` the talk and tighten it (`remove_range`), as in a talking head.
4. Lay out shots per beat: `place_asset`, `edit_item` to trim and frame.
5. Optional generation for missing context shots: `generate_image` / `generate_video` with
   `validateOnly: true` first, then `track_generation` with `place: true`.
6. Offer and CTA: `write_brf` (or `add_template` `end-card`).
7. Captions for speech: `add_subtitles` or `add_captions`.
8. Music: `detect_beats` on the track so cuts land on beats; `edit_item` `duck`.

## Verify

- [ ] `frame_grid` over the ad: each cell's shot matches its beat, and the product is on screen
      at the CTA.
- [ ] The first cell already shows the hook.
- [ ] Offer and CTA readable and inside the safe area.
- [ ] Product, logo and price are the supplied ones.
- [ ] Export and read `findings` on `track_export`.
