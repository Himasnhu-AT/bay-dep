/**
 * Loudness mastering for export — the contract and the arithmetic, with no ffmpeg in it.
 *
 * An export can be asked to land at a target integrated loudness (LUFS, ITU-R BS.1770 / EBU
 * R128) under a true-peak ceiling (dBTP). Main (`main/export/master.ts`) does it by a *closed
 * loop on the encoded file*: a linear gain, then a 4×-oversampled limiter, encoded with the
 * export's own codec, measured, corrected, repeated. Two things already cost a finished edit and
 * are why it is shaped like this rather than as one `loudnorm`:
 *
 * - **`loudnorm` falls back to dynamic mode without saying so in its output** — only its JSON's
 *   `normalization_type` does — and dynamic mode pumps. A "two-pass linear" call that silently
 *   compresses is a control that does not do what it says. Gain is the only thing applied here,
 *   and the limiter only touches peaks.
 * - **AAC adds true peak.** Encoding put ~0.8 dB on the peaks of a mix that measured under its
 *   ceiling as PCM. A ceiling verified before the encoder is not a ceiling, so the measurement
 *   that decides "done" is taken on the encoded bytes.
 *
 * **Off by default.** Mastering changes the level of the file away from the level the user
 * monitored in the preview; doing it unasked would make every export sound different from the
 * edit. It is one argument away — `loudness: "streaming"` — and the presets are the numbers the
 * common destinations publish.
 */

export interface LoudnessTarget {
  /** Integrated loudness to land on, LUFS. −14 for streaming platforms, −23 for EBU R128. */
  integratedLufs: number
  /** Maximum true peak of the *encoded* file, dBTP. */
  truePeakDb: number
}

export const LOUDNESS_PRESETS = {
  /** What YouTube, Spotify and most streaming platforms normalise to. */
  streaming: { integratedLufs: -14, truePeakDb: -1 },
  /** The common spoken-word target (Apple Podcasts' recommendation). */
  podcast: { integratedLufs: -16, truePeakDb: -1 },
  /** EBU R128 broadcast. */
  broadcast: { integratedLufs: -23, truePeakDb: -1 }
} as const satisfies Record<string, LoudnessTarget>

export type LoudnessPreset = keyof typeof LOUDNESS_PRESETS

/** Acceptance: the delivered file reads within this of the target. */
export const LOUDNESS_TOLERANCE_LU = 0.5
/**
 * The loop stops early once inside this — tighter than acceptance, so a file that is "met" is
 * not met by a hair that the next encoder release could tip over.
 */
export const LOUDNESS_AIM_LU = 0.2
/** Passes of gain → limit → encode → measure before the loop gives up and says so. */
export const MAX_MASTER_PASSES = 6

const LUFS_RANGE = { min: -40, max: -5 }
const PEAK_RANGE = { min: -12, max: 0 }

/**
 * A caller's `loudness` argument as a target, or an error sentence naming what is accepted.
 * Accepts a preset name, `"off"`, or `{ integratedLufs, truePeakDb }`.
 */
export function parseLoudness(value: unknown): { target: LoudnessTarget | null } | { error: string } {
  const presets = Object.keys(LOUDNESS_PRESETS)
  if (value === undefined || value === null || value === 'off') return { target: null }
  if (typeof value === 'string') {
    const preset = (LOUDNESS_PRESETS as Record<string, LoudnessTarget>)[value]
    if (preset) return { target: { ...preset } }
    return {
      error:
        `loudness "${value}" is not a preset. Use one of ${presets.map((p) => `"${p}"`).join(', ')}, ` +
        `"off", or { integratedLufs, truePeakDb }.`
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'loudness must be a preset name or an object { integratedLufs, truePeakDb }.' }
  }
  const given = value as Record<string, unknown>
  const unknown = Object.keys(given).filter((k) => k !== 'integratedLufs' && k !== 'truePeakDb')
  if (unknown.length > 0) {
    return { error: `loudness has no field "${unknown[0]}". The fields are integratedLufs and truePeakDb.` }
  }
  const lufs = given.integratedLufs
  const peak = given.truePeakDb ?? -1
  if (typeof lufs !== 'number' || !Number.isFinite(lufs) || lufs < LUFS_RANGE.min || lufs > LUFS_RANGE.max) {
    return {
      error:
        `loudness.integratedLufs must be a number from ${LUFS_RANGE.min} to ${LUFS_RANGE.max} LUFS; ` +
        `got ${JSON.stringify(lufs)}. −14 is the streaming norm, −23 broadcast.`
    }
  }
  if (typeof peak !== 'number' || !Number.isFinite(peak) || peak < PEAK_RANGE.min || peak > PEAK_RANGE.max) {
    return {
      error:
        `loudness.truePeakDb must be a number from ${PEAK_RANGE.min} to ${PEAK_RANGE.max} dBTP; ` +
        `got ${JSON.stringify(peak)}. −1 is the usual ceiling.`
    }
  }
  return { target: { integratedLufs: lufs, truePeakDb: peak } }
}

/** One measurement of a file: EBU R128 integrated loudness and 4×-oversampled true peak. */
export interface LoudnessMeasurement {
  /** LUFS. −70 (the gate floor) or lower for silence. */
  integratedLufs: number
  /** dBTP. `-Infinity` for digital silence. */
  truePeakDb: number
}

/**
 * What mastering did, as the export reports it. Written sentence-first: every state has a line
 * a person reads (`summary`), and `status` is what distinguishes them.
 *
 * - `met` — "Mastered to −14.1 LUFS (target −14), true peak −1.4 dBTP (ceiling −1), measured
 *   on the encoded file."
 * - `missed` — the loop ran out of passes; the file is delivered at the level it reached, and
 *   the sentence gives both numbers and the target so the gap is visible.
 * - `silent` — there was nothing to measure, so no gain was applied. Distinct from `missed`:
 *   no amount of iterating turns silence into −14 LUFS.
 */
