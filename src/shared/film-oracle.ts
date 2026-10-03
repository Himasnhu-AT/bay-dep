/**
 * The film oracle: does a motion composition read as one film, or as slides?
 *
 * A composition that wants to be judged publishes one object, `window.__film` ({@link FILM_CONTRACT}):
 * where its beats start, and a `track(t)` that says where each named thing is on screen at `t`.
 * `check_film` seeks the composition across its length, collects those boxes and a low-resolution
 * picture difference per step, and this module turns the two series into five legs:
 *
 * - **faults** — `time(t)` or `track(t)` threw, or the same time gave two answers. Neither shows
 *   in a film watched once, and export depends on both.
 * - **continuity** — at every beat boundary, did something on screen survive it and move or
 *   scale (carried), survive it unmoved (anchored), or was the picture replaced (bare)?
 * - **curves** — how fast each thing moves per frame, and how each move is eased.
 * - **rhythm** — are the beats a metronome, and does the picture ever stop?
 * - **framing** — is a subject the author promised to keep in frame ever out of it?
 *
 * The method — beats that carry into each other, measured rather than argued — and the published
 * thresholds marked "onetake" below come from onetake's `references/rhythm.md`
 * (github.com/feitangyuan/onetake), which reports them against six cuts of two films it knew the
 * verdict for. Nothing here is its code: its probe finds what is on screen by itself, while this
 * one reads only what `track` declares, so everything it concludes is about the declared boxes.
 *
 * **Where it is blind**, which every report repeats in `blind`:
 * - It follows ids. A carry built from two elements — one fading out where another fades in at
 *   the same size — is a replacement to it. Build a carry as one id that changes, or list the
 *   time in `cuts`.
 * - It believes `track`. A thing drawn and not tracked does not exist; a box that does not match
 *   what is drawn is taken at its word. The one cross-check is `untracked`: a picture that
 *   changes wholesale while every tracked box holds.
 * - A replacement slower than {@link CARRY_AFTER_SECONDS} looks like survival, because the
 *   outgoing thing is still visible when the window closes.
 * - Stillness is read from a {@link ENERGY_WIDTH}-pixel picture. Detail smaller than a few
 *   source pixels averages away, and any camera push counts as motion — a hold has to be still.
 *
 * Pure: no DOM, no Node. The sampling that feeds it is in `src/main/html/`.
 */

/** What a composition's author reads when the contract is missing or wrong. Kept beside the checks. */
export const FILM_CONTRACT = `window.__film = {
  beats: [0, 1.6, 3.0],            // where each beat starts, in seconds, ascending, the first at 0
  cuts: [12.1],                    // optional: beat starts that are deliberate hard cuts
  inFrame: { dot: [0.5, 15], mark: [12.2, 15, 'whole'] },  // optional: id -> [from, to] it must stay in frame ('whole': not cut by the edge)
  blur: false,                     // optional: true when the composition draws its own motion blur
  track(t) {                       // what is on screen at t, as boxes in SCREEN pixels (x, y = top-left)
    return { dot: { x: 900, y: 500, w: 120, h: 120, op: 1 } }
  }
}`

// ---------------------------------------------------------------------------
// Thresholds. Each says where its number comes from.
// ---------------------------------------------------------------------------

/** Carry score below this fails. onetake: its rejected cuts scored 0.00 and 0.40. */
export const CARRY_FAIL_BELOW = 0.5
/** Carry score below this warns. onetake: its accepted cuts scored 0.56 and 0.75. */
export const CARRY_WARN_BELOW = 0.7
/** A survivor that travels this share of the frame diagonal carried the boundary. onetake: 2 %. */
export const CARRY_MOVE_DIAGONALS = 0.02
/** …or one whose linear size changes by this ratio. onetake: 10 %. */
export const CARRY_SCALE_RATIO = 1.1
/** An unmoved survivor anchors a boundary only when it covers this share of the frame. onetake: 3 %. */
export const ANCHOR_AREA_SHARE = 0.03
/** A bare boundary this close to the end is the end card. onetake: 1.2 s. */
export const END_EXEMPT_SECONDS = 1.2
/** Bare boundaries are hits, not slides, when this many fall inside {@link BURST_WINDOW_SECONDS}. onetake: 3 in 1.5 s. */
export const BURST_COUNT = 3
export const BURST_WINDOW_SECONDS = 1.5
/**
 * The window a carry is looked for in, around a boundary at `b`: who was on screen in
 * `[b - before, b)`, who still is in the second half of `[b, b + after]`, and how far a survivor
 * went across the whole of it. Mine: onetake finds its boundaries from the picture and uses 0.4 s
 * around each; a declared beat is where the author says the section starts, and the move that
 * joins two sections mostly happens just after that, so the window leans forward.
 */
export const CARRY_BEFORE_SECONDS = 0.25
export const CARRY_AFTER_SECONDS = 0.5
/** A box fainter than this is not on screen. Mine. */
export const VISIBLE_OPACITY = 0.05
/** Half-width of the window an undeclared scene change is looked for in. onetake: a 0.4 s window. */
export const TURNOVER_HALF_SECONDS = 0.2
/** A scene change is this share of the tracked area leaving while as much arrives. onetake: "most". */
export const TURNOVER_SHARE = 0.5
/** A declared cut or a detected scene change belongs to a beat this close to it. Mine. */
export const BOUNDARY_MATCH_SECONDS = 0.4
/** Below this many track samples a second a carry window holds too few samples to judge. Mine. */
export const MIN_TRACK_RATE = 10

/** Beat lengths with a coefficient of variation under this are a metronome. onetake: 0.25. */
export const BEAT_CV_MIN = 0.25
/** The longest beat should be this many times the shortest. onetake's beat sheet asks for 4x. */
export const BEAT_RATIO_MIN = 4
/**
 * A step whose picture energy is under this is dead still: the two captures are the same picture,
 * by the tolerance the purity check already uses ({@link PURITY_PICTURE_TOLERANCE}).
 * See the calibration under {@link ENERGY_WIDTH} for why this is not onetake's 0.5.
 */
export const STILL_ENERGY = 0.05
/** …and under this, barely moving. Not onetake's 2 — same calibration. */
export const LOW_ENERGY = 0.5
/** This share of the film must be dead still. onetake: 25 %. */
export const STILL_SHARE_MIN = 0.25
/** …with one stretch at least this long under {@link LOW_ENERGY}. onetake: 1 s. */
export const REST_SECONDS_MIN = 1
/**
 * Picture energy is the mean absolute luma difference (0–255) between two captures this many
 * pixels wide, {@link ENERGY_STEP_SECONDS} apart. The width and the step are onetake's (its rest
 * leg reads at 320 px; its map is one cell per 1/12 s); **the unit is mine** — its docs publish
 * the thresholds (0.5 still, 2 low) without the formula.
 *
 * **Calibrated in the running app** (`test/app/film.mjs` on `fixtures/film/`, a Retina Mac, so a
 * 3840x2160 capture resized to 320x180):
 *
 * - The unit is *share of the frame that changed x the luma contrast of the change*, and nothing
 *   else. The fixture's hero (a 200 px disc, luma 183 on 16, 1.5 % of the frame) crossing at
 *   62.5 px a step predicts 1.977 by the area of two overlapping discs; it read 1.97, 1.97, 1.98.
 * - There is no noise floor: every one of the 432 hold steps across three fixtures read exactly
 *   0.00, and a time captured twice differed by 0. So nothing but a moving picture puts a step
 *   over zero, and the thresholds can sit as low as the motion they are meant to see.
 * - On onetake's numbers the instrument could not see a subject move. That disc at 25 px/frame
 *   read 1.97 — under 2, a "rest"; its ease tails (10 px in the step) read 0.34–0.41 — under
 *   0.5, "dead still"; and it cannot read over 5.1 however fast it goes. Only the card swaps
 *   (a fifth of the frame) were over 2, so "never dead still for a second" was unfailable by any
 *   film whose moving things are subject-sized, which is most of them.
 * - At 0.05 / 0.5 the same disc is dead still under about 0.6 px/frame at 30 fps (which is
 *   {@link REST_PX_PER_FRAME_AT_1080P}, the track's own idea of rest) and resting under about
 *   6 px/frame. `carried.html` then reads 89 % still with exactly its three crossings as moving.
 *
 * It is blind to hue: the fixture's blue card swapped for a magenta one of nearly the same luma
 * read 1.51, where the other two swaps of the same card read 10.6 and 11.7.
 */
