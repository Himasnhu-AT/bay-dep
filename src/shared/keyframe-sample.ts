/**
 * The keyframe sampler, on its own so that `project.ts` can reach it.
 *
 * `sourceEdgeAt` in `project.ts` integrates a clip's speed keys, so the model needs this one
 * function; `keyframes.ts` needs the model's `KEYFRAME_PROPERTIES` when it loads. Kept in
 * `keyframes.ts` that was a cycle that ran `KEYFRAME_PROPERTIES.filter` before the list existed.
 * Here it depends on the ease table and on types only. `@shared/keyframes` re-exports it, so
 * there is still one sampler and every import of it keeps working.
 */

import { easeProgress } from './ease'
import type { Keyframe } from './project'

/**
 * The value `keys` give at item-relative `frame`, or undefined when there are none.
 *
 * Before the first key the first value holds; after the last, the last. `keys` must be sorted by
 * frame with no two on one frame — every writer here keeps them so, and the loader repairs a file
 * that is not (`repairKeyframes`).
 */
export function keyframeValueAt(keys: readonly Keyframe[] | undefined, frame: number): number | undefined {
  if (!keys || keys.length === 0) return undefined
  const first = keys[0]!
  if (frame <= first.frame) return first.value
  const last = keys[keys.length - 1]!
  if (frame >= last.frame) return last.value
  // The last key at or before `frame`: binary search, since a volume ride can carry hundreds.
  let lo = 0
  let hi = keys.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (keys[mid]!.frame <= frame) lo = mid
    else hi = mid
  }
  const a = keys[lo]!
  const b = keys[lo + 1]!
  const t = (frame - a.frame) / (b.frame - a.frame)
  return a.value + (b.value - a.value) * easeProgress(a.ease, t)
}
