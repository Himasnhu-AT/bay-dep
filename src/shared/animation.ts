/**
 * Animation presets: an In, an Out and a Loop a clip wears, as data.
 *
 * **Declarative, and evaluated by the keyframe sampler.** A preset is stored as what was chosen —
 * `{ in: { kind: 'slide', from: 'left', frames: 15 } }` — never as generated keys, and
 * `animatedItemAt` (`@shared/keyframes`) resolves it at draw time. So there is no second animation
 * system: the compositor paints one item, already animated, in preview, `preview_frame` and
 * export alike. Stored rather than baked because a baked In is a list of keys at frames 0..15 that
 * a trim of the head leaves behind; a declared one is measured from wherever the head is now.
 *
 * **Glued to the ends.** The In runs over the clip's first `frames`, the Out over its last, the
 * Loop throughout. Trim either end and they stay there. Split a clip and the left half keeps the
 * In, the right half the Out (`splitAnimation`).
 *
 * **Shorter than its presets.** When In and Out together are longer than the clip they share it
 * in proportion and meet without overlapping (`animationWindows`): 30 + 30 on a 40-frame clip
 * plays 20 and 20. One alone is capped at the clip's length.
 *
 * **Over the keys, not instead of them.** A preset is relative to whatever each property is at
 * that frame — keyed or static. Opacity and scale multiply; position, rotation and blur add. A
 * push-in keyed on `scale` with a Pop in arrives popping *and* pushing; neither silences the
 * other, and removing the preset leaves the keys exactly as they were.
 *
 * **A transition wins at its cut.** Where a transition crosses a clip's head, its In is set aside
 * (and its Out at a crossed tail): both say how the clip arrives, the transition draws the clip
 * before its own first frame, and an In still at "not here yet" would hide half the dissolve.
 * `animationForDraw` is that rule, the picture's twin of the fade rule in `@shared/audio-gain`.
 *
 * The curves are the move library's (`./motion/core`): measured eases and the closed-form spring.
 */

import { EASES, clamp, lerp, spring } from './motion/core'
import { adjustmentsOf, type Frames, type Item, type Timeline } from './project'

export const ANIMATION_KINDS = ['fade', 'slide', 'scale', 'pop', 'rise', 'blur', 'wipe', 'typewriter'] as const
export type AnimationKind = (typeof ANIMATION_KINDS)[number]

export const LOOP_KINDS = ['pulse', 'float', 'sway', 'flicker'] as const
export type LoopKind = (typeof LOOP_KINDS)[number]

export const ANIMATION_SIDES = ['left', 'right', 'top', 'bottom'] as const
export type AnimationSide = (typeof ANIMATION_SIDES)[number]

/** What moves: the whole clip, or — a title only — each line, word or letter in turn. */
export const ANIMATION_UNITS = ['clip', 'line', 'word', 'letter'] as const
export type AnimationUnit = (typeof ANIMATION_UNITS)[number]

export interface AnimationSpec {
  kind: AnimationKind
  /** How long it runs, in timeline frames, from the head (In) or to the tail (Out). */
  frames: Frames
  /** `slide`, `wipe`: the side it comes in from (In) or leaves toward (Out). Absent is left. */
  from?: AnimationSide
  /** A title only: animate each line, word or letter in turn. Absent is the whole clip. */
  by?: AnimationUnit
  /**
   * How far, in the kind's own unit: `slide` a fraction of the box (0.25), `scale` the size it
   * starts at (0.8), `blur` canvas pixels (24). Absent is the default in brackets.
   */
  amount?: number
}

export interface LoopSpec {
  kind: LoopKind
  /** One cycle, in timeline frames. */
  frames: Frames
  /** `pulse` a fraction of size (0.04), `float` of height (0.03), `sway` degrees (2), `flicker` of opacity (0.35). */
  amount?: number
  /** A title only: each unit runs the cycle a little after the one before — a wave. */
  by?: AnimationUnit
}

export interface ItemAnimation {
  in?: AnimationSpec
  out?: AnimationSpec
  loop?: LoopSpec
}

// ---------------------------------------------------------------------------
// The catalog — what each preset is, as data the tool description and the inspector both read
// ---------------------------------------------------------------------------

export interface PresetInfo {
  label: string
  /** What it looks like, as an In. */
  description: string
  /** Whether `from` applies. */
  sided: boolean
  /** Which units it can run by. `clip` alone means it has no per-word form. */
  units: readonly AnimationUnit[]
  /** Only a title can wear it. */
  textOnly: boolean
  /** What `amount` means and its default, when the kind has one. */
  amount?: { meaning: string; default: number; min: number; max: number }
  /** A length that suits it, in seconds. */
  seconds: number
}

