/**
 * Multicam cutting by whose mic is loudest: per-mic level curves in, a cut list out.
 *
 * The rules are podclip's (github.com/treydoe1/podclip-public-release, MIT — ideas reimplemented,
 * no code copied; r&d/research/podclip.md and its audit, r&d/research/audit.md §8):
 *
 * 1. **Latch** each mic: a mic is *hot* in a 50 ms window when its RMS is at or above its
 *    threshold. It becomes *active* once it has been hot for `attackSec` without a break, and
 *    stays active through breaths and gaps up to `releaseSec`.
 * 2. **Bleed**: when the loudest active mic is `dominanceDb` or more above the next active one,
 *    the others are that voice leaking into their mics and do not count.
 * 3. **Pick an angle**: one active speaker → their angle; two or more → the wide angle if there is
 *    one, else the loudest speaker's; nobody → hold the current shot.
 * 4. **Debounce**: a new angle must stay the choice for `delaySec`, and no cut comes sooner than
 *    `minShotSec` after the last. The cut is placed `leadSec` *before* the decision, so the speaker
 *    is on screen a moment before they would otherwise have been.
 *
 * Where it departs from podclip, on purpose:
 *
 * - **No dead option.** podclip's wide-frequency setting offers four values and implements two
 *   (audit §8.3, reproduced); here the wide angle is either given or not.
 * - **No redundant leading cut, and so a refusal that works.** podclip prepends a hold for the
 *   first camera whenever the first cut is past sample 0 — which it always is — so every non-silent
 *   run had two events and its "only one camera" refusal never fired (audit §8.3). Here the first
 *   decided angle is simply the shot from the start, consecutive segments on one angle are merged,
 *   and the caller refuses on **distinct angles used**, not on an event count.
 * - **Time, not rounded samples.** podclip rounds the lead-in to whole 50 ms samples (its 0.12 s
 *   default acts as 0.10 s). Decisions here are made per window, but the cut is placed at the
 *   exact `decision − leadSec` and then rounded once, to a timeline frame.
 * - **Relative thresholds by default.** podclip's −50 dB is absolute, so a quiet guest and a loud
 *   host need hand-tuned per-mic values. Absent `thresholdDb`, each mic is thresholded halfway
 *   between its own floor (10th percentile) and speech level (95th) — a heuristic, unmeasured on
 *   real podcasts, which is why `thresholdDb` stays as the override and every refusal reports each
 *   mic's floor, speech level and threshold.
 *
 * With the defaults below, speech that starts at t is cut to at t + 0.30 s (attack 7 windows −1,
 * + delay 2 windows, − lead 0.10 s) — the latency the audit measured on podclip itself.
 */

import { findItem, itemEnd, type Item, type Timeline } from './project'
import { splitItemAt } from './split'

/** Level windows are 50 ms: 20 a second, podclip's rate. */
export const LEVEL_WINDOW_SEC = 0.05

export interface SwitchOptions {
  /** One absolute threshold (dBFS RMS) for every mic. Null: each mic's own, from its levels. */
  thresholdDb: number | null
  /** How far the loudest active mic must lead the next for the next to count as bleed. */
  dominanceDb: number
  /** Hot this long without a break to become active. */
  attackSec: number
  /** Stays active this long after it stops being hot. */
  releaseSec: number
  /** A new angle must stay the choice this long before it is cut to. */
  delaySec: number
  /** No shot shorter than this. */
  minShotSec: number
  /** The cut lands this much before the decision. */
  leadSec: number
}

/** podclip's numbers (audit §8.2), with the lead-in it actually applies (0.10 s, not its slider's 0.12). */
export const SWITCH_DEFAULTS: SwitchOptions = {
  thresholdDb: null,
  dominanceDb: 6,
  attackSec: 0.35,
  releaseSec: 0.45,
  delaySec: 0.1,
  minShotSec: 0.75,
  leadSec: 0.1
}

