/**
 * When a composition's declared sounds play on the timeline — one schedule, read by preview and
 * export alike.
 *
 * A composition clip is a window onto composition time: at timeline frame `f` it shows
 * composition second `sourceStart + (f - from) / fps * speed`, the same mapping `sourceTimeAt`
 * gives any clip. A sound declared at `data-start` is heard whenever that window passes over
 * it. Everything here follows from applying that one mapping to each sound, and clipping to
 * what the clip actually shows.
 *
 * **Speed is honoured, the way a clip's own audio honours it.** A composition at 2× shows its
 * animation at double rate, so its whoosh lands at half the timeline distance and plays at 2×
 * — export through the same `atempo` stages a clip gets, preview through the same
 * `playbackRate`. Refusing speed would make a sped-up title's sound arrive after its picture,
 * which is worse than either choice made deliberately. (Like a clip's audio, it is pitch-
 * preserving in export and pitch-shifting only where the media element chooses to be.)
 *
 * **Clipped to the audible span, not to the item.** A transition over the clip's head or tail
 * shows handle frames outside its own `from..end`, and the sound under those frames plays too —
 * `audibleSpan` is the authority on that range, as `resolveTransition` is on the window.
 *
 * Units, because they are the ones that bite: `CompositionSound` is seconds as authored, and
 * a `ScheduledSound` is **timeline seconds** (seconds from timeline frame 0) and seconds into the
 * sound file. Timeline seconds rather than frames because a sound's start is not frame-aligned
 * — `data-start="0.2"` at 24fps is frame 4.8 — and rounding it to a frame would move every
 * sound by up to half a frame for no reason. The gain envelope, which *is* per frame, stays in
 * frames and comes from `itemAudioGainAt`.
 */

import type { CompositionSound } from './composition'
import type { Frames, Item } from './project'
import { US_PER_SECOND } from './project'

/** A declared sound placed on the timeline for one item. */
export interface ScheduledSound {
  /** The declaration, with the file it resolved to. */
  sound: CompositionSound & { path: string }
  /** Its position in the composition's declared list — a stable key per item. */
  index: number
  /** Timeline seconds at which it starts being heard. */
  startSeconds: number
  /** Timeline seconds at which it stops being heard. Exclusive. */
  endSeconds: number
  /** Seconds into the sound file at `startSeconds`. */
  mediaStartSeconds: number
  /** The rate the sound plays at: the item's speed. */
  speed: number
}

/** A clip's speed as the mix applies it — a non-finite or non-positive one plays at 1×. */
export function mixSpeed(item: Pick<Item, 'speed'>): number {
  return Number.isFinite(item.speed) && item.speed > 0 ? item.speed : 1
}

/**
 * Every declared sound `item` makes heard, placed on the timeline.
 *
 * `span` is the frames over which the item can sound at all — `audibleSpan`, so that a
 * transition's handles are included. `compositionSeconds` is the composition's `data-duration`:
 * nothing plays past it, because the page holds its last frame there and HyperFrames stops
 * its mixer there too. Sounds with no resolved `path` are skipped — they are faults, not
 * sounds.
 */
export function scheduleCompositionSounds(
  item: Item,
  span: { firstFrame: Frames; endFrame: Frames },
  compositionSeconds: number,
  sounds: readonly CompositionSound[],
  fps: number
): ScheduledSound[] {
  const rate = fps > 0 ? fps : 30
  const speed = mixSpeed(item)
  const itemStart = item.from / rate
  const sourceStart = item.sourceStartUs / US_PER_SECOND
  // Composition time at a timeline second, and back — the clip mapping and its inverse.
  const compositionAt = (seconds: number): number => sourceStart + (seconds - itemStart) * speed
  const timelineAt = (compositionTime: number): number =>
    itemStart + (compositionTime - sourceStart) / speed

  const shownFrom = Math.max(0, compositionAt(span.firstFrame / rate))
  const shownTo = Math.min(compositionSeconds, compositionAt(span.endFrame / rate))

  const out: ScheduledSound[] = []
  sounds.forEach((sound, index) => {
    const path = sound.path
    if (path === null) return
    const soundEnd =
      sound.durationSeconds === null
        ? Number.POSITIVE_INFINITY
        : sound.startSeconds + sound.durationSeconds
    const from = Math.max(sound.startSeconds, shownFrom)
    const to = Math.min(soundEnd, shownTo)
    if (!(to > from)) return
    out.push({
      sound: { ...sound, path },
      index,
      startSeconds: timelineAt(from),
      endSeconds: timelineAt(to),
      // Composition time and sound time advance together — the sound is authored at 1× in the
      // composition — so the offset into the file is how far past its own start we come in.
      mediaStartSeconds: sound.mediaStartSeconds + (from - sound.startSeconds),
      speed
    })
  })
  return out
}

/**
 * Where in the sound file `entry` is at timeline second `seconds`, or null when it is not
 * sounding then. What preview seeks the element to; export trims to the same numbers.
 */
export function soundSecondsAt(entry: ScheduledSound, seconds: number): number | null {
  if (!(seconds >= entry.startSeconds && seconds < entry.endSeconds)) return null
  return entry.mediaStartSeconds + (seconds - entry.startSeconds) * entry.speed
}