const ALL_UNITS = ANIMATION_UNITS
const CLIP_ONLY = ['clip'] as const

export const ANIMATION_PRESETS: Record<AnimationKind, PresetInfo> = {
  fade: { label: 'Fade', description: 'Opacity from nothing. The picture only — sound keeps its own fades.', sided: false, units: ALL_UNITS, textOnly: false, seconds: 0.4 },
  slide: {
    label: 'Slide',
    description: 'Travels in from a side, fading up as it comes.',
    sided: true,
    units: ALL_UNITS,
    textOnly: false,
    amount: { meaning: 'distance as a fraction of the box (of the type size, by word or letter)', default: 0.25, min: 0.02, max: 2 },
    seconds: 0.5
  },
  scale: {
    label: 'Scale',
    description: 'Grows to size from a little smaller (or shrinks from larger), fading up.',
    sided: false,
    units: ALL_UNITS,
    textOnly: false,
    amount: { meaning: 'the size it starts at, 1 being full size', default: 0.8, min: 0, max: 3 },
    seconds: 0.45
  },
  pop: { label: 'Pop', description: 'Springs up from nothing and overshoots a little before it settles.', sided: false, units: ALL_UNITS, textOnly: false, seconds: 0.5 },
  rise: {
    label: 'Rise',
    description: 'Rises into place from below through a mask, so it appears from an edge rather than from off screen. By line or word on a title, each rises out of its own line.',
    sided: false,
    units: ALL_UNITS,
    textOnly: false,
    seconds: 0.6
  },
  blur: {
    label: 'Blur in',
    description: 'Resolves out of a blur as it fades up.',
    sided: false,
    units: ALL_UNITS,
    textOnly: false,
    amount: { meaning: 'the blur it starts at, in canvas pixels', default: 24, min: 1, max: 200 },
    seconds: 0.5
  },
  wipe: { label: 'Wipe', description: 'Revealed by an edge crossing it from a side; nothing moves.', sided: true, units: CLIP_ONLY, textOnly: false, seconds: 0.5 },
  typewriter: { label: 'Typewriter', description: 'A title only: its letters appear one after another, with no fade.', sided: false, units: ['letter'], textOnly: true, seconds: 1 }
}

export const LOOP_PRESETS: Record<LoopKind, { label: string; description: string; amount: { meaning: string; default: number; min: number; max: number }; seconds: number }> = {
  pulse: { label: 'Pulse', description: 'Breathes a little larger and back.', amount: { meaning: 'a fraction of its size', default: 0.04, min: 0.005, max: 0.5 }, seconds: 1.2 },
  float: { label: 'Float', description: 'Drifts up and down. By word or letter on a title, a wave.', amount: { meaning: 'a fraction of its height (of the type size, by word or letter)', default: 0.03, min: 0.002, max: 1 }, seconds: 2 },
  sway: { label: 'Sway', description: 'Tilts a few degrees each way.', amount: { meaning: 'degrees', default: 2, min: 0.1, max: 45 }, seconds: 2 },
  flicker: { label: 'Flicker', description: 'Opacity dips unevenly, like a failing tube. Deterministic, so an export repeats.', amount: { meaning: 'how far opacity dips, 0..1', default: 0.35, min: 0.02, max: 1 }, seconds: 0.5 }
}

/** The catalog in one paragraph, for a tool description: generated, so it cannot drift from the data. */
export function animationCatalogText(): string {
  const ends = ANIMATION_KINDS.map((kind) => {
    const info = ANIMATION_PRESETS[kind]
    const extras = [
      info.sided ? `from: ${ANIMATION_SIDES.join('|')}` : '',
      info.amount ? `amount: ${info.amount.meaning} (default ${info.amount.default})` : '',
      info.units.length > 1 ? 'by: line|word|letter on a title' : '',
      info.textOnly ? 'titles only' : ''
    ].filter(Boolean)
    return `"${kind}" — ${info.description}${extras.length > 0 ? ` [${extras.join('; ')}]` : ''}`
  })
  const loops = LOOP_KINDS.map((kind) => `"${kind}" — ${LOOP_PRESETS[kind].description} [amount: ${LOOP_PRESETS[kind].amount.meaning}, default ${LOOP_PRESETS[kind].amount.default}]`)
  return `In/Out kinds: ${ends.join(' ')} Loop kinds: ${loops.join(' ')}`
}

// ---------------------------------------------------------------------------
// When each one runs
// ---------------------------------------------------------------------------

export interface AnimationWindows {
  /** Frames the In actually gets. */
  inFrames: Frames
  /** Frames the Out actually gets. */
  outFrames: Frames
  /** True when either was shortened to fit the clip. */
  shortened: boolean
}

const wholeFrames = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0

