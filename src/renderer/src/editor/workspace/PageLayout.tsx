/**
 * One page's frame: the resizable groups every page shares, filled from `pageContent.tsx`.
 *
 * Each page remembers its own split sizes under its own ids (`bay.layout.<page>.*`), so dragging
 * the Color page's inspector wide does not move the Edit page's. The Edit page keeps the ids the
 * editor had before pages existed (`bay.layout.main/work/stage`), and the same panel ids, so a
 * layout someone already dragged into survives the update.
 */

import type { ReactNode } from 'react'
import { useDefaultLayout } from 'react-resizable-panels'
import { ErrorBoundary } from '@/components'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import type { RegionId, WorkspacePage } from '@/store/editor'
import { Slot } from './hosted'
import { layoutStorage } from './layoutStorage'
import type { PageContent } from './pageContent'
import { useRegionPanel } from './useCollapsiblePanel'

type Size = `${number}px` | `${number}%`

interface Frame {
  ids: { main: string; work: string; stage: string; bottom: string }
  left: { defaultSize: Size; minSize: Size; maxSize: Size }
  right: { defaultSize: Size; minSize: Size; maxSize: Size }
  timeline: { defaultSize: Size; minSize: Size }
  beside: { defaultSize: Size; minSize: Size; maxSize: Size }
  /** The smallest the viewer may be. */
  viewerMin: Size
  /** The smallest the viewer-and-timeline column may be, beside the left panel. */
  workMin: Size
}

const ids = (page: WorkspacePage): Frame['ids'] => ({
  main: `bay.layout.${page}.main`,
  work: `bay.layout.${page}.work`,
  stage: `bay.layout.${page}.stage`,
  bottom: `bay.layout.${page}.bottom`
})

// The cap is a share of the window, not pixels: 480px was fine at 1440 and left a 1024 window
// with a library at 40% of it and the viewer squeezed. 30% is 432px at 1440, 307px at 1024.
const EDIT_LEFT = { defaultSize: '300px', minSize: '220px', maxSize: '30%' } as const
const INSPECTOR = { defaultSize: '268px', minSize: '220px', maxSize: '45%' } as const
const BESIDE = { defaultSize: '280px', minSize: '200px', maxSize: '50%' } as const

/** Sizes per page. Pixel sizes for side panels, so a larger window goes to the viewer. */
export const PAGE_FRAMES: Record<WorkspacePage, Frame> = {
  edit: {
    // Pinned: renaming these resets everyone's Edit layout to the defaults.
    ids: { main: 'bay.layout.main', work: 'bay.layout.work', stage: 'bay.layout.stage', bottom: 'bay.layout.edit.bottom' },
    left: EDIT_LEFT,
    right: INSPECTOR,
    timeline: { defaultSize: '260px', minSize: '150px' },
    beside: BESIDE,
    // Room for library + viewer + inspector + the agent dock at 1280px.
    viewerMin: '280px',
    workMin: '45%'
  },
  media: {
    ids: ids('media'),
    // The pool is the page: it takes most of the width, and the viewer beside it is a monitor.
    left: { defaultSize: '58%', minSize: '320px', maxSize: '75%' },
    right: INSPECTOR,
    timeline: { defaultSize: '200px', minSize: '120px' },
    beside: BESIDE,
    viewerMin: '280px',
    workMin: '25%'
  },
  color: {
    ids: ids('color'),
    left: EDIT_LEFT,
    right: { defaultSize: '320px', minSize: '260px', maxSize: '50%' },
    // The clip strip (~150px) sits inside this region, above the timeline: 190px left the
    // timeline's toolbar with no tracks under it.
    timeline: { defaultSize: '360px', minSize: '280px' },
    beside: BESIDE,
    viewerMin: '320px',
    workMin: '45%'
  },
  audio: {
    ids: ids('audio'),
    left: EDIT_LEFT,
    right: { defaultSize: '300px', minSize: '240px', maxSize: '45%' },
    // Fairlight's shape: the tracks are the page, the picture is a reference.
    timeline: { defaultSize: '55%', minSize: '200px' },
    beside: BESIDE,
    viewerMin: '280px',
    workMin: '45%'
  },
  deliver: {
    ids: ids('deliver'),
    left: { defaultSize: '360px', minSize: '300px', maxSize: '520px' },
    right: { defaultSize: '300px', minSize: '240px', maxSize: '40%' },
    timeline: { defaultSize: '180px', minSize: '120px' },
    beside: BESIDE,
    viewerMin: '320px',
    workMin: '45%'
  }
}

/** Which of the three toggleable regions a page has. The TopBar greys out the others. */
export function regionsOf(content: PageContent): Record<RegionId, boolean> {
  return { side: content.left !== undefined, inspector: content.right !== undefined, timeline: content.timeline }
}