export interface LoudnessReport {
  status: 'met' | 'missed' | 'silent'
  target: LoudnessTarget
  /** Measured on the delivered file. Null only when silent. */
  measured: LoudnessMeasurement | null
  /** The mix before mastering. */
  before: LoudnessMeasurement
  /** The gain the last pass applied, dB. */
  gainDb: number
  /** The limiter ceiling the last pass used, dBFS at 4× oversampling. */
  limiterCeilingDb: number
  passes: number
  summary: string
}

/** Where the loop is: the next pass's settings. */
export interface MasterSettings {
  gainDb: number
  limiterCeilingDb: number
}

/** Below this the mix is treated as silence: it is the BS.1770 absolute gate. */
export const SILENCE_LUFS = -70

/**
 * The first pass: gain straight to the target from the unmastered measurement, and a limiter
 * ceiling half a dB under the true-peak ceiling — a first guess at the codec's overshoot, which
 * the loop then measures and corrects rather than trusting.
 */
export function firstPass(target: LoudnessTarget, before: LoudnessMeasurement): MasterSettings {
  return {
    gainDb: target.integratedLufs - before.integratedLufs,
    limiterCeilingDb: clampCeiling(target.truePeakDb - 0.5)
  }
}

/** `alimiter` accepts a limit from 0.0625 (−24.1 dB) to 1 (0 dB). */
function clampCeiling(db: number): number {
  return Math.max(-24, Math.min(0, db))
}

/** True when a measurement is inside the acceptance window for `target`. */
export function meetsTarget(target: LoudnessTarget, measured: LoudnessMeasurement): boolean {
  return (
    Math.abs(measured.integratedLufs - target.integratedLufs) <= LOUDNESS_TOLERANCE_LU &&
    measured.truePeakDb <= target.truePeakDb
  )
}

/**
 * One step of the loop: given the settings a pass used and what its encoded file measured,
 * either stop, or the settings for the next pass.
 *
 * Each correction is the measured error, applied where it lives: loudness by gain, peak by the
 * limiter ceiling (plus 0.1 dB so a codec that overshoots by exactly the gap does not need a
 * third try). The two interact — a lower ceiling takes loudness off dense material, more gain
 * pushes more into the limiter — which is why it is a loop and not a formula.
 */
export function nextPass(
  target: LoudnessTarget,
  used: MasterSettings,
  measured: LoudnessMeasurement
): { done: true } | { done: false; next: MasterSettings } {
  const loudnessError = target.integratedLufs - measured.integratedLufs
  const peakOver = measured.truePeakDb - target.truePeakDb
  if (Math.abs(loudnessError) <= LOUDNESS_AIM_LU && peakOver <= 0) return { done: true }
  return {
    done: false,
    next: {
      gainDb: used.gainDb + (Math.abs(loudnessError) > LOUDNESS_AIM_LU ? loudnessError : 0),
      limiterCeilingDb: clampCeiling(
        peakOver > 0 ? used.limiterCeilingDb - (peakOver + 0.1) : used.limiterCeilingDb
      )
    }
  }
}

/** One decimal, with a real minus sign, for the sentences a person reads. */
function db(value: number): string {
  if (!Number.isFinite(value)) return value < 0 ? '−∞' : '∞'
  const fixed = value.toFixed(1)
  return fixed.startsWith('-') ? `−${fixed.slice(1)}` : fixed
}

export function loudnessSummary(report: Omit<LoudnessReport, 'summary'>): string {
  const { target, measured } = report
  if (report.status === 'silent' || !measured) {
    return (
      `Mastering skipped: the mix measures ${db(report.before.integratedLufs)} LUFS, which is ` +
      `silence, so there is nothing to bring to ${db(target.integratedLufs)} LUFS.`
    )
  }
  const reading =
    `${db(measured.integratedLufs)} LUFS (target ${db(target.integratedLufs)}), true peak ` +
    `${db(measured.truePeakDb)} dBTP (ceiling ${db(target.truePeakDb)})`
  if (report.status === 'met') {
    return `Mastered to ${reading}, measured on the encoded file after ${report.passes} pass${report.passes === 1 ? '' : 'es'}.`
  }
  return (
    `Mastering did not converge in ${report.passes} passes: the encoded file reads ${reading}. ` +
    `It is delivered at that level. Dense material limited this hard usually needs a lower ` +
    `target or a quieter mix going in.`
  )
}

/**
 * The summary block `ffmpeg -af ebur128=peak=true` prints, as numbers — or null when the text
 * has no summary (the filter did not run, or the output was cut off).
 *
 * Read from the *last* "Summary:" block, since per-frame lines precede it and repeat the labels.
 */
export function parseEbur128Summary(stderr: string): LoudnessMeasurement | null {
  const at = stderr.lastIndexOf('Summary:')
  if (at < 0) return null
  const tail = stderr.slice(at)
  const integrated = /I:\s+(-?[\d.]+|-inf|nan)\s+LUFS/.exec(tail)
  const peak = /Peak:\s+(-?[\d.]+|-inf|inf|nan)\s+dBFS/.exec(tail)
  if (!integrated || !peak) return null
  const number = (text: string): number =>
    text === '-inf' ? Number.NEGATIVE_INFINITY : text === 'inf' ? Number.POSITIVE_INFINITY : Number(text)
  const integratedLufs = number(integrated[1]!)
  const truePeakDb = number(peak[1]!)
  if (Number.isNaN(integratedLufs) || Number.isNaN(truePeakDb)) return null
  return { integratedLufs, truePeakDb }
}