/**
 * The frames the In and the Out get on a clip `duration` long. Each is capped at the clip; when
 * together they are longer than it they split it in proportion to what was asked, so they meet at
 * one frame and never play over each other.
 */
export function animationWindows(animation: ItemAnimation | undefined, duration: Frames): AnimationWindows {
  const askedIn = wholeFrames(animation?.in?.frames)
  const askedOut = wholeFrames(animation?.out?.frames)
  const length = Math.max(0, Math.round(duration))
  let inFrames = Math.min(askedIn, length)
  let outFrames = Math.min(askedOut, length)
  if (inFrames + outFrames > length) {
    inFrames = Math.round((length * askedIn) / (askedIn + askedOut))
    outFrames = length - inFrames
  }
  return { inFrames, outFrames, shortened: inFrames !== askedIn || outFrames !== askedOut }
}

// ---------------------------------------------------------------------------
// What a preset does to a clip at a moment
// ---------------------------------------------------------------------------

/** Fractions of the clip's box hidden from each side; all zero is "clipped to the box itself". */
export interface RevealInsets {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * A preset's effect, relative to the clip at rest. `dx`/`dy` are fractions of the box's width and
 * height for a whole clip, and of the type size for a title's units.
 */
export interface AnimationState {
  opacity: number
  dx: number
  dy: number
  scale: number
  /** Degrees added. */
  rotation: number
  /** Canvas pixels added (fractions of the type size for a unit). */
  blur: number
  /** A mask over the clip's own box. Null is none. */
  reveal: RevealInsets | null
}

const REST: AnimationState = Object.freeze({ opacity: 1, dx: 0, dy: 0, scale: 1, rotation: 0, blur: 0, reveal: null })

const sideVector = (side: AnimationSide | undefined): { x: number; y: number } =>
  side === 'right' ? { x: 1, y: 0 } : side === 'top' ? { x: 0, y: -1 } : side === 'bottom' ? { x: 0, y: 1 } : { x: -1, y: 0 }

const amountOf = (spec: { kind: AnimationKind; amount?: number }): number => {
  const info = ANIMATION_PRESETS[spec.kind]?.amount
  if (!info) return 0
  const given = spec.amount
  return typeof given === 'number' && Number.isFinite(given) ? clamp(given, info.min, info.max) : info.default
}

/**
 * The state of one In at progress `p` — 0 not here yet, 1 at rest — for a whole clip (`unit`
 * false) or one unit of a title. An Out is the same state read at the progress it has left.
 * `arriving` picks the curve: a spring only makes sense on the way in.
 */
function endState(spec: AnimationSpec, p: number, unit: boolean, arriving: boolean): AnimationState {
  if (p >= 1) return REST
  const t = clamp(p)
  switch (spec.kind) {
    case 'fade':
      return { ...REST, opacity: EASES.sineInOut(t) }
    case 'slide': {
      const v = sideVector(spec.from)
      const far = amountOf(spec) * (1 - EASES.quintOut(t))
      return { ...REST, dx: v.x * far, dy: v.y * far, opacity: EASES.cubicOut(clamp(t / 0.6)) }
    }
    case 'scale': {
      const start = amountOf(spec)
      return { ...REST, scale: lerp(start, 1, EASES.cubicOut(t)), opacity: EASES.cubicOut(clamp(t / 0.6)) }
    }
    case 'pop': {
      // On the way in: the move library's spring over the window (ζ 0.5 — about 16% past, then
      // settled to within 1% by the end). On the way out a spring would wobble before leaving,
      // so it simply shrinks, accelerating.
      const size = arriving ? spring(t, { damping: 0.5, frequency: 11 }) / spring(1, { damping: 0.5, frequency: 11 }) : EASES.cubicOut(t)
      return { ...REST, scale: Math.max(0, size), opacity: clamp(t / 0.25) }
    }
    case 'rise':
      // A whole clip travels its own height under a mask the size of its box; a unit travels
      // its line's height under the line's mask (the painter owns that mask).
      return { ...REST, dy: 1 - EASES.quintOut(t), reveal: unit ? null : { left: 0, top: 0, right: 0, bottom: 0 } }
    case 'blur':
      return { ...REST, blur: (unit ? amountOf(spec) / 100 : amountOf(spec)) * (1 - EASES.cubicOut(t)), opacity: EASES.cubicOut(t) }
    case 'wipe': {
      const hidden = 1 - EASES.cubicInOut(t)
      const side = spec.from ?? 'left'
      // The edge starts at the side it comes from, so the far side is what stays hidden.
      return {
        ...REST,
        reveal: {
          left: side === 'right' ? hidden : 0,
          right: side === 'left' ? hidden : 0,
          top: side === 'bottom' ? hidden : 0,
          bottom: side === 'top' ? hidden : 0
        }
      }
    }
    case 'typewriter':
      // Letters are there or not; the sampler decides which by count, so this is only reached
      // for a letter not yet typed.
      return { ...REST, opacity: 0 }
    default:
      return REST
  }
}

function loopState(spec: LoopSpec, local: number, phase: number, unit: boolean): AnimationState {
  const period = wholeFrames(spec.frames)
  if (period <= 0) return REST
  const info = LOOP_PRESETS[spec.kind]
  if (!info) return REST
  const amount = typeof spec.amount === 'number' && Number.isFinite(spec.amount) ? clamp(spec.amount, info.amount.min, info.amount.max) : info.amount.default
  const angle = (local / period) * Math.PI * 2 - phase
  switch (spec.kind) {
    case 'pulse':
      return { ...REST, scale: 1 + amount * Math.sin(angle) }
    case 'float':
      // A unit's `dy` is in type sizes, a clip's in box heights; a wave wants more of the former.
      return { ...REST, dy: -(unit ? amount * 6 : amount) * Math.sin(angle) }
    case 'sway':
      return { ...REST, rotation: amount * Math.sin(angle) }
    case 'flicker': {
      // Three incommensurate sines: uneven, repeatable, and exactly 1 where they all peak.
      const wobble = (Math.sin(angle) + Math.sin(angle * 2.71 + 1.3) + Math.sin(angle * 5.13 + 0.4)) / 3
      return { ...REST, opacity: 1 - amount * clamp((1 - wobble) / 2) }
    }
    default:
      return REST
  }
}

function combine(a: AnimationState, b: AnimationState): AnimationState {
  if (a === REST) return b
  if (b === REST) return a
  const reveal =
    a.reveal && b.reveal
      ? {
          left: Math.max(a.reveal.left, b.reveal.left),
          top: Math.max(a.reveal.top, b.reveal.top),
          right: Math.max(a.reveal.right, b.reveal.right),
          bottom: Math.max(a.reveal.bottom, b.reveal.bottom)
        }
      : (a.reveal ?? b.reveal)
  return {
    opacity: a.opacity * b.opacity,
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    scale: a.scale * b.scale,
    rotation: a.rotation + b.rotation,
    blur: a.blur + b.blur,
    reveal
  }
}

const byUnit = (spec: { by?: AnimationUnit; kind: string } | undefined): boolean =>
  spec !== undefined && (spec.kind === 'typewriter' || (spec.by !== undefined && spec.by !== 'clip'))

/**
 * The whole-clip state at item-relative frame `local` on a clip `duration` long. The same frozen
 * object ({@link isAtRest}) whenever nothing is in play, which is every frame between an In and
 * an Out with no Loop. A preset that runs by line, word or letter contributes nothing here — the
 * text painter asks {@link textUnitsAt}.
 */
export function animationStateAt(animation: ItemAnimation | undefined, local: number, duration: Frames): AnimationState {
  if (!animation) return REST
  const windows = animationWindows(animation, duration)
  let state: AnimationState = REST
  if (animation.in && !byUnit(animation.in) && windows.inFrames > 0 && local < windows.inFrames) {
    state = combine(state, endState(animation.in, local / windows.inFrames, false, true))
  }
  const remaining = duration - local
  if (animation.out && !byUnit(animation.out) && windows.outFrames > 0 && remaining < windows.outFrames) {
    state = combine(state, endState(animation.out, remaining / windows.outFrames, false, false))
  }
  if (animation.loop && !byUnit(animation.loop)) state = combine(state, loopState(animation.loop, local, 0, false))
  return state
}

export function isAtRest(state: AnimationState): boolean {
  return state === REST
}

/**
 * `item` — already holding its keyed layout — with its presets applied at timeline `frame`. The
 * same object when nothing is in play. Opacity and scale multiply what is there, position and
 * rotation add to it, and a blur joins the clip's adjustments so it is drawn by the one filter
 * mapping every other blur goes through.
 */
export function applyAnimation(item: Item, frame: Frames): Item {
  if (!item.animation) return item
  const state = animationStateAt(item.animation, frame - item.from, item.durationInFrames)
  if (state === REST) return item
  const layout = { ...item.layout }
  layout.opacity = clamp(finiteOr(layout.opacity, 1) * state.opacity)
  layout.left = finiteOr(layout.left, 0) + state.dx * finiteOr(layout.width, 0)
  layout.top = finiteOr(layout.top, 0) + state.dy * finiteOr(layout.height, 0)
  if (state.scale !== 1) layout.scale = Math.max(0, finiteOr(layout.scale, 1) * state.scale)
  if (state.rotation !== 0) layout.rotation = finiteOr(layout.rotation, 0) + state.rotation
  const out: Item = { ...item, layout }
  if (state.blur > 0) {
    const base = item.adjustments?.blur
    out.adjustments = { ...adjustmentsOf(item.adjustments), blur: finiteOr(base, 0) + state.blur }
  }
  return out
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * The mask a preset puts over `item` at `frame`, as fractions of the box hidden from each side —
 * or null. The box is the clip's own (its keyed layout, before the preset moves it): a Rise
 * travels *through* a mask that stays put.
 */
export function animationRevealAt(item: Item, frame: Frames): RevealInsets | null {
  if (!item.animation) return null
  return animationStateAt(item.animation, frame - item.from, item.durationInFrames).reveal
}

// ---------------------------------------------------------------------------
// A title's units
// ---------------------------------------------------------------------------

export interface UnitState extends AnimationState {
  /** Draw this unit under its own line's mask (a Rise by line, word or letter). */
  masked: boolean
}

/** Where one drawn run of a title sits, counted in reading order at each size of unit. */
export interface UnitPosition {
  line: number
  lines: number
  word: number
  words: number
  letter: number
  letters: number
}

export interface TextUnits {
  /** How the painter must split the words: the finest unit any preset in play asks for. */
  by: Exclude<AnimationUnit, 'clip'>
  /**
   * The state of the run at `position`. Each preset reads the index of its own unit, so an In by
   * word and an Out by letter on one title each count what they were asked to count.
   */
  state(position: UnitPosition): UnitState
}

/** How much of a unit's own move overlaps the next unit's: 0 strictly one after another. */
const UNIT_OVERLAP = 0.6

/**
 * Progress of unit `index` of `count` when the whole run is at `t` (0..1): each unit takes an
 * equal stretch overlapping the next, so the first starts at 0 and the last finishes exactly as
 * `t` reaches 1.
 */
export function unitProgress(t: number, index: number, count: number, overlap = UNIT_OVERLAP): number {
  if (count <= 1) return clamp(t)
  // Exactly, not to the last bit: the final unit must read as landed when the run is over.
  if (t >= 1) return 1
  const length = 1 / (1 + (count - 1) * (1 - overlap))
  const start = index * length * (1 - overlap)
  return clamp((t - start) / length)
}

const FINENESS: Record<AnimationUnit, number> = { clip: 0, line: 1, word: 2, letter: 3 }
type TextUnit = Exclude<AnimationUnit, 'clip'>
const unitOf = (spec: { by?: AnimationUnit; kind: string }): TextUnit =>
  spec.kind === 'typewriter' ? 'letter' : spec.by === 'word' || spec.by === 'letter' ? spec.by : 'line'

const indexIn = (position: UnitPosition, unit: TextUnit): [number, number] =>
  unit === 'line' ? [position.line, position.lines] : unit === 'word' ? [position.word, position.words] : [position.letter, position.letters]

/**
 * How a title's lines, words or letters are animated at `frame`, or null when no preset on it
 * runs by unit *at this frame* — the painter then draws whole lines exactly as it always did,
 * which is every frame of a title between its In and its Out.
 */
export function textUnitsAt(item: Item, frame: Frames): TextUnits | null {
  const animation = item.animation
  if (!animation) return null
  const local = frame - item.from
  const duration = item.durationInFrames
  const windows = animationWindows(animation, duration)
  const remaining = duration - local
  const inSpec = animation.in && byUnit(animation.in) && windows.inFrames > 0 && local < windows.inFrames ? animation.in : undefined
  const outSpec = animation.out && byUnit(animation.out) && windows.outFrames > 0 && remaining < windows.outFrames ? animation.out : undefined
  const loopSpec = animation.loop && byUnit(animation.loop) ? animation.loop : undefined
  if (!inSpec && !outSpec && !loopSpec) return null

  let finest: TextUnit = 'line'
  for (const spec of [inSpec, outSpec, loopSpec]) {
    if (spec && FINENESS[unitOf(spec)] > FINENESS[finest]) finest = unitOf(spec)
  }

  const one = (spec: AnimationSpec, t: number, index: number, count: number, arriving: boolean): UnitState => {
    if (spec.kind === 'typewriter') {
      // Whole letters only: `count * t` of them are on the page.
      const typed = Math.floor(count * clamp(t) + 1e-9)
      return { ...REST, opacity: index < typed ? 1 : 0, masked: false }
    }
    const state = endState(spec, unitProgress(t, index, count), true, arriving)
    return { ...state, masked: spec.kind === 'rise' && state !== REST }
  }

  return {
    by: finest,
    state(position) {
      let state: AnimationState = REST
      let masked = false
      if (inSpec) {
        const [index, count] = indexIn(position, unitOf(inSpec))
        const unit = one(inSpec, local / windows.inFrames, index, count, true)
        masked ||= unit.masked
        state = combine(state, unit)
      }
      if (outSpec) {
        // Leaving in reading order — the first unit goes first — which is an In read backwards:
        // unit i of the Out is where unit (count − 1 − i) of an In would be at the time left.
        const [index, count] = indexIn(position, unitOf(outSpec))
        const unit = one(outSpec, remaining / windows.outFrames, count - 1 - index, count, false)
        masked ||= unit.masked
        state = combine(state, unit)
      }
      if (loopSpec) {
        const [index] = indexIn(position, unitOf(loopSpec))
        state = combine(state, loopState(loopSpec, local, index * 0.55, true))
      }
      return { ...state, masked }
    }
  }
}

// ---------------------------------------------------------------------------
// Edits: splitting, and the transition rule
// ---------------------------------------------------------------------------

/**
 * A split clip's two animations: the left half arrives, the right half leaves, and a Loop goes on
 * through both. Either is undefined when it has nothing left.
 */
export function splitAnimation(animation: ItemAnimation | undefined): [ItemAnimation | undefined, ItemAnimation | undefined] {
  if (!animation) return [undefined, undefined]
  const left: ItemAnimation = {}
  const right: ItemAnimation = {}
  if (animation.in) left.in = { ...animation.in }
  if (animation.out) right.out = { ...animation.out }
  if (animation.loop) {
    left.loop = { ...animation.loop }
    right.loop = { ...animation.loop }
  }
  return [Object.keys(left).length > 0 ? left : undefined, Object.keys(right).length > 0 ? right : undefined]
}

/** Which ends of `item` a transition crosses. */
export function transitionEnds(timeline: Pick<Timeline, 'transitions'>, itemId: string): { head: boolean; tail: boolean } {
  let head = false
  let tail = false
  for (const transition of timeline.transitions ?? []) {
    if (transition.toItemId === itemId) head = true
    if (transition.fromItemId === itemId) tail = true
  }
  return { head, tail }
}

/**
 * `item` as it should be animated on `timeline`: the same object unless a transition crosses an
 * end that also has a preset, in which case that preset is set aside. The stored animation is
 * untouched — remove the transition and the In plays again.
 */
export function animationForDraw(timeline: Pick<Timeline, 'transitions'> | null | undefined, item: Item): Item {
  const animation = item.animation
  if (!animation || !timeline?.transitions?.length || (!animation.in && !animation.out)) return item
  const ends = transitionEnds(timeline, item.id)
  const dropIn = ends.head && animation.in !== undefined
  const dropOut = ends.tail && animation.out !== undefined
  if (!dropIn && !dropOut) return item
  const kept: ItemAnimation = { ...animation }
  if (dropIn) delete kept.in
  if (dropOut) delete kept.out
  if (Object.keys(kept).length === 0) {
    const { animation: _dropped, ...rest } = item
    return rest
  }
  return { ...item, animation: kept }
}

// ---------------------------------------------------------------------------
// Writing: validation with refusals an agent can act on
// ---------------------------------------------------------------------------

export interface AnimationTarget {
  itemId: string
  durationInFrames: Frames
  fps: number
  /** Whether the item draws a picture at all. */
  hasPicture: boolean
  /** Whether it is a title — the only thing that can animate by line, word or letter. */
  isText: boolean
}

export type AnimationMerge =
  | { ok: true; animation: ItemAnimation | undefined; notes: string[] }
  | { ok: false; error: string }

const END_FIELDS = ['kind', 'frames', 'seconds', 'from', 'by', 'amount']
const LOOP_FIELDS = ['kind', 'frames', 'seconds', 'amount', 'by']

function lengthOf(raw: Record<string, unknown>, where: string, fallbackSeconds: number, fps: number): number | string {
  if (raw.frames !== undefined && raw.seconds !== undefined) return `${where} has both frames and seconds; give one.`
  if (raw.frames !== undefined) {
    const frames = raw.frames
    if (typeof frames !== 'number' || !Number.isInteger(frames) || frames < 1 || frames > 100_000) {
      return `${where}.frames must be a whole number of frames, at least 1; got ${JSON.stringify(frames)}. Or give seconds, such as seconds: ${fallbackSeconds}.`
    }
    return frames
  }
  const seconds = raw.seconds ?? fallbackSeconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0 || seconds > 600) {
    return `${where}.seconds must be a number of seconds above 0; got ${JSON.stringify(seconds)}.`
  }
  return Math.max(1, Math.round(seconds * fps))
}

function parseEnd(raw: unknown, name: 'in' | 'out', target: AnimationTarget): AnimationSpec | string {
  const where = `animation.${name}`
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return `${where} must be an object such as { kind: "fade", seconds: 0.4 }, or null to remove it. Kinds: ${ANIMATION_KINDS.join(', ')}.`
  }
  const spec = raw as Record<string, unknown>
  const unknown = Object.keys(spec).find((key) => !END_FIELDS.includes(key))
  if (unknown !== undefined) {
    return `${where} has no field "${unknown}". It accepts ${END_FIELDS.join(', ')}.` + (unknown === 'direction' ? ' The side is `from`.' : unknown === 'duration' || unknown === 'durationInFrames' ? ' The length is `frames` or `seconds`.' : '')
  }
  const kind = spec.kind
  if (typeof kind !== 'string' || !(ANIMATION_KINDS as readonly string[]).includes(kind)) {
    return `${where}.kind is ${JSON.stringify(kind)}; it must be one of ${ANIMATION_KINDS.join(', ')}.` + (kind === 'zoom' ? ' A zoom is "scale".' : kind === 'spring' || kind === 'bounce' ? ' A bounce is "pop".' : '')
  }
  const info = ANIMATION_PRESETS[kind as AnimationKind]
  if (info.textOnly && !target.isText) {
    return `${where}.kind "${kind}" needs letters to type, and ${target.itemId} is not a title. Use "wipe" (from: "left") for the same reveal on a picture, or "fade".`
  }
  const frames = lengthOf(spec, where, info.seconds, target.fps)
  if (typeof frames === 'string') return frames
  const out: AnimationSpec = { kind: kind as AnimationKind, frames }
  if (spec.from !== undefined) {
    if (!info.sided) return `${where}.from does not apply to "${kind}" — only ${ANIMATION_KINDS.filter((k) => ANIMATION_PRESETS[k].sided).join(' and ')} have a side. Leave it out.`
    if (typeof spec.from !== 'string' || !(ANIMATION_SIDES as readonly string[]).includes(spec.from)) {
      return `${where}.from is ${JSON.stringify(spec.from)}; it must be one of ${ANIMATION_SIDES.join(', ')} — the side it comes in from (or, on an out, leaves toward).` + (spec.from === 'up' || spec.from === 'down' ? ` "${spec.from}" is a direction of travel: coming up means from: "bottom".` : '')
    }
    if (spec.from !== 'left') out.from = spec.from as AnimationSide
  }
  if (spec.by !== undefined) {
    if (typeof spec.by !== 'string' || !(ANIMATION_UNITS as readonly string[]).includes(spec.by)) {
      return `${where}.by is ${JSON.stringify(spec.by)}; it must be one of ${ANIMATION_UNITS.join(', ')}.`
    }
    if (spec.by !== 'clip') {
      if (!target.isText) {
        return `${where}.by "${spec.by}" needs lines, words or letters, and ${target.itemId} is not a title. Leave by out to animate the whole clip.`
      }
      if (!info.units.includes(spec.by as AnimationUnit)) {
        return `${where}.by "${spec.by}" does not apply to "${kind}", which runs by ${info.units.join(' or ')}.` + (kind === 'wipe' ? ' For a reveal word by word use kind: "rise" or "fade" with by: "word".' : '')
      }
      if (kind !== 'typewriter') out.by = spec.by as AnimationUnit
    }
  }
  if (spec.amount !== undefined) {
    if (!info.amount) return `${where}.amount does not apply to "${kind}". Leave it out.`
    const amount = spec.amount
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < info.amount.min || amount > info.amount.max) {
      return `${where}.amount is ${JSON.stringify(amount)}; for "${kind}" it is ${info.amount.meaning}, from ${info.amount.min} to ${info.amount.max} (default ${info.amount.default}).`
    }
    if (amount !== info.amount.default) out.amount = amount
  }
  return out
}

