/**
 * The source viewer's position, in whole frames of the source's own rate.
 *
 * It used to be microseconds read back from `currentTime`, stepped by `1e6 / fps`. Chromium hands
 * `currentTime` back truncated, each step added a frame to the truncated value, and the display
 * floored — so thirty presses of → read 00:00:00:29 and a mark there stored 999999 µs, one frame
 * early in the viewer's own picture and label. Kept as a frame index, a step is `+ 1` and cannot
 * drift, and a mark is the exact start of its frame.
 *
 * The frame → time mapping is the compositor's: frame `n` starts at `framesToUs(n)`, and the
 * element is seeked `FRAME_EDGE_SECONDS` past that start, because a video element shows the frame
 * whose timestamp is at or before `currentTime` and a seek that lands a rounding short shows the
 * previous one.
 */

import { framesToUs, US_PER_SECOND } from '@shared/project'
import { FRAME_EDGE_SECONDS } from '@/engine/sync'

/** The rate a source's frames are counted in: its own, or 30 for a file that has none. */
export function sourceRate(fps: number | null | undefined): number {
  return fps && Number.isFinite(fps) && fps > 0 ? fps : 30
}

/** The last frame a source can be positioned on: the one playing at its very end. */
export function lastSourceFrame(durationUs: number, rate: number): number {
  return Math.max(0, Math.ceil((durationUs / US_PER_SECOND) * rate - 1e-6) - 1)
}

/** Where frame `frame` starts, in source microseconds — what a mark stores. */
export function sourceFrameStartUs(frame: number, rate: number): number {
  return framesToUs(frame, rate)
}

/** The `currentTime` that shows frame `frame`: just past its start, as the compositor seeks. */
export function sourceSeekSeconds(frame: number, rate: number): number {
  return sourceFrameStartUs(frame, rate) / US_PER_SECOND + FRAME_EDGE_SECONDS
}

/**
 * The frame an element is showing at `currentTime` seconds. A small tolerance absorbs the
 * truncation Chromium applies, so a time a hair short of a frame's start reads as that frame and
 * not the one before it.
 */
export function sourceFrameAtSeconds(seconds: number, rate: number): number {
  return Math.max(0, Math.floor(seconds * rate + 1e-3))
}