export const ENERGY_WIDTH = 320
export const ENERGY_STEP_SECONDS = 1 / 12
/**
 * A step whose picture energy is over this is a wholesale change of picture. Mine. Measured: a
 * 900x500 card (a fifth of the frame) swapping colour reads 1.5–11.7, so this fires only for a
 * change bigger than that.
 */
export const PICTURE_CUT_ENERGY = 12

/** Without motion blur, a move over this strobes into copies — at 1920x1080. onetake: 80 px/frame. */
export const FAST_PX_PER_FRAME_AT_1080P = 80
const DIAGONAL_1080P = Math.hypot(1920, 1080)
/** Slower than this a thing is at rest — px/frame at 1080p, scaled with the frame. Mine. */
export const REST_PX_PER_FRAME_AT_1080P = 0.5
/** A move is worth reporting when it travels this share of the frame diagonal. Mine. */
export const MOVE_MIN_DIAGONALS = 0.05
/** A move whose t80 is at or over this is on a soft curve. onetake: 0.55. */
export const SOFT_T80 = 0.55
/** Every move within this band of t80 is the same curve. Mine. */
export const SAME_CURVE_BAND = 0.1
/** Two boxes this close, in px, are the same box — for the purity check. Mine. */
export const PURITY_TOLERANCE_PX = 0.01
/** Two captures of one time may differ by this much picture energy and still be the same. Mine. */
export const PURITY_PICTURE_TOLERANCE = 0.05

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/** One thing on screen: a box in screen pixels, `x`/`y` its top-left corner, `op` its opacity 0..1. */
export interface FilmBox {
  x: number
  y: number
  w: number
  h: number
  op: number
}

export type FilmBoxes = Record<string, FilmBox>

/** `__film` after validation. */
export interface FilmMeta {
  beats: number[]
  cuts: number[]
  inFrame: Record<string, { from: number; to: number; whole: boolean }>
  blur: boolean
}

/**
 * What the page says about its `__film`, as plain data: main reads this out of the composition
 * window and nothing in it has been trusted yet. `present` is false when there is no object.
 */
export interface DeclaredFilm {
  present: boolean
  /** `typeof window.__film`, or `'null'`. */
  kind: string
  beats?: unknown
  cuts?: unknown
  inFrame?: unknown
  blur?: unknown
  /** `typeof __film.track`. */
  track?: string
}

const seconds = (value: number): string => `${Math.round(value * 100) / 100} s`
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/**
 * Validate what a composition declared. Every problem is a sentence its author can act on, and
 * all of them come back at once: a contract with three mistakes has three.
 */
export function readFilmMeta(
  declared: DeclaredFilm,
  durationSeconds: number
): { ok: true; meta: FilmMeta } | { ok: false; problems: string[] } {
  if (!declared.present) {
    return {
      ok: false,
      problems: [
        declared.kind === 'undefined'
          ? 'This composition declares nothing to measure: there is no window.__film. Add one beside ' +
            `the timeline registration — the smallest that can be checked is:\n${FILM_CONTRACT}`
          : `window.__film is ${declared.kind}, not an object, so there is nothing to measure. It must be:\n${FILM_CONTRACT}`
      ]
    }
  }

  const problems: string[] = []
  const beats: number[] = []
  if (!Array.isArray(declared.beats) || declared.beats.length === 0) {
    problems.push(
      '__film.beats is missing. It is the list of times, in seconds, where each beat of the film ' +
        'starts — [0, 1.6, 3.0] for three beats — and every boundary between two of them is checked for a carry.'
    )
  } else if (!declared.beats.every(isNumber)) {
    problems.push('__film.beats must be numbers (seconds). Something in it is not: ' + JSON.stringify(declared.beats) + '.')
  } else {
    beats.push(...declared.beats)
    if (beats[0] !== 0) problems.push(`__film.beats must start at 0 — the first beat starts with the film — but it starts at ${beats[0]}.`)
    const disorder = beats.findIndex((beat, index) => index > 0 && beat <= beats[index - 1]!)
    if (disorder > 0) {
      problems.push(`__film.beats must ascend, and ${beats[disorder]} follows ${beats[disorder - 1]}.`)
    }
    const late = beats.filter((beat) => beat >= durationSeconds)
    if (late.length > 0) {
      problems.push(
        `__film.beats names ${late.join(', ')}, at or past the composition's end (${seconds(durationSeconds)}, its data-duration). ` +
          'Beats are seconds on the same clock as time(t).'
      )
    }
  }

  if (declared.track !== 'function') {
    problems.push(
      `__film.track is ${declared.track === 'undefined' || declared.track === undefined ? 'missing' : `a ${declared.track}, not a function`}. ` +
        'It is what the oracle follows: track(t) returns the boxes of what is on screen at t, in screen pixels — ' +
        '{ card: { x, y, w, h, op } } — and leaves out (or gives op 0 to) what is not.'
    )
  }

  const cuts: number[] = []
  if (declared.cuts !== undefined && declared.cuts !== null) {
    if (!Array.isArray(declared.cuts) || !declared.cuts.every(isNumber)) {
      problems.push('__film.cuts must be a list of times in seconds — the beat starts that are deliberate hard cuts — or be left out.')
    } else {
      cuts.push(...declared.cuts)
      for (const cut of cuts) {
        const nearest = beats.slice(1).reduce<number | null>(
          (best, beat) => (best === null || Math.abs(beat - cut) < Math.abs(best - cut) ? beat : best),
          null
        )
        if (nearest === null || Math.abs(nearest - cut) > BOUNDARY_MATCH_SECONDS) {
          problems.push(
            `__film.cuts lists ${cut}, but no beat starts there. A cut exempts the boundary of a beat, so it must be one of ` +
              `the beat starts after the first: ${beats.slice(1).join(', ') || 'there are none'}.`
          )
        }
      }
    }
  }

  const inFrame: FilmMeta['inFrame'] = {}
  if (declared.inFrame !== undefined && declared.inFrame !== null) {
    if (typeof declared.inFrame !== 'object' || Array.isArray(declared.inFrame)) {
      problems.push("__film.inFrame must map an id to [from, to] or [from, to, 'whole'], or be left out.")
    } else {
      for (const [id, span] of Object.entries(declared.inFrame as Record<string, unknown>)) {
        const [from, to, mode] = Array.isArray(span) ? (span as unknown[]) : []
        if (!isNumber(from) || !isNumber(to) || to <= from || (mode !== undefined && mode !== 'whole') || (span as unknown[]).length > 3) {
          problems.push(
            `__film.inFrame.${id} is ${JSON.stringify(span)}. It must be [from, to] in seconds with to after from, ` +
              "or [from, to, 'whole'] when the frame edge must not cut it."
          )
          continue
        }
        inFrame[id] = { from, to, whole: mode === 'whole' }
      }
    }
  }

  if (declared.blur !== undefined && declared.blur !== null && typeof declared.blur !== 'boolean') {
    problems.push('__film.blur must be true or false: true only when the composition draws its own motion blur, which lifts the speed limit.')
  }

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, meta: { beats, cuts, inFrame, blur: declared.blur === true } }
}

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

