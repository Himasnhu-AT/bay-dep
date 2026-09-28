/**
 * Matching speakers' loudness with clip gain, for `level_voices`.
 *
 * Each clip's source is measured in main (`ebur128`, EBU R128 integrated loudness over exactly the
 * span the clip plays). The level the listener hears is that plus the clip's own gain plus its
 * track fader, both linear 0..2 (`item.volume`, `track.volume`), so the gain that lands a clip on
 * the target is `target − measured − fader`, in dB, applied as `item.volume`. It is a gain, not a
 * render: nothing about the clip's dynamics changes, and undo puts the old level back.
 *
 * The default target is **−16 LUFS**, the level Apple Podcasts asks spoken-word shows to deliver
 * at. Each speaker measured on their own mic is close to what the mix reads while they talk alone,
 * so landing every voice there balances the show and puts it near delivery level in one step.
 */

/** Apple Podcasts' spoken-word delivery level. */
export const DEFAULT_VOICE_LUFS = -16

/** `item.volume` and `track.volume` are linear 0..2: at most +6.02 dB. */
export const MAX_GAIN = 2

/** ebur128 reads anything with no gated audio as −70 LUFS: nothing there to level. */
export const SILENT_LUFS = -69.5

export const gainToDb = (gain: number): number => (gain > 0 ? 20 * Math.log10(gain) : Number.NEGATIVE_INFINITY)
export const dbToGain = (db: number): number => 10 ** (db / 20)

export interface VoiceLevelPlan {
  /** What the listener hears now: measured + current clip gain + fader. */
  beforeLufs: number
  /** What they will hear with `volume`. Short of the target when the gain had to be clamped. */
  afterLufs: number
  /** The new `item.volume`, rounded to 3 places. */
  volume: number
  /** The gain the target needed, when it is more than `MAX_GAIN` allows. */
  neededGainDb?: number
}

const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places

/** The clip gain that puts a clip measured at `measuredLufs` on `targetLufs`. */
export function planVoiceLevel(measuredLufs: number, currentVolume: number, trackVolume: number, targetLufs: number): VoiceLevelPlan {
  const fader = gainToDb(trackVolume > 0 ? trackVolume : 1)
  const beforeLufs = measuredLufs + gainToDb(currentVolume) + fader
  const neededDb = targetLufs - measuredLufs - fader
  const wanted = dbToGain(neededDb)
  const volume = round(Math.min(MAX_GAIN, wanted), 3)
  const plan: VoiceLevelPlan = {
    beforeLufs: round(beforeLufs, 1),
    afterLufs: round(measuredLufs + gainToDb(volume) + fader, 1),
    volume
  }
  if (wanted > MAX_GAIN) plan.neededGainDb = round(neededDb, 1)
  return plan
}
