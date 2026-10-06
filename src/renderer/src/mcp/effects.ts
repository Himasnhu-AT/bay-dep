/**
 * `edit_effects`: a batch of operations on one clip's effect stack.
 *
 * The checking and the operations are `applyEffectOps` in `@shared/effects/edit` — the same
 * function the store's actions run one operation of — so this is the resolving of the clip, the
 * refusals that are about the clip rather than the stack (a locked track, a clip with no picture),
 * one store edit, and a result an agent can act on: the whole stack with its ids, and for each
 * effect whether the compositor will run it.
 */

import { findAsset, type Item } from '@shared/project'
import { EFFECT_ITEM_KINDS, effectSpec, takesEffects } from '@shared/effects/index'
import { applyEffectOps, EffectEditError } from '@shared/effects/edit'
import { effectDraws } from '@shared/effects/resolve'
import type { Effect } from '@shared/effects/spec'
import { newId } from '@/store/factory'
import { assertUnlocked, fail, project, resolveItem, store, type Handlers } from './helpers'

/** One effect as a tool result reports it: what is stored, and whether it will draw. */
function describeEffect(effect: Effect, index: number): Record<string, unknown> {
  const spec = effectSpec(effect.kind)
  const draws = effectDraws(effect)
  return {
    index,
    id: effect.id,
    kind: effect.kind,
    enabled: effect.enabled !== false,
    params: effect.params,
    draws,
    ...(draws
      ? {}
      : {
          why: !spec
            ? 'this build of bay has no such effect, so it is skipped'
            : effect.enabled === false
              ? 'it is switched off'
              : 'at these values it changes nothing, so it runs no pass'
        })
  }
}

/** A clip's stack for a result: `inspect_item` reports this too, so the two cannot describe it differently. */
export function describeEffects(item: Item): Record<string, unknown>[] {
  return (item.effects ?? []).map(describeEffect)
}

export function editEffects(args: Record<string, unknown>): Record<string, unknown> {
  const { item, track } = resolveItem(String(args.itemId))
  const asset = findAsset(project(), item.assetId)
  if (!takesEffects(asset?.kind)) {
    fail(
      `${asset?.name ?? item.id} is ${asset?.kind ?? 'a clip with no asset'}, which has no picture for an effect to draw on. ` +
        `Effects apply to ${EFFECT_ITEM_KINDS.join(', ')} clips` +
        (asset?.kind === 'text' ? '; a title\'s look is edit_item text (colour, outline, shadow).' : '.')
    )
  }
  assertUnlocked(track, `changing the effects of ${item.id}`)

  let result
  try {
    result = applyEffectOps(item.effects, args.operations, () => newId('fx'))
  } catch (error) {
    if (error instanceof EffectEditError) fail(error.message)
    throw error
  }
  store().setEffects(item.id, result.effects)

  const after = resolveItem(item.id).item
  const effects = describeEffects(after)
  const idle = effects.filter((effect) => effect.draws === false)
  return {
    itemId: item.id,
    effects,
    ...(result.added.length > 0 ? { added: result.added } : {}),
    note:
      effects.length === 0
        ? 'This clip now has no effects.'
        : `${effects.length} effect${effects.length === 1 ? '' : 's'}, drawn in this order after the clip's grade.` +
          (idle.length > 0
            ? ` ${idle.length === 1 ? 'One does' : `${idle.length} do`} not draw (${idle.map((e) => `${String(e.id)}: ${String(e.why)}`).join('; ')}).`
            : '') +
          ' Look with preview_frame; it reports under gradeWarnings if an effect could not run.'
  }
}

export const handlers: Handlers = {
  edit_effects: (args) => editEffects(args)
}
