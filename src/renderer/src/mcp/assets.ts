/**
 * `edit_asset` — change what an asset is, for every clip that places it.
 *
 * **Deliberately two fields.** The model's rule is that an asset is the *what* and an item the
 * *where and when*, and almost everything on `Asset` is a fact about a file rather than a
 * choice: duration, size, frame rate and whether it carries audio were measured by the probe,
 * and writing any of them would make bay disagree with the file it plays — a 10-second clip
 * told it is 20 seconds long renders ten seconds of nothing. `path` is a choice, but changing
 * it is a relink that has to re-probe the new file, which this tool cannot do. The poster and
 * waveform paths are caches, and a composition's variables are read from its HTML.
 *
 * That leaves the two things a person genuinely decides about an asset: what it is **called**,
 * and — for a text asset, the one kind with no file behind it — the **words** it draws. The
 * string *is* that asset's source, which is why it lives on the asset and not the item, and
 * why changing it here changes every placement at once. The result names those placements, so
 * an agent that meant to change one title learns it changed four.
 */

import { allItems } from '@shared/project'
import { fail, project, resolveAsset, store } from './helpers'

/** Everything about an asset an agent might have hoped to set here, and where it lives instead. */
const NOT_HERE =
  'Only name, and text on a text asset, are asset-level choices. Duration, size, frame rate and ' +
  'audio were measured from the file; timing, position, look and text styling belong to each ' +
  'placed item — use edit_item for those.'

export function editAsset(args: Record<string, unknown>): Record<string, unknown> {
  const asset = resolveAsset(String(args.assetId))
  if (args.name === undefined && args.text === undefined) {
    fail(`Nothing to change: pass name, or text for a text asset. ${NOT_HERE}`)
  }

  const patch: { name?: string; text?: string } = {}
  if (args.name !== undefined) {
    const name = String(args.name).trim()
    if (name === '') fail('name is empty. An asset needs a name to be found in the media pool.')
    patch.name = name
  }
  if (args.text !== undefined) {
    if (asset.kind !== 'text') {
      // Refused rather than stored: text on a video asset would read back exactly as written and
      // draw nothing, which is a control that does not do what it says.
      fail(
        `${asset.name} is a ${asset.kind} asset, and only a text asset draws words. To put words ` +
          `over it, place a text asset on a track above it. ${NOT_HERE}`
      )
    }
    const text = String(args.text)
    if (text.trim() === '') {
      fail('text is empty, which would draw nothing. To hide the words, remove the items instead.')
    }
    patch.text = text
  }

  const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter(
    (key) => patch[key] !== asset[key]
  )
  store().editAsset(asset.id, patch)

  const after = project().assets.find((a) => a.id === asset.id)
  if (!after) fail(`Asset ${asset.id} was edited but cannot be read back.`)
  const usedBy = project()
    .timelines.flatMap((timeline) => allItems(timeline))
    .filter((item) => item.assetId === after.id)
    .map((item) => item.id)

  return {
    assetId: after.id,
    kind: after.kind,
    name: after.name,
    ...(after.kind === 'text' ? { text: after.text ?? '' } : {}),
    changed,
    usedBy,
    note:
      changed.length === 0
        ? 'It already had these values, so nothing changed and no undo step was added.'
        : usedBy.length === 0
          ? 'No item places this asset yet.'
          : `Every item placing this asset shows the change — ${usedBy.length} ` +
            `${usedBy.length === 1 ? 'item' : 'items'}.`
  }
}
