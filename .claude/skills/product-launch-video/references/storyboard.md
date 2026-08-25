# storyboard.json

The blueprint. Written in full before an element exists, and re-read in Phase 5 instead of
trusting your memory of what you meant.

It is not documentation. It is the thing you diff the render against.

## Schema

```json
{
  "meta": {
    "title": "Product name — video type",
    "durationSec": "total, seconds",
    "fps": { "numerator": "…", "denominator": "…" },
    "width": 1920,
    "height": 1080,
    "format": "product-film",
    "kit": "the style_pick id you committed",
    "narrativeStructure": "problem-solution | vision-reality | montage-focus | teaser",
    "publishedTo": "landing page | X | LinkedIn | YouTube | Shorts | keynote",
    "mustReadMuted": true,
    "signatureElement": "the one motif that makes this film this film"
  },

  "voice": {
    "enabled": true,
    "kokoroVoice": "af_heart",
    "targetWordsPerSecond": 2.5,
    "tone": ["confident", "unhurried"],
    "why": "one sentence on why this voice and not another"
  },

  "beats": [
    {
      "id": "kebab-case, and it is the marker name",
      "act": "hook | reveal | showcase | climax | close",
      "startSec": 0,
      "durationSec": 4.2,
      "purpose": "why this beat exists",
      "emotionalBeat": "what the viewer feels here",
      "narration": "exact words, or null",

      "layers": {
        "ground": "…", "structure": "…", "depth": "…",
        "atmosphere": "…", "content": "…", "light": "…", "grain": "…"
      },
      "framing": "the kit framing the focal element sits in",
      "leadingLine": "what points at the focal element",

      "motion": {
        "entrance": "element → move → direction",
        "response":  "which incumbent answers it, with which move",
        "ambient":   "what moves under the held part",
        "accent":    "optional",
        "exit":      "how it leaves — designed, not a reversed entrance"
      },
      "choreography": "pattern name if 3+ items, else null",
      "carriesForward": "the element id that survives into the next beat",
      "seam": "how this beat becomes the next one"
    }
  ],

  "payoffMarker": "the beat id the loudest moment lands on",
  "risks": ["what you expect to go wrong, written before it does"]
}
```

## Filling it in

**`fps` is a fraction.** 30/1, or 24000/1001 for 23.976. Never a rounded whole number when the
source is broadcast rate — that is how a 41-second film ends up 41.04 seconds long and the last
narration line lands past the picture.

**`durationSec` per beat is provisional until narration exists.** `narrate` returns the real
duration. When it disagrees with the plan, the plan is wrong: update it and push every subsequent
`startSec`. Note also that `narrate` refuses a line over 8 seconds and lists the offending
sentences — so a beat's narration is one or two short sentences, always.

**`carriesForward` is not optional** in a product film. `broken-continuity` is a real check in
this genre, and it is satisfied by keeping an element's *id* across the seam and animating it
there — not by building a similar-looking element in the next beat.

**`motion.response` is the field agents leave blank.** Something already on screen has to answer
the arrival with a positional or scale move. Opacity does not count. If you cannot name the
incumbent, the beat has nothing on screen to respond, which usually means the beat before it
cleared the frame it should have kept.

**`risks` earns its place.** Write down what you expect to be wrong — the beat you are unsure
reads, the line you think is too long, the panel you suspect is a placeholder. Then check exactly
those in the contact sheet. The alternative is looking at fourteen frames with no hypothesis and
concluding they are fine.

## Worked fragment

```json
{
  "id": "the-claim",
  "act": "hook",
  "startSec": 0,
  "durationSec": 3.6,
  "purpose": "State the argument before showing anything, so the product arrives as an answer.",
  "emotionalBeat": "recognition — this is my problem",
  "narration": "Every video tool you know runs somewhere else.",

  "layers": {
    "ground": "full-frame shape, gradient from the kit's bg tone to its surface tone, raked from the lower left",
    "structure": null,
    "depth": "one blurred ellipse, accent tone, upper right, screen blend",
    "atmosphere": null,
    "content": "headline, role hook, framing hero",
    "light": null,
    "grain": "noise plate, overlay blend, barely there"
  },
  "framing": "hero",
  "leadingLine": "the gradient runs from the dark lower-left up into the glow behind the headline",

  "motion": {
    "entrance": "headline → land → up",
    "response": "the depth orb → dim-back as the headline settles",
    "ambient": "ground → push-in over the whole beat",
    "accent": "headline → tap on the last word's cue",
    "exit": "headline → duck at 3.2 s"
  },
  "choreography": null,
  "carriesForward": "orb — it becomes the product mark in beat 2",
  "seam": "z-out on the headline, z-in on the mark, velocity matched"
}
```

Note what makes this usable: every motion field names an element *and* a registry move, the
leading line is a real geometric claim rather than "good composition", and `carriesForward` names
an id that beat 2 is obliged to animate rather than rebuild.
