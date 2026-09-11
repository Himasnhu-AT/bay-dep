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
 *
 * The reasoning about *why* a cut cannot take a transition lives in `@/lib/junctions` and is
 * shared with the timeline's junction markers, deliberately. An agent and a user looking at
 * the same cut must be given the same explanation, and two copies of that prose would drift
 * apart on the first edit to either.
 */

import { findItem, resolveTransition, type Transition } from '@shared/project'
import { resolveId } from '@shared/mcp'
import { roomAt, whyInactive } from '@/lib/junctions'
import { fail, project, resolveItem, store, timeline } from './helpers'

/**
 * One transition as a tool result.
 *
 * `maxDurationInFrames` is on **every** answer, including the refusals' sibling cases, and the
 * schema promises it for a specific reason: there is no tool that asks how long a transition
 * could be at a junction, so without it a caller's only way to find the ceiling is to create a
 * transition and read what it got. Returning it turns a guess-and-retry loop into one call.
 */
function describe(transition: Transition): Record<string, unknown> {
  const resolved = resolveTransition(project(), timeline(), transition)
  const from = findItem(timeline(), transition.fromItemId)?.item
  const to = findItem(timeline(), transition.toItemId)?.item
  const capacity =
    from && to ? roomAt(project(), timeline(), from, to).capacityInFrames : 0
  if (!resolved) {
    return {
      transitionId: transition.id,
      kind: transition.kind,
      fromItemId: transition.fromItemId,
      toItemId: transition.toItemId,
      requestedDurationInFrames: transition.durationInFrames,
      maxDurationInFrames: capacity,
      active: false,
      warning: `Stored, but nothing will draw. ${whyInactive(project(), timeline(), transition)}`
    }
  }
  return {
    transitionId: transition.id,
    kind: transition.kind,
    fromItemId: transition.fromItemId,
    toItemId: transition.toItemId,
    requestedDurationInFrames: transition.durationInFrames,
    maxDurationInFrames: capacity,
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
  // The room this junction has, needed before anything else: it is both the default duration
  // and the number reported back, and there is no other way for a caller to ask.
  const room = roomAt(project(), timeline(), from.item, to.item)

  // **Omitting the duration is documented behaviour**, so it cannot be a refusal. About a
  // second reads as a dissolve, or the most the junction can take when that is less — which is
  // the choice an editor makes anyway, and it means the common call is `{ from, to, kind }`.
  let durationInFrames: number
  if (args.durationInFrames === undefined) {
    durationInFrames = Math.min(Math.round(timeline().fps), Math.max(2, room.capacityInFrames))
  } else {
    durationInFrames = Math.round(Number(args.durationInFrames))
    if (!Number.isFinite(durationInFrames) || durationInFrames < 2) {
      fail(
        `durationInFrames must be at least 2 so each side of the cut gets a frame; got ` +
          `${args.durationInFrames}. Omit it entirely and bay picks a sensible length — ` +
          `this junction can take up to ${room.capacityInFrames}.`
      )
    }
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