function parseLoop(raw: unknown, target: AnimationTarget): LoopSpec | string {
  const where = 'animation.loop'
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return `${where} must be an object such as { kind: "pulse", seconds: 1.2 }, or null to remove it. Kinds: ${LOOP_KINDS.join(', ')}.`
  }
  const spec = raw as Record<string, unknown>
  const unknown = Object.keys(spec).find((key) => !LOOP_FIELDS.includes(key))
  if (unknown !== undefined) return `${where} has no field "${unknown}". It accepts ${LOOP_FIELDS.join(', ')}.`
  const kind = spec.kind
  if (typeof kind !== 'string' || !(LOOP_KINDS as readonly string[]).includes(kind)) {
    return `${where}.kind is ${JSON.stringify(kind)}; it must be one of ${LOOP_KINDS.join(', ')}. (${ANIMATION_KINDS.join(', ')} are for in and out.)`
  }
  const info = LOOP_PRESETS[kind as LoopKind]
  const frames = lengthOf(spec, where, info.seconds, target.fps)
  if (typeof frames === 'string') return frames
  if (frames < 2) return `${where}.frames is ${frames}; one cycle needs at least 2 frames.`
  const out: LoopSpec = { kind: kind as LoopKind, frames }
  if (spec.amount !== undefined) {
    const amount = spec.amount
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < info.amount.min || amount > info.amount.max) {
      return `${where}.amount is ${JSON.stringify(amount)}; for "${kind}" it is ${info.amount.meaning}, from ${info.amount.min} to ${info.amount.max} (default ${info.amount.default}).`
    }
    if (amount !== info.amount.default) out.amount = amount
  }
  if (spec.by !== undefined) {
    if (typeof spec.by !== 'string' || !(ANIMATION_UNITS as readonly string[]).includes(spec.by)) {
      return `${where}.by is ${JSON.stringify(spec.by)}; it must be one of ${ANIMATION_UNITS.join(', ')}.`
    }
    if (spec.by !== 'clip') {
      if (!target.isText) return `${where}.by "${spec.by}" needs lines, words or letters, and ${target.itemId} is not a title. Leave by out.`
      out.by = spec.by as AnimationUnit
    }
  }
  return out
}

