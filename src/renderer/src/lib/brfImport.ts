import { brfCodeAssetFields } from '@shared/brf'
import type { ImportedAsset } from '@shared/ipc'
import { brfRuntime } from '@/engine/brfCode'
import { selectTimeline, useEditor } from '@/store/editor'

/**
 * Finishes `.brf` files main has imported. Main reads a `.brf` as text and never runs it — its
 * code runs only in the renderer's locked-down workers — so the asset arrives without the
 * duration, size and vars that running it reveals. This fills them in, or marks the asset with
 * why it cannot be drawn, before it reaches the store. Every import path goes through here.
 */
export async function completeBrfImports(imported: ImportedAsset[]): Promise<ImportedAsset[]> {
  const timeline = selectTimeline(useEditor.getState())
  const fps = timeline?.fps ?? 30
  const width = timeline?.width ?? 1920
  const height = timeline?.height ?? 1080
  return Promise.all(
    imported.map(async (entry) => {
      const asset = entry.asset
      if (asset.kind !== 'brf' || asset.brfCode === undefined || asset.error || entry.reused) return entry
      const checked = await brfRuntime.verify(asset.brfCode, fps, width, height)
      if (!checked.ok) return { ...entry, asset: { ...asset, error: checked.error } }
      return { ...entry, asset: { ...asset, ...brfCodeAssetFields(asset.brfCode, checked.meta) } }
    })
  )
}
