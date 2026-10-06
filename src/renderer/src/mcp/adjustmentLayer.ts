/**
 * `add_adjustment_layer`: the agent's door to the store's `addAdjustmentLayer` — the same action
 * the Effects Library and the timeline's lane menu run, so the layer an agent adds is the layer a
 * person adds.
 *
 * The span is the caller's when given. Unlike the UI, a call with no span never reads the
 * selection: an agent's layer starts at the playhead for five seconds unless it says otherwise,
 * because what happens to be selected in the window is not something the agent chose.
 */

import { ADJUSTMENT_LAYER_NAME } from '@shared/adjustment-layer'
import { itemEnd } from '@shared/project'
import { fail, resolveItem, store, timeline, type Handlers } from './helpers'

/** The default length of an agent's layer, in seconds. */
const DEFAULT_SECONDS = 5

export function addAdjustmentLayer(args: Record<string, unknown>): Record<string, unknown> {
  const fps = timeline().fps
  const from = args.from === undefined ? store().playhead : Number(args.from)
  const durationInFrames = args.durationInFrames === undefined ? Math.max(1, Math.round(DEFAULT_SECONDS * fps)) : Number(args.durationInFrames)
  let result: ReturnType<ReturnType<typeof store>['addAdjustmentLayer']> = { ok: false, error: 'The layer was not created.' }
  store().transact(() => {
    result = store().addAdjustmentLayer({ from, durationInFrames, ...(args.trackId !== undefined ? { trackId: String(args.trackId) } : {}) })
  })
  const made = result as ReturnType<ReturnType<typeof store>['addAdjustmentLayer']>
  if (!made.ok) fail(made.error)
  const { item, track } = resolveItem(made.itemId)
  return {
    itemId: item.id,
    assetId: made.assetId,
    name: ADJUSTMENT_LAYER_NAME,
    trackId: track.id,
    trackName: track.name,
    ...(made.createdTrackId ? { createdTrackId: made.createdTrackId } : {}),
    from: item.from,
    durationInFrames: item.durationInFrames,
    endFrame: itemEnd(item),
    clipsBelow: made.clipsBelow,
    next:
      `The layer changes nothing yet. Give it a look with edit_item({ itemId: "${item.id}", grade: { … } }) and/or { adjustments: { … } }; ` +
      'add masks to limit it to part of the frame, and opacity for how strongly it is mixed in. Check it with preview_frame.',
    ...(made.warnings.length > 0 ? { warnings: made.warnings } : {})
  }
}

export const handlers: Handlers = {
  add_adjustment_layer: (args) => addAdjustmentLayer(args)
}