/** A side panel whose visibility is a store region; `inert` while collapsed (still mounted at 0px). */
function RegionPanel({
  id,
  region,
  size,
  label,
  children
}: {
  id: string
  region: RegionId
  size: { defaultSize: Size; minSize: Size; maxSize?: Size }
  label: string
  children: ReactNode
}): ReactNode {
  const { panelRef, onResize, hidden } = useRegionPanel(region, size.defaultSize)
  return (
    <ResizablePanel
      id={id}
      defaultSize={size.defaultSize}
      minSize={size.minSize}
      maxSize={size.maxSize}
      // Pixel-stable: resizing the window, or a neighbour, goes to the viewer — the one region
      // meant to take whatever is left.
      groupResizeBehavior="preserve-pixel-size"
      collapsible
      collapsedSize="0px"
      panelRef={panelRef}
      onResize={onResize}
    >
      {/* `inert` while collapsed: a 0px panel is still mounted, and without it its controls stay
          in the tab order and the accessibility tree, reachable but invisible. */}
      <div inert={hidden} className="flex h-full min-h-0 flex-col">
        <ErrorBoundary region={label}>{children}</ErrorBoundary>
      </div>
    </ResizablePanel>
  )
}

export function PageLayout({ page, content }: { page: WorkspacePage; content: PageContent }): ReactNode {
  const frame = PAGE_FRAMES[page]
  // Every group's hook runs on every page, used or not, so the hook order never changes.
  const main = useDefaultLayout({ id: frame.ids.main, storage: layoutStorage })
  const work = useDefaultLayout({ id: frame.ids.work, storage: layoutStorage })
  const stage = useDefaultLayout({ id: frame.ids.stage, storage: layoutStorage })
  const bottom = useDefaultLayout({ id: frame.ids.bottom, storage: layoutStorage })

  const stageGroup = (
    <ResizablePanelGroup
      id={frame.ids.stage}
      orientation="horizontal"
      defaultLayout={stage.defaultLayout}
      onLayoutChanged={stage.onLayoutChanged}
    >
      <ResizablePanel id="viewer" minSize={frame.viewerMin}>
        <Slot name="viewer" />
      </ResizablePanel>
      {content.right !== undefined && (
        <>
          <ResizableHandle aria-label="Resize inspector" />
          <RegionPanel id="inspector" region="inspector" size={frame.right} label="the inspector">
            {content.right}
          </RegionPanel>
        </>
      )}
    </ResizablePanelGroup>
  )

  const timelineBody = (
    <div className="flex h-full min-h-0 flex-col">
      {/* Under pressure the strip gives way, not the timeline: the timeline keeps room for its
          toolbar and a track or two whatever the region's height. */}
      {content.aboveTimeline !== undefined && <div className="min-h-0 shrink overflow-hidden">{content.aboveTimeline}</div>}
      <div className="min-h-28 flex-1">
        {content.besideTimeline === undefined ? (
          <Slot name="timeline" />
        ) : (
          <ResizablePanelGroup
            id={frame.ids.bottom}
            orientation="horizontal"
            defaultLayout={bottom.defaultLayout}
            onLayoutChanged={bottom.onLayoutChanged}
          >
            <ResizablePanel id="timeline-body" minSize="40%">
              <Slot name="timeline" />
            </ResizablePanel>
            <ResizableHandle aria-label="Resize the panel beside the timeline" />
            <ResizablePanel
              id="beside"
              defaultSize={frame.beside.defaultSize}
              minSize={frame.beside.minSize}
              maxSize={frame.beside.maxSize}
              groupResizeBehavior="preserve-pixel-size"
            >
              <ErrorBoundary region="the panel beside the timeline">{content.besideTimeline}</ErrorBoundary>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
    </div>
  )

  const workGroup = content.timeline ? (
    <ResizablePanelGroup
      id={frame.ids.work}
      orientation="vertical"
      defaultLayout={work.defaultLayout}
      onLayoutChanged={work.onLayoutChanged}
    >
      <ResizablePanel id="stage" minSize="220px">
        {stageGroup}
      </ResizablePanel>
      <ResizableHandle aria-label="Resize timeline" />
      <RegionPanel id="timeline" region="timeline" size={frame.timeline} label="the timeline">
        {timelineBody}
      </RegionPanel>
    </ResizablePanelGroup>
  ) : (
    stageGroup
  )

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      {content.rail}
      <ResizablePanelGroup
        id={frame.ids.main}
        orientation="horizontal"
        defaultLayout={main.defaultLayout}
        onLayoutChanged={main.onLayoutChanged}
      >
        {content.left !== undefined && (
          <>
            <RegionPanel id="side" region="side" size={frame.left} label="the side panel">
              {content.left}
            </RegionPanel>
            <ResizableHandle aria-label="Resize side panel" />
          </>
        )}
        <ResizablePanel id="work" minSize={frame.workMin}>
          {workGroup}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