/**
 * One call of `track(t)`, as the page reports it: each box as `[x, y, w, h, op]` with `null`
 * where the value was not a finite number, or `null` for an entry that was not an object.
 */
export type RawBoxes = Record<string, (number | null)[] | null>

/** One sampled time, straight from the page. Exactly one of `boxes`, `threw` and `shape` is set. */
export interface RawTrackSample {
  t: number
  boxes?: RawBoxes
  /** Which call threw, with its message. */
  threw?: 'time' | 'track'
  message?: string
  /** What `track` returned when it was not an object: `'undefined'`, `'null'`, `'number'`… */
  shape?: string
}

export interface FilmSamples {
  /** The composition's size: the screen `track` reports boxes on. */
  width: number
  height: number
  /** The film's frame rate: speeds are reported per frame of this. */
  fps: number
  durationSeconds: number
  /** Track samples per second. */
  trackRate: number
  track: RawTrackSample[]
  /**
   * Picture energy: `values[i]` is the difference between the captures at `i * step` and
   * `(i + 1) * step`, or null where one could not be taken. Null when no pictures were sampled,
   * with the reason in `energyMissing`.
   */
  energy: { step: number; values: (number | null)[] } | null
  energyMissing?: string
  /** The purity check: `t` sampled, then `via`, then `t` again. */
  purity: {
    t: number
    via: number
    first: RawTrackSample
    again: RawTrackSample
    /** Picture energy between the two captures of `t`; null when pictures were not sampled. */
    pictureDelta: number | null
  }[]
}

interface Sample {
  t: number
  /** Everything `track` returned that was a well-formed box; null when the sample threw. */
  boxes: FilmBoxes | null
}

function readBoxes(raw: RawTrackSample, malformed: Map<string, number>): FilmBoxes | null {
  if (!raw.boxes) return null
  const boxes: FilmBoxes = {}
  for (const [id, values] of Object.entries(raw.boxes)) {
    const [x, y, w, h, op] = values ?? []
    if (!isNumber(x) || !isNumber(y) || !isNumber(w) || !isNumber(h) || !isNumber(op)) {
      if (!malformed.has(id)) malformed.set(id, raw.t)
      continue
    }
    boxes[id] = { x, y, w, h, op }
  }
  return boxes
}

interface Frame {
  width: number
  height: number
  diagonal: number
}

/** On screen at all: drawn, with some size, and not wholly outside the frame. */
function visible(box: FilmBox | undefined, frame: Frame): box is FilmBox {
  return box !== undefined && present(box) && shownArea(box, frame) > 0
}

/** Drawn with some size, wherever it is. */
function present(box: FilmBox | undefined): box is FilmBox {
  return box !== undefined && box.op >= VISIBLE_OPACITY && box.w > 0 && box.h > 0
}

