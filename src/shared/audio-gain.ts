/**
 * How loud one item is at one timeline frame — the one implementation preview and export share.
 *
 * Shared rather than renderer-only because export runs in main, and "preview and export must
 * share the gain curve, not merely agree about it": two copies of a gain curve are re-decided
 * independently the first time either is edited, and both sound fine in isolation.
 *
 * **Scope, stated because it is narrower than the name suggests.** Today this is what an HTML
 * composition's declared sounds are mixed with, in both preview (`engine/audio.ts`) and export
 * (`main/export/audio-graph.ts`). Ordinary clips predate it: preview multiplies `fadeGainAt` by
 * the transition gain in `audioRoutingAt`, and export approximates the fades with `afade` and
 * applies **no** transition gain at all. Moving clips onto this function is the obvious next
 * step and is deliberately not done in the same change as composition audio.
 */

import type { Frames, Item, Project, Timeline, TransitionKind } from './project'
import { fadeGainAt, itemEnd, resolveTransition, transitionAtFrame } from './project'

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * What the two clips' audio should be doing at `progress`.
 *
 * A transition that shows both pictures and plays one is the most audible defect this feature
 * can have, and the mapping is a judgement rather than a derivation, so it is stated here:
 *
 * - **Dissolve, wipe, push, slide, iris — cross-fade.** The picture may wipe or slide, but a
 *   hard audio cut in the middle of a two-second wipe sounds like a mistake. Every NLE
 *   cross-fades sound under a visual transition of any kind.
 * - **Dip to black or white — dip through silence.** The visual passes through a solid colour
 *   at the midpoint and the sound passes through nothing, which is what a dip *means*. Both
 *   gains reach 0 at exactly 0.5, so the halves meet where the picture's halves meet.
 *
 * Linear rather than equal-power. Equal-power (`sqrt`) holds perceived loudness better across
 * a long cross-fade, and for transitions of a second or two linear is what editors expect and
 * what matches the picture's own linear alpha — a sound that stays loud while the image is
 * half gone reads as out of sync with it.
 *
 * Moved here from `engine/transitions.ts`, which re-exports it, so export can reach it.
 */
export function transitionAudioGains(
  kind: TransitionKind,
  progress: number
): { from: number; to: number } {
  const p = clamp01(progress)
  if (kind === 'dip-to-black' || kind === 'dip-to-white') {
    // Silence at the midpoint, matching the picture being fully at the dip colour.
    return { from: Math.max(0, 1 - p * 2), to: Math.max(0, p * 2 - 1) }
  }
  return { from: 1 - p, to: p }
}

/**
 * The frames over which `item` can make sound: its own span, widened by any transition that
 * straddles either of its ends.
 *
 * A transition's window is centred on the cut, so the incoming clip must sound before its own
 * `from` and the outgoing one past its own end — both reading handle material. A schedule
 * clipped to the item's own span would hard-cut the outgoing sound at the cut while its
 * picture is still half visible.
 */
export function audibleSpan(
  project: Project,
  timeline: Timeline,
  item: Item
): { firstFrame: Frames; endFrame: Frames } {
  let firstFrame = item.from
  let endFrame = itemEnd(item)
  for (const transition of timeline.transitions ?? []) {
    if (transition.fromItemId !== item.id && transition.toItemId !== item.id) continue
    const resolved = resolveTransition(project, timeline, transition)
    if (!resolved) continue
    if (resolved.to.id === item.id) firstFrame = Math.min(firstFrame, resolved.firstFrame)
    if (resolved.from.id === item.id) endFrame = Math.max(endFrame, resolved.lastFrame + 1)
  }
  return { firstFrame, endFrame }
}

/**
 * `item`'s gain at `frame`: its volume, times its fade envelope, times any transition over it.
 *
 * Three independent things multiply, and collapsing any two would make one unreachable while
 * the other is set — with one exception, which is a rule rather than an accident: **where a
 * transition and the item's own fade meet, the transition wins and the fade at that end is
 * ignored.** They express the same intent at the same place, and multiplied, a 12-frame
 * fade-out against a dissolve's ramp dips to near-silence mid-window — a hole neither side
 * asked for. It lives here, in the function both sides call, so it is decided once.
 *
 * Volume is clamped to 0..2 as the inspector allows; a non-finite one is treated as 1, since
 * one NaN would otherwise silence the item with no error anywhere.
 */
export function itemAudioGainAt(
  project: Project,
  timeline: Timeline,
  item: Item,
  frame: Frames
): number {
  const volume = Number.isFinite(item.volume) ? Math.max(0, Math.min(2, item.volume)) : 1
  if (volume === 0) return 0

  const active = transitionAtFrame(project, timeline, frame)
  let transitionGain = 1
  let fadeIn = item.fadeInFrames
  let fadeOut = item.fadeOutFrames
  let inTransition = false
  if (active) {
    const gains = transitionAudioGains(active.resolved.transition.kind, active.progress)
    if (active.resolved.from.id === item.id) {
      transitionGain = gains.from
      fadeOut = 0
      inTransition = true
    } else if (active.resolved.to.id === item.id) {
      transitionGain = gains.to
      fadeIn = 0
      inTransition = true
    }
  }

  // Outside the item's own span only a transition can make it sound, and there the fade at
  // that end has just been set aside.
  if (!inTransition && (frame < item.from || frame >= itemEnd(item))) return 0
  const fade = fadeGainAt({ ...item, fadeInFrames: fadeIn, fadeOutFrames: fadeOut }, frame)
  return volume * fade * transitionGain
}
