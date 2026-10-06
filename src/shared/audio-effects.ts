/**
 * Audio effects on a clip (`Item.audioEffects`) and on a track (`Track.audioEffects`): the
 * catalogue, the one table every equaliser band is derived from, the ffmpeg graphs, and the plan
 * that says which part of a chain is *live* and which is *baked*.
 *
 * **Two kinds of effect, because preview and export are two renderers.**
 *
 * - **Equaliser bands are live.** A band is a second-order section (a biquad). The preview runs it
 *   as a Web Audio `BiquadFilterNode`, export as ffmpeg's `highpass`/`lowpass`/`equalizer`/
 *   `lowshelf`/`highshelf`. Those are the same filter family, but they do not take the same
 *   numbers: Web Audio's low/high-pass `Q` is in **decibels**, ffmpeg's is linear, and Web Audio's
 *   shelves have a fixed slope where ffmpeg's take a width. So nothing writes either set of
 *   arguments by hand: `biquadOf` makes one canonical (type, frequency, Q, gain), and
 *   `webAudioBiquad`, `ffmpegBiquad` and `biquadCoefficients` (the specified Web Audio formulas,
 *   which is what the preview computes) are all read from it. `main/audio-fx/eq-render.test.ts`
 *   renders tones through the real ffmpeg and compares against `biquadResponseDb`.
 *
 * - **Dynamics and noise removal are baked.** `DynamicsCompressorNode` and ffmpeg's `acompressor`
 *   are different detectors with different knees, so "two implementations that agree" does not
 *   exist. A dynamics stage also has *history*: its gain at a moment depends on the seconds before
 *   it, and a preview that has just been scrubbed has none, so even one shared detector running
 *   live would answer differently after every seek than the export does at the same frame. So the
 *   part of a chain up to its last dynamics/noise stage is rendered once by bay's ffmpeg into a
 *   content-addressed file (`main/audio-fx/bake.ts`, the way mattes are cached), and **both** paths
 *   play that file: the same samples, by construction, wherever the playhead lands. Noise removal
 *   (`afftdn`) has no Web Audio counterpart at all and needs the same mechanism, so this is one
 *   mechanism rather than a worklet beside a baker. The cost is that a change to a baked parameter
 *   re-renders the clip's sound (seconds, not live), and that a track's dynamics act on each clip
 *   of the track rather than on their sum — see `itemEffectPlan`.
 *
 * Everything here is optional and additive: an item or track with no list, an empty list, or a
 * list of switched-off or do-nothing effects resolves to `NO_EFFECTS` — no node, no filter, no
 * bake — so a project that never used an effect plays, exports and saves exactly as before.
 */

/** Second-order sections: live in the preview (Web Audio) and in export (ffmpeg). */
export const EQ_KINDS = ['highpass', 'lowpass', 'lowshelf', 'highshelf', 'bell'] as const
/** Rendered into a processed file by ffmpeg, which preview and export both play. */
export const BAKED_KINDS = ['compressor', 'gate', 'deesser', 'limiter', 'denoise'] as const
export const AUDIO_EFFECT_KINDS = [...EQ_KINDS, ...BAKED_KINDS] as const

export type EqKind = (typeof EQ_KINDS)[number]
export type BakedKind = (typeof BAKED_KINDS)[number]
export type AudioEffectKind = (typeof AUDIO_EFFECT_KINDS)[number]

/**
 * One effect in a chain. `params` holds every parameter of its kind (see `AUDIO_EFFECT_CATALOG`),
 * in the unit the catalogue names — Hz, dB, ms, a ratio, a percentage — never a linear gain or a
 * normalised 0..1, so the file, the inspector and a tool call all read the same number.
 */
export interface AudioEffect {
  /** Unique within its list. */
  id: string
  kind: AudioEffectKind
  /** Absent or true is on. False keeps the effect and its settings and does nothing. */
  enabled?: boolean
  params: Record<string, number>
}

export type ParamUnit = 'Hz' | 'dB' | 'ms' | 'ratio' | 'Q' | '%'

export interface ParamSpec {
  key: string
  label: string
  unit: ParamUnit
  min: number
  max: number
  default: number
  /** One line for a tooltip and for a tool's refusal. */
  hint: string
}

export interface EffectSpec {
  kind: AudioEffectKind
  label: string
  /** What it is for, in the words an editor would use. */
  description: string
  baked: boolean
  params: readonly ParamSpec[]
}

const FREQUENCY = (def: number, hint: string): ParamSpec => ({
  key: 'frequency', label: 'Frequency', unit: 'Hz', min: 20, max: 20000, default: def, hint
})
const GAIN = (hint: string): ParamSpec => ({
  key: 'gain', label: 'Gain', unit: 'dB', min: -24, max: 24, default: 0, hint
})

/** Butterworth: the flattest pass band a second-order section has. */
export const BUTTERWORTH_Q = Math.SQRT1_2

