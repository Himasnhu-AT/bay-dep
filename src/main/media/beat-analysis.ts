/**
 * Beat, bar and drop-out analysis of a mono signal. Pure: samples in, seconds out.
 *
 * Kept apart from `beats.ts` (which decodes with ffmpeg and caches) because that file reaches
 * `electron` through the cache paths and so cannot be loaded by `pnpm test`; everything worth
 * testing is here.
 *
 * The pipeline is the standard one, chosen because each stage has a known failure and a known
 * fix rather than because it is the newest:
 *
 * 1. **Onset strength** — spectral flux of a log-compressed magnitude spectrum, half-wave
 *    rectified. Log compression is what makes a quiet hi-hat count next to a kick; without it the
 *    envelope is the kick drum and nothing else.
 * 2. **Tempo** — autocorrelation of that envelope picks a *period family* (T, T/2, 2T …); the
 *    octave inside the family is then decided by what sits halfway between the beats. A grid
 *    whose midpoints are as strong as its beats is too slow (the midpoints are beats too); the
 *    slowest grid whose midpoints are weak is the pulse. Autocorrelation alone cannot tell 87
 *    from 174 BPM on a click track — both lags line up every click — and a tempo prior centred on
 *    120 picks the wrong one of the two, which is the drum-and-bass failure every tracker has.
 * 3. **Beats** — Ellis's dynamic program (2007): the best chain of onsets whose spacing stays
 *    near the period, so a grid follows a performance rather than a metronome and carries on
 *    through a bar with no drums in it.
 * 4. **Bar phase** — which beat of `beatsPerBar` carries the low-frequency accent (the kick).
 *    Reported only when one position clearly wins; a click track with no accent has no
 *    downbeat, and saying so is better than guessing one in four.
 * 5. **Drop-outs** — beats the continued grid expects and nobody plays (the drums stop), and
 *    stretches where the level itself falls far under the music's (silence). See `findDropouts`.
 */

/** Analysis is done at this rate; ffmpeg resamples. Kick fundamentals and hat transients both survive it. */
export const ANALYSIS_SAMPLE_RATE = 22050
const FFT_SIZE = 1024
const HOP = 256
/** Bins at or below this frequency count as "low" for the kick-accent (downbeat) evidence. */
const LOW_BAND_HZ = 150

export interface BeatOptions {
  /** Beats in a bar, for the downbeat. Default 4. */
  beatsPerBar?: number
  /** The tempo search range. The detected pulse is always inside it. */
  minBpm?: number
  maxBpm?: number
}

export interface Dropout {
  /** Seconds from the start of the signal. */
  start: number
  end: number
  /**
   * `percussion`: the beat stops (sound may carry on); `start` is the first beat that does not
   * come. `silence`: the level itself falls far under the music's.
   */
  kind: 'silence' | 'percussion'
}

export interface BeatAnalysis {
  bpm: number
  /** 0..1: how strongly the onsets repeat at the detected period (normalised autocorrelation). */
  confidence: number
  beatsPerBar: number
  /** Seconds from the start of the signal. */
  beats: number[]
  /** A subset of `beats`; empty when no position in the bar clearly carries the accent. */
  downbeats: number[]
  /** 0..1: how clearly the chosen bar position beats the runner-up. */
  downbeatConfidence: number
  dropouts: Dropout[]
  durationSeconds: number
}

/** Envelopes at the analysis frame rate (`frameRate` per second). */
export interface Envelopes {
  frameRate: number
  /** Broadband onset strength. */
  onset: Float64Array
  /** Onset strength in the low band only — the kick. */
  low: Float64Array
  /** RMS level of each analysis frame, linear. */
  rms: Float64Array
}

// ---------------------------------------------------------------------------
// 1. Onset strength
// ---------------------------------------------------------------------------

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const half = len >> 1
    for (let k = 0; k < half; k += 1) {
      const c = Math.cos(angle * k)
      const s = Math.sin(angle * k)
      for (let i = k; i < n; i += len) {
        const j = i + half
        const vr = re[j]! * c - im[j]! * s
        const vi = re[j]! * s + im[j]! * c
        re[j] = re[i]! - vr
        im[j] = im[i]! - vi
        re[i] = re[i]! + vr
        im[i] = im[i]! + vi
      }
    }
  }
}

