import type { ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components'
import { selectTimeline, useEditor } from '@/store/editor'

/**
 * "Add adjustment layer", wherever it is offered: the store's one action, then a line saying
 * where the layer went and where its look is set — a new layer changes nothing until it has a
 * grade or an adjustment, and an empty clip appearing above the edit with no word would read as
 * nothing having happened. `from` is for a caller that knows the frame (the timeline's lane
 * menu); without it the layer covers the selected clips, or starts at the playhead.
 */
export function addAdjustmentLayerHere(from?: number): void {
  const state = useEditor.getState()
  const result = state.addAdjustmentLayer(from === undefined ? undefined : { from })
  if (!result.ok) {
    state.notify(result.error, 'error')
    return
  }
  const timeline = selectTimeline(useEditor.getState())
  const track = timeline?.tracks.find((candidate) => candidate.id === result.trackId)
  const under = result.clipsBelow === 0 ? 'Nothing is under it yet' : `It changes the ${result.clipsBelow === 1 ? 'clip' : `${result.clipsBelow} clips`} under it`
  state.notify(`Adjustment layer added on ${track?.name ?? 'a new track'}. ${under} — set its look in the inspector: Color for a grade, Effects for adjustments, Video › Masks to limit it.`, 'info')
}

/** The Effects Library's row for it. */
export function AdjustmentLayerButton(): ReactNode {
  return (
    <div className="border-b border-line px-3 py-2.5">
      <Button
        variant="subtle"
        className="w-full"
        icon={<SlidersHorizontal aria-hidden="true" className="size-3.5" />}
        onClick={() => addAdjustmentLayerHere()}
      >
        Add adjustment layer
      </Button>
      <p className="mt-1.5 text-[11px] leading-snug text-ink-2">
        A clip with no picture: its grade, adjustments and masks change everything on the tracks below it. Covers the selected clips, or
        starts at the playhead.
      </p>
    </div>
  )
}