/**
 * Applies `given` — `{ in?, out?, loop? }`, each a spec or null, or `null` for "remove them all" —
 * over `current`. Each end named is **replaced whole**; ends not named are kept. A length may be
 * `frames` or `seconds` (stored as frames at the timeline's rate); with neither, the kind's own.
 * `notes` says what the clip's length did to what was asked.
 */
export function mergeAnimation(current: ItemAnimation | undefined, given: unknown, target: AnimationTarget): AnimationMerge {
  if (given === null) return { ok: true, animation: undefined, notes: [] }
  if (typeof given !== 'object' || Array.isArray(given)) {
    return { ok: false, error: '`animation` must be an object of { in?, out?, loop? }, or null to remove every preset. ' + animationCatalogText() }
  }
  if (!target.hasPicture) {
    return {
      ok: false,
      error: `animation on ${target.itemId} would change nothing: it is a sound-only clip with no picture to animate. For sound use fadeInFrames/fadeOutFrames, or keyframes.volume.`
    }
  }
  const raw = given as Record<string, unknown>
  const unknown = Object.keys(raw).find((key) => !['in', 'out', 'loop'].includes(key))
  if (unknown !== undefined) {
    return { ok: false, error: `animation has no field "${unknown}". It is { in?, out?, loop? } — such as { in: { kind: "${(ANIMATION_KINDS as readonly string[]).includes(unknown) ? unknown : 'fade'}" } }.` }
  }
  const out: ItemAnimation = { ...current }
  for (const name of ['in', 'out'] as const) {
    if (raw[name] === undefined) continue
    if (raw[name] === null) {
      delete out[name]
      continue
    }
    const parsed = parseEnd(raw[name], name, target)
    if (typeof parsed === 'string') return { ok: false, error: parsed }
    out[name] = parsed
  }
  if (raw.loop !== undefined) {
    if (raw.loop === null) delete out.loop
    else {
      const parsed = parseLoop(raw.loop, target)
      if (typeof parsed === 'string') return { ok: false, error: parsed }
      out.loop = parsed
    }
  }
  const animation = Object.keys(out).length > 0 ? out : undefined
  const notes: string[] = []
  const windows = animationWindows(animation, target.durationInFrames)
  if (animation && windows.shortened) {
    const asked = [animation.in ? `in ${animation.in.frames}` : '', animation.out ? `out ${animation.out.frames}` : ''].filter(Boolean).join(' + ')
    const got = [animation.in ? `in ${windows.inFrames}` : '', animation.out ? `out ${windows.outFrames}` : ''].filter(Boolean).join(' and ')
    notes.push(
      `The clip is ${target.durationInFrames} frames and the presets ask for ${asked}, so they play shortened: ${got}. ` +
        `The asked lengths are stored and come back if the clip gets longer.`
    )
  }
  return { ok: true, animation, notes }
}

/**
 * What the presets do in the agent's terms: the timeline frames each end actually occupies.
 * Reported by `edit_item` and `inspect_item`.
 */
export function describeAnimation(item: Item): Record<string, unknown> | undefined {
  const animation = item.animation
  if (!animation) return undefined
  const windows = animationWindows(animation, item.durationInFrames)
  const end = item.from + item.durationInFrames
  const out: Record<string, unknown> = {}
  if (animation.in) out.in = { kind: animation.in.kind, timelineFrames: [item.from, item.from + windows.inFrames] }
  if (animation.out) out.out = { kind: animation.out.kind, timelineFrames: [end - windows.outFrames, end] }
  if (animation.loop) out.loop = { kind: animation.loop.kind, everyFrames: animation.loop.frames }
  if (windows.shortened) out.note = 'shortened to fit the clip; the stored lengths are longer'
  return out
}
