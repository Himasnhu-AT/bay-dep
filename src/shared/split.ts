/**
 * Cutting one clip in two: the store's Split (`splitAt`) and `switch_speakers`, which razors each
 * angle at every cut, share this so a switched angle's pieces play exactly what the whole did.
 */

import { itemEnd, sourceEdgeAt, type Frames, type Item, type Transition } from './project'
import { sliceKeyframes } from './keyframes'
import { splitAnimation } from './animation'

/**
 * Cuts `item` at timeline frame `at`, shortening it to the left half (mutated) and returning the
 * right half as a new item with id `id`. Null — and `item` untouched — when `at` is on or outside
 * an edge, because a cut there would make a zero-length clip.
 *
 * A transition out of `item` sits on its end, which is now the right half's: pass the timeline's
 * `transitions` and any whose `fromItemId` was `item` is re-pointed there. A transition *into*
 * `item` stays on the left half, which keeps its id and its start.
 */
export function splitItemAt(item: Item, at: Frames, fps: number, id: string, transitions?: Transition[]): Item | null {
  if (at <= item.from || at >= itemEnd(item)) return null
  const leftDuration = at - item.from
  const rightDuration = item.durationInFrames - leftDuration
  const right: Item = {
    ...item,
    id,
    from: at,
    durationInFrames: rightDuration,
    // Where the left half stops reading — through the one mapping, so a reversed or ramped clip
    // splits into two that play exactly what the whole did.
    sourceStartUs: sourceEdgeAt(item, leftDuration, fps),
    layout: { ...item.layout },
    fadeInFrames: 0,
    // Each half keeps the keys that shape it, so the pair draws exactly what the whole did.
    keyframes: sliceKeyframes(item.keyframes, leftDuration, item.durationInFrames)
  }
  if (!right.keyframes) delete right.keyframes
  if (item.keyframes) item.keyframes = sliceKeyframes(item.keyframes, 0, leftDuration)
  // The left half still arrives and the right half still leaves; neither does both.
  if (item.animation) {
    const [leftAnimation, rightAnimation] = splitAnimation(item.animation)
    if (leftAnimation) item.animation = leftAnimation
    else delete item.animation
    if (rightAnimation) right.animation = rightAnimation
    else delete right.animation
  }
  item.durationInFrames = leftDuration
  item.fadeOutFrames = Math.min(item.fadeOutFrames, leftDuration)
  right.fadeOutFrames = Math.min(right.fadeOutFrames, rightDuration)
  for (const transition of transitions ?? []) if (transition.fromItemId === item.id) transition.fromItemId = right.id
  return right
}
