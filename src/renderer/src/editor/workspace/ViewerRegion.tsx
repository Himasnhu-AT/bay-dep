import type { ReactNode } from 'react'
import { ErrorBoundary, Select } from '@/components'
import { formatTimecode } from '@shared/timecode'
import { useViewer, VIEWER_ZOOMS, type ViewerZoom } from '@/lib/viewer'
import { selectFps, selectTimeline, useEditor } from '@/store/editor'
import { Preview } from '@/editor/Preview'
import { Transport } from '@/editor/Transport'
import { RegionHeader } from './RegionHeader'

/** The playhead as the header's readout. Its own component, so only it re-renders per frame. */
function PlayheadTimecode(): ReactNode {
  const playhead = useEditor((state) => state.playhead)
  const fps = useEditor(selectFps)
  return (
    <span
      aria-hidden="true"
      className="font-mono text-[12px] font-medium text-accent tabular-nums select-none"
    >
      {formatTimecode(playhead, fps)}
    </span>
  )
}

/**
 * Resolve's viewer header: zoom at the left, what is being shown in the middle, the timecode at
 * the right. The name says which viewer this is — "Timeline — <name>" — which nothing on screen
 * said before; the Media page's source monitor is a different picture and says so in its own
 * header.
 */
export function ViewerHeader(): ReactNode {
  const zoom = useViewer((state) => state.zoom)
  const setZoom = useViewer((state) => state.setZoom)
  const name = useEditor((state) => selectTimeline(state)?.name ?? '')
  return (
    <RegionHeader
      leading={
        <Select<ViewerZoom>
          label="Viewer zoom level"
          value={zoom}
          options={VIEWER_ZOOMS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={setZoom}
          className="h-5 w-[64px] [&_select]:text-[11px]"
        />
      }
      centre={
        <span className="text-[11px] font-semibold text-ink-0 select-none">
          <span className="text-ink-2">Timeline</span>
          {name && <span> — {name}</span>}
        </span>
      }
      actions={<PlayheadTimecode />}
    />
  )
}

/**
 * The programme viewer as a region: header, picture, transport. Rendered once by the workspace
 * and moved between pages (`hosted.tsx`), never remounted by a page switch — it owns the engine.
 */
export function ViewerRegion(): ReactNode {
  return (
    <section aria-label="Viewer" className="flex h-full min-h-0 min-w-0 flex-col bg-surface-1">
      <ViewerHeader />
      <ErrorBoundary region="the viewer">
        <Preview />
        <Transport />
      </ErrorBoundary>
    </section>
  )
}
