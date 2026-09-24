/**
 * Add Freeze Frame (⌥F, the clip context menu): grab the frame under the playhead in main, import
 * it, and insert it as one undo step.
 *
 * The time asked of main is `sourceSecondsAt` — the exact seek the compositor makes for this clip
 * at this frame (in-point, slip, speed, the half-millisecond frame edge, the clamp inside the
 * source) — and main writes the frame an element shows there (`main/media/frame-grab.ts`). The
 * timeline edit is `@shared/freeze-frame`, applied by the store's `insertFreezeFrame`.
 */

import type { FreezeFrameRequest } from '@shared/ipc'
import { findAsset, formatTimecode, type Asset, type Item } from '@shared/project'
import { freezeRefusal, freezeTarget } from '@shared/freeze-frame'
import { sourceSecondsAt } from '@/engine/sync'
import { selectTimeline, useEditor } from '@/store/editor'
import { stillDurationFrames } from '@/store/editing-prefs'
import { bay } from './bridge'

/**
 * What main is asked for: the file, and the source second the compositor shows at `frame`. Null
 * for an asset with no file behind it.
 */
export function freezeRequest(item: Item, asset: Asset, frame: number, fps: number): FreezeFrameRequest | null {
  if (!asset.path) return null
  return { path: asset.path, seconds: sourceSecondsAt(item, asset, frame, fps), name: asset.name }
}

let running = false

/** Runs the whole freeze. Every refusal and failure is a toast saying why. */
export async function addFreezeFrame(): Promise<void> {
  if (running) return
  const state = useEditor.getState()
  const timeline = selectTimeline(state)
  if (!timeline) return
  const frame = state.playhead
  const target = freezeTarget(state.project, timeline, state.selection, frame)
  if (!target.ok) {
    state.notify(target.error)
    return
  }
  const refusal = freezeRefusal(timeline, target.item, frame)
  if (refusal) {
    state.notify(refusal, 'error')
    return
  }
  const asset = findAsset(state.project, target.item.assetId)
  const request = asset ? freezeRequest(target.item, asset, frame, timeline.fps) : null
  const api = bay()
  if (!asset || !request || !api) {
    state.notify('Freeze Frame is unavailable: this window has no bridge to the app.', 'error')
    return
  }

  running = true
  try {
    const grabbed = await api.media.freezeFrame(request)
    if (!grabbed.ok) {
      useEditor.getState().notify(grabbed.error, 'error')
      return
    }
    const [imported] = await api.media.importPaths([grabbed.path])
    if (!imported?.asset || imported.asset.error) {
      useEditor.getState().notify(
        `The frame was written to ${grabbed.path} but could not be imported: ${imported?.asset.error ?? 'nothing came back'}.`,
        'error'
      )
      return
    }
    // Named like its clip label unless this project already holds that still under a name. A
    // `reused` import (the same frame grabbed before, in any project) came back named after its
    // file — "freeze-clipa-mp4-e354bd844f38.png" — which is how the verifier saw it.
    const existing = findAsset(useEditor.getState().project, imported.asset.id)
    const still: Asset = existing ?? {
      ...imported.asset,
      name: `Freeze · ${asset.name} · ${formatTimecode(frame, timeline.fps, true)}`
    }
    // Planned again inside the store against the timeline as it is now: the grab took a moment,
    // and the clip may have moved or gone meanwhile.
    const result = useEditor.getState().insertFreezeFrame({
      itemId: target.item.id,
      frame,
      frames: stillDurationFrames(timeline.fps),
      still
    })
    if ('error' in result) useEditor.getState().notify(result.error, 'error')
  } catch (error) {
    useEditor.getState().notify(`Freeze Frame failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
  } finally {
    running = false
  }
}