/**
 * Where on the clock analysis frame `f` sits. Measured, not derived: with log compression the
 * flux jumps as soon as a transient enters the window's rising edge, well before it reaches the
 * centre. The rising edge is where the window's *end* meets the transient, so the frame's time is
 * near its last samples: at 0.3·N every beat read 20 ms early, at 0.72·N the click tracks in
 * `beat-analysis.test.ts` land within 3 ms.
 */
const FRAME_OFFSET_SAMPLES = FFT_SIZE * 0.72

export function frameTime(frame: number, sampleRate: number): number {
  return (frame * HOP + FRAME_OFFSET_SAMPLES) / sampleRate
}

export function onsetEnvelopes(samples: Float32Array, sampleRate: number): Envelopes {
  const frames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP) + 1)
  const onset = new Float64Array(frames)
  const low = new Float64Array(frames)
  const rms = new Float64Array(frames)
  const bins = FFT_SIZE / 2
  const lowBins = Math.max(1, Math.round(LOW_BAND_HZ / (sampleRate / FFT_SIZE)))
  const window = new Float64Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE)

  let previous = new Float64Array(bins)
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  for (let f = 0; f < frames; f += 1) {
    const start = f * HOP
    let energy = 0
    for (let i = 0; i < FFT_SIZE; i += 1) {
      const x = samples[start + i]!
      energy += x * x
      re[i] = x * window[i]!
      im[i] = 0
    }
    rms[f] = Math.sqrt(energy / FFT_SIZE)
    fft(re, im)
    const magnitude = new Float64Array(bins)
    let flux = 0
    let lowFlux = 0
    for (let b = 1; b < bins; b += 1) {
      magnitude[b] = Math.log1p(100 * Math.hypot(re[b]!, im[b]!))
      const rise = magnitude[b]! - previous[b]!
      if (rise > 0) {
        flux += rise
        if (b <= lowBins) lowFlux += rise
      }
    }
    // The first frame has nothing before it, so everything in it would read as an onset.
    onset[f] = f === 0 ? 0 : flux
    low[f] = f === 0 ? 0 : lowFlux
    previous = magnitude
  }
  return { frameRate: sampleRate / HOP, onset, low, rms }
}

// ---------------------------------------------------------------------------
// 2. Tempo
// ---------------------------------------------------------------------------

function mean(values: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < values.length; i += 1) sum += values[i]!
  return values.length === 0 ? 0 : sum / values.length
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Unbiased, normalised autocorrelation at integer lag: 1 at lag 0. */
function autocorrelation(signal: Float64Array, maxLag: number): Float64Array {
  const m = mean(signal)
  const centred = signal.map((v) => v - m)
  const out = new Float64Array(maxLag + 1)
  for (let lag = 0; lag <= maxLag; lag += 1) {
    let sum = 0
    const n = centred.length - lag
    for (let i = 0; i < n; i += 1) sum += centred[i]! * centred[i + lag]!
    out[lag] = n > 0 ? sum / n : 0
  }
  const zero = out[0]! || 1
  return out.map((v) => v / zero)
}

/** The largest value within ±`radius` frames of a fractional position. */
function peakNear(signal: Float64Array, at: number, radius: number): number {
  const centre = Math.round(at)
  let best = 0
  for (let i = centre - radius; i <= centre + radius; i += 1) {
    const v = signal[i]
    if (v !== undefined && v > best) best = v
  }
  return best
}

export interface GridFit {
  onBeat: number
  /**
   * Broadband strength halfway between two beats over the weaker of those two beats, as the
   * median across the music. 1 means the midpoints are beats too.
   */
  midpointRatio: number
  /** The same in the kick band, or null when the signal has too little low end to say. */
  lowMidpointRatio: number | null
}