/** Heuristic: a mic whose speech level is under this far above its floor never had a voice on it. */
export const MIN_SPEECH_RANGE_DB = 10
/** Heuristic: an automatic threshold is never set below this, whatever the floor. */
export const AUTO_THRESHOLD_FLOOR_DB = -60

export interface MicStats {
  /** 10th percentile of the level: the room with nobody talking. */
  floorDb: number
  /** 95th percentile: this mic's speech level, when its speaker talks at all. */
  speechDb: number
  /** What counted as hot. Infinity when the mic never had a voice on it (automatic mode). */
  thresholdDb: number
  /** Share of the span this mic was active. */
  activeShare: number
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NEGATIVE_INFINITY
  const sorted = [...values].sort((a, b) => a - b)
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[at]!
}

/** A mic's floor, speech level and automatic threshold (Infinity when it never held a voice). */
export function autoThreshold(levels: readonly number[]): { floorDb: number; speechDb: number; thresholdDb: number } {
  const floorDb = percentile(levels, 10)
  const speechDb = percentile(levels, 95)
  if (!(speechDb - floorDb >= MIN_SPEECH_RANGE_DB)) return { floorDb, speechDb, thresholdDb: Number.POSITIVE_INFINITY }
  return { floorDb, speechDb, thresholdDb: Math.max(AUTO_THRESHOLD_FLOOR_DB, floorDb + (speechDb - floorDb) / 2) }
}

/**
 * Which mics are active in each window, after attack and release: `active[w][m]`.
 * Exported for the tests, which pin attack and release on their own.
 */
export function latchMics(curves: readonly (readonly number[])[], thresholds: readonly number[], options: Pick<SwitchOptions, 'attackSec' | 'releaseSec'>): boolean[][] {
  const windows = Math.min(...curves.map((c) => c.length))
  const attack = Math.max(1, Math.round(options.attackSec / LEVEL_WINDOW_SEC))
  const release = Math.max(0, Math.round(options.releaseSec / LEVEL_WINDOW_SEC))
  const hotRun = curves.map(() => 0)
  const releaseLeft = curves.map(() => 0)
  const latched = curves.map(() => false)
  const out: boolean[][] = []
  for (let w = 0; w < windows; w += 1) {
    const row: boolean[] = []
    for (let m = 0; m < curves.length; m += 1) {
      const level = curves[m]![w]!
      if (level >= thresholds[m]!) {
        hotRun[m]! += 1
        releaseLeft[m] = release
        if (hotRun[m]! >= attack) latched[m] = true
      } else {
        hotRun[m] = 0
        if (latched[m]) {
          if (releaseLeft[m]! > 0) releaseLeft[m]! -= 1
          if (releaseLeft[m]! <= 0) latched[m] = false
        }
      }
      row.push(latched[m]!)
    }
    out.push(row)
  }
  return out
}

/** The active mics that count, after bleed: only the loudest when it leads the next by `dominanceDb`. */
export function dominantSet(active: readonly number[], levels: readonly number[], dominanceDb: number): number[] {
  if (active.length <= 1) return [...active]
  const byLevel = [...active].sort((a, b) => levels[b]! - levels[a]!)
  if (levels[byLevel[0]!]! - levels[byLevel[1]!]! >= dominanceDb) return [byLevel[0]!]
  return byLevel
}

export interface SwitchSegment {
  /** The angle on screen: 0..n-1 are the speakers' angles, n is the wide. */
  angle: number
  fromFrame: number
  toFrame: number
}

export interface SwitchPlan {
  segments: SwitchSegment[]
  /** Distinct angles the plan puts on screen. One means there is nothing to switch. */
  anglesUsed: number
  mics: MicStats[]
}

/**
 * The cut list for `curves` (one per speaker, 50 ms windows, all starting at `startFrame` on the
 * timeline), covering [startFrame, endFrame). `hasWide` adds angle index `curves.length`.
 */
