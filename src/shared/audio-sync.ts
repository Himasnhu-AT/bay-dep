/**
 * Aligning recordings of one event by their sound, for `sync_angles`.
 *
 * Each clip's audio is reduced in main to RMS dB per 10 ms (`media/audio-analysis.ts`); here that
 * level curve becomes an **onset envelope** — the rise in level from one window to the next, zero
 * where it falls — normalised to zero mean and unit variance. Two mics in one room hear the same
 * claps, plosives and word starts at different levels and colours; their *rises* line up where
 * their raw levels do not, and a constant gain difference disappears in the subtraction.
 *
 * The lag is found by cross-correlation over every lag at once (an FFT, so an hour-long pair is
 * about a million-point transform rather than an hour × every lag), each lag's sum divided by how
 * many windows overlap there, and only lags with a real overlap considered. Confidence is two
 * numbers, both needed: the **Pearson correlation** of the two envelopes at the best lag (does the
 * sound actually match?) and the **peak ratio**, best over the best lag more than half a second
 * away (is this lag clearly better than any other — or is the audio repetitive, a music bed or a
 * metronome, where many lags fit?). The floors below are heuristics, set from the synthetic
 * specimens in the tests (over five seeds, matched speech-like bursts at different gains with
 * their own noise read 0.98 and 7–9; unrelated ones 0.11–0.13 and 1.0–1.1), not from real
 * recordings.
 */

/** Sync envelopes are 10 ms windows: a third of a frame at 30 fps. */
export const SYNC_WINDOW_SEC = 0.01

/** Heuristic: below this correlation at the best lag, the clips do not share audio. */
export const MIN_SYNC_CORRELATION = 0.3
/** Heuristic: below this peak ratio, several lags fit about as well — repetitive audio. */
export const MIN_SYNC_PEAK_RATIO = 1.3
/** Lags this close to the best are the same peak, not a rival. */
const RIVAL_EXCLUSION_SEC = 0.5
/** Heuristic: an overlap shorter than this cannot establish a match. */
export const MIN_SYNC_OVERLAP_SEC = 5
/** Heuristic: …nor one covering less than this share of the shorter clip. */
export const MIN_SYNC_OVERLAP_SHARE = 0.25

/** Level curve (dB per window) → normalised onset envelope. */
export function onsetEnvelope(levelsDb: readonly number[]): Float64Array {
  const floor = -80
  const out = new Float64Array(levelsDb.length)
  let prev = Math.max(floor, levelsDb[0] ?? floor)
  for (let i = 0; i < levelsDb.length; i += 1) {
    const level = Math.max(floor, levelsDb[i]!)
    out[i] = Math.max(0, level - prev)
    prev = level
  }
  let mean = 0
  for (const v of out) mean += v
  mean /= out.length || 1
  let variance = 0
  for (let i = 0; i < out.length; i += 1) {
    out[i]! -= mean
    variance += out[i]! * out[i]!
  }
  const sd = Math.sqrt(variance / (out.length || 1))
  if (sd > 0) for (let i = 0; i < out.length; i += 1) out[i]! /= sd
  return out
}

/** In-place iterative radix-2 FFT; `inverse` scales by 1/n. Lengths must be powers of two. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    for (let start = 0; start < n; start += size) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < size / 2; k += 1) {
        const a = start + k
        const b = a + size / 2
        const tr = re[b]! * cr - im[b]! * ci
        const ti = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a]! += tr
        im[a]! += ti
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      re[i]! /= n
      im[i]! /= n
    }
  }
}

/**
 * `c[lag + (b.length - 1)] = Σ_i a[i] · b[i − lag]` for every lag in [−(nb−1), na−1]: at lag L,
 * b's window j lines up with a's window j + L.
 */
export function crossCorrelate(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const total = a.length + b.length - 1
  let n = 1
  while (n < total) n <<= 1
  const ar = new Float64Array(n)
  const ai = new Float64Array(n)
  const br = new Float64Array(n)
  const bi = new Float64Array(n)
  for (let i = 0; i < a.length; i += 1) ar[i] = a[i]!
  for (let i = 0; i < b.length; i += 1) br[i] = b[i]!
  fft(ar, ai)
  fft(br, bi)
  // A · conj(B): the transform of the correlation, with lag L at index L mod n.
  for (let i = 0; i < n; i += 1) {
    const re = ar[i]! * br[i]! + ai[i]! * bi[i]!
    const im = ai[i]! * br[i]! - ar[i]! * bi[i]!
    ar[i] = re
    ai[i] = im
  }
  fft(ar, ai, true)
  const out = new Float64Array(total)
  for (let lag = -(b.length - 1); lag <= a.length - 1; lag += 1) out[lag + b.length - 1] = ar[(lag + n) % n]!
  return out
}