function shownArea(box: FilmBox, frame: Frame): number {
  const w = Math.min(box.x + box.w, frame.width) - Math.max(box.x, 0)
  const h = Math.min(box.y + box.h, frame.height) - Math.max(box.y, 0)
  return w > 0 && h > 0 ? w * h : 0
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** `unmeasured`: the leg had nothing to judge, which is not a pass — its sentence says why. */
export type LegStatus = 'pass' | 'warn' | 'fail' | 'unmeasured'

export type LegName = 'faults' | 'continuity' | 'curves' | 'rhythm' | 'framing'

export interface FilmFinding {
  leg: LegName
  severity: 'fail' | 'warn'
  /** What is wrong, with its numbers, and what to change. */
  sentence: string
}

export type BoundaryVerdict = 'carried' | 'anchored' | 'bare' | 'untracked'

export interface BoundaryReport {
  seconds: number
  /** False for a scene change found in the tracks where no beat was declared. */
  declared: boolean
  verdict: BoundaryVerdict
  /** The id that carried or anchored it, strongest first; empty when bare. */
  by: string[]
  /** Why it does not count against the score: a declared cut, the end card, or a burst of hits. */
  exempt: 'cut' | 'end' | 'burst' | null
  /** One line: who survived and what it did, or what was lost. */
  detail: string
}

export interface MoveReport {
  id: string
  fromSeconds: number
  toSeconds: number
  travelPx: number
  peakPxPerFrame: number
  /** The share of the move's time by which 80 % of its travel is done. Linear is 0.8; a hard ease-out is near 0.3. */
  t80: number
}

export interface FilmReport {
  verdict: 'pass' | 'warn' | 'fail'
  /** The one line to read first. */
  summary: string
  /** Every failure and warning, the ones a viewer cannot see first. */
  findings: FilmFinding[]
  legs: {
    faults: {
      status: LegStatus
      /** How many sampled times threw, and the first of them. */
      threw: { count: number; first: { seconds: number; call: 'time' | 'track'; message: string }[] }
      /** Times that gave a different answer the second time. */
      impure: { seconds: number; viaSeconds: number; what: string }[]
      /** Ids whose box was not five finite numbers, with the first time each was seen. */
      malformed: { id: string; seconds: number }[]
    }
    continuity: {
      status: LegStatus
      /** (carried + anchored / 2) / considered; null when no boundary was considered. */
      score: number | null
      carried: number
      anchored: number
      bare: number
      /** Boundaries the score covers: every one that is not exempt. */
      considered: number
      boundaries: BoundaryReport[]
      /** Times the picture changed wholesale while every tracked box held: something untracked. */
      untracked: number[]
    }
    curves: {
      status: LegStatus
      /** The limit applied, in px/frame at this frame size and rate. */
      limitPxPerFrame: number
      blurDeclared: boolean
      /** The fastest step of each tracked id that moved at all, fastest first. */
      peaks: { id: string; pxPerFrame: number; seconds: number; framesOverLimit: number }[]
      /** The moves worth reading, longest travel first. */
      moves: MoveReport[]
      medianT80: number | null
      /** Share of all travel that is on a soft curve. */
      softTravelShare: number | null
    }
    rhythm: {
      status: LegStatus
      beatSeconds: number[]
      /** Coefficient of variation of the beat lengths; null with fewer than two beats. */
      beatCv: number | null
      longestOverShortest: number | null
      /** Null when no pictures were sampled. */
      stillShare: number | null
      lowShare: number | null
      longestRest: { fromSeconds: number; toSeconds: number } | null
      /** Where the film moves: stretches at or over the low threshold. */
      moving: { fromSeconds: number; toSeconds: number; peak: number }[]
      /** Mean picture energy per beat, in beat order. */
      energyPerBeat: number[] | null
    }
    framing: {
      status: LegStatus
      subjects: { id: string; whole: boolean; out: { fromSeconds: number; toSeconds: number; how: 'absent' | 'off frame' | 'cut by the edge' }[] }[]
    }
  }
  sampling: {
    fps: number
    width: number
    height: number
    durationSeconds: number
    trackRate: number
    trackSamples: number
    energyStepSeconds: number | null
    pictures: number
  }
  /** What this report cannot see. Constant, and returned every time so a pass is read with it. */
  blind: string[]
}

export const BLIND: string[] = [
  'It follows ids: a carry made of two elements (one fading out where another fades in) reads as bare. Make it one id that changes, or list the time in cuts.',
  'It believes track(t): what is drawn but not tracked does not exist to it, and a box that does not match the picture is taken at its word.',
  `A replacement slower than ${CARRY_AFTER_SECONDS} s reads as survival, because the outgoing thing is still on screen when the window closes.`,
  `Stillness is read from a ${ENERGY_WIDTH} px picture: fine detail averages away, and a slow push counts as motion, so a hold must be dead still.`,
  'A film that is one continuous world has few boundaries; a score over one or two is not evidence. Judge those by eye with frame_grid.'
]

// ---------------------------------------------------------------------------
// Continuity
// ---------------------------------------------------------------------------

function between(samples: Sample[], from: number, to: number): Sample[] {
  return samples.filter((sample) => sample.t >= from - 1e-9 && sample.t <= to + 1e-9)
}

function idsVisible(samples: Sample[], frame: Frame): Set<string> {
  const ids = new Set<string>()
  for (const sample of samples) {
    for (const [id, box] of Object.entries(sample.boxes ?? {})) if (visible(box, frame)) ids.add(id)
  }
  return ids
}

interface Survivor {
  id: string
  movedPx: number
  scale: number
  areaShare: number
}

function survivorOf(id: string, window: Sample[], frame: Frame): Survivor {
  const boxes = window.map((sample) => sample.boxes?.[id]).filter((box): box is FilmBox => visible(box, frame))
  let movedPx = 0
  let smallest = Infinity
  let largest = 0
  let area = 0
  for (let i = 0; i < boxes.length; i += 1) {
    const a = boxes[i]!
    const size = Math.sqrt(a.w * a.h)
    smallest = Math.min(smallest, size)
    largest = Math.max(largest, size)
    area = Math.max(area, shownArea(a, frame))
    for (let j = i + 1; j < boxes.length; j += 1) {
      const b = boxes[j]!
      movedPx = Math.max(movedPx, Math.hypot(b.x + b.w / 2 - (a.x + a.w / 2), b.y + b.h / 2 - (a.y + a.h / 2)))
    }
  }
  return { id, movedPx, scale: smallest > 0 ? largest / smallest : 1, areaShare: area / (frame.width * frame.height) }
}

/** How strongly a survivor carried: 1 is exactly at a threshold. */
function carryStrength(survivor: Survivor, frame: Frame): number {
  return Math.max(
    survivor.movedPx / (CARRY_MOVE_DIAGONALS * frame.diagonal),
    (survivor.scale - 1) / (CARRY_SCALE_RATIO - 1)
  )
}

function judgeBoundary(at: number, samples: Sample[], frame: Frame, duration: number): Omit<BoundaryReport, 'declared' | 'exempt'> {
  const before = samples.filter((sample) => sample.t >= at - CARRY_BEFORE_SECONDS - 1e-9 && sample.t < at - 1e-9)
  const afterEnd = Math.min(at + CARRY_AFTER_SECONDS, duration)
  const settled = between(samples, at + (afterEnd - at) / 2, afterEnd)
  const was = idsVisible(before, frame)
  const is = idsVisible(settled, frame)
  const base = { seconds: at }

  if (was.size === 0 && is.size === 0) {
    return {
      ...base,
      verdict: 'untracked',
      by: [],
      detail:
        'track(t) reports nothing on screen on either side of this boundary, so it cannot be judged: either the frame is ' +
        'empty here, or what is on screen is not tracked. Return a box for whatever the viewer is looking at.'
    }
  }

  const window = between(samples, at - CARRY_BEFORE_SECONDS, afterEnd)
  const survivors = [...was].filter((id) => is.has(id)).map((id) => survivorOf(id, window, frame))
  const lost = [...was].filter((id) => !is.has(id))
  const arrived = [...is].filter((id) => !was.has(id))

  if (survivors.length === 0) {
    return {
      ...base,
      verdict: 'bare',
      by: [],
      detail:
        `nothing survives: ${lost.join(', ') || 'an empty frame'} is replaced by ${arrived.join(', ') || 'an empty frame'}. ` +
        'Keep one thing on screen across it and move or scale it into the next beat.'
    }
  }

  const carriers = survivors
    .filter((survivor) => carryStrength(survivor, frame) >= 1)
    .sort((a, b) => carryStrength(b, frame) - carryStrength(a, frame))
  if (carriers.length > 0) {
    const lead = carriers[0]!
    const did =
      lead.movedPx >= CARRY_MOVE_DIAGONALS * frame.diagonal
        ? `moves ${Math.round(lead.movedPx)} px`
        : `scales ${Math.round((lead.scale - 1) * 100)} %`
    return { ...base, verdict: 'carried', by: carriers.map((c) => c.id), detail: `${lead.id} survives and ${did} across it.` }
  }

  const anchors = survivors.filter((s) => s.areaShare >= ANCHOR_AREA_SHARE).sort((a, b) => b.areaShare - a.areaShare)
  if (anchors.length > 0) {
    const lead = anchors[0]!
    return {
      ...base,
      verdict: 'anchored',
      by: anchors.map((a) => a.id),
      detail:
        `${lead.id} survives but does not move (${Math.round(lead.movedPx)} px, ${Math.round((lead.scale - 1) * 100)} % scale): ` +
        'it holds the frame while the scene changes around it. Half a carry — make it travel or grow into the next beat.'
    }
  }

  const largest = [...survivors].sort((a, b) => b.areaShare - a.areaShare)[0]!
  return {
    ...base,
    verdict: 'bare',
    by: [],
    detail:
      `${survivors.map((s) => s.id).join(', ')} survives, but unmoved and small ` +
      `(${(largest.areaShare * 100).toFixed(1)} % of the frame, under ${ANCHOR_AREA_SHARE * 100} %), so the viewer sees a replacement. ` +
      'Move or scale it across the boundary.'
  }
}

/** Times where most of the tracked area changes identity inside a 0.4 s window. */
function sceneChanges(samples: Sample[], frame: Frame, rate: number): number[] {
  const reach = Math.max(1, Math.round(TURNOVER_HALF_SECONDS * rate))
  const area = (sample: Sample, ids: string[]): number =>
    ids.reduce((sum, id) => sum + shownArea(sample.boxes![id]!, frame), 0)
  const hits: number[] = []
  for (let k = reach; k + reach < samples.length; k += 1) {
    const a = samples[k - reach]!
    const b = samples[k + reach]!
    if (!a.boxes || !b.boxes) continue
    const was = Object.keys(a.boxes).filter((id) => visible(a.boxes![id], frame))
    const is = Object.keys(b.boxes).filter((id) => visible(b.boxes![id], frame))
    const gone = was.filter((id) => !is.includes(id))
    const came = is.filter((id) => !was.includes(id))
    if (gone.length === 0 || came.length === 0) continue
    if (area(a, gone) >= TURNOVER_SHARE * area(a, was) && area(b, came) >= TURNOVER_SHARE * area(b, is)) hits.push(samples[k]!.t)
  }
  // Neighbouring hits are one change, at the middle of the run.
  const changes: number[] = []
  let run: number[] = []
  for (const t of hits) {
    if (run.length > 0 && t - run[run.length - 1]! > 1.5 / rate) {
      changes.push((run[0]! + run[run.length - 1]!) / 2)
      run = []
    }
    run.push(t)
  }
  if (run.length > 0) changes.push((run[0]! + run[run.length - 1]!) / 2)
  return changes
}

// ---------------------------------------------------------------------------
// The whole check
// ---------------------------------------------------------------------------

/** The order findings are listed in: what a viewer is least able to see for themselves first. */
const HIDDEN_FIRST: LegName[] = ['faults', 'continuity', 'curves', 'rhythm', 'framing']

function ranges(times: number[], step: number): { fromSeconds: number; toSeconds: number }[] {
  const out: { fromSeconds: number; toSeconds: number }[] = []
  for (const t of times) {
    const last = out[out.length - 1]
    if (last && t - last.toSeconds <= step * 1.5) last.toSeconds = t
    else out.push({ fromSeconds: t, toSeconds: t })
  }
  return out
}

const round = (value: number, places = 2): number => {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

const span = (range: { fromSeconds: number; toSeconds: number }): string =>
  range.fromSeconds === range.toSeconds ? seconds(range.fromSeconds) : `${round(range.fromSeconds)}–${seconds(range.toSeconds)}`

export function checkFilm(meta: FilmMeta, input: FilmSamples): FilmReport {
  const frame: Frame = { width: input.width, height: input.height, diagonal: Math.hypot(input.width, input.height) }
  const duration = input.durationSeconds
  const findings: FilmFinding[] = []
  const note = (leg: LegName, severity: 'fail' | 'warn', sentence: string): void => {
    findings.push({ leg, severity, sentence })
  }

  // ---- faults -------------------------------------------------------------
  const malformedAt = new Map<string, number>()
  const samples: Sample[] = input.track.map((raw) => ({ t: raw.t, boxes: readBoxes(raw, malformedAt) }))
  const thrown = input.track.filter((raw) => raw.threw !== undefined)
  const shapeless = input.track.filter((raw) => raw.shape !== undefined)
  const impure: FilmReport['legs']['faults']['impure'] = []
  for (const probe of input.purity) {
    const first = readBoxes(probe.first, new Map())
    const again = readBoxes(probe.again, new Map())
    const differs = new Set<string>()
    if (first && again) {
      for (const id of new Set([...Object.keys(first), ...Object.keys(again)])) {
        const a = first[id]
        const b = again[id]
        if (!a || !b || (['x', 'y', 'w', 'h', 'op'] as const).some((key) => Math.abs(a[key] - b[key]) > PURITY_TOLERANCE_PX)) differs.add(id)
      }
    }
    const what: string[] = []
    if (differs.size > 0) what.push(`track gave different boxes for ${[...differs].join(', ')}`)
    if (probe.pictureDelta !== null && probe.pictureDelta > PURITY_PICTURE_TOLERANCE) {
      what.push(`the picture differed (energy ${round(probe.pictureDelta)})`)
    }
    if (what.length > 0) impure.push({ seconds: probe.t, viaSeconds: probe.via, what: what.join(' and ') })
  }
  const malformed = [...malformedAt].map(([id, t]) => ({ id, seconds: t }))

  if (impure.length > 0) {
    const worstCase = impure[0]!
    note(
      'faults',
      'fail',
      `time(t) is not a pure function of t: seeking ${seconds(worstCase.seconds)}, then ${seconds(worstCase.viaSeconds)}, then ` +
        `${seconds(worstCase.seconds)} again, ${worstCase.what}` +
        (impure.length > 1 ? ` (and at ${impure.slice(1).map((i) => seconds(i.seconds)).join(', ')})` : '') +
        '. Export and scrubbing seek out of order, so they will draw a different film. Compute every value from t alone: ' +
        'no counters, no state carried between calls, springs as closed forms.'
    )
  }
  if (thrown.length > 0) {
    const first = thrown.slice(0, 5)
    const calls = [...new Set(thrown.map((t) => `${t.threw}(t)`))].join(' and ')
    note(
      'faults',
      'fail',
      `${calls} threw at ${thrown.length} of ${input.track.length} sampled times, first at ` +
        `${first.map((t) => seconds(t.t)).join(', ')}: "${first[0]!.message ?? ''}". Those frames draw whatever the last good seek left. ` +
        'Fix the error; nothing at those times was measured.'
    )
  }
  if (shapeless.length > 0) {
    note(
      'faults',
      'fail',
      `track(t) returned ${shapeless[0]!.shape} at ${shapeless.length} sampled times, first at ${seconds(shapeless[0]!.t)}. ` +
        'It must return an object every time — {} when nothing is on screen.'
    )
  }
  if (malformed.length > 0) {
    note(
      'faults',
      'fail',
      `track(t) returned a box that is not five finite numbers for ${malformed.map((m) => `${m.id} (first at ${seconds(m.seconds)})`).join(', ')}. ` +
        'Each box is { x, y, w, h, op } in screen pixels; a NaN usually means a measurement taken before layout. Those boxes were ignored.'
    )
  }
  const faultsStatus: LegStatus =
    findings.some((f) => f.leg === 'faults') ? 'fail' : input.purity.length === 0 ? 'unmeasured' : 'pass'
  if (faultsStatus === 'unmeasured') note('faults', 'warn', 'Purity was not checked: no time was sampled twice.')

  // ---- continuity ---------------------------------------------------------
  const declaredBoundaries = meta.beats.slice(1)
  const found = sceneChanges(samples, frame, input.trackRate).filter(
    (t) => declaredBoundaries.every((beat) => Math.abs(beat - t) > BOUNDARY_MATCH_SECONDS) && t > BOUNDARY_MATCH_SECONDS
  )
  const all = [
    ...declaredBoundaries.map((seconds_) => ({ at: seconds_, declared: true })),
    ...found.map((seconds_) => ({ at: seconds_, declared: false }))
  ].sort((a, b) => a.at - b.at)
  const inBurst = (at: number): boolean =>
    all.some((start) => {
      const members = all.filter((other) => other.at >= start.at - 1e-9 && other.at <= start.at + BURST_WINDOW_SECONDS + 1e-9)
      return members.length >= BURST_COUNT && members.some((member) => member.at === at)
    })
  const boundaries: BoundaryReport[] = all.map(({ at, declared }) => {
    const judged = judgeBoundary(at, samples, frame, duration)
    const lost = judged.verdict === 'bare' || judged.verdict === 'untracked'
    const exempt: BoundaryReport['exempt'] =
      declared && meta.cuts.some((cut) => Math.abs(cut - at) <= BOUNDARY_MATCH_SECONDS)
        ? 'cut'
        : lost && at >= duration - END_EXEMPT_SECONDS
          ? 'end'
          : lost && inBurst(at)
            ? 'burst'
            : null
    return { ...judged, seconds: round(at, 3), declared, exempt }
  })
  const considered = boundaries.filter((b) => b.exempt === null)
  const carried = considered.filter((b) => b.verdict === 'carried').length
  const anchored = considered.filter((b) => b.verdict === 'anchored').length
  const bare = considered.length - carried - anchored
  const score = considered.length > 0 ? (carried + anchored / 2) / considered.length : null

  let continuityStatus: LegStatus
  if (score === null) {
    continuityStatus = 'unmeasured'
    note(
      'continuity',
      'warn',
      boundaries.length === 0
        ? 'Continuity was not measured: __film.beats declares one beat and the tracks show no scene change, so there is no boundary to judge. ' +
          'If the film has sections, list where each starts; if it is one continuous shot, judge it by eye with frame_grid.'
        : `Continuity was not measured: all ${boundaries.length} boundaries are exempt (${boundaries.map((b) => `${seconds(b.seconds)} ${b.exempt}`).join(', ')}). ` +
          'A film of nothing but cuts is a slideshow by declaration; carry the ones that are not hits.'
    )
  } else {
    continuityStatus = score < CARRY_FAIL_BELOW ? 'fail' : score < CARRY_WARN_BELOW ? 'warn' : 'pass'
    if (input.trackRate < MIN_TRACK_RATE) {
      if (continuityStatus === 'pass') continuityStatus = 'warn'
      note(
        'continuity',
        'warn',
        `The tracks were sampled ${round(input.trackRate, 1)} times a second, under the ${MIN_TRACK_RATE} a carry window needs, so each boundary's verdict is coarse.`
      )
    }
  }
  if (score !== null && score < CARRY_WARN_BELOW) {
    const lostOnes = considered.filter((b) => b.verdict === 'bare' || b.verdict === 'untracked')
    note(
      'continuity',
      score < CARRY_FAIL_BELOW ? 'fail' : 'warn',
      `Carry score ${score.toFixed(2)} over ${considered.length} boundaries (${carried} carried, ${anchored} anchored, ${bare} bare): ` +
        (score < CARRY_FAIL_BELOW
          ? `under ${CARRY_FAIL_BELOW}, this reads as slides — each beat replaces the last. `
          : `passes, under ${CARRY_WARN_BELOW} — it would be a better film carried. `) +
        (lostOnes.length > 0 ? `Bare at ${lostOnes.map((b) => seconds(b.seconds)).join(', ')}: ` : '') +
        'at each, keep one tracked thing on screen across the boundary and move it at least ' +
        `${Math.round(CARRY_MOVE_DIAGONALS * frame.diagonal)} px or scale it ${Math.round((CARRY_SCALE_RATIO - 1) * 100)} % — ` +
        'the thing pressed becomes the result, the subject opens into the next stage — or list a deliberate hard cut in __film.cuts.'
    )
  }
  for (const boundary of boundaries.filter((b) => !b.declared)) {
    note(
      'continuity',
      'warn',
      `The tracked scene changes at ${seconds(boundary.seconds)} (${boundary.verdict}) and no beat starts there. It was judged as a boundary; ` +
        'add it to __film.beats so the beat lengths are true.'
    )
  }
  const exemptCount = boundaries.length - considered.length
  if (considered.length > 0 && exemptCount > considered.length) {
    note(
      'continuity',
      'warn',
      `${exemptCount} of ${boundaries.length} boundaries are exempt, so the carry score covers only ${considered.length}. A score over that few is not evidence.`
    )
  }

  // A picture that changes wholesale while every tracked box holds still is drawn by something untracked.
  const untracked: number[] = []
  if (input.energy) {
    const { step, values } = input.energy
    values.forEach((value, index) => {
      if (value === null || value < PICTURE_CUT_ENERGY) return
      const at = (index + 1) * step
      if (all.some((b) => Math.abs(b.at - at) <= BOUNDARY_MATCH_SECONDS)) return
      const a = nearest(samples, index * step)
      const b = nearest(samples, at)
      if (!a?.boxes || !b?.boxes) return
      const ids = new Set([...Object.keys(a.boxes), ...Object.keys(b.boxes)])
      const held = [...ids].every((id) => {
        const p = a.boxes![id]
        const q = b.boxes![id]
        if (!visible(p, frame) && !visible(q, frame)) return true
        if (!visible(p, frame) || !visible(q, frame)) return false
        return cornerTravel(p, q) < CARRY_MOVE_DIAGONALS * frame.diagonal && Math.abs(p.op - q.op) < 0.2
      })
      if (held) untracked.push(round(at))
    })
    if (untracked.length > 0) {
      note(
        'continuity',
        'warn',
        `The picture changes wholesale at ${untracked.slice(0, 6).map(seconds).join(', ')}${untracked.length > 6 ? ` and ${untracked.length - 6} more` : ''} ` +
          'while every tracked box holds: something is on screen that track(t) does not report, so the carry score is about less than the viewer sees. Track it.'
      )
    }
  }

  // ---- curves -------------------------------------------------------------
  const scale = frame.diagonal / DIAGONAL_1080P
  const limit = FAST_PX_PER_FRAME_AT_1080P * scale
  const rest = REST_PX_PER_FRAME_AT_1080P * scale
  const perFrame = input.trackRate / input.fps
  const crossesCut = (from: number, to: number): boolean => meta.cuts.some((cut) => cut > from + 1e-9 && cut <= to + 1e-9)
  const ids = [...new Set(samples.flatMap((sample) => Object.keys(sample.boxes ?? {})))]
  const peaks: FilmReport['legs']['curves']['peaks'] = []
  const moves: MoveReport[] = []
  for (const id of ids) {
    let peak = { pxPerFrame: 0, seconds: 0 }
    let over = 0
    let run: { from: number; to: number; steps: number[] } | null = null
    const close = (): void => {
      if (!run) return
      const travel = run.steps.reduce((sum, step) => sum + step, 0)
      if (travel >= MOVE_MIN_DIAGONALS * frame.diagonal && run.steps.length >= 3) {
        let done = 0
        let t80 = 1
        for (let i = 0; i < run.steps.length; i += 1) {
          const next = done + run.steps[i]!
          if (next >= 0.8 * travel) {
            t80 = (i + (0.8 * travel - done) / run.steps[i]!) / run.steps.length
            break
          }
          done = next
        }
        moves.push({
          id,
          fromSeconds: round(run.from),
          toSeconds: round(run.to),
          travelPx: Math.round(travel),
          peakPxPerFrame: round(Math.max(...run.steps) * perFrame, 1),
          t80: round(t80)
        })
      }
      run = null
    }
    for (let k = 1; k < samples.length; k += 1) {
      const a = samples[k - 1]!
      const b = samples[k]!
      const p = a.boxes?.[id]
      const q = b.boxes?.[id]
      if (!present(p) || !present(q) || (!visible(p, frame) && !visible(q, frame)) || crossesCut(a.t, b.t)) {
        close()
        continue
      }
      const step = cornerTravel(p, q)
      const speed = step * perFrame
      if (speed > peak.pxPerFrame) peak = { pxPerFrame: speed, seconds: b.t }
      if (speed > limit) over += 1
      if (speed > rest) {
        if (!run) run = { from: a.t, to: b.t, steps: [] }
        run.steps.push(step)
        run.to = b.t
      } else close()
    }
    close()
    peaks.push({ id, pxPerFrame: round(peak.pxPerFrame, 1), seconds: round(peak.seconds), framesOverLimit: Math.round(over / perFrame) })
  }
  peaks.sort((a, b) => b.pxPerFrame - a.pxPerFrame)
  moves.sort((a, b) => b.travelPx - a.travelPx)
  const fast = peaks.filter((peak) => peak.pxPerFrame > limit)
  const totalTravel = moves.reduce((sum, move) => sum + move.travelPx, 0)
  const sortedT80 = moves.map((move) => move.t80).sort((a, b) => a - b)
  const medianT80 = sortedT80.length > 0 ? sortedT80[Math.floor((sortedT80.length - 1) / 2)]! : null
  const softTravelShare =
    totalTravel > 0 ? round(moves.filter((m) => m.t80 >= SOFT_T80).reduce((sum, m) => sum + m.travelPx, 0) / totalTravel) : null
  let curvesStatus: LegStatus = ids.length === 0 ? 'unmeasured' : 'pass'
  if (ids.length === 0) {
    note('curves', 'warn', 'Curves were not measured: track(t) never returned a box, so nothing was followed. Return a box for each thing that moves.')
  }
  if (fast.length > 0 && !meta.blur) {
    curvesStatus = 'fail'
    note(
      'curves',
      'fail',
      `${fast.map((f) => `${f.id} moves ${Math.round(f.pxPerFrame)} px/frame at ${seconds(f.seconds)}`).join('; ')} — over ` +
        `${Math.round(limit)} px/frame at ${input.fps} fps (${FAST_PX_PER_FRAME_AT_1080P} at 1080p). Without motion blur that strobes into ` +
        'separate copies. Give the move more frames, shorten its travel, or draw real motion blur and declare __film.blur: true.'
    )
  }
  if (moves.length >= 3 && sortedT80[sortedT80.length - 1]! - sortedT80[0]! <= SAME_CURVE_BAND) {
    if (curvesStatus === 'pass') curvesStatus = 'warn'
    note(
      'curves',
      'warn',
      `All ${moves.length} moves are the same curve: every t80 is between ${sortedT80[0]} and ${sortedT80[sortedT80.length - 1]}. ` +
        'Ease them differently by what they are — a landing snaps (t80 near 0.3), a camera drifts (near 0.7), a spring overshoots.'
    )
  }

  // ---- rhythm -------------------------------------------------------------
  const beatSeconds = meta.beats.map((beat, index) => round((meta.beats[index + 1] ?? duration) - beat, 3))
  const mean = beatSeconds.reduce((sum, value) => sum + value, 0) / beatSeconds.length
  const beatCv =
    beatSeconds.length >= 2 ? Math.sqrt(beatSeconds.reduce((sum, value) => sum + (value - mean) ** 2, 0) / beatSeconds.length) / mean : null
  const longestOverShortest = beatSeconds.length >= 2 ? Math.max(...beatSeconds) / Math.min(...beatSeconds) : null
  const rhythmStatuses: LegStatus[] = []
  if (beatCv === null || beatSeconds.length < 3) {
    rhythmStatuses.push('unmeasured')
    note(
      'rhythm',
      'warn',
      `Cadence was not measured: ${beatSeconds.length} beat${beatSeconds.length === 1 ? ' is' : 's are'} declared and it takes three to tell a rhythm from a metronome.`
    )
  } else if (beatCv < BEAT_CV_MIN) {
    rhythmStatuses.push('fail')
    note(
      'rhythm',
      'fail',
      `The beats are a metronome: lengths ${beatSeconds.join(', ')} s vary by ${beatCv.toFixed(2)} (coefficient of variation), under ${BEAT_CV_MIN}. ` +
        `Equal beats read as slides even when each one moves. Make the longest at least ${BEAT_RATIO_MIN}x the shortest: a burst of short hits, one long rest.`
    )
  } else if (longestOverShortest !== null && longestOverShortest < BEAT_RATIO_MIN) {
    rhythmStatuses.push('warn')
    note(
      'rhythm',
      'warn',
      `The longest beat is ${longestOverShortest.toFixed(1)}x the shortest (${Math.max(...beatSeconds)} s against ${Math.min(...beatSeconds)} s); the method asks for ${BEAT_RATIO_MIN}x. ` +
        'Shorten the hits or lengthen the rest.'
    )
  } else rhythmStatuses.push('pass')

  let stillShare: number | null = null
  let lowShare: number | null = null
  let longestRest: { fromSeconds: number; toSeconds: number } | null = null
  let energyPerBeat: number[] | null = null
  const moving: FilmReport['legs']['rhythm']['moving'] = []
  if (!input.energy || input.energy.values.every((value) => value === null)) {
    rhythmStatuses.push('unmeasured')
    note('rhythm', 'warn', `Stillness was not measured: ${input.energyMissing ?? 'no picture could be captured'}.`)
  } else {
    const { step, values } = input.energy
    const measured = values.filter((value): value is number => value !== null)
    stillShare = round(measured.filter((value) => value < STILL_ENERGY).length / measured.length)
    lowShare = round(measured.filter((value) => value < LOW_ENERGY).length / measured.length)
    let restFrom: number | null = null
    let moveFrom: number | null = null
    let movePeak = 0
    // In steps, not seconds: rounded seconds cannot be compared.
    let rest_ = { from: 0, to: 0 }
    const endRest = (index: number): void => {
      if (restFrom === null) return
      if (index - restFrom > rest_.to - rest_.from) rest_ = { from: restFrom, to: index }
      restFrom = null
    }
    const endMove = (index: number): void => {
      if (moveFrom === null) return
      moving.push({ fromSeconds: round(moveFrom * step), toSeconds: round(index * step), peak: round(movePeak, 1) })
      moveFrom = null
      movePeak = 0
    }
    values.forEach((value, index) => {
      if (value !== null && value < LOW_ENERGY) {
        endMove(index)
        if (restFrom === null) restFrom = index
      } else {
        endRest(index)
        if (value !== null) {
          if (moveFrom === null) moveFrom = index
          movePeak = Math.max(movePeak, value)
        } else endMove(index)
      }
    })
    endRest(values.length)
    endMove(values.length)
    energyPerBeat = meta.beats.map((beat, index) => {
      const end = meta.beats[index + 1] ?? duration
      const inside = values.filter((value, i): value is number => value !== null && i * step >= beat - 1e-9 && (i + 1) * step <= end + 1e-9)
      return inside.length > 0 ? round(inside.reduce((sum, value) => sum + value, 0) / inside.length) : 0
    })
    const restSeconds = (rest_.to - rest_.from) * step
    if (rest_.to > rest_.from) longestRest = { fromSeconds: round(rest_.from * step), toSeconds: round(rest_.to * step) }
    const neverRests = restSeconds < REST_SECONDS_MIN - 1e-9
    const neverStill = stillShare < STILL_SHARE_MIN
    if (neverRests || neverStill) {
      rhythmStatuses.push('fail')
      note(
        'rhythm',
        'fail',
        'The film never stops: ' +
          [
            neverStill ? `${Math.round(stillShare * 100)} % of it is dead still, under ${STILL_SHARE_MIN * 100} %` : null,
            neverRests ? `its longest rest is ${round(restSeconds)} s, under ${REST_SECONDS_MIN} s` : null
          ]
            .filter(Boolean)
            .join(' and ') +
          '. Moves land only against stillness. Hold a finished frame with nothing moving — no drift, no slow push, which reads as motion — ' +
          `for at least ${REST_SECONDS_MIN} s, and let the settled beats sit.`
      )
    } else rhythmStatuses.push('pass')
  }
  const rhythmStatus: LegStatus = rhythmStatuses.includes('fail')
    ? 'fail'
    : rhythmStatuses.includes('warn')
      ? 'warn'
      : rhythmStatuses.includes('unmeasured')
        ? 'unmeasured'
        : 'pass'

  // ---- framing ------------------------------------------------------------
  const step = 1 / input.trackRate
  const subjects: FilmReport['legs']['framing']['subjects'] = []
  for (const [id, want] of Object.entries(meta.inFrame)) {
    if (!ids.includes(id)) {
      subjects.push({ id, whole: want.whole, out: [{ fromSeconds: want.from, toSeconds: want.to, how: 'absent' }] })
      note(
        'framing',
        'fail',
        `__film.inFrame names ${id}, but track(t) never returns it${ids.length > 0 ? ` (it returns ${ids.join(', ')})` : ''}. ` +
          'Use the same id in both, or the subject is not being watched at all.'
      )
      continue
    }
    const out: FilmReport['legs']['framing']['subjects'][number]['out'] = []
    for (const how of ['absent', 'off frame', 'cut by the edge'] as const) {
      const times = between(samples, want.from, want.to)
        .filter((sample) => sample.boxes !== null)
        .filter((sample) => framed(sample.boxes![id], frame, want.whole) === how)
        .map((sample) => sample.t)
      for (const range of ranges(times, step)) out.push({ fromSeconds: round(range.fromSeconds), toSeconds: round(range.toSeconds), how })
    }
    out.sort((a, b) => a.fromSeconds - b.fromSeconds)
    subjects.push({ id, whole: want.whole, out })
    if (out.length > 0) {
      note(
        'framing',
        'fail',
        `${id} must stay ${want.whole ? 'whole ' : ''}in frame from ${want.from} to ${seconds(want.to)} and is ` +
          out.slice(0, 4).map((o) => `${o.how} at ${span(o)}`).join(', ') +
          (out.length > 4 ? ` and ${out.length - 4} more stretches` : '') +
          '. Key the camera to where it lands before it gets there, or widen the shot.'
      )
    }
  }
  const framingStatus: LegStatus =
    subjects.length === 0 ? 'unmeasured' : subjects.some((subject) => subject.out.length > 0) ? 'fail' : 'pass'

  // ---- verdict ------------------------------------------------------------
  findings.sort(
    (a, b) =>
      (a.severity === 'fail' ? 0 : 1) - (b.severity === 'fail' ? 0 : 1) || HIDDEN_FIRST.indexOf(a.leg) - HIDDEN_FIRST.indexOf(b.leg)
  )
  const statuses = { faults: faultsStatus, continuity: continuityStatus, curves: curvesStatus, rhythm: rhythmStatus, framing: framingStatus }
  // The findings are the verdict: every failing or warning leg says so in one, and so does every
  // leg that measured nothing — except framing, which is optional and unmeasured in silence.
  const verdict = findings.some((f) => f.severity === 'fail') ? 'fail' : findings.length > 0 ? 'warn' : 'pass'
  const failed = (Object.keys(statuses) as LegName[]).filter((leg) => statuses[leg] === 'fail')
  const unmeasured = (Object.keys(statuses) as LegName[]).filter((leg) => statuses[leg] === 'unmeasured' && leg !== 'framing')
  const summary =
    verdict === 'fail'
      ? `FAIL: ${failed.join(', ')}. ${findings[0]!.sentence}`
      : verdict === 'warn'
        ? `WARN${unmeasured.length > 0 ? ` (${unmeasured.join(', ')} not measured)` : ''}: ${findings[0]?.sentence ?? ''}`
        : `PASS: carry ${score!.toFixed(2)} over ${considered.length} boundaries, ${Math.round((stillShare ?? 0) * 100)} % still, ` +
          `fastest move ${Math.round(peaks[0]?.pxPerFrame ?? 0)} px/frame. Read \`blind\` before trusting it.`

  return {
    verdict,
    summary,
    findings,
    legs: {
      faults: {
        status: faultsStatus,
        threw: {
          count: thrown.length,
          first: thrown.slice(0, 5).map((t) => ({ seconds: round(t.t), call: t.threw!, message: t.message ?? '' }))
        },
        impure,
        malformed
      },
      continuity: {
        status: continuityStatus,
        score: score === null ? null : round(score),
        carried,
        anchored,
        bare,
        considered: considered.length,
        boundaries,
        untracked
      },
      curves: {
        status: curvesStatus,
        limitPxPerFrame: round(limit, 1),
        blurDeclared: meta.blur,
        // Only what moved: a list of every still card's 0 px/frame is noise around the one that matters.
        peaks: peaks.filter((peak) => peak.pxPerFrame > 0),
        moves: moves.slice(0, 12),
        medianT80,
        softTravelShare
      },
      rhythm: {
        status: rhythmStatus,
        beatSeconds,
        beatCv: beatCv === null ? null : round(beatCv),
        longestOverShortest: longestOverShortest === null ? null : round(longestOverShortest, 1),
        stillShare,
        lowShare,
        longestRest,
        moving,
        energyPerBeat
      },
      framing: { status: framingStatus, subjects }
    },
    sampling: {
      fps: input.fps,
      width: input.width,
      height: input.height,
      durationSeconds: duration,
      trackRate: round(input.trackRate, 2),
      trackSamples: input.track.length,
      energyStepSeconds: input.energy ? round(input.energy.step, 4) : null,
      pictures: input.energy ? input.energy.values.length + 1 : 0
    },
    blind: BLIND
  }
}

function nearest(samples: Sample[], t: number): Sample | undefined {
  let best: Sample | undefined
  for (const sample of samples) {
    if (!best || Math.abs(sample.t - t) < Math.abs(best.t - t)) best = sample
  }
  return best
}

/** The farthest any corner of a box travels between two samples: translation and scaling both count. */
function cornerTravel(a: FilmBox, b: FilmBox): number {
  return Math.max(
    Math.hypot(b.x - a.x, b.y - a.y),
    Math.hypot(b.x + b.w - (a.x + a.w), b.y - a.y),
    Math.hypot(b.x - a.x, b.y + b.h - (a.y + a.h)),
    Math.hypot(b.x + b.w - (a.x + a.w), b.y + b.h - (a.y + a.h))
  )
}

function framed(box: FilmBox | undefined, frame: Frame, whole: boolean): 'in' | 'absent' | 'off frame' | 'cut by the edge' {
  if (!present(box)) return 'absent'
  if (shownArea(box, frame) === 0) return 'off frame'
  if (whole && (box.x < -0.5 || box.y < -0.5 || box.x + box.w > frame.width + 0.5 || box.y + box.h > frame.height + 0.5)) return 'cut by the edge'
  return 'in'
}

// ---------------------------------------------------------------------------
// The sampling plan
// ---------------------------------------------------------------------------

/** How many times `track` is sampled at most. A call is cheap — no paint — but not free. */
export const MAX_TRACK_SAMPLES = 7200
/** How many pictures are captured at most; each costs a 40–80 ms capture in main. */
export const MAX_PICTURES = 600

export interface FilmPlan {
  /** Times `track` is read at: every frame of the film, or evenly fewer past the cap. */
  trackTimes: number[]
  trackRate: number
  /** Times a picture is captured at, {@link ENERGY_STEP_SECONDS} apart or evenly wider past the cap. */
  pictureTimes: number[]
  pictureStep: number
  /** `[t, via]`: times read twice with a seek elsewhere between, always picture times. */
  purity: [number, number][]
}

/**
 * Which times to sample. Tracks at the film's rate, because a peak speed is a per-frame number
 * and a carry window is half a second; pictures at 12 a second, because that is the scale the
 * stillness thresholds were published on and a capture is three orders dearer than a track call.
 */
export function planFilm(durationSeconds: number, fps: number, pictures: boolean): FilmPlan {
  const frames = Math.max(2, Math.floor(durationSeconds * fps + 1e-6) + 1)
  const trackCount = Math.min(frames, MAX_TRACK_SAMPLES)
  const trackRate = trackCount === frames ? fps : (trackCount - 1) / durationSeconds
  const trackTimes = Array.from({ length: trackCount }, (_, k) => Math.min(k / trackRate, durationSeconds))

  const wanted = Math.floor(durationSeconds / ENERGY_STEP_SECONDS + 1e-6) + 1
  const pictureCount = pictures ? Math.max(2, Math.min(wanted, MAX_PICTURES)) : 0
  const pictureStep = pictureCount === wanted ? ENERGY_STEP_SECONDS : durationSeconds / Math.max(1, pictureCount - 1)
  const pictureTimes = Array.from({ length: pictureCount }, (_, k) => Math.min(k * pictureStep, durationSeconds))

  // Three probes, each returning from far away: a state that accumulates shows as a difference.
  const grid = pictures ? pictureTimes : trackTimes
  const at = (share: number): number => grid[Math.min(grid.length - 1, Math.round(share * (grid.length - 1)))]!
  const purity: [number, number][] = [
    [at(0.37), at(0.83)],
    [at(0.71), at(0.11)],
    [at(0.05), at(0.93)]
  ]
  return { trackTimes, trackRate, pictureTimes, pictureStep, purity }
}