export function planSwitch(
  curves: readonly (readonly number[])[],
  span: { startFrame: number; endFrame: number; fps: number },
  hasWide: boolean,
  given: Partial<SwitchOptions> = {}
): SwitchPlan {
  const options: SwitchOptions = { ...SWITCH_DEFAULTS, ...given }
  const auto = curves.map((c) => autoThreshold(c))
  const thresholds = curves.map((_, m) => (options.thresholdDb === null ? auto[m]!.thresholdDb : options.thresholdDb))
  const latched = curves.length > 0 ? latchMics(curves, thresholds, options) : []
  const windows = latched.length
  const wide = hasWide ? curves.length : -1
  const delay = Math.max(0, Math.round(options.delaySec / LEVEL_WINDOW_SEC))

  let current: number | null = null
  /** The first decided angle: the shot from the start of the span. */
  let initial: number | null = null
  let candidate: number | null = null
  let candidateSince = 0
  let lastCutSec = 0
  const cuts: { atSec: number; angle: number }[] = []
  const activeCount = curves.map(() => 0)

  for (let w = 0; w < windows; w += 1) {
    const row = latched[w]!
    const levels = curves.map((c) => c[w]!)
    const active = row.flatMap((on, m) => (on ? [m] : []))
    for (const m of active) activeCount[m]! += 1
    const set = dominantSet(active, levels, options.dominanceDb)
    let proposal: number | null
    if (set.length === 0) proposal = current
    else if (set.length === 1) proposal = set[0]!
    else proposal = wide >= 0 ? wide : set[0]!

    if (proposal === null || proposal === current) {
      candidate = null
      continue
    }
    if (proposal !== candidate) {
      candidate = proposal
      candidateSince = w
    }
    if (w - candidateSince < delay) continue
    if (current === null) {
      // The first decided angle is the shot from the start: no cut, and no leading razor.
      current = candidate
      initial = candidate
      candidate = null
      continue
    }
    const atSec = w * LEVEL_WINDOW_SEC - options.leadSec
    if (atSec - lastCutSec < options.minShotSec) continue
    cuts.push({ atSec, angle: candidate })
    current = candidate
    candidate = null
    lastCutSec = atSec
  }

  const mics: MicStats[] = curves.map((_, m) => ({
    floorDb: auto[m]!.floorDb,
    speechDb: auto[m]!.speechDb,
    thresholdDb: thresholds[m]!,
    activeShare: windows > 0 ? Math.round((activeCount[m]! / windows) * 1000) / 1000 : 0
  }))
  if (initial === null) return { segments: [], anglesUsed: 0, mics }

  const segments = toSegments(initial!, cuts, span, options.minShotSec)
  return { segments, anglesUsed: new Set(segments.map((s) => s.angle)).size, mics }
}

/** Cuts in seconds → frame segments over the span, short shots folded into the one before, like runs merged. */
function toSegments(
  first: number,
  cuts: readonly { atSec: number; angle: number }[],
  span: { startFrame: number; endFrame: number; fps: number },
  minShotSec: number
): SwitchSegment[] {
  const minFrames = Math.max(1, Math.round(minShotSec * span.fps))
  let segments: SwitchSegment[] = []
  let angle = first
  let from = span.startFrame
  for (const cut of cuts) {
    const at = Math.min(span.endFrame, Math.max(span.startFrame, span.startFrame + Math.round(cut.atSec * span.fps)))
    if (at > from) {
      segments.push({ angle, fromFrame: from, toFrame: at })
      from = at
    }
    angle = cut.angle
  }
  if (span.endFrame > from) segments.push({ angle, fromFrame: from, toFrame: span.endFrame })

  // Fold any shot under the minimum into the shot before it (the first into the one after), then
  // merge neighbours that ended up on one angle. Repeat until nothing changes.
  for (let changed = true; changed; ) {
    changed = false
    const merged: SwitchSegment[] = []
    for (const seg of segments) {
      const prev = merged[merged.length - 1]
      if (prev && prev.angle === seg.angle) {
        prev.toFrame = seg.toFrame
        changed = true
      } else merged.push({ ...seg })
    }
    segments = merged
    const short = segments.findIndex((s) => s.toFrame - s.fromFrame < minFrames)
    if (short >= 0 && segments.length > 1) {
      if (short === 0) segments[1]!.fromFrame = segments[0]!.fromFrame
      else segments[short - 1]!.toFrame = segments[short]!.toFrame
      segments.splice(short, 1)
      changed = true
    }
  }
  return segments
}

