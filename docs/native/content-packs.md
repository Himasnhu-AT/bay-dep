# Content packs — what bay may ship, and what it may not

Looks, templates and motion-graphics sound are **generated**, not downloaded. Recorded audio —
a door, a room tone, a real crowd — cannot be, and that is the only thing this document is
about: the licence rules a downloadable pack has to clear before it can exist.

Written after checking the actual licence text of the obvious sources, because "free music" and
"free sound effects" are marketing categories, not licences, and most of them forbid the one
thing a pack does.

---

## The question that decides everything

Not *"can I use this in a video?"* — almost everything says yes to that.

**"May bay redistribute the file?"** A pack is bay handing the user a copy of someone's
recording. That is a much narrower permission, and it is the one most "royalty-free" sites
explicitly withhold.

---

## What the licences actually say

| Source | Verdict | Why |
|---|---|---|
| **Pixabay** | ✗ Cannot ship | "You cannot sell or distribute Content (either in digital or physical form) on a **Standalone** basis." A bundled pack is exactly that. Fine for a user to download themselves and import; not something bay may hand them. |
| **Unminus** | ✗ Cannot ship | "Music cannot be offered or sold without significant modification", and the licence expressly bars compiling its songs into another service. |
| **YouTube Audio Library** | ✗ Cannot ship | Grants use *in videos*, not redistribution of the files. |
| **Freesound**, CC0 filter | ✓ Per track | Licences are per upload. The CC0 subset is genuinely public domain and redistributable; everything else on the site is not, so a pack must be built track by track, not scraped. |
| **Kenney** ([UI Audio](https://kenney.nl/assets/ui-audio), [Interface Sounds](https://kenney.nl/assets/interface-sounds)) | ✓ Can ship | ~150 CC0 interface sounds — clicks, switches, confirmations. Explicitly public domain, explicitly redistributable. The cleanest starting point for recorded UI sound. |
| **Free Music Archive**, CC0 filter | ✓ Per track | ~3,500 public-domain tracks. FMA cautions that its own public-domain metadata "should not be considered authoritative", so each track needs checking rather than trusting the filter. |
| **Musopen** | ✓ Per track | CC0/PD classical recordings. Genuinely free; wrong genre for most short-form video. |

## The two licences a pack may use, and the two it may not

**Allowed:**

- **CC0** — the clean case. No attribution, no conditions, redistribution explicit.
- **CC BY** — redistribution explicitly permitted *with attribution*. A bundled credits file
  satisfies it, which is what most software does, and it opens up most of FMA.

**Refused, and the second one is not obvious:**

- **NC (non-commercial)** — bay's users may be commercial. Shipping them a bed they are not
  allowed to use commercially is handing them a trap.
- **ND (no derivatives)** — *unusable in an editor at all.* Trimming a track to length and
  fading it is a derivative work. Shipping ND audio in a video editor means shipping audio the
  editor is not permitted to edit.
- **SA (share-alike)** — viral onto the user's finished film. Not bay's licence to impose.

This should be enforced the way the runtime manifest already enforces immutable URLs and
redistributable licences: as a **test**, so a pack entry with the wrong licence is a build
failure rather than a discovery someone makes later.

---

## Why the sound effects are synthesised instead

`bay_audio::sfx` generates whooshes, risers, sub-drops, impacts, clicks, ticks and pops. Not as
a licensing dodge — for these specific sounds it is the better answer, and it is how they are
made in a real library anyway. A whoosh *is* filtered noise with an envelope; a riser *is* a
noise sweep.

The argument that settles it is timing. **A whoosh has to be exactly as long as the move it
covers.** A downloaded 0.6s whoosh under a 0.35s dissolve is either clipped or trailing, and
the fixes are to retime the edit around the asset or to stretch the asset and shift its pitch.
A synthesised one is rendered at the length asked for. A fixed file cannot do that, however
good the recording is.

The same reasoning is why the looks are generated: nothing downloads, nothing needs a licence,
nothing can go missing, and a grade can be dialled back by amount rather than re-authored.

Where synthesis genuinely cannot help — a real door, real footsteps, real room tone — a pack is
the right answer, and the rules above are what it has to clear.

---

## What is shipped today

| | |
|---|---|
| **Synthesised** | 13 sounds in `bay_audio::sfx` — whoosh, reverse whoosh, riser, sub-drop, impact, click, tick, pop, chime, error, beep, glitch, swell. No download. Rendered at whatever length the edit needs. |
| **Recorded** | The `sfx` component: Kenney's Interface Sounds (100) and UI Audio (52), CC0, ~1.2 MB installed. Fetched only when asked, digest-pinned, and each pack ships its own `License.txt` so the licence is checkable from the install rather than from a web page that may not exist in five years. |

Both halves are searched by one tool (`sfx_search`), because an author looking for a click does
not care which half it comes from — and asking them to search twice would mean discovering the
packs only if they already knew packs existed.

Adding the 151st recorded sound is a file in a pack, not a function. That is the whole reason
the recorded half is an index rather than code.

## If a music pack is wanted

The mechanism is settled: `bay-provision` already fetches pinned, SHA-256-verified archives
from immutable URLs and refuses anything without a redistributable licence. A pack is a
manifest entry, not new plumbing.

The open decision is sourcing, and it is a judgement call rather than an engineering one:

- **A small hand-verified CC0 set** — perhaps 20–30 beds. High confidence, no attribution
  surface needed, slow to assemble because every track is checked individually.
- **A larger CC BY set** — much faster to build and far more variety, but it needs attribution
  plumbing: per-track credit stored in the pack, surfaced in the app, and carried into whatever
  the user exports if they want it.

Both are viable. Neither should start before someone decides which.