/**
 * For a period (frames), fit a beat grid to the onsets and measure what sits halfway between
 * its beats — broadband and in the kick band, as two witnesses.
 *
 * Each midpoint is compared with the *weaker* of the two beats around it, not with the beats'
 * average: on a half-tempo grid over an accented bar the beats alternate strong and weak, and
 * the midpoints are exactly as strong as the weak ones because they are the same beats. The
 * median across pairs, over pairs where a beat is actually being played, keeps an intro or an
 * outro with no percussion from voting — a score with eight seconds of pad read every grid as
 * too slow when its silent beats were counted.
 */
export function gridFit(env: Pick<Envelopes, 'onset' | 'low'>, period: number): GridFit {
  const { onset, low } = env
  // Fitted in stretches of eight beats, each with its own phase: a period off by a fraction of
  // a frame drifts a whole-track grid off the onsets within a few seconds (a 0.2-frame error is
  // three frames by beat 15), and a drifted grid reads every beat as missing.
  const span = period * 8
  const beats: number[] = []
  for (let from = 0; from + span <= onset.length || from === 0; from += span) {
    const until = Math.min(onset.length, from + span)
    let best = { phase: 0, score: -1 }
    for (let phase = 0; phase < period; phase += 0.5) {
      const here: number[] = []
      for (let t = from + phase; t < until; t += period) here.push(peakNear(onset, t, 1))
      const score = mean(here)
      if (score > best.score) best = { phase, score }
    }
    for (let t = from + best.phase; t < until; t += period) beats.push(t)
  }
  const strength = beats.map((t) => peakNear(onset, t, 1))
  const typical = median(strength)
  const ratios: number[] = []
  const lowRatios: number[] = []
  let lowTotal = 0
  for (let i = 0; i + 1 < beats.length; i += 1) {
    const a = beats[i]!
    const b = beats[i + 1]!
    // Neighbouring stretches can fit phases a frame apart; a pair that straddles two stretches
    // at a spacing far from the period is not a pair.
    if (Math.abs(b - a - period) > period / 4) continue
    const weaker = Math.min(strength[i]!, strength[i + 1]!)
    if (weaker < 0.25 * typical) continue
    const mid = (a + b) / 2
    ratios.push(peakNear(onset, mid, 1) / weaker)
    const weakerLow = Math.min(peakNear(low, a, 1), peakNear(low, b, 1))
    lowTotal += weakerLow
    if (weakerLow > 0) lowRatios.push(peakNear(low, mid, 1) / weakerLow)
  }
  const onBeat = mean(strength)
  return {
    onBeat,
    midpointRatio: ratios.length > 0 ? median(ratios) : 0,
    // A kick band carrying under 1% of the broadband strength is noise, not a witness: the
    // real score this was measured on has almost no kick, and its low-band "ratio" is random.
    lowMidpointRatio:
      ratios.length > 0 && lowTotal / ratios.length > 0.01 * typical && lowRatios.length > 0 ? median(lowRatios) : null
  }
}

/**
 * Midpoints at or above this fraction of the beats' strength mean the grid is too slow: what
 * sits between its beats is itself a beat. Measured between cases that must all hold: a click
 * track with an accented downbeat (on the half-tempo grid the midpoints *are* the weaker beats,
 * ratio ~0.9-1), swung eighths (midpoints empty, ~0), and a real score whose off-beat eighths
 * are a little weaker than its beats (~0.6, and 110 BPM is right there).
 *
 * Broadband alone cannot separate a groove's eighth-note hats from its beats: after log
 * compression a quiet hat rises in as many bins as a kick, and the ratio is ~0.96. So the kick
 * band is a second witness, and a grid is too slow only when both say so — hats have no low
 * end, clicks that are all the same have the same low end on and off the half-tempo grid.
 */
const MIDPOINT_TOO_STRONG = 0.7

/**
 * Doubling into a pulse faster than `FAST_PULSE_BPM` needs midpoints nearly as strong as the
 * beats. A pulse over 180 is rare (drum and bass sits at 170-175), while eighth notes at 100-120
 * are everywhere and are often played as hard as the beat. The real score this was measured
 * on (110 BPM, eighths harder than its weaker beats) is kept at 110 by the 215 ceiling, not by
 * this; the same groove at 90-107 BPM doubles inside the range, and this is what holds it.
 */
