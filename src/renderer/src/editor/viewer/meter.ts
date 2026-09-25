/**
 * The master meter's arithmetic: decibels, where a level sits on the scale, and the ballistics
 * (peak hold, fall-back, clip latch). Pure, so the behaviour a person reads off the meter —
 * "it clipped", "it peaked at -6" — is tested without an AudioContext.
 */

/** The bottom of the scale. Quieter than this draws as nothing. */
export const METER_FLOOR_DB = -60
/** How long the peak marker holds before it falls. */
export const PEAK_HOLD_MS = 1500
/** How fast a held peak falls once released, and how fast the bar itself falls. */
export const PEAK_FALL_DB_PER_S = 24
export const BAR_FALL_DB_PER_S = 36

/** Amplitude (1 = full scale) to dBFS; silence is -Infinity. */
export function toDb(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : Number.NEGATIVE_INFINITY
}

/**
 * Where a level sits on the meter, 0..1. Linear in dB from the floor to 0 dBFS, which is how
 * every NLE's meter reads: -6 dB is well up the bar, not a quarter of it.
 */
export function meterPosition(db: number): number {
  if (!(db > METER_FLOOR_DB)) return 0
  return Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB)
}

/** One channel's displayed state. */
export interface ChannelMeter {
  /** The bar: RMS in dB, rising at once and falling at `BAR_FALL_DB_PER_S`. */
  rmsDb: number
  /** The peak marker, in dB. */
  peakDb: number
  /** When the marker was last pushed up (ms, the caller's clock). */
  peakAt: number
  /** Latched once a sample reaches full scale; cleared only by `resetClip`. */
  clipped: boolean
}

export function emptyChannel(): ChannelMeter {
  return { rmsDb: Number.NEGATIVE_INFINITY, peakDb: Number.NEGATIVE_INFINITY, peakAt: 0, clipped: false }
}

/**
 * The channel after one reading. `now` and `dtMs` are the caller's clock, so the test drives
 * time. `ballistics: false` (reduced motion) shows the reading as it is: no hold, no fall.
 */
export function stepChannel(
  state: ChannelMeter,
  reading: { peak: number; rms: number },
  now: number,
  dtMs: number,
  ballistics = true
): ChannelMeter {
  const peakDb = toDb(reading.peak)
  const rmsDb = toDb(reading.rms)
  // A sample at full scale is clipping (float samples past 1 are clipped by the output).
  const clipped = state.clipped || reading.peak >= 1
  if (!ballistics) return { rmsDb, peakDb, peakAt: now, clipped }

  const barFall = state.rmsDb - (BAR_FALL_DB_PER_S * dtMs) / 1000
  const nextRms = rmsDb >= barFall ? rmsDb : barFall

  let nextPeak = state.peakDb
  let peakAt = state.peakAt
  if (peakDb >= state.peakDb) {
    nextPeak = peakDb
    peakAt = now
  } else if (now - state.peakAt > PEAK_HOLD_MS) {
    nextPeak = Math.max(peakDb, state.peakDb - (PEAK_FALL_DB_PER_S * dtMs) / 1000)
  }
  return {
    rmsDb: nextRms < METER_FLOOR_DB ? Number.NEGATIVE_INFINITY : nextRms,
    peakDb: nextPeak < METER_FLOOR_DB ? Number.NEGATIVE_INFINITY : nextPeak,
    peakAt,
    clipped
  }
}

/** A dB value as the meter's tooltip reads it: `-6.0 dB`, `-∞`. */
export function formatDb(db: number): string {
  return Number.isFinite(db) ? `${db.toFixed(1)} dB` : '−∞ dB'
}

/** The marks a tall meter prints beside its bars, in dBFS. Denser near the top, where mixing happens. */
export const METER_SCALE_DB: readonly number[] = [0, -3, -6, -12, -18, -24, -36, -48, -60]

/** Each scale mark with where it sits on the meter (0 bottom, 1 top), for a DOM scale beside a canvas. */
export function meterTicks(marks: readonly number[] = METER_SCALE_DB): { db: number; label: string; position: number }[] {
  return marks.map((db) => ({ db, label: db === 0 ? '0' : `−${Math.abs(db)}`, position: meterPosition(db) }))
}

/**
 * The loudest of several channels' held peaks, as the number a mixer strip prints under its
 * meter: `−6.0`, `−∞`. A strip with one bar and a strip with two read the same way.
 */
export function heldPeakText(channels: readonly Pick<ChannelMeter, 'peakDb'>[]): string {
  const loudest = channels.reduce((max, channel) => Math.max(max, channel.peakDb), Number.NEGATIVE_INFINITY)
  if (!Number.isFinite(loudest)) return '−∞'
  const text = Math.abs(loudest).toFixed(1)
  return loudest < 0 && text !== '0.0' ? `−${text}` : text
}
