# The multicam podcast — a named format

Two or three locked-off cameras on one conversation, separate lavalier or boom mics per
speaker, an hour of it, and a deliverable that is the whole episode plus short social cuts.
Everything below was measured on a real one; the numbers are the ones that mattered.

**The one rule:** the sound is the edit. Cut it on the transcript and the mics, then conform
the picture to that. A camera you have not downloaded yet does not stop you building the cut.

---

## Before you touch the picture

**Probe every file first.** Frame rate is the one that bites: interview cameras shoot broadcast
rates, and rounding one to a whole number is a conform, not a rounding. Pass `fps` **and**
`fpsDenominator` to `project_create` — the numerator/denominator pair for the source rate.
Getting this wrong drifts the picture off the sound by about a frame every three-quarters of a
minute, invisibly, until an hour in it is a lip-sync fault nobody can place.

**Both mics carry both voices.** Separation between a pair of lavaliers a metre apart measured
8–9 dB, which is plenty to tell who is speaking and nowhere near enough to treat either track
as clean. So:

- `transcribe` **one** mic — it hears everyone through bleed, so one transcript covers the room.
- Attribute each utterance by comparing the two mics' energy over that window, taking the loud
  quartile rather than the mean so pauses inside a turn do not drag the answer. The result is
  strongly bimodal; a turn is not ambiguous.
- Trust content over the transcriber for names. A guest spelled their own name aloud on tape,
  and the transcriber still got it wrong every time.

**Level the speakers against each other before anything else**, measured over each speaker's own
turns rather than over the whole file. On the episode this ran on, one mic sat 7 dB under the
other — which is the brief's "no one buried under the other", and it is a static gain, not a
job for a compressor.

**Leave a clean noise floor alone.** It measured around -70 dB. Broadband denoise at that floor
costs more in artefacts than it removes in hiss. Say so rather than reaching for a tool.

---

## Finding the top of the show

Recordings start long before the episode does: room chatter, a guest leaving, a slate, a
producer asking someone to spell their name. Read the transcript and find the first line that is
addressed to the audience. Then place the in-point in the **gap between two words**, taken off
the audio envelope, not off the transcriber's word boundaries — those run words together through
a monologue and are simply absent for whole minutes at a time.

Trim the filler word at the head if there is one. Opening on the second word of a sentence is
usually the difference between a start that sounds deliberate and one that sounds like a tape.

---

## Switching

The rules, which agree with what a well-cut episode of the same show does:

- Cut to whoever is speaking.
- **Hold through short interjections.** A back-channel "mhm" or a laugh under about a second and
  a half does not take the picture; it plays over whoever has the floor. Cutting on every one is
  the single most common way a multicam edit reads as automated.
- **The wide carries overlap and crosstalk**, and resets the room between subjects. Detect
  crosstalk as both mics hot within a few dB of each other.
- **Never sit on one angle through a long answer.** Break it with the listener's reaction — a
  glance, two to four seconds, then back — and with the wide. An angle held for a whole monologue
  stops being an edit and becomes a security camera.
- **Cut on speech, not on a clock.** Build the candidate points from gaps in the *combined*
  envelope of both mics; the longer the pause the more it reads as the end of a thought, which is
  where a cut belongs. Vary shot length deterministically rather than randomly so two runs of the
  same episode can be compared.
- Median shot length in the low single-digit seconds, with a floor of two and a bit. A metronome
  is as wrong as a locked-off camera: an early version of this cut everything at exactly the
  maximum and read as mechanical.

Sanity-check the result by its distribution — median, shortest, longest, and screen time per
camera — against the reference episode before rendering anything.

---

## Lower thirds

Both must be identical in face, size, position, animation and hold; only the words differ. Bring
each in a few seconds after that person first speaks *on camera*, not after they first make a
sound. Use `plate` for a scrim or `shadow` for a drop shadow — over a dark set the shadow is
usually right, because a box is then the only hard edge in the frame.

**The type ramp is quoted against a 1080-tall canvas and scaled to the real one.** On a portrait
canvas every step therefore comes out about 1.8× bigger than the number in the kit. A ramp that
is right for the landscape master will break words across lines on the vertical cut. Give the
vertical piece its own kit with a smaller ramp rather than fighting `scale`, which sets the
layout box and never the glyph size.

---

## Colour

**Match the cameras before grading, and measure it on something neutral that all of them see** —
a wall, a grey card, the set itself. Two traps, both hit on the first attempt:

- **Mask the practicals out of the sample.** A lamp glow inside the sample region read as a
  strong warm cast on one camera and would have had it "corrected" the wrong way. With the
  highlights masked, the same three cameras sat within about a decibel of each other.
- **Cameras of the same model on the same settings are usually already matched.** Measure, then
  do nothing if nothing is wrong. Applying a sub-decibel correction is correcting noise.

Then one grade, identical on every angle — that is what makes a cut between angles invisible.
`looks_list` names what is available; a look is generated on the machine, so there is no file.

**Read `effect_add`'s parameter ranges before passing one.** They are not interchangeable
between effects, and the wrong one does not error — it silently returns a frame nobody wants.

---

## Sound

Target the loudness the brief names, and verify the rendered file rather than trusting the
setting. Two things to know:

- **`role: "speech"` attaches an EQ, compressor and limiter.** Right for raw dialogue, wrong for
  a bed that arrives already mixed — running the chain over finished work cost about 6 dB and
  most of the loudness range. Pass `processDialogue: false` for audio that is already levelled.
- **Reaching a loudness target on dynamic speech needs gain into a limiter, not compression.**
  Squeezing it with a compressor collapsed the loudness range; oversampling around the limiter
  is what keeps inter-sample peaks under a true-peak ceiling.

**Then call `audio_smooth`.** Every place two sounds meet needs a crossfade — see its own tool
description for why a butt-joined dialogue edit ticks at every seam even though nothing in the
waveform is discontinuous.

---

## What `check` will say, and which of it to believe

This format trips two gates that are aimed at composed motion graphics:

- **`broken-continuity` fires on every camera cut.** It wants consecutive beats to carry an
  element across the seam. A hard cut between locked-off angles shares nothing *by design*, and
  a well-cut reference episode is hard cuts throughout. Override it with `ignoreChecks` and a
  `reason` — which is written into the file's own metadata, so the claim outlives the session.
- **`no-response` and `unreadable-dwell`** likewise assume composed graphics. A caption under
  speech is read and heard at once and does not need a standalone title's dwell.

**Everything else it says, believe.** On this edit it correctly caught frame-boundary drift, a
one-frame overlap and a one-frame hole between shots. Snap the *boundaries* to frames and derive
each duration from the next boundary — rounding start and length independently is what put the
overlap and the hole there.

---

## The social cut

Choose the excerpt for a complete arc, not a good line: a question, a surprising answer, and a
confirmation reads as self-contained in well under a minute. Cut the filler out of the setup —
the question as asked is usually twice as long as the question that plays.

Reframe rather than letterbox (`cover`). Captions continuous, held until the next one takes over
rather than timed to the words alone, or they blink out in every gap. Merge only the lines that
genuinely flash, and cap the merge: merging on a reading-speed test makes each line longer, which
fails the test again, and collapses the whole piece into one caption.
