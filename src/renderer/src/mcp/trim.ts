/**
 * `trim_item` — slip, slide and roll.
 *
 * **One tool with a `mode`, not three**, because the three share everything an agent has to
 * get right: the id, the signed frame delta and its sign convention, the refusal shape (a
 * legal range, never a clamp) and the transition report. Three tools would state that
 * contract three times, and three descriptions drift. What differs between them is *which
 * thing stays still*, and that contrast reads best side by side in one description, at the
 * moment the model is choosing — rather than spread across three catalog entries it may not
 * read together.
 *
 * The arithmetic is `@shared/trim`, shared with the timeline's modifier-drags so an agent and
 * a user get the same answer at the same cut. This file only turns ids into items, passes
 * refusals through unchanged (they already name the range and which side ran out), and reports
 * what actually happened in the units the rest of the surface uses.
 */

import { findItem, itemEnd } from '@shared/project'
import { transitionsAfterTrim, type TrimMode } from '@shared/trim'
import { fail, project, resolveItem, store, timeline } from './helpers'

export function trimItem(args: Record<string, unknown>): Record<string, unknown> {
  const { item, track } = resolveItem(String(args.itemId))
  const mode = args.mode as TrimMode
  // A locked track is refused by the planner, not `assertUnlocked`: that helper's way out is
  // "pass a different trackId", and this tool has none to pass.
  const edge = args.edge === undefined ? undefined : (args.edge as 'start' | 'end')

  const endBefore = Math.max(0, ...track.items.map(itemEnd))
  // No `transact` around this, unlike most tools here: `trimEdit` is a single `edit()`, so it
  // is already exactly one undo step, and a wrapper nothing could observe is not worth keeping.
  const result = store().trimEdit({
    itemId: item.id,
    mode,
    deltaFrames: Number(args.deltaFrames),
    ...(edge ? { edge } : {})
  })
  if (!result.ok) fail(result.error)

  const tl = timeline()
  const items = result.changes.map((change) => {
    const found = findItem(tl, change.itemId)
    if (!found) fail(`Item ${change.itemId} was trimmed but cannot be read back.`)
    return {
      itemId: found.item.id,
      from: found.item.from,
      durationInFrames: found.item.durationInFrames,
      endFrame: itemEnd(found.item),
      // Seconds, the unit edit_item accepts and inspect_item reports.
      sourceStartSeconds: found.item.sourceStartUs / 1_000_000
    }
  })
  const transitions = transitionsAfterTrim(project(), tl, result)
  const shortened = transitions.filter((t) => t.clampedBecause !== null)
  const trackAfter = tl.tracks.find((t) => t.id === track.id)
  const endAfter = trackAfter ? Math.max(0, ...trackAfter.items.map(itemEnd)) : endBefore

  return {
    mode,
    deltaFrames: result.deltaFrames,
    // The range that was legal *before* this edit — what the caller could have asked for.
    legalRange: result.range,
    items,
    ...(transitions.length > 0 ? { transitions } : {}),
    ...(endAfter !== endBefore
      ? {
          note:
            `Nothing followed ${item.id} to absorb the slide, so ${track.name} now ends at frame ` +
            `${endAfter} instead of ${endBefore}.`
        }
      : {}),
    ...(shortened.length > 0
      ? {
          warnings: shortened.map((t) =>
            t.effectiveDurationInFrames === null
              ? `Transition ${t.transitionId} is still on its cut but will not draw: ${t.clampedBecause}.`
              : `Transition ${t.transitionId} is now ${t.effectiveDurationInFrames} frames, not ` +
                `${t.requestedDurationInFrames}: ${t.clampedBecause}.`
          )
        }
      : {})
  }
}
