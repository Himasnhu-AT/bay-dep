/**
 * The numbers and small conversions shared by everything that has to agree about where a
 * media element should be. They live here rather than in one of the three consumers so
 * that the compositor, the audio engine and the exporter cannot drift apart — a picture
 * pinned to one tolerance and a sound pinned to another is a lip-sync bug with no single
 * place to fix it.
 */

import { sourceTimeAt, US_PER_SECOND, type Item, type Asset } from '@shared/project'
import { CLIP_SPEED_RANGE } from '@shared/speed'
import { speedAtFrame } from '@shared/speed-curve'

/**
 * How far a media element may run from where the timeline says it should be before we
 * correct it during playback. An element that is playing drifts constantly by small
 * amounts; every correction is a discontinuity in the audio, so correcting a 5ms error
 * costs more than it fixes. 80ms is about where a correction stops being audible as a
 * click and starts being audible as a slip.
 */
export const DRIFT_TOLERANCE_SECONDS = 0.08

/**
 * How far ahead of the playhead live playback puts the next clip's element in place. A seek to a
 * trimmed in-point decodes from the keyframe before it — up to 20 frames on the reporter's takes,
 * seconds on long-GOP footage — so this is generous; each clip costs one paused, seeked decoder.
 */
export const PREROLL_SECONDS = 1

/**
 * How long a seek in flight is left alone during playback before it is assumed lost and asked
 * again. Longer than {@link STALE_SEEK_MS} because a playing element's seek is not a scrub that a
 * newer one supersedes: restarting it only restarts the decode from the keyframe.
 */
export const PLAYBACK_SEEK_PATIENCE_MS = 2000

/** The most a playback seek is aimed ahead of the clock to cover its own latency. */
export const MAX_SEEK_LEAD_MS = 1000

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
 * How far past the computed source time a media element is asked to seek.
 *
 * Source time is whole microseconds, so a frame-exact in-point at 24 fps cannot be stored
 * exactly: frame 68 is 2.8333333 s, stored as 2 833 333 µs, and a timeline frame's offset is
 * rounded again. The sum lands up to a microsecond *before* the source frame's timestamp, and a
 * video element shows the frame whose timestamp is at or before `currentTime` — so the clip
 * showed the previous source frame on every timeline frame where the roundings fell short, and
 * the right one where they did not: a one-frame judder through the whole clip (measured on a
 * 24 fps take placed at 2.833333 s: timeline frames alternated between source 94 and 95 where 95
 * was asked). Half a millisecond is far larger than any rounding here and far smaller than a
 * frame at any rate a source has (4.2 ms at 240 fps), and inaudible where the audio engine
 * seeks by the same number.
 */
export const FRAME_EDGE_SECONDS = 0.0005

/**
 * Where in the source, in seconds, `item` should be reading at timeline `frame`.
 *
 * Clamped inside the asset: a clip trimmed past the end of its source, or one whose
 * `speed` runs it off the end, would otherwise ask for a `currentTime` the element
 * refuses, and a refused seek leaves the element wherever it was — which reads as a
 * frozen picture rather than as the out-of-range request it is.
 */
export function sourceSecondsAt(item: Item, asset: Asset, frame: number, fps: number): number {
  const raw = sourceTimeAt(item, frame, fps) / US_PER_SECOND + FRAME_EDGE_SECONDS
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
  return clamp(finite(speed, 1), 0.0625, CLIP_SPEED_RANGE.max)
}

/** The slowest rate a media element plays at; below it (a hold is 0) the picture is stepped. */
export const SLOWEST_PLAYABLE_RATE = 0.0625

/**
 * How live playback moves a clip's element at timeline `frame`.
 *
 * `play` is the ordinary case: the element runs at `rate` and is only corrected when it drifts.
 * Under a speed ramp the rate is the curve's at this frame, set again every frame — which is the
 * same sum `sourceTimeAt` integrates, so the drift correction has only rounding to absorb.
 *
 * `step` is for what an element cannot play: **backwards**, and slower than it will go (a held
 * frame is speed 0). The element stays paused and is seeked to each frame's source time, exactly
 * as a scrub does. It is the honest baseline, not a fast one: every step back is a decode from
 * the keyframe before it, so on long-GOP footage the picture updates as often as seeks land and
 * the last complete picture is held in between (`pictureHold`). Export and `preview_frame` wait
 * for every seek, so they are frame-exact whatever this achieves.
 */
export function transportFor(item: Item, frame: number): { mode: 'play'; rate: number } | { mode: 'step' } {
  if (item.reverse) return { mode: 'step' }
  const rate = speedAtFrame(item, frame - item.from)
  if (!(rate >= SLOWEST_PLAYABLE_RATE)) return { mode: 'step' }
  return { mode: 'play', rate: playbackRateFor(rate) }
}
