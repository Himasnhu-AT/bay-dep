# Structure — beats, roles, the hold, the turn, the landing

**bay has no scene object.** No tool creates, splits or selects one, and `export_video` takes one
scene, so a project is one scene however long it runs. Structure is therefore expressed in *time*,
and the handle is `marker_add`. Place the markers before you place elements: `check` derives beats
from narration starts and markers, returns them in `stats`, and every pacing, continuity and mix
rule is evaluated against them. Beats you did not declare are beats the engine guessed.

The one structural fact worth more than the rest: **a video is not a stack of slides.** The unit
is not the beat, it is the *seam* between two beats — what persists, what changes, and what the
change means. A piece where every beat is built from nothing and torn down is a carousel, and it
reads as one whatever is on the cards.

## Roles

`add_text` and `add_shape` take a `role`. It is not a label — it selects the type tier and the
weight from the kit, and it partitions every distribution `check` computes. Getting it wrong is
how a decorative tick gets measured as the hook.

| role | what it is | one per |
|---|---|---|
| `hook` | the proposition the first moment makes. A few words, containing a verb or a number | video |
| `headline` | what this beat asserts | beat |
| `kicker` | the small line that frames the headline | beat |
| `label` | names a thing on screen — an axis, a part, a quantity | as needed |
| `data` | a value the viewer is meant to read as a value | as needed |
| `caption` | set by `narrate`; never author one, and never place an element at a caption id | — |
| `lockup` | the terminal mark | video |
| `ground` | the field everything sits on. Must cover most of the canvas | scene |
| `chrome` | rules, ticks, frames — furniture that is not content | sparingly |

`ground` and `chrome` are capped as a share of elements. They are the exemption from the
contrast floor, so an uncapped exemption is just the floor deleted.

## Beats

- **Declare them.** `marker_add` at each beat, and specifically at the turn and the payoff. The
  payoff marker must exist *before* any audio element does — the mix gate asks whether the
  loudest moment lands on it, and a marker placed afterwards answers a question you already knew.
- **Count and length come from `check`,** which knows the runtime. It wants more beats than a
  long-form piece would use, a spread rather than a uniform grid, and no single beat eating a
  quarter of the piece. Ask it rather than guessing; it will name the floor it applied.
- **A beat holds at least as long as its text takes to read.** `unreadable-dwell` does that
  arithmetic from the string itself, so let it, and fix with `element_trim`.
- **Nothing rewards length.** A shorter cut of the same material passes everything the long one
  passes and is usually better. Runtime is the one axis no check applies pressure on, which means
  it is yours to apply.

## The seam

Between two consecutive beats, **at least one element id survives and changes**. This is
`broken-continuity`, and it cannot be faked: element identity across time is a fact in the file.

- Carry it with `animate` — move it, resize it, reposition it. Keep the id.
- `transform_set` and `text_update` change an element in place, keeping id and animation.
  `element_trim` extends it across the seam. `element_duplicate` when the new beat genuinely needs
  a second copy of a thing rather than a rebuild.
- **Never delete-and-re-add to change a beat.** You lose the id, the animation, and the seam.
- Passing this rule *reduces* element count. That is the point: the previous version of this
  skill asked for layers and got 46 shapes, half of them invisible.

## Response — the frame reacts to its own events

When something arrives, something already on screen answers within a few frames: it moves or it
changes size. Not opacity — a fade is not a reaction, it is a second arrival. Not the arriving
element's own stagger group. Not the same element every time.

The call is `animate` on the incumbent, with a positional or scale move from the registry. This is
`no-response`, and it is the rule that turns a stack of slides into a composition — because it
forces the existing frame to make room for the new thing, which is what a designer does by hand.

## The hold

**Silence over motion is a beat. Silence over a still is dead air.** Both look identical in the
project file and completely different on screen, which is why `frozen` measures the picture rather
than the timeline: it asks whether the arrangement of things on screen changed, so a slow drift, a
breathing scale or a hue shift does not count. Drift buys ambient liveness and nothing else.

Hold deliberately and rarely: one real hold buys the reveal after it. Many holds are a piece that
ran out of material. If a stretch has no voice, give it the largest picture move in the video —
that is what a hold is *for*, and it is the cheapest strong moment available to you.

## The turn

The single instant the viewer's model updates: before it they believe one thing, after it they
believe another and know why. It sits a little past a third of the way in — late enough that the
first belief has been made worth overturning, early enough to build the corrected one.

Three things make it a turn rather than a paragraph break, and all three are calls:

- **It is the shortest beat in the piece.** `element_trim` the elements around it.
- **The voice gets a handful of words, or none.** After a long line, a short one is itself the
  signal — `narrate` a separate short clip rather than running it into the previous sentence.
- **It is staged unlike its neighbours.** At least three of these inside one window: the largest
  element changes size sharply (`animate` a scale move); the composition's centre of mass moves
  (`animate` positional moves, or `element_delete` what is no longer needed); the accent tone
  appears where it has not been (`add_shape(tone: "accent")`); the number of text objects on
  screen drops to one or none; the bed drops and returns (`audio_set` or a volume move); one
  transient lands above the bed (`sfx_add`).

The last of those is the one agents avoid, because it means deleting text at the most important
moment. It is also the one that works.

## The landing

The final seconds are the highest-retention real estate in the piece, and the frame a looping
viewer sees twice.

1. **Restate one thing** — a few spoken words, or one glyph, or both. Not a summary.
2. **Complete a motion.** The last move should finish shortly before the cut. Ending on a frame
   that has been static reads as the file running out rather than the piece ending.
3. **Close the loop.** Return to the hook's exact framing, or arrive at a composition used nowhere
   else. Returning to the middle of the piece is neither.
4. **Add something.** The terminal seconds must contain at least one element or token that appears
   nowhere earlier. A recap card of things already shown is bookkeeping.
5. **`role: "lockup"`** — one text object at the kit's largest tier, one accent on the one thing
   it refers to, and nothing that has to be read for the first time.

No citation card: sources go in the post description, or as a brief credit *during* the body at the
moment the sourced number is on screen. A call to action only when there is a specific named next
action — otherwise a callback to the hook is a stronger ending and costs no time.
