/**
 * `add_template` — and the Templates panel, which calls this same function.
 *
 * One path for both on purpose. A panel with its own copy of "write, import, place, set the
 * values" would be a second implementation of a four-step sequence whose steps each fail in a
 * different way, and the two would drift the first time one of them learned something.
 *
 * The size is the active timeline's, read at the moment of the call. That is the whole fix for
 * templates landing as a portrait strip on a landscape canvas: nothing downstream chooses a
 * size, so nothing downstream can choose the wrong one.
 */

import { coerce, type CompositionVariableValue } from '@shared/composition'
import { itemEnd } from '@shared/project'
import { findTemplate, TEMPLATES } from '@shared/templates'
import { bay } from '@/lib/bay'
import { fail, resolveItem, store, timeline, type Handlers } from './helpers'

export async function addTemplate(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const spec = findTemplate(String(args.templateId))
  if (!spec) {
    fail(
      `There is no template "${String(args.templateId)}". bay ships: ` +
        `${TEMPLATES.map((t) => t.id).join(', ')}.`
    )
  }

  // Values are checked before anything touches the disk or the project, so a bad value refuses
  // the whole call rather than leaving a placed clip with half its values set.
  const values: Record<string, CompositionVariableValue> = {}
  const given = args.variables ?? {}
  if (typeof given !== 'object' || given === null || Array.isArray(given)) {
    fail('`variables` must be an object of { id: value }.')
  }
  for (const [id, value] of Object.entries(given as Record<string, unknown>)) {
    const declared = spec.variables.find((v) => v.id === id)
    if (!declared) {
      fail(
        `${spec.name} declares no variable "${id}". It declares: ` +
          `${spec.variables.map((v) => `${v.id} (${v.type})`).join(', ')}.`
      )
    }
    const coerced = coerce(value, declared.type)
    if (coerced === null) {
      fail(`"${id}" is a ${declared.type}, and ${JSON.stringify(value)} is not one.`)
    }
    values[id] = coerced
  }

  const tl = timeline()
  const atFrame = args.atFrame === undefined ? store().playhead : Number(args.atFrame)

  const api = bay()
  if (!api) fail('This window has no bridge to the app, so a template cannot be written.')

  const written = await api.composition.writeTemplate(spec.id, tl.width, tl.height)
  if (!written.ok) fail(written.error)

  const imported = await api.media.importPaths([written.path])
  const asset = imported[0]?.asset
  if (!asset) fail(`${written.path} was written but could not be imported. This is a fault in bay.`)
  if (asset.error) fail(`${spec.name} could not be read after writing it: ${asset.error}`)

  // One undo step: the asset, the clip and every value. Undoing a template placement that left
  // an orphan asset, or a clip with its values stripped, would be two actions pretending to be
  // one.
  let placed: string | null = null
  // Named for what it is ("Lower third"), not for the file main wrote. Only a new asset: main
  // dedupes by path, so a second placement of the same template returns the same asset, which
  // the user may have renamed since.
  const fresh = !store().project.assets.some((a) => a.id === asset.id)
  store().transact(() => {
    store().addAssets([fresh ? { ...asset, name: spec.name } : asset])
    placed = store().placeAsset(asset.id, atFrame)
    if (!placed) return
    for (const [id, value] of Object.entries(values)) {
      store().setCompositionVariable(placed, id, value)
    }
  })
  if (!placed) fail(`${spec.name} could not be placed at frame ${atFrame}.`)

  const { item, track } = resolveItem(placed)
  return {
    itemId: item.id,
    assetId: asset.id,
    template: spec.id,
    trackId: track.id,
    trackName: track.name,
    from: item.from,
    durationInFrames: item.durationInFrames,
    endFrame: itemEnd(item),
    // Reported so the size is checkable rather than assumed: it is the canvas's.
    width: asset.width,
    height: asset.height,
    path: written.path,
    variables: item.variables ?? {},
    next:
      `Change what it says with edit_item { itemId: "${item.id}", variables: { ... } }. ` +
      `Check it with preview_frame at a frame inside it.`
  }
}

export const handlers: Handlers = {
  add_template: (args) => addTemplate(args),
}
