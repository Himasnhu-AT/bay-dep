# Cuts, transitions and camera

The grammar of seams. This is where "a pile of slides" becomes "one continuous film," and it is
the single largest craft gap between bay's current output and professional motion graphics.

---

## 1. The classic cuts

| Cut | What it is | Why it works |
|---|---|---|
| **Cut on action** | cut mid-movement to another angle that continues the same movement | the movement bridges the seam and the eye never registers the cut — the workhorse of invisible editing |
| **J-cut** | the *next* shot's audio starts before its picture | the ear arrives first; conversations stop ping-ponging |
| **L-cut** | the *previous* shot's audio continues over the next picture | reaction and continuity; the most natural way to leave a scene |
| **Match cut** | frame the same shape/position across a jump in place or time | the composition is the bridge; reads as travel through time |
| **Smash / hard cut** | no softening at all | disruption, register change, comedic timing, rapid-fire lists |
| **Cross-dissolve** | overlap and blend | "this continues," a passage of time, a soft register shift |

**Choosing the cut point:** align the edit with the soundtrack's natural movement, the dialogue,
or the beat. Cut before an action completes and it feels unfinished; hold too long after and
momentum drains. Cut at the natural end of an action or a sentence.

---

## 2. Velocity-matched cuts — the technique that fixes "slideshow"

The single underlying principle behind all of the following: **cut at peak velocity, match
direction and speed on both sides of the cut.** The differences between the variants are only
axis, scope and granularity.

The reason this matters: a static composition cutting to another static composition reads as
two slides no matter how nice each is. A cut taken while both sides are moving in the same
direction at the same speed reads as **one camera continuing through the content.**

### Cut the curve (the default for scene-to-scene)

The outgoing hero accelerates in one direction, the cut lands mid-motion, the incoming hero
enters *continuing the same direction* and decelerates.

| Direction | A exits | B enters from | B ends |
|---|---|---|---|
| Leftward | `x: 0 → −230` | `x: +230` | `x: 0` |
| Rightward | `x: 0 → +230` | `x: −230` | `x: 0` |
| Upward | `y: 0 → −230` | `y: +230` | `y: 0` |

**Velocity matching via mirrored eases:** exit on `power4.in`, entry on `power4.out`, with the
*same distance and duration*. Mathematically these are the two halves of one `power4.inOut`, so
the entering element picks up at exactly the velocity the exiting one left at (≈ 3,070 px/s for
230 px over 0.3 s, on both sides).

**The fade trick:** the exit's opacity completes at ~25–30% of its travel (fade ≈ 0.18–0.3 s
against a 0.3–0.34 s move) — the element vanishes while still visibly accelerating, so nothing
has to reach the frame edge. Entry fades in fast from ~0.35 opacity under its deceleration.
Time the last fading element to die **right at the cut** — a gap where nothing is moving reads
as dead air.

Rules: same direction both sides · mirrored `.in`/`.out` · exit 0.2–0.4 s, entry ≥ exit ·
partial travel plus fade, never full off-screen moves.

### Zoom-through (within-scene swaps, Z axis)

You **never see both texts at once.** The outgoing scales toward the viewer while accelerating;
blur and opacity peak at the cut, hiding a hard swap; the incoming continues scaling up from
behind, decelerating into the focal plane.

- **Exit:** scale 1.0 → 1.2, blur 0 → 10 px, opacity 1.0 → 0.15. Scale/blur on `power3.in`;
  **opacity on a separate linear tween** (sharing `power3.in` keeps opacity near 1.0 for most
  of the move and the dimming reads uneven). Duration 0.2 s.
- **Cut:** at peak velocity and peak blur. Outgoing → opacity 0 instantly; incoming set to
  opacity 0.15, scale 0.75, blur 10 px. Blur, opacity and *scale direction* all match at the
  cut frame.
- **Entry:** scale 0.75 → 1.0, blur 10 → 0, opacity 0.15 → 1.0, `expo.out`, 0.5 s.

### Inverse zoom-through (arrival / payoff beats)

The mirror: the outgoing element **recedes** (1.0 → 0.8) and the incoming arrives **oversized**
(1.25 → 1.0), as if it had been just behind the camera. Forward zoom-through reads as
*progressing through* content; inverse reads as *arriving at* content — right for a payoff line
or a held end state.

### Waterfall cut (text-to-text, per word)

Cut-the-curve at word granularity. Each outgoing word ramps out on `power4.in` (barely creeps,
then rips) over 0.34 s, fading in 0.18 s so it dies ~25–30% into its travel; stagger in reading
order ~0.022 s/word, timed so the **last** word finishes fading exactly at the cut. Each
incoming word enters from +230 at 0.35 opacity on `power4.out`, with **shrinking** stagger gaps
(start 0.05 s, ×0.84 per word) so the cascade accelerates across the line.

### Blur logic (all Z-axis variants)

Blur sells the speed, but it must scale with subject size:

| Subject | Peak blur | Why |
|---|---|---|
| Text (headline, line, word group) | **10 px** | at 20 px letterforms smear; the eye loses the word it was tracking and the cut reads as a glitch |
| Full-frame surface (window, card, screenshot) | **18–20 px** | big textured surfaces survive heavy blur; light blur on a full-frame move reads as a rendering hiccup |

Both sides of a cut use the **same** peak blur. Apply blur to the wrapper, never to individual
children.

### Choosing at a seam

