/**
 * `edit_item.masks`: the shape masks an agent asks for, checked into what the item will store.
 *
 * The list replaces the clip's shapes whole — a mask has no id to merge by, and "the second one,
 * but softer" is clearer as the list the agent wants than as a patch against one it must first
 * read. The clip's subject mask (a cut-out's, made by `put_behind_subject`) is not the caller's
 * to write here: it is kept, first, whatever the list says, and listing one is refused with the
 * tool that makes it.
 *
 * Every refusal names the mask, the field and the legal range (`checkMasks`), because the caller
 * cannot see the picture and needs the next call to work.
 */

import { checkMasks, type Mask } from '@shared/matte'
import { GRADEABLE_KINDS } from '@shared/grade'
import type { Asset, Item } from '@shared/project'
import { fail } from './helpers'

/** Asset kinds a shape mask reaches: the ones drawn as a picture source, an adjustment layer's copy of the frame included. */
export const MASKABLE_KINDS: readonly string[] = GRADEABLE_KINDS

/** The item's `masks` after `edit_item({ masks })`, or undefined when it then has none. */
export function mergeMasks(item: Item, asset: Asset | undefined, given: unknown): Mask[] | undefined {
  const subject = item.masks?.filter((mask) => mask.kind === 'subject') ?? []
  const clearing = given === null || (Array.isArray(given) && given.length === 0)
  if (clearing) return subject.length > 0 ? subject : undefined
  // Refused rather than stored: a mask on a title or a sound reads back exactly as written and
  // changes nothing, because only picture sources pass through the mask.
  if (!asset || !MASKABLE_KINDS.includes(asset.kind)) {
    fail(
      `Item ${item.id} draws ${asset ? `a ${asset.kind} asset` : 'a missing asset'}, which shape masks do not reach. ` +
        `masks applies to ${MASKABLE_KINDS.join(', ')} clips` +
        (asset?.kind === 'text' ? ' — to show a title through a shape, write it as a .brf (write_brf) or a composition and mask that.' : '.')
    )
  }
  if (Array.isArray(given) && given.some((mask) => (mask as { kind?: unknown } | null)?.kind === 'subject')) {
    fail(
      'masks here takes shape masks only ("rect", "ellipse", "path"). A subject mask — the cut-out of a person — is made by ' +
        'put_behind_subject, and a clip that has one keeps it whatever this list says, so leave it out.'
    )
  }
  const checked = checkMasks(given)
  if (!checked.ok) fail(`${checked.error}.`)
  return [...subject, ...checked.masks]
}
