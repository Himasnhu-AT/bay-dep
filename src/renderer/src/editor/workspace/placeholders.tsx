/**
 * Stand-ins for page panels that other packages are building (WP5's ColorPanel, AudioPanel,
 * Mixer). Each is built only from what exists today, so the pages work now; `pageContent.tsx`
 * swaps them out by changing one line. Delete a stand-in once nothing names it.
 */

import type { ReactNode } from 'react'
import { AudioLines, Palette } from 'lucide-react'
import { isGradeableKind } from '@shared/grade'
import { isVisualItem } from '@shared/inspector'
import { findAsset } from '@shared/project'
import { EmptyState, Panel, ScrollArea } from '@/components'
import { useSelectedItems } from '@/lib/useSelectedItems'
import { selectTimeline, useEditor } from '@/store/editor'
import { AdjustmentsSection } from '@/editor/AdjustmentsSection'
import { GradeSection } from '@/editor/GradeSection'
import { Inspector } from '@/editor/Inspector'
import { AudioMeter } from '@/editor/viewer/AudioMeter'
import { RegionHeader } from './RegionHeader'

/** Color page, right: the selection's grade and adjustments, the same sections the Inspector has. */
export function ColorStandIn(): ReactNode {
  const selected = useSelectedItems()
  const project = useEditor((state) => state.project)
  const timeline = useEditor(selectTimeline)
  if (!timeline) return null
  const kindOf = (id: string): ReturnType<typeof findAsset> => findAsset(project, id)
  const trackKind = (trackId: string) => timeline.tracks.find((track) => track.id === trackId)?.kind
  const visual = selected.filter((item) => isVisualItem(kindOf(item.assetId)?.kind, trackKind(item.trackId)))
  const gradeable = visual.filter((item) => isGradeableKind(kindOf(item.assetId)?.kind))
  const luts = project.assets.filter((asset) => asset.kind === 'lut' && !asset.error)

  return (
    <Panel title="Color" className="h-full" bodyClassName="flex flex-col">
      {visual.length === 0 ? (
        <EmptyState
          icon={<Palette className="size-5" />}
          title="Select a clip to grade it"
          hint="Click a clip on the timeline below. Its grade and adjustments show here."
        />
      ) : (
        <ScrollArea className="flex-1">
          {gradeable.length > 0 && <GradeSection items={gradeable} luts={luts} />}
          <AdjustmentsSection items={visual} timeline={timeline} />
        </ScrollArea>
      )}
    </Panel>
  )
}

/** Audio page, right: a labelled master meter over the Inspector (whose Audio section is the level). */
export function AudioStandIn(): ReactNode {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-1">
      <RegionHeader title="Master" actions={<AudioLines aria-hidden="true" className="size-3.5 text-ink-2" />} />
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="shrink-0 text-[10px] text-ink-2 select-none">L / R</span>
        <AudioMeter className="w-40" />
      </div>
      <div className="min-h-0 flex-1">
        <Inspector />
      </div>
    </div>
  )
}
