/**
 * `add_transition` and `remove_transition`.
 *
 * Both are thin over the store's own `addTransition` / `removeTransition`, which already
 * refuse a non-adjacent pair with a reason rather than storing a transition that
 * `resolveTransition` would silently drop later. This file's job is to pass those reasons
 * through unchanged and to say what the caller actually got.
 *
 * The part worth care is **`clampedBecause`**. A transition is centred on a cut and needs
 * footage either side of it; a clip with none to spare gets a shorter transition than was
 * asked for. Returning the requested duration as though it were honoured would be the same
 * lie as a playhead that clamps without saying so, or type that auto-shrinks in silence —
 * so the result reports the effective window and why it is short.
 */

import {
  findAsset,
  findItem,
  handlesFor,
  itemEnd,
  resolveTransition,
  type Transition
} from '@shared/project'
import { resolveId } from '@shared/mcp'
import { fail, project, resolveItem, store, timeline } from './helpers'

/**
 * Why a stored transition will not draw.
 *
 * `resolveTransition` returns null for three different reasons and the caller cannot tell
 * them apart from the null alone. An earlier version of this file reported all three as "the
 * clips are no longer adjacent", which was wrong in the most common case: two clips that abut
 * perfectly but each use their whole source have nowhere to dissolve *from*, and being told
 * they are not adjacent sends an agent to move clips that are already touching.
 */
function whyInactive(transition: Transition): string {
  const tl = timeline()
  const from = findItem(tl, transition.fromItemId)?.item
  const to = findItem(tl, transition.toItemId)?.item
  if (!from || !to) {
    return 'One of the two clips no longer exists. Remove the transition, or re-add it between clips that do.'
  }
  if (itemEnd(from) !== to.from) {
    return (
      `The clips are no longer adjacent — ${transition.fromItemId} ends at ${itemEnd(from)} and ` +
      `${transition.toItemId} starts at ${to.from}. Close the gap and it will draw again.`
    )
  }
  const fromRoom = Math.min(handlesFor(findAsset(project(), from.assetId), from, tl.fps).after, from.durationInFrames)
  const toRoom = Math.min(handlesFor(findAsset(project(), to.assetId), to, tl.fps).before, to.durationInFrames)
  return (
    `The clips abut, but neither has footage to spare across the cut: the outgoing clip has ` +
    `${fromRoom} frames past its end and the incoming has ${toRoom} before its start, so there ` +
    `is nothing to dissolve between. Trim one of them shorter than its source — a transition ` +
    `borrows the frames on either side of the cut.`
  )
}

function describe(transition: Transition): Record<string, unknown> {
  const resolved = resolveTransition(project(), timeline(), transition)
  if (!resolved) {
    return {
      transitionId: transition.id,
      kind: transition.kind,
      fromItemId: transition.fromItemId,
      toItemId: transition.toItemId,
      requestedDurationInFrames: transition.durationInFrames,
      active: false,
      warning: `Stored, but nothing will draw. ${whyInactive(transition)}`
    }
  }
  return {
    transitionId: transition.id,
    kind: transition.kind,
    fromItemId: transition.fromItemId,
    toItemId: transition.toItemId,
    requestedDurationInFrames: transition.durationInFrames,
    effectiveDurationInFrames: resolved.lastFrame - resolved.firstFrame + 1,
    firstFrame: resolved.firstFrame,
    lastFrame: resolved.lastFrame,
    active: true,
    ...(transition.direction ? { direction: transition.direction } : {}),
    // Surfaced rather than swallowed: an agent that asked for 30 frames and got 8 has to be
    // told, or it reports a dissolve the viewer will not see.
    ...(resolved.clampedBecause
      ? {
          clampedBecause: resolved.clampedBecause,
          note: `Shorter than requested: ${resolved.clampedBecause}.`
        }
      : {})
  }
}

export function addTransition(args: Record<string, unknown>): Record<string, unknown> {
  const from = resolveItem(String(args.fromItemId))
  const to = resolveItem(String(args.toItemId))
  const durationInFrames = Math.round(Number(args.durationInFrames))
  if (!Number.isFinite(durationInFrames) || durationInFrames < 2) {
    fail(
      `durationInFrames must be at least 2 so each side of the cut gets a frame; got ` +
        `${args.durationInFrames}.`
    )
  }

  let added: string | null = null
  let refusal: string | null = null
  store().transact(() => {
    const outcome = store().addTransition({
      fromItemId: from.item.id,
      toItemId: to.item.id,
      kind: args.kind as Transition['kind'],
      durationInFrames,
      direction: args.direction as Transition['direction'] | undefined
    })
    if ('error' in outcome) refusal = outcome.error
    else added = outcome.id
  })
  // The store's refusals already name the junction and what to do about it, so they are
  // passed through rather than reworded into something vaguer. `fail` is outside the
  // transaction: throwing inside would commit whatever it had already changed as one entry.
  if (refusal !== null) fail(refusal)
  if (added === null) fail('The transition was not added, and the store gave no reason.')

  const stored = (timeline().transitions ?? []).find((t) => t.id === added)
  if (!stored) fail(`Transition ${added} was added but cannot be read back.`)
  return describe(stored)
}

export function removeTransition(args: Record<string, unknown>): Record<string, unknown> {
  const existing = timeline().transitions ?? []
  if (existing.length === 0) {
    fail('This timeline has no transitions, so there is none to remove.')
  }
  const resolved = resolveId(String(args.transitionId), existing.map((t) => t.id))
  if (!resolved.ok) {
    fail(
      `${resolved.error} Transitions on this timeline: ` +
        existing.map((t) => `${t.id} (${t.kind}, ${t.fromItemId} → ${t.toItemId})`).join(', ') + '.'
    )
  }
  const target = existing.find((t) => t.id === resolved.id)
  if (!target) fail(`No transition ${resolved.id}.`)

  store().transact(() => store().removeTransition(target.id))
  return {
    removed: target.id,
    kind: target.kind,
    note: 'The cut is a straight one again. Neither clip moved.'
  }
}
