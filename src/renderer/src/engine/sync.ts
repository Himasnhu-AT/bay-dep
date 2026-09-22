/**
 * The numbers and small conversions shared by everything that has to agree about where a
 * media element should be. They live here rather than in one of the three consumers so
 * that the compositor, the audio engine and the exporter cannot drift apart — a picture
 * pinned to one tolerance and a sound pinned to another is a lip-sync bug with no single
 * place to fix it.
 */

import { sourceTimeAt, US_PER_SECOND, type Item, type Asset } from '@shared/project'

/**
 * How far a media element may run from where the timeline says it should be before we
 * correct it during playback. An element that is playing drifts constantly by small
 * amounts; every correction is a discontinuity in the audio, so correcting a 5ms error
 * costs more than it fixes. 80ms is about where a correction stops being audible as a
 * click and starts being audible as a slip.
 */
export const DRIFT_TOLERANCE_SECONDS = 0.08

/** How long a seek may be outstanding before we assume it was dropped and re-issue it. */
export const STALE_SEEK_MS = 400

export function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low
  return value < low ? low : value > high ? high : value
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

/** A layout number that survived a bad edit, an unparsed input, or a divide by zero. */
export function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/**
 * Where in the source, in seconds, `item` should be reading at timeline `frame`.
 *
 * Clamped inside the asset: a clip trimmed past the end of its source, or one whose
 * `speed` runs it off the end, would otherwise ask for a `currentTime` the element
 * refuses, and a refused seek leaves the element wherever it was — which reads as a
 * frozen picture rather than as the out-of-range request it is.
 */
export function sourceSecondsAt(item: Item, asset: Asset, frame: number, fps: number): number {
  const raw = sourceTimeAt(item, frame, fps) / US_PER_SECOND
  if (asset.durationUs <= 0) return Math.max(0, raw)
  // Half a frame short of the end: asking for exactly the duration seeks past the last
  // decodable frame on some containers and lands on nothing.
  const last = Math.max(0, asset.durationUs / US_PER_SECOND - 0.5 / Math.max(1, fps))
  return clamp(raw, 0, last)
}


/**
 * The playback rates a media element will actually honour. Outside this it silently mutes.
 *
 * Two ways this diverges from what the export encoder produces, both recorded here because
 * this clamp is where someone would look:
 *
 * - **Pitch.** The export matches only because `preservesPitch` is left at its default of
 *   true, which makes `playbackRate` a time-stretch — the same thing ffmpeg's `atempo`
 *   does. Setting `preservesPitch = false` to get a resample-and-repitch effect would make
 *   the preview and the export disagree, and the fix is on the export side: `asetrate`,
 *   not `atempo`. Nothing sets it today.
 * - **Range.** The clamp is the element's limit, not the timeline's. ffmpeg's atempo chain
 *   handles any positive speed, so a clip beyond this range exports with audio the preview
 *   never played. The export is the more correct of the two, so this is left as it is.
 */
export function playbackRateFor(speed: number): number {
  return clamp(finite(speed, 1), 0.0625, 16)
}