const FAST_PULSE_BPM = 180
const MIDPOINT_TOO_STRONG_FOR_FAST = 0.9

function tooSlow(fit: GridFit, doubledBpm: number): boolean {
  if (doubledBpm > FAST_PULSE_BPM) {
    // Both witnesses, and the kick band must be there to testify: without a kick, even
    // eighths as hard as the beat (the measured score's are harder than its weaker beats) are
    // eighths, and the beat stays under 180.
    return (
      fit.midpointRatio >= MIDPOINT_TOO_STRONG_FOR_FAST &&
      fit.lowMidpointRatio !== null &&
      fit.lowMidpointRatio >= MIDPOINT_TOO_STRONG_FOR_FAST
    )
  }
  if (fit.midpointRatio < MIDPOINT_TOO_STRONG) return false
  return fit.lowMidpointRatio === null || fit.lowMidpointRatio >= MIDPOINT_TOO_STRONG
}

/** How close to the strongest autocorrelation peak a shorter lag must come to be preferred. */
const NEARLY_AS_PERIODIC = 0.85

export interface TempoEstimate {
  /** Frames per beat, fractional. */
  period: number
  /** The normalised autocorrelation at that period, 0..1. */
  confidence: number
}

export function estimateTempo(env: Envelopes, minBpm: number, maxBpm: number): TempoEstimate {
  const { onset, frameRate } = env
  const minLag = Math.max(2, Math.floor((frameRate * 60) / maxBpm))
  const maxLag = Math.ceil((frameRate * 60) / minBpm)
  const ac = autocorrelation(onset, Math.min(maxLag + 1, Math.max(0, onset.length - 1)))
  const peaks: number[] = []
  for (let lag = minLag; lag <= maxLag && lag < ac.length - 1; lag += 1) {
    const v = ac[lag]!
    if (v > 0 && v >= ac[lag - 1]! && v >= ac[lag + 1]!) peaks.push(lag)
  }
  if (peaks.length === 0) return { period: (frameRate * 60) / 120, confidence: 0 }
  // The *shortest* lag that is nearly as periodic as the best one. On a click track every
  // multiple of the beat lines up equally, and the global maximum is whichever multiple the
  // rounding favours — 174 BPM came back as 58. Starting short and letting the octave step
  // below walk slower cannot land on a third or a fifth of the tempo.
  const strongest = Math.max(...peaks.map((lag) => ac[lag]!))
  const bestLag = peaks.find((lag) => ac[lag]! >= NEARLY_AS_PERIODIC * strongest)!

  // Sub-frame lag, parabola through the peak and its neighbours: at 86 frames a second a
  // whole-frame lag is ±2 BPM at 174, which is outside what the beat grid can absorb.
  const a = ac[bestLag - 1]!
  const b = ac[bestLag]!
  const c = ac[bestLag + 1]!
  const denom = a - 2 * b + c
  const base = bestLag + (denom === 0 ? 0 : (0.5 * (a - c)) / denom)

  // The octave inside the family: slowest grid whose midpoints are not beats themselves.
  const family: number[] = []
  for (let p = base; (frameRate * 60) / p >= minBpm; p *= 2) family.push(p)
  for (let p = base / 2; (frameRate * 60) / p <= maxBpm; p /= 2) family.push(p)
  family.sort((x, y) => y - x) // longest period (slowest tempo) first
  let period = family[family.length - 1] ?? base
  for (const candidate of family) {
    if (!tooSlow(gridFit(env, candidate), (2 * frameRate * 60) / candidate)) {
      period = candidate
      break
    }
  }
  const at = Math.round(period)
  const confidence = Math.max(0, Math.min(1, ac[at] ?? b))
  return { period, confidence }
}

// ---------------------------------------------------------------------------
// 3. Beats
// ---------------------------------------------------------------------------

/** How hard the dynamic program resists changing the spacing (Ellis's α; librosa's `tightness`). */
const TIGHTNESS = 100

/**
 * Ellis's dynamic program over the onset envelope: each frame's best score is its own onset
 * strength plus the best predecessor's score, less a penalty for spacing away from the period.
 * Returns beat frames, first to last, with weak beats at either end (fade-ins, tails) trimmed.
 */