- **Unfinished phrase** (one idea continuing across visually distinct scenes) → cut-the-curve /
  waterfall.
- **State change** (a new chapter — most often hook → context) → zoom-through.
- **Arrival / payoff** → inverse zoom-through.
- **Parallel co-equal items** (list) → hard cut, or a consistent directional push.

### Anti-patterns

| Don't | Why | Instead |
|---|---|---|
| Two texts visible during a zoom-through | breaks the Z illusion | hard cut at the blur peak |
| 20 px blur on text | letterforms smear, reads as a glitch | 10 px for text |
| Elements on different paths across a cut | the eye tracks one direction, the cut goes another | same property, same direction |
| Mismatched blur/opacity at the swap | visible flash or brightness jump | identical values at the cut frame |
| Gentle entry ease after a hard exit | entry feels slower than the exit | mirror the exit (`power4.out` / `expo.out`) |
| Full off-screen exits and entries | wastes time, breaks the speed illusion | partial travel plus early fade |
| A lone element fading long before its cut | dead air at the seam | end the fade ~0.02 s before the cut |
| Zoom-through on body text | small text at 0.75 scale is unreadable | headlines and short phrases only |

---

## 3. Transition taxonomy

A working catalog, roughly ordered by how mechanical the effect is. Useful both as a menu and
as a specification of what a transition *library* would need to contain.

| Category | Patterns | Motion character |
|---|---|---|
| **Push / slide** | push slide, vertical push, elastic push, squeeze | content moves through the frame as one continuous surface |
| **Scale / zoom** | zoom through, zoom out | perspective shift — toward or away from content |
| **Radial / clip** | circle iris, diamond iris, diagonal split | geometric reveal — a shape uncovers or covers |
| **3D** | card flip | physical — content flips like an object |
| **Dissolve** | crossfade, blur crossfade, focus pull, colour dip | overlap and blend; both scenes exist during the seam |
| **Cover / blinds** | staggered colour blocks, horizontal/vertical blinds | structural — the frame is sliced or covered |
| **Light** | light leak, overexposure burn, film burn | organic film — light bleeds across the frame |
| **Distortion** | glitch / RGB split, chromatic aberration, ripple, VHS | instability — the image malfunctions |
| **Blur** | blur through, directional blur | soft defocus |
| **Mechanical** | shutter, clock wipe | visible mechanical logic |
| **Grid** | grid dissolve | fragmentation |
| **Whip pan** | horizontal motion blur + lateral crossfade | reads as a camera panning between shots |

Timing presets: instant 0.15 s · snappy 0.2 s · smooth 0.4 s · dramatic 0.5 s · gentle 0.6 s ·
luxe 0.7 s.

**Budget:** a 5–7 beat reel wants **one or two** hero transitions (the reveal and the CTA).
More than that and they flatten each other. Everything else is a cut, a dissolve, or a
velocity-matched seam. If the beat is the centrepiece, make the transition an event; if the
beat is connective tissue, a crossfade is fine.

---

## 4. Camera

A "camera" in a compositor is a transform applied to the whole scene (or a `world` wrapper
containing it), not a separate object. Moves worth having a name for:

- **Push / pull** — slow scale on the root. The cinematic baseline. Use *once*, early; a push
  in the back half of a shot disrupts the sightline (§02, rule 3).
- **Zoom-to-target** — scale plus counter-translation so a non-centred element stays framed.
  The counter-translate is `T = −offset × S` when the whole world scales.
- **Pan / focus-lock** — the viewport transforms to bring a region into frame and holds.
- **Cursor / subject tracking** — the framing locks to a moving focal point.
- **Multi-phase** — pull-back → focus → push as one sequence, plus a continuous micro-drift.
- **3D flight** — perspective plus rotation on a `preserve-3d` world; dive into an angled grid,
  tilt-to-flatten, fly past standing cards, decelerate into focus.
- **Rack focus / depth-of-field** — blur the off-focus subset while the focal element stays
  sharp. The cheapest way to make a flat composition read as having depth.

### Parallax and depth

Depth is what separates a composited frame from a layout. Cheap, high-yield sources of it:

- **Differential motion.** Background moves less than midground moves less than foreground.
  Even a few percent difference reads.
- **Depth of field.** Off-plane layers blurred, focal plane sharp.
- **Scale + shadow.** A perspective tilt with a soft drop shadow makes a flat image an object.
- **Occlusion.** Something in front of something else. A headline passing *behind* a subject is
  worth more than any filter.
- **Atmosphere.** A vignette and a light gradient tell the eye where the light is (see §06).

---

## Sources

- [Cuts in film — Adobe](https://www.adobe.com/creativecloud/video/post-production/cuts-in-film.html)
- [Cutting on action — Wikipedia](https://en.wikipedia.org/wiki/Cutting_on_action)
- [9 Most-used Cuts in Video Editing — invideo](https://invideo.io/blog/video-editing-types-of-cuts/)
- [17 foundational editing techniques — LucidLink](https://www.lucidlink.com/blog/editing-techniques)
- [Eight Essential Cuts Every Video Editor Needs to Know — No Film School](https://nofilmschool.com/essential-cuts-every-video-editor-needs-know)
- Encoded practice: `~/.claude/skills/faceless-explainer/references/cut-catalog.md`,
  `~/.claude/skills/hyperframes-creative/references/beat-direction.md`,
  `~/.claude/skills/hyperframes-animation/rules-index.md`