export const AUDIO_EFFECT_CATALOG: readonly EffectSpec[] = [
  {
    kind: 'highpass', label: 'High-pass', baked: false,
    description: 'Removes everything below a frequency (12 dB per octave): rumble, handling noise, plosives.',
    params: [
      FREQUENCY(80, 'Sound below this is removed; −3 dB here at the default Q.'),
      { key: 'q', label: 'Q', unit: 'Q', min: 0.1, max: 10, default: BUTTERWORTH_Q, hint: '0.707 is flat; higher adds a resonant bump at the frequency.' }
    ]
  },
  {
    kind: 'lowpass', label: 'Low-pass', baked: false,
    description: 'Removes everything above a frequency (12 dB per octave): hiss, harshness, or a muffled "next room" sound.',
    params: [
      FREQUENCY(12000, 'Sound above this is removed; −3 dB here at the default Q.'),
      { key: 'q', label: 'Q', unit: 'Q', min: 0.1, max: 10, default: BUTTERWORTH_Q, hint: '0.707 is flat; higher adds a resonant bump at the frequency.' }
    ]
  },
  {
    kind: 'lowshelf', label: 'Low shelf', baked: false,
    description: 'Raises or lowers everything below a frequency: warmth up, boom down.',
    params: [FREQUENCY(120, 'The shelf reaches half its gain here.'), GAIN('Positive boosts the lows, negative cuts them. 0 does nothing.')]
  },
  {
    kind: 'highshelf', label: 'High shelf', baked: false,
    description: 'Raises or lowers everything above a frequency: air up, brightness down.',
    params: [FREQUENCY(8000, 'The shelf reaches half its gain here.'), GAIN('Positive boosts the highs, negative cuts them. 0 does nothing.')]
  },
  {
    kind: 'bell', label: 'Parametric band', baked: false,
    description: 'Boosts or cuts around one frequency. Add up to as many as the chain holds; three is the usual equaliser.',
    params: [
      FREQUENCY(1000, 'The centre of the band.'),
      GAIN('Boost or cut at the centre. 0 does nothing.'),
      { key: 'q', label: 'Q', unit: 'Q', min: 0.1, max: 18, default: 1, hint: 'Width: 0.5 is broad, 1 about an octave and a third, 8 a narrow notch.' }
    ]
  },
  {
    kind: 'compressor', label: 'Compressor', baked: true,
    description: 'Evens out level: sound above the threshold rises only 1 dB for every `ratio` dB.',
    params: [
      { key: 'threshold', label: 'Threshold', unit: 'dB', min: -60, max: 0, default: -18, hint: 'Peak level (dBFS) above which gain is reduced.' },
      { key: 'ratio', label: 'Ratio', unit: 'ratio', min: 1, max: 20, default: 3, hint: '3 means 3:1. 1 does nothing; 20 is close to a limiter.' },
      { key: 'attack', label: 'Attack', unit: 'ms', min: 0.01, max: 2000, default: 10, hint: 'How fast gain comes down once the level is over the threshold.' },
      { key: 'release', label: 'Release', unit: 'ms', min: 0.01, max: 9000, default: 120, hint: 'How fast gain comes back once the level is under it.' },
      { key: 'knee', label: 'Knee', unit: 'dB', min: 0, max: 18, default: 6, hint: 'Width of the soft bend around the threshold. 0 is a hard corner.' },
      { key: 'makeup', label: 'Make-up', unit: 'dB', min: 0, max: 24, default: 0, hint: 'Gain added after compression, to bring the level back up.' }
    ]
  },
  {
    kind: 'gate', label: 'Noise gate', baked: true,
    description: 'Turns the sound down while it is below the threshold: room noise between sentences.',
    params: [
      { key: 'threshold', label: 'Threshold', unit: 'dB', min: -90, max: 0, default: -45, hint: 'Peak level (dBFS) below which the gate closes.' },
      { key: 'ratio', label: 'Ratio', unit: 'ratio', min: 1, max: 20, default: 4, hint: 'Each dB under the threshold becomes this many. 1 does nothing.' },
      { key: 'range', label: 'Range', unit: 'dB', min: -90, max: 0, default: -40, hint: 'The most the gate may turn the sound down. 0 does nothing.' },
      { key: 'attack', label: 'Attack', unit: 'ms', min: 0.01, max: 9000, default: 5, hint: 'How fast the gate opens when sound returns.' },
      { key: 'release', label: 'Release', unit: 'ms', min: 0.01, max: 9000, default: 150, hint: 'How fast it closes again.' },
      { key: 'knee', label: 'Knee', unit: 'dB', min: 0, max: 18, default: 6, hint: 'Width of the soft bend around the threshold.' }
    ]
  },
  {
    kind: 'deesser', label: 'De-esser', baked: true,
    description: 'Turns the sound down while its sibilance ("s", "sh") is over the threshold. Listens above `frequency`, reduces the whole signal.',
    params: [
      { key: 'frequency', label: 'Frequency', unit: 'Hz', min: 2000, max: 12000, default: 6000, hint: 'The detector hears only what is above this (24 dB per octave).' },
      { key: 'threshold', label: 'Threshold', unit: 'dB', min: -60, max: 0, default: -30, hint: 'Sibilance level (dBFS peak) above which gain is reduced.' },
      { key: 'ratio', label: 'Ratio', unit: 'ratio', min: 1, max: 20, default: 4, hint: 'How hard it is reduced. 1 does nothing.' }
    ]
  },
  {
    kind: 'limiter', label: 'Limiter', baked: true,
    description: 'A ceiling no sample goes over. Put it last. `gain` drives the sound into it.',
    params: [
      { key: 'ceiling', label: 'Ceiling', unit: 'dB', min: -24, max: 0, default: -1, hint: 'The highest sample peak that comes out (dBFS).' },
      { key: 'gain', label: 'Gain', unit: 'dB', min: 0, max: 24, default: 0, hint: 'Gain before the ceiling: louder, at the cost of dynamics.' },
      { key: 'release', label: 'Release', unit: 'ms', min: 1, max: 8000, default: 50, hint: 'How fast gain comes back after a peak.' }
    ]
  },
  {
    kind: 'denoise', label: 'Noise removal', baked: true,
    description: 'Removes steady background noise (hiss, air conditioning, room tone). bay measures the noise in the quiet stretches of the recording, so it is for speech and other sound with pauses.',
    params: [
      { key: 'strength', label: 'Strength', unit: '%', min: 0, max: 100, default: 50, hint: `How much of the noise is removed: 100 % is ${0.4 * 100} dB. Too much sounds watery. 0 does nothing.` }
    ]
  }
]