export function trackBeats(onset: Float64Array, period: number): number[] {
  const n = onset.length
  if (n === 0 || !(period > 1)) return []
  let sumSq = 0
  for (let i = 0; i < n; i += 1) sumSq += onset[i]! ** 2
  const std = Math.sqrt(sumSq / n) || 1

  // Smoothed with a narrow Gaussian so a beat a frame off the grid still scores.
  const radius = Math.max(1, Math.round(period))
  const kernel: number[] = []
  for (let k = -radius; k <= radius; k += 1) kernel.push(Math.exp(-0.5 * ((k * 32) / period) ** 2))
  const local = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    let sum = 0
    for (let k = -radius; k <= radius; k += 1) {
      const v = onset[i + k]
      if (v !== undefined) sum += (v / std) * kernel[k + radius]!
    }
    local[i] = sum
  }

  const score = new Float64Array(n)
  const back = new Int32Array(n).fill(-1)
  const lo = Math.round(period / 2)
  const hi = Math.round(2 * period)
  for (let i = 0; i < n; i += 1) {
    let best = -Infinity
    let bestAt = -1
    for (let j = i - hi; j <= i - lo; j += 1) {
      if (j < 0) continue
      const gap = Math.log((i - j) / period)
      const v = score[j]! - TIGHTNESS * gap * gap
      if (v > best) {
        best = v
        bestAt = j
      }
    }
    // A predecessor that only costs is no predecessor: the chain starts here instead. Without
    // this the first beat of a track paid the spacing penalty against the silence before it,
    // and the chain skipped it to start one beat later.
    const extend = bestAt >= 0 && best > 0
    score[i] = local[i]! + (extend ? best : 0)
    back[i] = extend ? bestAt : -1
  }

  // End on the last local maximum of the score that is a real beat, not a tail artefact.
  const maxima: number[] = []
  for (let i = 1; i < n - 1; i += 1) if (score[i]! > score[i - 1]! && score[i]! >= score[i + 1]!) maxima.push(i)
  if (maxima.length === 0) return []
  const threshold = 0.5 * median(maxima.map((i) => score[i]!))
  const credible = maxima.filter((i) => score[i]! >= threshold)
  const lastCredible = credible[credible.length - 1] ?? maxima[maxima.length - 1]!
  // The best-scoring ending among the last two beats' worth, not simply the last: the last
  // local maximum is often an off-beat (the final hat), and ending the chain there squeezes
  // the final beats off the grid to reach it.
  let end = lastCredible
  for (const i of credible) {
    if (i >= lastCredible - 2 * period && score[i]! > score[end]!) end = i
  }
  const beats: number[] = []
  for (let i = end; i >= 0; i = back[i]!) beats.push(i)
  beats.reverse()

  // Trim beats in silence or fade at the ends — the chain happily extends into nothing.
  const strength = beats.map((b) => local[b]!)
  const rmsStrength = Math.sqrt(mean(strength.map((v) => v * v)))
  const floor = 0.5 * rmsStrength
  let first = 0
  let last = beats.length - 1
  while (first <= last && strength[first]! <= floor) first += 1
  while (last >= first && strength[last]! <= floor) last -= 1
  return beats.slice(first, last + 1)
}

/** A beat frame moved to the sub-frame peak of the onset near it, when there is one. */
function refine(onset: Float64Array, frame: number, floor: number): number {
  let at = frame
  for (let i = frame - 2; i <= frame + 2; i += 1) {
    if ((onset[i] ?? -1) > (onset[at] ?? -1)) at = i
  }
  const peak = onset[at] ?? 0
  if (peak < floor) return frame
  const a = onset[at - 1] ?? peak
  const c = onset[at + 1] ?? peak
  const denom = a - 2 * peak + c
  const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom
  return at + Math.max(-0.5, Math.min(0.5, shift))
}