// --- Applying a plan ----------------------------------------------------------------------------

/**
 * bay's representation of a switched multicam: **the angles stay stacked on their own tracks,
 * each razored where it goes on or off screen, and the pieces that are off screen are disabled**
 * (`Item.disabled`: on the timeline, drawn and heard nowhere — preview, `preview_frame` and export
 * all read it through `playableTimeline`). podclip does the same in Premiere, and it is the most
 * reversible shape bay has: every angle keeps its whole footage in place, re-enabling any piece
 * shows that angle there, and nothing is copied onto a new track that could drift from the
 * original. An angle is razored only where *its own* state changes (a switch between two other
 * angles leaves it whole), and at the span's edges only if it is off there.
 *
 * Pictures only: a piece is disabled on its own, never with its linked sound, so the room keeps
 * sounding while the picture switches. The caller detaches any sound still embedded in an angle
 * first, since disabling a picture that carries its own sound would silence it.
 */
export function applyAngleSwitch(
  timeline: Timeline,
  itemIds: readonly string[],
  segments: readonly SwitchSegment[],
  newId: () => string
): { createdItemIds: string[]; disabledItemIds: string[] } {
  const created: string[] = []
  const disabled: string[] = []
  if (segments.length === 0) return { createdItemIds: created, disabledItemIds: disabled }
  const spanFrom = segments[0]!.fromFrame
  const spanTo = segments[segments.length - 1]!.toFrame
  const angleAt = (frame: number): number | null => segments.find((s) => frame >= s.fromFrame && frame < s.toFrame)?.angle ?? null

  itemIds.forEach((itemId, angle) => {
    const found = findItem(timeline, itemId)
    if (!found || found.track.locked) return
    const track = found.track
    const start = found.item.from
    const end = itemEnd(found.item)
    // Where this angle's on/off state changes inside the item: the span's edges and its own switches.
    // Outside the span the clip keeps the state it has, so an edge is a cut only when that differs.
    const onAt = (frame: number): boolean | null => (frame >= spanFrom && frame < spanTo ? angleAt(frame) === angle : null)
    const wasOn = !found.item.disabled
    const stateAt = (frame: number): boolean => onAt(frame) ?? wasOn
    const cuts: number[] = []
    for (const at of [spanFrom, spanTo, ...segments.map((s) => s.fromFrame)]) {
      if (at <= start || at >= end || cuts.includes(at)) continue
      if (stateAt(at - 1) !== stateAt(at)) cuts.push(at)
    }
    cuts.sort((a, b) => a - b)
    const pieces: Item[] = [found.item]
    for (const at of cuts) {
      const right = splitItemAt(pieces[pieces.length - 1]!, at, timeline.fps, newId())
      if (!right) continue
      pieces.push(right)
      track.items.push(right)
      created.push(right.id)
    }
    for (const piece of pieces) {
      const on = onAt(Math.floor((piece.from + itemEnd(piece)) / 2))
      if (on === null) continue
      if (on) delete piece.disabled
      else {
        piece.disabled = true
        disabled.push(piece.id)
      }
    }
    track.items.sort((a, b) => a.from - b.from)
  })
  return { createdItemIds: created, disabledItemIds: disabled }
}