/** Windows a and b share at lag L (b's j against a's j + L). */
function overlapAt(na: number, nb: number, lag: number): number {
  return Math.max(0, Math.min(na, nb + lag) - Math.max(0, lag))
}

/** Pearson correlation of a and b over their overlap at `lag`. */
export function correlationAt(a: ArrayLike<number>, b: ArrayLike<number>, lag: number): number {
  const start = Math.max(0, lag)
  const end = Math.min(a.length, b.length + lag)
  const n = end - start
  if (n < 2) return 0
  let ma = 0
  let mb = 0
  for (let i = start; i < end; i += 1) {
    ma += a[i]!
    mb += b[i - lag]!
  }
  ma /= n
  mb /= n
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = start; i < end; i += 1) {
    const x = a[i]! - ma
    const y = b[i - lag]! - mb
    cov += x * y
    va += x * x
    vb += y * y
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0
}

export interface SyncOffset {
  /**
   * Where the other clip must start, in seconds after the reference starts, for its sound to line
   * up: the other's moment at τ from its own start is the reference's moment at τ + offsetSec.
   * Negative means the other starts first.
   */
  offsetSec: number
  /** Pearson correlation of the onset envelopes at that offset. */
  correlation: number
  /** Best normalised peak over the best more than half a second away. */
  peakRatio: number
  /** Seconds of sound the two share at that offset. */
  overlapSec: number
  /** Whether both confidence floors are met. */
  confident: boolean
}

/**
 * The offset that lines `other` up with `reference`, from their level curves (dB per
 * `windowSec`). Null when no lag leaves `minOverlapSec` of shared sound.
 */
export function findSyncOffset(
  reference: readonly number[],
  other: readonly number[],
  windowSec: number = SYNC_WINDOW_SEC,
  minOverlapSec: number = MIN_SYNC_OVERLAP_SEC
): SyncOffset | null {
  const a = onsetEnvelope(reference)
  const b = onsetEnvelope(other)
  // A clip shorter than the minimum overlap cannot establish a match at any lag — and with no
  // rival lags left to compare, its peak ratio would read as infinitely sure.
  const floor = Math.max(2, Math.round(minOverlapSec / windowSec))
  const shorter = Math.min(a.length, b.length)
  if (shorter < floor) return null
  // Lags that share only a sliver of the shorter clip are where unrelated audio scores best
  // (a mean over few windows is noisy), so a lag must share a quarter of it too (heuristic).
  const minOverlap = Math.max(floor, Math.round(shorter * MIN_SYNC_OVERLAP_SHARE))
  const raw = crossCorrelate(a, b)
  const normalised = new Float64Array(raw.length)
  let best = -1
  for (let k = 0; k < raw.length; k += 1) {
    const lag = k - (b.length - 1)
    const overlap = overlapAt(a.length, b.length, lag)
    normalised[k] = overlap >= minOverlap ? raw[k]! / overlap : Number.NEGATIVE_INFINITY
    if (normalised[k]! > (best >= 0 ? normalised[best]! : Number.NEGATIVE_INFINITY)) best = k
  }
  if (best < 0 || !Number.isFinite(normalised[best]!)) return null
  const exclusion = Math.round(RIVAL_EXCLUSION_SEC / windowSec)
  let rival = Number.NEGATIVE_INFINITY
  for (let k = 0; k < normalised.length; k += 1) {
    if (Math.abs(k - best) <= exclusion) continue
    if (normalised[k]! > rival) rival = normalised[k]!
  }
  const peak = normalised[best]!
  const peakRatio = !Number.isFinite(rival) ? Number.POSITIVE_INFINITY : rival <= 0 ? (peak > 0 ? Number.POSITIVE_INFINITY : 0) : peak / rival

  // Sub-window refinement: a parabola through the peak and its neighbours.
  let fraction = 0
  const left = normalised[best - 1]
  const right = normalised[best + 1]
  if (left !== undefined && right !== undefined && Number.isFinite(left) && Number.isFinite(right)) {
    const denom = left - 2 * peak + right
    if (denom < 0) fraction = Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denom))
  }
  const lag = best - (b.length - 1)
  const correlation = correlationAt(a, b, lag)
  const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places
  return {
    offsetSec: round((lag + fraction) * windowSec, 4),
    correlation: round(correlation, 3),
    peakRatio: Number.isFinite(peakRatio) ? round(peakRatio, 2) : peakRatio,
    overlapSec: round(overlapAt(a.length, b.length, lag) * windowSec, 2),
    confident: correlation >= MIN_SYNC_CORRELATION && peakRatio >= MIN_SYNC_PEAK_RATIO
  }
}