/** Tempo from beat times by least squares: robust to a missing beat, and sub-frame precise. */
function bpmFromBeats(times: number[]): number | null {
  const n = times.length
  if (n < 4) return null
  const mx = (n - 1) / 2
  const my = mean(times)
  let num = 0
  let den = 0
  for (let i = 0; i < n; i += 1) {
    num += (i - mx) * (times[i]! - my)
    den += (i - mx) ** 2
  }
  const slope = num / den
  return slope > 0 ? 60 / slope : null
}

// ---------------------------------------------------------------------------
// 4. Bar phase
// ---------------------------------------------------------------------------

/**
 * The downbeat must out-accent the runner-up by at least this fraction. Below it, "which beat
 * is one" is a guess, and a guess placed as a marker reads as a measurement.
 */
const DOWNBEAT_MIN_CONTRAST = 0.15

export function findDownbeatPhase(
  low: Float64Array,
  onset: Float64Array,
  beatFrames: number[],
  beatsPerBar: number
): { phase: number; confidence: number } | null {
  if (beatsPerBar < 2 || beatFrames.length < beatsPerBar * 2) return null
  const byPosition = (signal: Float64Array): number[] => {
    const scores: number[] = []
    for (let k = 0; k < beatsPerBar; k += 1) {
      scores.push(mean(beatFrames.filter((_, i) => i % beatsPerBar === k).map((f) => peakNear(signal, f, 2))))
    }
    return scores
  }
  // The kick band alone. Mixed with broadband strength, a bright snare or click on the other
  // beats outweighs the kick's accent, because log compression gives a broadband transient more
  // bins to rise in. Broadband is the fallback only for material with no low end at all.
  let scores = byPosition(low)
  if (!(Math.max(...scores) > 0)) scores = byPosition(onset)
  const order = scores.map((s, k) => ({ s, k })).sort((a, b) => b.s - a.s)
  const best = order[0]!
  const second = order[1]!
  if (!(best.s > 0)) return null
  const contrast = (best.s - second.s) / best.s
  return contrast >= DOWNBEAT_MIN_CONTRAST ? { phase: best.k, confidence: Math.min(1, contrast) } : null
}

// ---------------------------------------------------------------------------
// 5. Drop-outs
// ---------------------------------------------------------------------------

/**
 * A grid beat counts as played when the onset near it reaches this fraction of the typical
 * beat. Measured on a real score: its drum hits sit at 700-1500 and the pad that carries on
 * after the drums stop peaks at ~300 of the same units, against a typical beat of ~1100.
 */
const PLAYED_FRACTION = 0.3
/** Fewer missing beats than this is a fill or a syncopation, not a drop-out. */
const MIN_MISSING_BEATS = 2
/** Quieter than the music's median level by this much is silence, for a musical signal. */
const SILENCE_BELOW_DB = 24
/**
 * A silence must last this long, and at least a beat: the gap between two clicks of a click
 * track is digital silence, and is the music, not a drop-out in it.
 */
const MIN_SILENCE_SECONDS = 0.25

/**
 * Where the music drops out, two ways, reported separately because they answer different
 * questions and often overlap:
 *
 * - **`percussion`** — the beat stops. The tracked grid is continued at the same period to the
 *   end of the signal, and a drop-out is a run of at least `MIN_MISSING_BEATS` grid beats with
 *   nothing played on them. It starts *on the first missing beat* — the moment the next hit
 *   would have come and does not, which is where a cut "on the drop" lands — and ends on the
 *   first of two beats played in a row (one stray hit is not the drums coming back), or at the
 *   end of the signal when they never do.
 * - **`silence`** — the level itself falls `SILENCE_BELOW_DB` under the music's median, inside
 *   the music: from the first beat to the last moment anything is audible, so a fade-out tail
 *   and a lead-in are not reported as drop-outs.
 */
