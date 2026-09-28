/**
 * Silences → timeline frame ranges to remove, for `remove_silences`.
 *
 * ffmpeg's `silencedetect` reports silences in seconds of *source*, from the start of the span it
 * read (`media/audio-analysis.ts`). The span read for a clip is exactly what the clip plays — from
 * its in-point, for its duration × speed — so a silence s seconds in is at timeline frame
 * `item.from + s · fps / speed`. That is the one mapping, and the tests pin it through an in-point
 * and a speed, because a mapping that ignores either removes the wrong words.
 *
 * Across several clips (two mics of one podcast, say) a moment is removable only when **every
 * analysed clip that plays it is silent** — one person pausing while the other talks is not a
 * pause. On one track the clips do not overlap, so this is simply each clip's own silences.
 *
 * Defaults, from the open-source cutters surveyed in r&d/research/github-repos.md §1:
 * - threshold **−30 dBFS**: auto-editor's 0.04 linear is ≈ −28, jumpcutter's 0.03 ≈ −30 and
 *   unsilence uses −35. −30 sits in the middle, loose enough for a room tone around −40 to count
 *   as silence and tight enough that a quiet trailing syllable does not.
 * - minimum silence **0.5 s** (unsilence's silence-time-threshold). auto-editor's 0.2 s min-cut is
 *   meant for its own frame-level smoothing; with padding kept on both sides a 0.2 s silence would
 *   leave nothing to remove anyway, and cutting every sub-half-second breath makes speech breathless.
 * - padding **0.2 s** kept on each side (auto-editor's margin), so every cut keeps a breath and no
 *   consonant is clipped. The shortest thing removed is therefore 0.5 − 2·0.2 = 0.1 s.
 */

import type { SilenceInterval } from './ipc'

export const SILENCE_DEFAULTS = {
  thresholdDb: -30,
  minSilenceSec: 0.5,
  keepPaddingSec: 0.2
} as const

/** What the mapping needs of a clip. */
export interface SilenceClip {
  from: number
  durationInFrames: number
  speed: number
}

/** A span of timeline frames, possibly fractional until it is rounded to a cut. */
export interface FrameSpan {
  from: number
  to: number
}

const speedOf = (speed: number): number => (Number.isFinite(speed) && speed > 0 ? speed : 1)

/** A clip's silences (seconds from its in-point, source time) as timeline frames, clipped to the clip. */
export function silenceFrames(clip: SilenceClip, silences: readonly SilenceInterval[], fps: number): FrameSpan[] {
  const speed = speedOf(clip.speed)
  const end = clip.from + clip.durationInFrames
  return silences
    .map((s) => ({ from: clip.from + (s.startSec * fps) / speed, to: clip.from + (s.endSec * fps) / speed }))
    .map((s) => ({ from: Math.max(clip.from, s.from), to: Math.min(end, s.to) }))
    .filter((s) => s.to > s.from)
}

export interface AnalysedClip {
  clip: SilenceClip
  /** Its silences in timeline frames (from `silenceFrames`). */
  silent: readonly FrameSpan[]
}

/**
 * Where every analysed clip that plays a moment is silent there (and at least one plays it), as
 * fractional frame spans. Elementary intervals between all the boundaries, each judged at its
 * midpoint, then joined.
 */
export function commonSilence(clips: readonly AnalysedClip[]): FrameSpan[] {
  const bounds = new Set<number>()
  for (const { clip, silent } of clips) {
    bounds.add(clip.from)
    bounds.add(clip.from + clip.durationInFrames)
    for (const s of silent) {
      bounds.add(s.from)
      bounds.add(s.to)
    }
  }
  const points = [...bounds].sort((a, b) => a - b)
  const out: FrameSpan[] = []
  for (let i = 0; i + 1 < points.length; i += 1) {
    const from = points[i]!
    const to = points[i + 1]!
    const mid = (from + to) / 2
    const playing = clips.filter(({ clip }) => mid >= clip.from && mid < clip.from + clip.durationInFrames)
    if (playing.length === 0) continue
    if (!playing.every(({ silent }) => silent.some((s) => mid >= s.from && mid < s.to))) continue
    const last = out[out.length - 1]
    if (last && last.to === from) last.to = to
    else out.push({ from, to })
  }
  return out
}

export interface RemovalRange {
  /** First frame removed. */
  fromFrame: number
  /** First frame kept (remove_range's convention). */
  toFrame: number
}

/**
 * Silent spans → whole-frame ranges to remove: `paddingFrames` kept at each side, rounded inwards
 * (never removing a frame that is not wholly silent), and anything left under one frame dropped.
 */
export function removalRanges(silent: readonly FrameSpan[], paddingFrames: number): RemovalRange[] {
  const pad = Math.max(0, paddingFrames)
  const out: RemovalRange[] = []
  for (const s of silent) {
    const fromFrame = Math.ceil(s.from + pad - 1e-9)
    const toFrame = Math.floor(s.to - pad + 1e-9)
    if (toFrame - fromFrame < 1) continue
    const last = out[out.length - 1]
    if (last && fromFrame <= last.toFrame) last.toFrame = Math.max(last.toFrame, toFrame)
    else out.push({ fromFrame, toFrame })
  }
  return out
}

/** Total frames the ranges remove. */
export function framesRemoved(ranges: readonly RemovalRange[]): number {
  return ranges.reduce((sum, r) => sum + (r.toFrame - r.fromFrame), 0)
}