const SPEC_BY_KIND = new Map<string, EffectSpec>(AUDIO_EFFECT_CATALOG.map((spec) => [spec.kind, spec]))

export function effectSpec(kind: string): EffectSpec | undefined {
  return SPEC_BY_KIND.get(kind)
}

export function isBakedKind(kind: string): kind is BakedKind {
  return (BAKED_KINDS as readonly string[]).includes(kind)
}

/** A chain longer than this is refused: each band is a node in the preview and a filter per clip in export. */
export const MAX_AUDIO_EFFECTS = 16

/** A parameter's value: the stored one when it is a finite number in range, else clamped or the default. */
export function paramOf(effect: AudioEffect, key: string): number {
  const spec = effectSpec(effect.kind)?.params.find((p) => p.key === key)
  if (!spec) return 0
  const value = effect.params?.[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return spec.default
  return Math.min(spec.max, Math.max(spec.min, value))
}

/** An effect of `kind` at its defaults. */
export function defaultEffect(kind: AudioEffectKind, id: string): AudioEffect {
  const params: Record<string, number> = {}
  for (const p of effectSpec(kind)!.params) params[p.key] = p.default
  return { id, kind, params }
}

/**
 * True when the effect, as set, changes nothing — the `'none'` rule for sound. A band at 0 dB, a
 * compressor at 1:1 with no make-up, a gate with no range, noise removal at 0 %. Such an effect
 * costs no node, no filter and no bake. High-pass, low-pass and the limiter always do something.
 */
export function isIdentity(effect: AudioEffect): boolean {
  switch (effect.kind) {
    case 'lowshelf':
    case 'highshelf':
    case 'bell':
      return paramOf(effect, 'gain') === 0
    case 'compressor':
      return paramOf(effect, 'ratio') === 1 && paramOf(effect, 'makeup') === 0
    case 'gate':
      return paramOf(effect, 'ratio') === 1 || paramOf(effect, 'range') === 0
    case 'deesser':
      return paramOf(effect, 'ratio') === 1
    case 'denoise':
      return paramOf(effect, 'strength') === 0
    default:
      return false
  }
}

/** The effects of a list that do something: known kind, switched on, not an identity — in order. */
export function activeEffects(list: readonly AudioEffect[] | undefined | null): AudioEffect[] {
  if (!list || list.length === 0) return NONE
  const out = list.filter((e) => e && SPEC_BY_KIND.has(e.kind) && e.enabled !== false && !isIdentity(e))
  return out.length === 0 ? NONE : out
}

const NONE: AudioEffect[] = []

// -- the equaliser table --------------------------------------------------------------------------

export type BiquadType = 'highpass' | 'lowpass' | 'lowshelf' | 'highshelf' | 'peaking'

/**
 * One band, canonically. `q` is **linear** for every type (0.707 = Butterworth); a shelf's is fixed
 * at 0.707, which is the slope-1 shelf Web Audio always draws. `gainDb` is 0 for the two passes.
 */
export interface BiquadSpec {
  type: BiquadType
  frequency: number
  q: number
  gainDb: number
}

/** The band an equaliser effect is. Null for a baked kind. */
export function biquadOf(effect: AudioEffect): BiquadSpec | null {
  const frequency = paramOf(effect, 'frequency')
  switch (effect.kind) {
    case 'highpass':
    case 'lowpass':
      return { type: effect.kind, frequency, q: paramOf(effect, 'q'), gainDb: 0 }
    case 'lowshelf':
    case 'highshelf':
      return { type: effect.kind, frequency, q: BUTTERWORTH_Q, gainDb: paramOf(effect, 'gain') }
    case 'bell':
      return { type: 'peaking', frequency, q: paramOf(effect, 'q'), gainDb: paramOf(effect, 'gain') }
    default:
      return null
  }
}

/**
 * What to set on a `BiquadFilterNode` for this band.
 *
 * `Q` is the trap: for `lowpass`/`highpass` the Web Audio specification reads it as a resonance in
 * **dB** (α = sin ω₀ / (2·10^(Q/20))), for `peaking` as a plain Q, and for the shelves not at all.
 * Handing the node the linear 0.707 for a high-pass gives a +0.7 dB resonance where Butterworth is
 * −3 dB, which is the 3.7 dB disagreement at the corner this conversion exists to remove.
 */
export function webAudioBiquad(spec: BiquadSpec): { type: BiquadType; frequency: number; Q: number; gain: number } {
  const passes = spec.type === 'lowpass' || spec.type === 'highpass'
  return {
    type: spec.type,
    frequency: spec.frequency,
    Q: passes ? 20 * Math.log10(spec.q) : spec.q,
    gain: spec.gainDb
  }
}

function num(value: number): string {
  return value.toFixed(6)
}

/** The ffmpeg filter for this band, width given as a linear Q (`t=q`) so it is the same section. */
export function ffmpegBiquad(spec: BiquadSpec): string {
  const f = `f=${num(spec.frequency)}:t=q:w=${num(spec.q)}`
  switch (spec.type) {
    case 'highpass':
      return `highpass=${f}:p=2`
    case 'lowpass':
      return `lowpass=${f}:p=2`
    case 'lowshelf':
      return `lowshelf=${f}:g=${num(spec.gainDb)}`
    case 'highshelf':
      return `highshelf=${f}:g=${num(spec.gainDb)}`
    case 'peaking':
      return `equalizer=${f}:g=${num(spec.gainDb)}`
  }
}

export interface BiquadCoefficients {
  b0: number
  b1: number
  b2: number
  a0: number
  a1: number
  a2: number
}

/**
 * The section's coefficients at `sampleRate`, by the formulas the Web Audio specification gives
 * for `BiquadFilterNode` (§1.13.5) — what the preview's node computes — written from the canonical
 * linear Q. They are Bristow-Johnson's cookbook sections.
 */
export function biquadCoefficients(spec: BiquadSpec, sampleRate: number): BiquadCoefficients {
  const w0 = (2 * Math.PI * spec.frequency) / sampleRate
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const A = Math.pow(10, spec.gainDb / 40)
  const alpha = sin / (2 * spec.q)
  switch (spec.type) {
    case 'lowpass':
      return { b0: (1 - cos) / 2, b1: 1 - cos, b2: (1 - cos) / 2, a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha }
    case 'highpass':
      return { b0: (1 + cos) / 2, b1: -(1 + cos), b2: (1 + cos) / 2, a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha }
    case 'peaking':
      return { b0: 1 + alpha * A, b1: -2 * cos, b2: 1 - alpha * A, a0: 1 + alpha / A, a1: -2 * cos, a2: 1 - alpha / A }
    case 'lowshelf': {
      const k = 2 * alpha * Math.sqrt(A)
      return {
        b0: A * (A + 1 - (A - 1) * cos + k),
        b1: 2 * A * (A - 1 - (A + 1) * cos),
        b2: A * (A + 1 - (A - 1) * cos - k),
        a0: A + 1 + (A - 1) * cos + k,
        a1: -2 * (A - 1 + (A + 1) * cos),
        a2: A + 1 + (A - 1) * cos - k
      }
    }
    case 'highshelf': {
      const k = 2 * alpha * Math.sqrt(A)
      return {
        b0: A * (A + 1 + (A - 1) * cos + k),
        b1: -2 * A * (A - 1 + (A + 1) * cos),
        b2: A * (A + 1 + (A - 1) * cos - k),
        a0: A + 1 - (A - 1) * cos + k,
        a1: 2 * (A - 1 - (A + 1) * cos),
        a2: A + 1 - (A - 1) * cos - k
      }
    }
  }
}

/** The section's gain in dB at `frequency`, evaluated on the unit circle. */
export function biquadResponseDb(spec: BiquadSpec, frequency: number, sampleRate: number): number {
  const c = biquadCoefficients(spec, sampleRate)
  const w = (2 * Math.PI * frequency) / sampleRate
  const c1 = Math.cos(w)
  const s1 = Math.sin(w)
  const c2 = Math.cos(2 * w)
  const s2 = Math.sin(2 * w)
  const numRe = c.b0 + c.b1 * c1 + c.b2 * c2
  const numIm = -(c.b1 * s1 + c.b2 * s2)
  const denRe = c.a0 + c.a1 * c1 + c.a2 * c2
  const denIm = -(c.a1 * s1 + c.a2 * s2)
  return 10 * Math.log10((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm))
}

/** A whole chain's gain in dB at `frequency`: the bands in series. */
export function chainResponseDb(specs: readonly BiquadSpec[], frequency: number, sampleRate: number): number {
  let total = 0
  for (const spec of specs) total += biquadResponseDb(spec, frequency, sampleRate)
  return total
}

// -- the baked kinds: ffmpeg arguments and the textbook static curves they are measured against ----

const dbToLinear = (db: number): number => Math.pow(10, db / 20)

/** Noise removal's reduction in dB at a strength in percent: 0.4 dB per point, 40 dB at 100 %. */
export function denoiseReductionDb(strength: number): number {
  return 0.4 * strength
}

/** The de-esser's detector timing: fast enough to catch an "s", slow enough not to distort it. */
const DEESSER_ATTACK_MS = 1
const DEESSER_RELEASE_MS = 60
/** The limiter's look-ahead. `latency=1` takes the same delay back out, so the file stays aligned. */
const LIMITER_ATTACK_MS = 5

/**
 * A compressor's output level for a steady input level, both in dB — the textbook static curve
 * (Giannoulis, Massberg & Reiss 2012): unity below the knee, a slope of 1/ratio above it, and a
 * quadratic bend `knee` dB wide between. Make-up is added to all of it.
 */
export function compressorOutDb(
  inDb: number,
  p: { threshold: number; ratio: number; knee?: number; makeup?: number }
): number {
  const over = inDb - p.threshold
  const knee = p.knee ?? 0
  const makeup = p.makeup ?? 0
  if (2 * over < -knee) return inDb + makeup
  if (knee > 0 && 2 * Math.abs(over) <= knee) {
    return inDb + ((1 / p.ratio - 1) * (over + knee / 2) ** 2) / (2 * knee) + makeup
  }
  return p.threshold + over / p.ratio + makeup
}

/**
 * A gate's output level for a steady input level (hard knee): unity above the threshold; below it
 * each dB under becomes `ratio` dB under, and the reduction never exceeds `range` (a negative dB).
 */
export function gateOutDb(inDb: number, p: { threshold: number; ratio: number; range: number }): number {
  if (inDb >= p.threshold) return inDb
  const expanded = p.threshold + (inDb - p.threshold) * p.ratio
  return Math.max(expanded, inDb + p.range)
}

/** A limiter's output peak for a steady input peak: the input plus its gain, never over the ceiling. */
export function limiterOutDb(inDb: number, p: { ceiling: number; gain?: number }): number {
  return Math.min(inDb + (p.gain ?? 0), p.ceiling)
}

/**
 * The ffmpeg filters for one baked effect, as a chain fragment with one input and one output.
 * `index` makes the de-esser's internal labels unique within a graph.
 *
 * Levels are read against **peak**, not RMS (`detection=peak`), so a threshold means what a peak
 * meter shows; and channels are linked by their maximum, so a stereo image does not move when one
 * side is louder.
 *
 * Measured (`bake.test.ts`): once the detector has settled on a sustained tone — a fast attack and
 * a slow release — the compressor and the gate are on the textbook curves within 0.01 dB. At the
 * default 10/120 ms a sustained tone gets 0.8 dB *less* reduction than the curve, because a
 * one-pole detector rides under a sine's peak between crests; the test states 1 dB. `rms` in place
 * of `peak` moves that by 0.2 dB: a mutation swapping them survives the suite, so the choice of
 * `peak` is recorded here as a choice, not claimed as a tested guard.
 */
function bakedFilter(effect: AudioEffect, index: number, noiseFloorDb: number): string {
  const p = (key: string): number => paramOf(effect, key)
  switch (effect.kind) {
    case 'compressor':
      return (
        `acompressor=threshold=${num(dbToLinear(p('threshold')))}:ratio=${num(p('ratio'))}` +
        `:attack=${num(p('attack'))}:release=${num(p('release'))}:knee=${num(dbToLinear(p('knee')))}` +
        `:makeup=${num(dbToLinear(p('makeup')))}:detection=peak:link=maximum`
      )
    case 'gate':
      return (
        `agate=threshold=${num(dbToLinear(p('threshold')))}:ratio=${num(p('ratio'))}` +
        `:range=${num(dbToLinear(p('range')))}:attack=${num(p('attack'))}:release=${num(p('release'))}` +
        `:knee=${num(dbToLinear(p('knee')))}:detection=peak:link=maximum`
      )
    case 'deesser': {
      // A wide-band de-esser: the detector hears the signal through two high-passes (24 dB/octave),
      // and the gain it decides is applied to all of the signal. No crossover, so nothing to sum
      // back wrongly, and a tone below the frequency is left exactly alone.
      const hp = ffmpegBiquad({ type: 'highpass', frequency: p('frequency'), q: BUTTERWORTH_Q, gainDb: 0 })
      return (
        `asplit[dm${index}][ds${index}];[ds${index}]${hp},${hp}[dk${index}];` +
        `[dm${index}][dk${index}]sidechaincompress=threshold=${num(dbToLinear(p('threshold')))}` +
        `:ratio=${num(p('ratio'))}:attack=${num(DEESSER_ATTACK_MS)}:release=${num(DEESSER_RELEASE_MS)}` +
        `:knee=1:detection=peak:link=maximum`
      )
    }
    case 'limiter':
      // `level=false`: alimiter's default auto-level would normalise the result back up to 0 dBFS.
      return (
        `alimiter=level_in=${num(dbToLinear(p('gain')))}:limit=${num(dbToLinear(p('ceiling')))}` +
        `:attack=${num(LIMITER_ATTACK_MS)}:release=${num(p('release'))}:level=false:latency=1`
      )
    case 'denoise':
      // `afftdn` removes `nr` dB of whatever is at or under `nf`, so `nf` has to be this
      // recording's own noise level — measured by main before the bake (`afftdnFloor`). Measured:
      // with white noise at −38.8 dB RMS, `nf=-50` (the default) removed 0.7 dB of it and
      // `tn=1` (the filter's own tracking) the same; `nf=-33` removed the full `nr`.
      //
      // The filter also delays its output by one FFT hop — exactly 1200 samples at 48 kHz,
      // measured by cross-correlation — and does not take it back out. The trim does, and the pad
      // puts the length back, so a denoised clip stays in sync with its picture.
      return (
        `afftdn=nr=${num(Math.max(0.01, denoiseReductionDb(p('strength'))))}:nf=${num(noiseFloorDb)}` +
        `,atrim=start_sample=${AFFTDN_DELAY_SAMPLES},asetpts=N/SR/TB,apad=pad_len=${AFFTDN_DELAY_SAMPLES}`
      )
    default: {
      const band = biquadOf(effect)
      return band ? ffmpegBiquad(band) : 'anull'
    }
  }
}

/** Every bake is this rate: the export's, so a baked file is never resampled on its way into the mix. */
export const BAKE_SAMPLE_RATE = 48000

/**
 * The `-filter_complex` that renders a source's whole audio stream through `effects` (already
 * reduced to active ones), from `[0:a]` to `[out]`.
 *
 * It opens with a resample that also pins the first sample to time zero. A source whose audio
 * stream starts late (a camera file, an AAC stream's priming) would otherwise come out of the WAV
 * that much early, and a baked clip would be out of sync with its own picture by a constant.
 */
export function bakeFilterGraph(effects: readonly AudioEffect[], noiseFloorDb: number = DEFAULT_NOISE_FLOOR_DB): string {
  const steps = [
    `aresample=${BAKE_SAMPLE_RATE}:async=1:first_pts=0`,
    ...effects.map((e, i) => bakedFilter(e, i, noiseFloorDb))
  ]
  return `[0:a]${steps.join(',')}[out]`
}

/** `afftdn`'s latency at `BAKE_SAMPLE_RATE`, in samples. Pinned by `bake.test.ts` against the binary. */
export const AFFTDN_DELAY_SAMPLES = 1200

/** `afftdn`'s own default floor: used only where nothing was measured (a graph built for a capability check). */
export const DEFAULT_NOISE_FLOOR_DB = -50

/**
 * The stages before a chain's first noise removal — what the noise is measured *after*, because a
 * high-pass or a compressor's make-up ahead of it changes the level of the noise it will meet.
 * Null when the chain removes no noise, so nothing needs measuring.
 */
export function stagesBeforeDenoise(effects: readonly AudioEffect[]): AudioEffect[] | null {
  const at = effects.findIndex((e) => e.kind === 'denoise')
  return at < 0 ? null : effects.slice(0, at)
}

/**
 * `afftdn`'s `nf` for a recording whose quiet stretches measure `quietRmsDb`: 6 dB over them
 * (measured: at +1 dB over, 11 of 20 dB came off; at +4, 19.5; at +9, all 20), within the range
 * the filter accepts.
 */
export function afftdnFloor(quietRmsDb: number): number {
  if (!Number.isFinite(quietRmsDb)) return DEFAULT_NOISE_FLOOR_DB
  return Math.min(-20, Math.max(-80, quietRmsDb + 6))
}

/**
 * A recording's noise level from the RMS (dB) of its consecutive short windows: the tenth
 * percentile of the windows that are not digital silence. In speech that is the room between
 * words. In sound with no pauses it is simply the quietest tenth, which over-reads the noise —
 * the reason noise removal is described as being for recordings with pauses, and has a strength.
 */
export function quietLevelDb(windowRmsDb: readonly number[]): number {
  const heard = windowRmsDb.filter((db) => Number.isFinite(db) && db > -90).sort((a, b) => a - b)
  if (heard.length === 0) return Number.NEGATIVE_INFINITY
  return heard[Math.floor((heard.length - 1) * 0.1)]!
}

/** Bump when `bakeFilterGraph` changes what a given chain sounds like: old files stop being found. */
export const BAKE_VERSION = 'afx1'

/**
 * What identifies a bake besides the file it is of: the version and each stage's kind and
 * parameters. Ids and switched-off stages are not in it, so renaming or re-adding an effect with
 * the same settings finds the same file.
 */
export function bakeSignature(effects: readonly AudioEffect[]): string {
  const stages = effects.map((e) => {
    const spec = effectSpec(e.kind)
    return `${e.kind}(${(spec?.params ?? []).map((p) => `${p.key}=${num(paramOf(e, p.key))}`).join(',')})`
  })
  return `${BAKE_VERSION}|${stages.join('|')}`
}

// -- the plan: which part of a clip's sound is baked, and which bands run live, where --------------

export interface EffectPlan {
  /**
   * Rendered into the clip's processed file, in order. Empty means the clip plays its own file.
   * Holds equaliser bands too when they come before a dynamics stage — order is kept.
   */
  bake: readonly AudioEffect[]
  /** Bands on the clip's own sound, before its fader, fades and pan. */
  clip: readonly BiquadSpec[]
}

export const NO_EFFECTS: EffectPlan = Object.freeze({ bake: NONE, clip: [] as BiquadSpec[] })

interface HasEffects {
  audioEffects?: AudioEffect[]
}

function lastBakedIndex(list: readonly AudioEffect[]): number {
  for (let i = list.length - 1; i >= 0; i -= 1) if (isBakedKind(list[i]!.kind)) return i
  return -1
}

const bands = (list: readonly AudioEffect[]): BiquadSpec[] =>
  list.map(biquadOf).filter((b): b is BiquadSpec => b !== null)

/**
 * How one clip's sound is processed, given its own chain and its track's.
 *
 * The signal path is: **clip effects → clip volume, fades, transition, duck, track fader
 * (`itemAudioGainAt`) → pan → the track's bus → track effects → the mix → mastering.** Clip
 * effects are before the fader on purpose — an insert, as on any mixer — so a compressor's
 * threshold means the same thing whatever the clip's volume is, and a fade-out fades the processed
 * sound instead of pulling it back under the threshold.
 *
 * Within the clip's chain, everything up to its last baked stage is baked (bands before a
 * compressor included, because order matters to a compressor) and the bands after it run live.
 *
 * **A track's baked stages are applied to each of its clips, not to the bus.** A bus cannot be
 * baked: it is the sum of clips that move. So when the track's chain holds a baked stage, each
 * clip's bake is its own whole chain followed by the track's chain up to that stage — the track's
 * dynamics act on each clip before that clip's fader — and only the track bands *after* the
 * track's last baked stage run on the bus (`trackBusBands`). For clips that do not overlap, which
 * is what a track holds outside a transition, that differs from a bus compressor only in that the
 * clip's own volume comes after it rather than before.
 */
export function itemEffectPlan(track: HasEffects | undefined | null, item: HasEffects): EffectPlan {
  if (!item.audioEffects && !track?.audioEffects) return NO_EFFECTS
  const own = activeEffects(item.audioEffects)
  const tracks = activeEffects(track?.audioEffects)
  if (own.length === 0 && tracks.length === 0) return NO_EFFECTS
  const trackCut = lastBakedIndex(tracks)
  if (trackCut >= 0) return { bake: [...own, ...tracks.slice(0, trackCut + 1)], clip: [] }
  const cut = lastBakedIndex(own)
  return { bake: cut >= 0 ? own.slice(0, cut + 1) : NONE, clip: bands(own.slice(cut + 1)) }
}

/** The bands that run on a track's bus: its active chain after its last baked stage. */
export function trackBusBands(track: HasEffects | undefined | null): readonly BiquadSpec[] {
  if (!track?.audioEffects) return NO_BANDS
  const active = activeEffects(track.audioEffects)
  if (active.length === 0) return NO_BANDS
  return bands(active.slice(lastBakedIndex(active) + 1))
}

const NO_BANDS: readonly BiquadSpec[] = Object.freeze([]) as readonly BiquadSpec[]

/** The ffmpeg chain fragment for live bands, or null when there are none (no filter at all). */
export function ffmpegBands(specs: readonly BiquadSpec[]): string | null {
  return specs.length === 0 ? null : specs.map(ffmpegBiquad).join(',')
}

// -- checking, editing, presets ----------------------------------------------------------------------

const UNIT_WORDS: Record<ParamUnit, string> = { Hz: 'Hz', dB: 'dB', ms: 'ms', ratio: ':1', Q: '', '%': '%' }

function rangeText(p: ParamSpec): string {
  const unit = UNIT_WORDS[p.unit]
  return `${p.min} to ${p.max}${unit ? (unit === ':1' ? ' (a ratio, 4 means 4:1)' : ` ${unit}`) : ''}`
}

/** One line per parameter of a kind — what a refusal quotes so the next call can be right. */
export function describeParams(kind: AudioEffectKind): string {
  return effectSpec(kind)!
    .params.map((p) => `${p.key} ${rangeText(p)} (default ${Number(p.default.toFixed(3))})`)
    .join('; ')
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Checks one effect's kind and parameters and fills in the defaults a caller left out. Refuses an
 * unknown kind (naming the kinds), an unknown parameter (naming this kind's), and a value outside
 * its range (naming the range and unit) — never clamps, because a clamped call reports success for
 * a sound the caller did not ask for.
 */
export function checkEffect(value: unknown, id: string): Checked<AudioEffect> {
  if (!value || typeof value !== 'object') return { ok: false, error: 'An effect is an object: { kind, params }.' }
  const given = value as { kind?: unknown; params?: unknown; enabled?: unknown; id?: unknown }
  const spec = typeof given.kind === 'string' ? effectSpec(given.kind) : undefined
  if (!spec) {
    return {
      ok: false,
      error: `Unknown effect kind ${JSON.stringify(given.kind)}. The kinds are: ${AUDIO_EFFECT_KINDS.join(', ')}.`
    }
  }
  const params: Record<string, number> = {}
  const raw = (given.params ?? {}) as Record<string, unknown>
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `${spec.kind}.params is an object of numbers: ${describeParams(spec.kind)}.` }
  }
  for (const key of Object.keys(raw)) {
    if (!spec.params.some((p) => p.key === key)) {
      return { ok: false, error: `${spec.kind} has no parameter "${key}". Its parameters: ${describeParams(spec.kind)}.` }
    }
  }
  for (const p of spec.params) {
    const v = raw[p.key]
    if (v === undefined) {
      params[p.key] = p.default
      continue
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < p.min || v > p.max) {
      return { ok: false, error: `${spec.kind}.${p.key} must be ${rangeText(p)}; got ${JSON.stringify(v)}. ${p.hint}` }
    }
    params[p.key] = v
  }
  if (given.enabled !== undefined && typeof given.enabled !== 'boolean') {
    return { ok: false, error: `${spec.kind}.enabled is true or false.` }
  }
  const effect: AudioEffect = { id: typeof given.id === 'string' && given.id ? given.id : id, kind: spec.kind, params }
  if (given.enabled === false) effect.enabled = false
  return { ok: true, value: effect }
}

export interface AudioEffectPreset {
  slug: string
  name: string
  description: string
  effects: readonly { kind: AudioEffectKind; params: Record<string, number> }[]
}

/**
 * Named chains. A preset is data: applying one writes ordinary effects into the list, which are
 * then edited, reordered and switched off like any others — nothing remembers it was a preset.
 */
export const AUDIO_EFFECT_PRESETS: readonly AudioEffectPreset[] = [
  {
    slug: 'podcast-voice',
    name: 'Podcast voice',
    description: 'A spoken voice made clear and even: rumble out, a little mud out, presence in, sibilance tamed, levelled, and a ceiling.',
    effects: [
      { kind: 'highpass', params: { frequency: 80 } },
      { kind: 'bell', params: { frequency: 250, gain: -2.5, q: 1 } },
      { kind: 'bell', params: { frequency: 4000, gain: 3, q: 0.9 } },
      { kind: 'deesser', params: { frequency: 6500, threshold: -28, ratio: 4 } },
      { kind: 'compressor', params: { threshold: -20, ratio: 3, attack: 8, release: 120, knee: 6, makeup: 4 } },
      { kind: 'limiter', params: { ceiling: -1 } }
    ]
  },
  {
    slug: 'telephone',
    name: 'Telephone',
    description: 'The narrow band of a phone line: nothing under 300 Hz or over 3.4 kHz, a nasal push in the middle, squashed.',
    effects: [
      { kind: 'highpass', params: { frequency: 300 } },
      { kind: 'lowpass', params: { frequency: 3400 } },
      { kind: 'bell', params: { frequency: 1800, gain: 5, q: 1 } },
      { kind: 'compressor', params: { threshold: -24, ratio: 6, attack: 5, release: 80, knee: 3, makeup: 6 } }
    ]
  },
  {
    slug: 'radio',
    name: 'Radio',
    description: 'A broadcast voice: a warm low end, bright top, heavily levelled and held under a ceiling.',
    effects: [
      { kind: 'highpass', params: { frequency: 100 } },
      { kind: 'lowshelf', params: { frequency: 150, gain: 3 } },
      { kind: 'bell', params: { frequency: 3000, gain: 3, q: 1 } },
      { kind: 'highshelf', params: { frequency: 9000, gain: 2 } },
      { kind: 'compressor', params: { threshold: -22, ratio: 4, attack: 5, release: 80, knee: 6, makeup: 5 } },
      { kind: 'limiter', params: { ceiling: -1 } }
    ]
  },
  {
    slug: 'noise-cleanup',
    name: 'Noise cleanup',
    description: 'For a noisy recording: rumble out, steady background noise removed, and the gaps between sentences turned down.',
    effects: [
      { kind: 'highpass', params: { frequency: 70 } },
      { kind: 'denoise', params: { strength: 60 } },
      { kind: 'gate', params: { threshold: -50, ratio: 2, range: -18, attack: 5, release: 200, knee: 6 } }
    ]
  }
]

export function findPreset(nameOrSlug: string): AudioEffectPreset | undefined {
  const wanted = nameOrSlug.trim().toLowerCase().replace(/[\s_]+/g, '-')
  return AUDIO_EFFECT_PRESETS.find((p) => p.slug === wanted || p.name.toLowerCase().replace(/\s+/g, '-') === wanted)
}

/** One change to a chain. The inspector and the `audio_effects` tool both go through `applyEffectOp`. */
export type EffectOp =
  | { op: 'add'; kind: unknown; params?: unknown; enabled?: unknown; index?: number }
  | { op: 'edit'; effectId: string; params?: unknown; enabled?: boolean }
  | { op: 'remove'; effectId: string }
  | { op: 'move'; effectId: string; toIndex: number }
  | { op: 'preset'; preset: string; mode?: 'replace' | 'append' }
  | { op: 'clear' }

function unknownId(list: readonly AudioEffect[], effectId: string): string {
  return list.length === 0
    ? `There is no effect ${JSON.stringify(effectId)}: the chain is empty. Add one first.`
    : `There is no effect ${JSON.stringify(effectId)}. The chain holds: ${list.map((e) => `${e.id} (${e.kind})`).join(', ')}.`
}

/**
 * `list` with `op` applied, or the sentence that says why not and what would be accepted. Pure:
 * `makeId` is asked for an id only when an effect is created.
 */
export function applyEffectOp(
  list: readonly AudioEffect[] | undefined,
  op: EffectOp,
  makeId: () => string
): Checked<AudioEffect[]> {
  const current = list ?? []
  const tooMany = (count: number): string =>
    `A chain holds at most ${MAX_AUDIO_EFFECTS} effects; this would make ${count}. Remove one first.`
  switch (op.op) {
    case 'add': {
      if (current.length + 1 > MAX_AUDIO_EFFECTS) return { ok: false, error: tooMany(current.length + 1) }
      const made = checkEffect({ kind: op.kind, params: op.params, enabled: op.enabled }, makeId())
      if (!made.ok) return made
      const at = op.index ?? current.length
      if (!Number.isInteger(at) || at < 0 || at > current.length) {
        return { ok: false, error: `index must be a whole number from 0 (first) to ${current.length} (last); got ${at}.` }
      }
      return { ok: true, value: [...current.slice(0, at), made.value, ...current.slice(at)] }
    }
    case 'edit': {
      const found = current.find((e) => e.id === op.effectId)
      if (!found) return { ok: false, error: unknownId(current, op.effectId) }
      if (op.params === undefined && op.enabled === undefined) {
        return { ok: false, error: `Nothing to change: give params (${describeParams(found.kind)}) or enabled.` }
      }
      const filled: Record<string, number> = {}
      for (const p of effectSpec(found.kind)!.params) filled[p.key] = paramOf(found, p.key)
      const merged = checkEffect(
        {
          kind: found.kind,
          params: { ...filled, ...((op.params as Record<string, unknown> | undefined) ?? {}) },
          enabled: op.enabled ?? found.enabled
        },
        found.id
      )
      if (!merged.ok) return merged
      return { ok: true, value: current.map((e) => (e.id === found.id ? { ...merged.value, id: found.id } : e)) }
    }
    case 'remove': {
      if (!current.some((e) => e.id === op.effectId)) return { ok: false, error: unknownId(current, op.effectId) }
      return { ok: true, value: current.filter((e) => e.id !== op.effectId) }
    }
    case 'move': {
      const from = current.findIndex((e) => e.id === op.effectId)
      if (from < 0) return { ok: false, error: unknownId(current, op.effectId) }
      if (!Number.isInteger(op.toIndex) || op.toIndex < 0 || op.toIndex >= current.length) {
        return { ok: false, error: `toIndex must be a whole number from 0 (first) to ${current.length - 1} (last); got ${op.toIndex}.` }
      }
      const next = current.filter((_, i) => i !== from)
      next.splice(op.toIndex, 0, current[from]!)
      return { ok: true, value: next }
    }
    case 'preset': {
      const preset = findPreset(String(op.preset))
      if (!preset) {
        return {
          ok: false,
          error: `Unknown preset ${JSON.stringify(op.preset)}. The presets are: ${AUDIO_EFFECT_PRESETS.map((p) => `"${p.slug}" (${p.name})`).join(', ')}.`
        }
      }
      const base = op.mode === 'append' ? current : []
      if (base.length + preset.effects.length > MAX_AUDIO_EFFECTS) {
        return { ok: false, error: tooMany(base.length + preset.effects.length) }
      }
      const made: AudioEffect[] = []
      for (const each of preset.effects) {
        const checked = checkEffect(each, makeId())
        if (!checked.ok) return checked
        made.push(checked.value)
      }
      return { ok: true, value: [...base, ...made] }
    }
    case 'clear':
      return { ok: true, value: [] }
  }
}

/** A chain read back for a person or an agent: each stage with its unit-bearing values. */
export function describeEffect(effect: AudioEffect): string {
  const spec = effectSpec(effect.kind)
  if (!spec) return effect.kind
  const values = spec.params.map((p) => {
    const v = Number(paramOf(effect, p.key).toFixed(2))
    return p.unit === 'ratio' ? `${p.key} ${v}:1` : p.unit === 'Q' ? `Q ${v}` : `${p.key} ${v} ${p.unit}`
  })
  return `${spec.label} (${values.join(', ')})${effect.enabled === false ? ' — off' : ''}`
}