export function findDropouts(env: Envelopes, beatFrames: number[], period: number, sampleRate: number): Dropout[] {
  const { onset, rms } = env
  const n = onset.length
  if (n === 0 || beatFrames.length < 4 || !(period > 1)) return []
  const typical = median(beatFrames.map((f) => peakNear(onset, f, 2)))
  if (!(typical > 0)) return []
  const out: Dropout[] = []
  const end = n - 1

  // -- percussion: missing beats on the continued grid --
  const grid = [...beatFrames]
  for (let f = beatFrames[beatFrames.length - 1]! + period; f <= end; f += period) grid.push(f)
  const played = grid.map((f) => peakNear(onset, f, 2) >= PLAYED_FRACTION * typical)
  for (let i = 1; i < grid.length; i += 1) {
    if (played[i] || !played[i - 1]) continue
    let j = i
    while (j < grid.length && !(played[j] && (j + 1 >= grid.length || played[j + 1]))) j += 1
    if (j - i >= MIN_MISSING_BEATS) {
      out.push({
        start: round3(frameTime(grid[i]!, sampleRate)),
        end: round3(j < grid.length ? frameTime(grid[j]!, sampleRate) : frameTime(end, sampleRate)),
        kind: 'percussion'
      })
    }
    i = j
  }

  // -- silence: the level, smoothed over ~0.1 s, far under the music's median --
  const db = new Float64Array(n)
  const w = Math.max(1, Math.round(env.frameRate * 0.05))
  for (let i = 0; i < n; i += 1) {
    let power = 0
    let count = 0
    for (let k = i - w; k <= i + w; k += 1) {
      const v = rms[k]
      if (v !== undefined) {
        power += v * v
        count += 1
      }
    }
    db[i] = 10 * Math.log10(power / count + 1e-20)
  }
  const first = beatFrames[0]!
  const reference = median(Array.from(db.subarray(first, beatFrames[beatFrames.length - 1]! + 1)))
  const floor = reference - SILENCE_BELOW_DB
  let lastAudible = first
  for (let i = end; i >= first; i -= 1) {
    if (db[i]! > floor) {
      lastAudible = i
      break
    }
  }
  let start = -1
  for (let i = first; i <= lastAudible; i += 1) {
    const quiet = db[i]! <= floor
    if (quiet && start < 0) start = i
    if (!quiet && start >= 0) {
      if (i - start >= Math.max(MIN_SILENCE_SECONDS * env.frameRate, period)) {
        out.push({ start: round3(frameTime(start, sampleRate)), end: round3(frameTime(i, sampleRate)), kind: 'silence' })
      }
      start = -1
    }
  }
  return out.sort((x, y) => x.start - y.start)
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

// ---------------------------------------------------------------------------
// Whole analysis
// ---------------------------------------------------------------------------

export function analyzeBeats(samples: Float32Array, sampleRate: number, options: BeatOptions = {}): BeatAnalysis {
  const beatsPerBar = Math.max(1, Math.round(options.beatsPerBar ?? 4))
  const minBpm = options.minBpm ?? 55
  const maxBpm = options.maxBpm ?? 215
  const durationSeconds = round3(samples.length / sampleRate)
  const empty: BeatAnalysis = {
    bpm: 0,
    confidence: 0,
    beatsPerBar,
    beats: [],
    downbeats: [],
    downbeatConfidence: 0,
    dropouts: [],
    durationSeconds
  }
  const env = onsetEnvelopes(samples, sampleRate)
  if (env.onset.length < 8) return empty
  const tempo = estimateTempo(env, minBpm, maxBpm)
  const frames = trackBeats(env.onset, tempo.period)
  if (frames.length < 2) return { ...empty, confidence: tempo.confidence }

  const typical = median(frames.map((f) => peakNear(env.onset, f, 2)))
  const times = frames.map((f) => round3(frameTime(refine(env.onset, f, 0.3 * typical), sampleRate)))
  const bpm = bpmFromBeats(times) ?? (env.frameRate * 60) / tempo.period
  const bar = findDownbeatPhase(env.low, env.onset, frames, beatsPerBar)
  return {
    bpm: Math.round(bpm * 100) / 100,
    confidence: Math.round(tempo.confidence * 100) / 100,
    beatsPerBar,
    beats: times,
    downbeats: bar ? times.filter((_, i) => i % beatsPerBar === bar.phase) : [],
    downbeatConfidence: bar ? Math.round(bar.confidence * 100) / 100 : 0,
    dropouts: findDropouts(env, frames, tempo.period, sampleRate),
    durationSeconds
  }
}
