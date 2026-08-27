# Choreography — three or more items at once

One element arriving is an animation problem. Six arriving together is a *choreography* problem,
and it is the one an agent reliably gets wrong: it staggers a fade across six cards, satisfies
every rule it was given, and produces a grid.

**The pattern is the message.** Abundance, breadth, ordered progression, assembly, choice — the
collective motion says which one before any word does. Pick the pattern from what the beat means,
not from what looks busy.

Four principles under all of it:

- **Stagger, never synchronise.** Simultaneous arrival has no reading order. The group moves
  carry their own stagger; `animate_many` lets you override `stagger` and `decay` when the beat
  needs a different rhythm. `decay` below 1 accelerates the cascade — that is the difference
  between a wave and a conveyor belt.
- **Common fate, then break it.** Items moving alike are read as one group. The one that moves
  differently becomes the subject instantly. That is the cheapest focal point in the medium.
- **Z-hierarchy.** The hero is bigger, sharper, faster, in front. Supporting items are smaller,
  dimmer, slower. Depth without 3D.
- **Transformation beats translation.** Something that scales up from a point was always there,
  waiting. Something that slides in came from off-screen. The first is nearly always the better
  read, which is why `swell` and `press` outrank `sweep` for a reveal.

---

## The ten patterns in bay

| Pattern | Says | In bay |
|---|---|---|
| **Staggered cascade** | ordered progression, momentum | **Native.** `cascade` — importance order, accelerating. |
| **Wave** | equal weight, breadth | **Native.** `wave` — 8–14 items, even gaps. |
| **Grid reveal** | completeness, a catalogue | **Native.** `wave` via `animate_many`; the reveal direction is the *order you pass the ids* — row-major, diagonal, or spiral, all free. |
| **Converge to hero** | unity, assembly, "it comes together" | **Native.** Place items at rest, then `animate` each with the entrance whose travel points inward — `sweep` left for the right-hand items, `drop` for the top row. Per-item direction is the whole trick. |
| **Counter-scroll** | variety, richness | **Native as an arrival.** `counter-cascade` alternates sides. As a *continuous* scroll, see below. |
| **Parallax layers** | depth, immersion | **Native.** `drift` on each depth at its own start, `push-in` on a `group_create` over the lot. The group is the camera. |
| **Fan / spread** | options, choice | **Partial.** `counter-cascade` gives the spread. There is no per-item rotation fan — the rotation moves carry fixed amplitudes. Spread without the fan reads fine; a fan faked with hand keys does not. |
| **Radial burst** | impact, everything at once | **Substitute.** Position items radially, then `swell` them staggered — they arrive from behind, out of the centre's depth rather than travelling out of its middle. Real outward travel needs a per-item vector, which is off-vocabulary. The substitute reads as a burst; take it. |
| **Perspective wall** | scale, a premium gallery | **Substitute.** Rotation is z-only, so there is no tilted plane. Fake the recession: each row up is smaller, dimmer and `drift`s slower. That is parallax standing in for perspective and it is convincing at these durations. |
| **Orbital float** | ecosystem, satellites | **Not buildable.** There is no circular path; `drift` and `creep` are linear. Do not approximate an orbit with keyframes — say so and build a living constellation instead: items around the hero, each `drift`ing on a different axis with a `tilt` accent, the hero on a slow `push-in`. |

## Infinite marquee — the one honest exception

A seamless loop needs the row to travel *exactly* its own width and wrap. `drift`'s amplitude is
fixed by the registry, so it cannot be tuned to the wrap distance, and two rows offset by an
approximate width will visibly jump.

This is the case where hand keyframes are the right answer rather than laziness: two copies of
the row, a linear `x` from 0 to `-rowWidth` over the loop, the second offset by `+rowWidth`.
`off-vocabulary-motion` will report it. **Say in your delivery note that it did, and why** — the
report is not a failure, it is the record that you left the vocabulary deliberately.

Everything else in this table stays inside it.

## Choosing

If a beat shows more than three items and you cannot name which pattern it uses, it does not have
one, and it will render as a grid with a stagger. Go back to the storyboard entry and pick.

Two consecutive beats may not use the same pattern. That is not a style rule — a film whose every
group arrives the same way has told the viewer that its groups are interchangeable.
