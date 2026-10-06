/**
 * A clip's video effect stack: add, change, reorder, switch off and remove.
 *
 * Every action is one operation of `applyEffectOps` (`@shared/effects/edit`) — the function
 * `edit_effects` runs a batch of — so the inspector, the library and the agent change a stack
 * through one set of checks, and a value the compositor could not draw as given is refused
 * rather than stored. A refusal changes nothing (so pushes no undo step) and is shown as a toast.
 *
 * An emptied stack is removed from the item, not left as `[]`: absent is how "no effects" is
 * stored, and a clip that had an effect added and removed saves as it did before.
 */

import { findItem, type Item } from '@shared/project'
import { applyEffectOps, EffectEditError } from '@shared/effects/edit'
import type { Effect } from '@shared/effects/spec'
import { newId } from '../factory'
import type { EditorActions } from '../types'
import type { StoreKit } from '../kit'

type Actions = Pick<
  EditorActions,
  'addEffect' | 'patchEffect' | 'moveEffect' | 'removeEffect' | 'toggleEffect' | 'setEffects'
>

function store(item: Item, effects: Effect[]): void {
  if (effects.length > 0) item.effects = effects
  else delete item.effects
}

export function effectsSlice({ get, editTimeline, currentTimeline }: StoreKit): Actions {
  /** Runs one operation on an item's stack. Returns what `add` made, or null when nothing changed. */
  const apply = (itemId: string, operation: Record<string, unknown>): string[] | null => {
    // Written from inside the mutator; a holder, because a `let` assigned in a callback narrows to its initial value.
    const out: { added: string[] | null; refusal: string | null } = { added: null, refusal: null }
    editTimeline((timeline) => {
      const found = findItem(timeline, itemId)
      if (!found || found.track.locked) return
      try {
        const result = applyEffectOps(found.item.effects, [operation], () => newId('fx'))
        store(found.item, result.effects)
        out.added = result.added
      } catch (error) {
        if (!(error instanceof EffectEditError)) throw error
        out.refusal = error.message
      }
    })
    if (out.refusal) get().notify(out.refusal, 'error')
    return out.added
  }

  return {
    addEffect(itemId, kind, options) {
      const added = apply(itemId, { op: 'add', kind, params: options?.params, index: options?.index })
      return added?.[0] ?? null
    },

    patchEffect(itemId, effectId, patch) {
      apply(itemId, { op: 'update', effectId, params: patch.params, enabled: patch.enabled })
    },

    moveEffect(itemId, effectId, toIndex) {
      apply(itemId, { op: 'move', effectId, toIndex })
    },

    removeEffect(itemId, effectId) {
      apply(itemId, { op: 'remove', effectId })
    },

    toggleEffect(itemId, effectId) {
      const timeline = currentTimeline()
      const effect = timeline && findItem(timeline, itemId)?.item.effects?.find((candidate) => candidate.id === effectId)
      if (!effect) return
      apply(itemId, { op: 'update', effectId, enabled: effect.enabled === false })
    },

    setEffects(itemId, effects) {
      editTimeline((timeline) => {
        const found = findItem(timeline, itemId)
        if (!found || found.track.locked) return
        store(found.item, effects.map((effect) => ({ ...effect, params: { ...effect.params } })))
      })
    }
  }
}
