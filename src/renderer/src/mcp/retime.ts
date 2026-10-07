/**
 * How a reversed or ramped clip reads back to the agent — one description for `edit_item`'s result
 * and `inspect_item`, so what was set and what is reported cannot disagree.
 */

import { plainTime, sourceSpanOf, type Item } from '@shared/project'
import { retimeSound } from '@shared/retime-sound'
import { speedCurveLabel, speedKeysOf } from '@shared/speed-curve'

/**
 * Direction, ramp, the footage read and what the clip's sound does. Empty for a clip that plays
 * forwards at one speed, so every other clip's result reads exactly as it did.
 */
export function retimeReport(item: Item, fps: number): Record<string, unknown> {
  if (plainTime(item)) return {}
  const sound = retimeSound(item)
  const span = sourceSpanOf(item, fps)
  const keys = speedKeysOf(item)
  return {
    ...(item.reverse ? { reverse: true } : {}),
    ...(keys
      ? {
          // In the unit `speedRamp` takes: `speed`, not the stored `value`.
          speedRamp: keys.map((key) => ({ frame: key.frame, speed: key.value, ...(key.ease ? { ease: key.ease } : {}) })),
          speedRange: speedCurveLabel(item)
        }
      : {}),
    // The footage it reads, earliest first, in seconds — direction and ramp already applied.
    footageSeconds: [span.startUs / 1_000_000, span.endUs / 1_000_000],
    sound: { preview: sound.preview, export: sound.export, ...(sound.notice ? { note: sound.notice } : {}) }
  }
}
