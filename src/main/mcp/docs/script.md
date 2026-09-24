# The Script surface

`read_script` hands you the active timeline as a markdown document. You edit the text and pass the
whole thing to `apply_script`; bay works out what changed and applies it as **one undo step**. Use
it when an edit touches many clips — tightening a cut, reordering shots, rewording every title —
instead of one tool call per clip.

## What it looks like

```
# Script · Interview

timeline: tl_mf3k2a
rev: 3b1f09ac
fps: 30
ripple: off

## V1 · video · [trk_mf3k2a1]
- [itm_mf3k2a5x] 00:00:00:00 → 00:00:02:15 · goodall.mp4 · src 12.400s
  ~ [trn_mf3k9q] cross-dissolve 30f · itm_mf3k2a5x → itm_mf3k2a7p
- [itm_mf3k2a7p] 00:00:02:15 → 00:00:05:00 · broll.mov · src 0.000s

## V2 · video · [trk_mf3k2a2]
- [itm_mf3k2b0c] 00:00:01:00 → 00:00:03:00 · text · "Jane Goodall"

## A1 · audio · [trk_mf3k2a3]
> (no clips)
```

- **The header** (`timeline`, `rev`, `fps`) must come back exactly as it was. `rev` fingerprints
  the timeline you read: if anyone changes it before you apply, the whole script is refused and
  you read it again, rather than your stale timecodes quietly moving their clip back.
- **One section per track**, in stacking order, headed `## name · kind · [id]`. Every section
  must stay, even if you empty it — a missing section is refused, never read as "delete
  everything on that track".
- **One line per clip**, in timeline order: `- [id] in → out · source · src <seconds>s`.
  - `in` is the first frame shown and `out` the **first frame after** the clip, so a clip's `out`
    equals the next clip's `in` when they touch — the same half-open rule as `remove_range`.
  - Timecodes are `hh:mm:ss:ff` at the timeline's nominal rate (29.97 counts 30 frames a second,
    as every NLE does). A bare frame number such as `75f` is accepted anywhere a timecode is.
  - `src` is where in the source file the clip is reading at `in`, in seconds. Stills (images,
    text) have no source time and no `src`.
  - A text clip ends with its text as a JSON string: `"Line one\nLine two"`.
  - `@2x` after the source name means the clip plays at that speed.
- **Transitions** are `~ [id]` lines under the clip they leave.
- Lines starting with `>`, blank lines and `---` are ignored. Anything else is refused.

## The edits, and exactly what each does

| You change | bay does |
| --- | --- |
| delete a clip line | removes the clip and leaves a gap |
| delete it with `ripple: on` in the header | removes it and slides later clips **on that track** back to close the gap. Other tracks do not move, so they can drift out of sync — the result names them. To cut time without losing sync, use `remove_range` instead. |
| reorder lines within a track | lays that track's clips end to end in the new order, starting where its first clip started. Gaps on that track close. |
| `in` and `out` by the same amount | moves the clip; same length, same picture |
| only `in` | head trim: the source advances with it, so every frame still shown shows what it did |
| only `out` | tail trim |
| `in` and `out` by different amounts | **refused** — a move plus a trim, but it is not clear which source frame should now play at `in`. Also change `src` to say so, or do it in two applies. |
| `src` (with or without the timecodes) | the line is read literally: the clip spans `in → out` and plays the source from `src`. A slip, or any trim written out in full. |
| the quoted text of a text clip | rewrites the words. If another clip shares that text, this clip gets its own copy; the other is untouched. |
| delete a `~` line | removes that transition; the cut is straight again |

Several edits in one script are fine — they are applied together and undone together. On a track
whose lines you reordered, don't also change timecodes: positions there come from the order, and
the combination is refused rather than half-honoured. Reorder in one apply and retime in the next.

## What is refused

Every refusal names the line and says what to do instead, and a refused script changes nothing.

- A line with no `[id]` — a script cannot add clips. Use `place_asset`, then read the script again.
- An id that is not on the timeline, or a prefix that matches several.
- A clip line moved into another track's section — use `edit_item` with `trackId`.
- A changed source name or speed — use `place_asset` or `edit_item`.
- An edited track header, reordered sections, or a missing section.
- An edited transition line — keep it or delete it; use `add_transition` to change one.
- Any change to a clip on a locked track.
- An edit that would make two clips on one track overlap, trim before the start of a source, or
  run past its end. The refusal gives the frame that would fit.

## Transitions and broken cuts

A transition belongs to the cut between two clips. If your edit means those two clips no longer
touch — one was deleted, trimmed away from the other, or reordered elsewhere — the transition is
**removed, and the result says so**. A reorder that brings two other clips together does not give
them a transition; that new cut is straight until you add one with `add_transition`.

## What comes back

`apply_script` returns one line per change — deleted, moved, trimmed, reordered, rippled,
retitled, transitions removed and why — and then the new script, so you can keep editing from it
without another read. The rev in that new script is current; the old one is not.

`apply_script` is a write. If the user has turned on "Ask before editing" in bay's agent panel,
propose it first: put the call in `propose_edit` with the **entire** script as its `script` argument, exactly as you will send it.
The approval matches the text byte for byte. For a long script, write it to a file and pass
`@./edit.md` — bay reads the file for you, both when you propose and when you apply, so leave the
file alone in between or the two will no longer match.
