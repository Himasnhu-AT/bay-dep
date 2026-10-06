/**
 * `audio_effects` — a clip's or a track's effect chain.
 *
 * The chain logic is `applyEffectOp` in `@shared/audio-effects`, which the inspector calls too;
 * this file resolves the target, refuses what cannot carry effects with the reason and the
 * alternative, and reads the chain back with each effect's id.
 */

import { findAsset } from '@shared/project'
import {
  applyEffectOp,
  describeEffect,
  effectSpec,
  isBakedKind,
  isIdentity,
  paramOf,
  type AudioEffect,
  type EffectOp
} from '@shared/audio-effects'
import { newId } from '@/store/editor'
import { assertUnlocked, fail, project, resolveItem, resolveTrack, store, type Handlers } from './helpers'

/** A chain as an agent (and `inspect_item`/`read_project`) reads it. */
export function describeChain(effects: readonly AudioEffect[] | undefined): Record<string, unknown>[] {
  return (effects ?? []).map((effect) => {
    const params: Record<string, number> = {}
    for (const p of effectSpec(effect.kind)?.params ?? []) params[p.key] = paramOf(effect, p.key)
    return {
      effectId: effect.id,
      kind: effect.kind,
      enabled: effect.enabled !== false,
      params,
      summary: describeEffect(effect),
      ...(effect.enabled !== false && isIdentity(effect) ? { note: 'As set, this changes nothing.' } : {})
    }
  })
}

function operation(args: Record<string, unknown>): EffectOp {
  const action = String(args.action)
  const needId = (): string => {
    if (typeof args.effectId !== 'string' || !args.effectId) {
      fail(`action "${action}" needs effectId — the id a previous audio_effects call, inspect_item or read_project returned.`)
    }
    return args.effectId as string
  }
  switch (action) {
    case 'add':
      if (args.kind === undefined) fail('action "add" needs kind.')
      return { op: 'add', kind: args.kind, params: args.params, enabled: args.enabled, index: args.index as number | undefined }
    case 'edit':
      return { op: 'edit', effectId: needId(), params: args.params, enabled: args.enabled as boolean | undefined }
    case 'remove':
      return { op: 'remove', effectId: needId() }
    case 'move':
      if (typeof args.index !== 'number') fail('action "move" needs index: the position to move the effect to, 0 first.')
      return { op: 'move', effectId: needId(), toIndex: args.index as number }
    case 'preset':
      if (typeof args.preset !== 'string') fail('action "preset" needs preset.')
      return { op: 'preset', preset: args.preset as string, mode: args.mode as 'replace' | 'append' | undefined }
    case 'clear':
      return { op: 'clear' }
    default:
      return fail(`Unknown action "${action}". Use add, edit, remove, move, preset or clear.`)
  }
}

export function audioEffectsTool(args: Record<string, unknown>): Record<string, unknown> {
  const hasItem = typeof args.itemId === 'string' && args.itemId !== ''
  const hasTrack = typeof args.trackId === 'string' && args.trackId !== ''
  if (hasItem === hasTrack) {
    fail('Give exactly one of itemId (a clip\'s own chain) or trackId (a chain on everything the track plays).')
  }

  let target: { itemId: string } | { trackId: string }
  let current: readonly AudioEffect[] | undefined
  let label: Record<string, unknown>
  if (hasItem) {
    const { item, track } = resolveItem(String(args.itemId))
    assertUnlocked(track, 'change the effects of a clip on')
    const asset = findAsset(project(), item.assetId)
    if (item.audioDetached) {
      fail(`${item.id} plays no sound of its own — it was detached. Put the effects on its audio item instead (inspect_item names it).`)
    }
    if (!asset || !asset.hasAudio || asset.kind === 'html') {
      fail(
        asset?.kind === 'html'
          ? `${item.id} is a composition: its declared sounds take a track's equaliser but no clip effects. Put an equaliser on its track (trackId "${track.id}").`
          : `${item.id} has no sound, so there is nothing for an audio effect to act on.`
      )
    }
    target = { itemId: item.id }
    current = item.audioEffects
    label = { itemId: item.id }
  } else {
    const track = resolveTrack(String(args.trackId))
    target = { trackId: track.id }
    current = track.audioEffects
    label = { trackId: track.id, trackName: track.name }
  }

  const next = applyEffectOp(current, operation(args), () => newId('afx'))
  if (!next.ok) fail(next.error)
  store().transact(() => store().setAudioEffects(target, next.value))

  const baked = next.value.filter((e) => e.enabled !== false && !isIdentity(e) && isBakedKind(e.kind)).map((e) => e.kind)
  return {
    ...label,
    effects: describeChain(next.value),
    ...(baked.length > 0
      ? {
          rendering:
            `${[...new Set(baked)].join(', ')} ${baked.length === 1 ? 'is' : 'are'} rendered into a processed copy of ` +
            (hasItem ? 'the clip\'s sound' : 'each clip\'s sound on this track') +
            '. The preview plays it once it is ready (a moment for a long file); an export always waits for it.'
        }
      : {})
  }
}

export const handlers: Handlers = {
  audio_effects: (args) => audioEffectsTool(args)
}
