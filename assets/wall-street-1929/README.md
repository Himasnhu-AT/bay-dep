# *How Wall Street lost 89% of its value*

The 1929 crash, 50.3 s, on the same 138 BPM grid as the Weimar music cut. Third piece in the
series and the first where the writing is right.

```bash
bay --mcp
python3 hunt1929.py     # search + SigLIP re-rank, writes bank1929.json
python3 build1929.py    # needs music.wav beside it — see ../loaf-of-bread/music-cut/README.md
```

**This build no longer preprocesses anything.** It reads the tempo with `audio_beats` instead of
a numpy script that lived in a scratch directory, and imports the downloaded originals straight
from the cache — `add_image(cover: {width, height})` crops each one to the panel, which is what
an ffmpeg pass per image used to do into a `plates/` folder. Two whole steps of the earlier
pipeline are gone.

One consequence worth knowing: `audio_beats` reads this track at **139.75 BPM** where the
hand-written script said 138, so 115 beats is 49.7 s rather than 50.3. The confidence is 0.379 —
a real ambiguity, not a bug — and `candidates` lists both readings. The cut measures the same
either way.

## What changed: the cards say what they mean

The Weimar cut opened on the bare word **1923** and nobody reading it knew what 1923 was. Those
cards were fragments of sentences the narration used to carry; once the voice went, they carried
nothing. A viewer who does not already know the story cannot follow a caption that says
"So it printed".

So every card here is a complete statement with its own context — who, where, when — in five or
six words a line:

> New York, September 1929 / Prices hit a record high
> You could buy stock with / just ten percent down
> A broker lent the rest / It was buying on margin

Three constraints fell out of that, and all three are enforced rather than remembered:

1. **Lines cap at 25 characters.** Past that the red chip is wider than the frame. `cards1929.json`
   is checked against the measured advance table before a build.
2. **Longer lines need smaller type.** The captions drop from the `label` tier to `chrome`, whose
   metrics were measured off a calibration frame the same way. At the label tier "Prices hit a
   record high" would have made a chip 0.90 of the frame wide.
3. **No content word may repeat across consecutive beats.** `check`'s continuity rule reads a word
   appearing in two beats as two different elements as a rebuild rather than a carry, and it
   fired three times on the first draft — on "1929", and twice on "fell". The fix is rewording,
   and `audit_cards.py` finds all three classes of problem before a render does.

## The archive picked the subject

1929 was chosen over Barings, Lehman and the tulip mania because of what `stock_search` returns
under the **default** licence policy — no ShareAlike opt-in:

| | Weimar 1923 | Wall Street 1929 |
|---|---|---|
| public domain / CC0 | 10 of 25 | **30 of 33** |
| CC BY (credit required) | 2 | 3 |
| CC BY-SA (copyleft) | **13** | **0** |
| finished video | must be CC BY-SA | **no licence obligation** |

US federal and pre-1930 material is almost entirely unrestricted, so this piece imposes nothing
on whoever publishes it. `CREDITS.md` lists the three images that want a name.

**Period material only.** The archive is full of 2023–24 photographs of the exchange, an Occupy
sign and a 2025 index chart, and SigLIP ranks them highly because they *are* pictures of the
stock market. A modern frame in a 1929 piece is a lie the viewer cannot check, so `picks1929.json`
is filtered by hand. This is the third time looking at a contact sheet has caught something a
score could not: the ranker also offered an East German party headquarters for "Reichsbank" and
a 1933 antisemitic boycott photo for a query about shop windows.

## Measured

| | narrated 1923 | music 1923 | **1929** |
|---|---|---|---|
| runtime | 78.3 s | 50.3 s | **49.7 s** |
| picture cuts | 25 | 38 | **36** |
| hard cuts (scene > 0.20) | 8 | 24 | **21** |
| mean frame delta | 0.67 % | 0.94 % | **1.03 %** |
| reference reel | — | — | 1.88 %, 37 hard cuts |

`check` returns `unevaluated` with `skipped: [speech-masked, bed-too-quiet]` and **zero
findings**. Both skips are structural: they measure a voice against a bed and there is no voice.

## Two things still wrong

- **The frame delta gap is content, not structure.** The cut rate matches the reference (36
  changes against its 37); the reference is moving archival film and this is stills, which hold
  still between cuts.
- **There is no chart.** The strongest image for "By 1932 the Dow sank from 381 points to 41"
  would be the line itself, and Commons has no period Dow chart in the public domain — the only
  falling-line image it offered was a 2025 index screenshot. The number lives in the text and the
  picture carries the mood instead. Drawing the chart natively with `add_shape` and `animate` is
  the obvious fix and is not done.
