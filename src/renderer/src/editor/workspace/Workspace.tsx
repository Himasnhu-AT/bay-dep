/**
 * The editor window's working area: the top bar, the resizable regions and the status bar.
 *
 * Split out of `App.tsx` so the page layouts can change without touching the file that owns
 * the project lifecycle, the dialogs and drag-and-drop. `App` still decides *when* the editor
 * shows; this decides *how it is laid out*.
 */

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { useDefaultLayout, usePanelRef, type PanelImperativeHandle } from 'react-resizable-panels'
import { ErrorBoundary } from '@/components'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Inspector } from '@/editor/Inspector'
import { LeftRail, SidePanel } from '@/editor/LeftRail'
import { Preview } from '@/editor/Preview'
import { StatusBar } from '@/editor/StatusBar'
import { Timeline } from '@/editor/Timeline'
import { TopBar } from '@/editor/TopBar'
import { Transport } from '@/editor/Transport'
import { useEditor, type RegionId } from '@/store/editor'

/**
 * Where a panel layout the user dragged into is remembered. `localStorage`, wrapped so that a
 * profile where storage throws (private mode, a locked-down profile) falls back to the defaults
 * instead of taking the editor down: a remembered layout is a convenience, never a requirement.
 */
export const layoutStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      // Not remembered this time; the layout still works.
    }
  }
}

export interface WorkspaceProps {
  onHome(): void
  onExport(): void
  saving: boolean
}

export function Workspace({ onHome, onExport, saving }: WorkspaceProps): ReactNode {
  // One remembered layout per group. Keys are pinned by these ids: renaming one resets that
  // group to its defaults for everyone, which costs a drag, not data.
  const mainLayout = useDefaultLayout({ id: 'bay.layout.main', storage: layoutStorage })
  const workLayout = useDefaultLayout({ id: 'bay.layout.work', storage: layoutStorage })
  const stageLayout = useDefaultLayout({ id: 'bay.layout.stage', storage: layoutStorage })

  // -- hiding regions ----------------------------------------------------------
  //
  // The store says which regions are hidden; the panels are made to agree with it. Collapsing
  // rather than unmounting keeps the panel's last size, so showing it again puts it back where
  // it was. And the sync runs the other way too: a panel dragged shut against its edge
  // collapses, and its button must then read as "hidden" rather than disagree with the screen.
  const sideRef = usePanelRef()
  const inspectorRef = usePanelRef()
  const timelineRef = usePanelRef()
  const hiddenRegions = useEditor((state) => state.hiddenRegions)
  const setRegionHidden = useEditor((state) => state.setRegionHidden)

  // The width a region had when it was hidden, so showing it restores exactly that. The library's
  // own `expand()` restored the inspector to its minimum (236px came back as 220px) when the
  // side panel was wide, because it re-solves the whole group; an explicit resize does not.
  const sizeBeforeHide = useRef<Partial<Record<RegionId, number>>>({})
  useEffect(() => {
    const refs: [RegionId, RefObject<PanelImperativeHandle | null>][] = [
      ['side', sideRef],
      ['inspector', inspectorRef],
      ['timeline', timelineRef]
    ]
    for (const [region, ref] of refs) {
      const panel = ref.current
      if (!panel) continue
      if (hiddenRegions[region] && !panel.isCollapsed()) {
        sizeBeforeHide.current[region] = panel.getSize().inPixels
        panel.collapse()
      }
      if (!hiddenRegions[region] && panel.isCollapsed()) {
        panel.expand()
        const before = sizeBeforeHide.current[region]
        if (before) panel.resize(`${Math.round(before)}px`)
      }
    }
  }, [hiddenRegions, sideRef, inspectorRef, timelineRef])

  const followCollapse =
    (region: RegionId, ref: RefObject<PanelImperativeHandle | null>) => (): void => {
      const collapsed = ref.current?.isCollapsed()
      if (collapsed !== undefined) setRegionHidden(region, collapsed)
    }

  return (
    <>
      <TopBar
        onHome={onHome}
        onExport={onExport}
        saving={saving}
      />

      {/* Every boundary between regions is a separator that can be dragged or moved with the
          arrow keys, and the layout is remembered. The rail is outside the groups: it is a
          fixed strip of buttons, and resizing it would only make the buttons harder to hit. */}
      <div className="flex min-h-0 flex-1">
        <LeftRail />

        <ResizablePanelGroup
          id="bay.layout.main"
          orientation="horizontal"
          defaultLayout={mainLayout.defaultLayout}
          onLayoutChanged={mainLayout.onLayoutChanged}
        >
          <ResizablePanel
            id="side"
            defaultSize="300px"
            minSize="220px"
            // A pixel cap, not a share of the window: at 55% a side panel dragged (or remembered)
            // wide took the room the inspector and preview need, and grew with every larger
            // window. The library clamps a remembered layout to this on load.
            maxSize="480px"
            // Pixel-stable: resizing the window, or any panel beside it, goes to the preview —
            // the one region that is meant to take whatever space is left.
            groupResizeBehavior="preserve-pixel-size"
            collapsible
            collapsedSize="0px"
            panelRef={sideRef}
            onResize={followCollapse('side', sideRef)}
          >
            {/* `inert` while collapsed: a 0px panel is still mounted, and without it its controls
                stayed in the tab order and the accessibility tree, reachable but invisible. */}
            <div inert={hiddenRegions.side} className="h-full min-h-0">
              <ErrorBoundary region="the side panel">
                <SidePanel />
              </ErrorBoundary>
            </div>
          </ResizablePanel>
          <ResizableHandle aria-label="Resize side panel" />

          <ResizablePanel id="work" minSize="45%">
            <ResizablePanelGroup
              id="bay.layout.work"
              orientation="vertical"
              defaultLayout={workLayout.defaultLayout}
              onLayoutChanged={workLayout.onLayoutChanged}
            >
              <ResizablePanel id="stage" minSize="220px">
                <ResizablePanelGroup
                  id="bay.layout.stage"
                  orientation="horizontal"
                  defaultLayout={stageLayout.defaultLayout}
                  onLayoutChanged={stageLayout.onLayoutChanged}
                >
                  <ResizablePanel id="viewer" minSize="320px">
                    <div className="flex h-full min-h-0 min-w-0 flex-col">
                      <ErrorBoundary region="the viewer">
                        <Preview />
                        <Transport />
                      </ErrorBoundary>
                    </div>
                  </ResizablePanel>
                  <ResizableHandle aria-label="Resize inspector" />
                  <ResizablePanel
                    id="inspector"
                    defaultSize="268px"
                    minSize="220px"
                    maxSize="45%"
                    groupResizeBehavior="preserve-pixel-size"
                    collapsible
                    collapsedSize="0px"
                    panelRef={inspectorRef}
                    onResize={followCollapse('inspector', inspectorRef)}
                  >
                    <div inert={hiddenRegions.inspector} className="h-full min-h-0">
                      <ErrorBoundary region="the inspector">
                        <Inspector />
                      </ErrorBoundary>
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
              <ResizableHandle aria-label="Resize timeline" />
              <ResizablePanel
                id="timeline"
                defaultSize="260px"
                minSize="150px"
                groupResizeBehavior="preserve-pixel-size"
                collapsible
                collapsedSize="0px"
                panelRef={timelineRef}
                onResize={followCollapse('timeline', timelineRef)}
              >
                <div inert={hiddenRegions.timeline} className="flex h-full min-h-0 flex-col">
                  <ErrorBoundary region="the timeline">
                    <Timeline />
                  </ErrorBoundary>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <StatusBar />
    </>
  )
}
