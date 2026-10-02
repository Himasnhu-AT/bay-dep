/**
 * The editor window's working area: the top bar, the current page, the agent dock, the status
 * bar and the page bar.
 *
 * Split out of `App.tsx` so the page layouts can change without touching the file that owns
 * the project lifecycle, the dialogs and drag-and-drop. `App` still decides *when* the editor
 * shows; this decides *how it is laid out*.
 *
 * What survives a page switch, and why:
 * - the viewer and the timeline — rendered once here and moved into the page's slots
 *   (`hosted.tsx`), because the viewer owns the engine and remounting it rebuilds every decoder;
 * - the agent dock — it sits beside the page rather than inside it, so a conversation's scroll
 *   and composer draft stay put;
 * - the bars.
 * The page's own panels (library, inspector, …) remount; they hold nothing that matters.
 *
 * Two layout modes (`layoutMode`, ⌘⇧A, the TopBar's Resolve | AI switch): Resolve is the page
 * layout, the agent a dock and the page bar along the bottom; AI swaps all of that for
 * `AiLayout` — the agent large, the viewer and the media pool beside it, the rest in drawers.
 * `layoutRegions.ts` says which regions each mode shows. Both place the same hosted viewer and
 * timeline, so a mode switch moves them like a page switch does. The agent's conversation lives
 * in the store, and the panel itself is hosted too, so a draft, attachments and a send in flight
 * survive a switch.
 *
 * A project edited in DaVinci Resolve (`hostOf(project)`) gets neither: `ResolveWorkspace` takes
 * the working area, the page bar and panel toggles go, and the viewer and timeline wait, still
 * mounted, in the parking box.
 */

import { useCallback, useMemo, type ReactNode } from 'react'
import { useDefaultLayout } from 'react-resizable-panels'
import { ErrorBoundary } from '@/components'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { AgentPanel } from '@/editor/AgentPanel'
import { StatusBar } from '@/editor/StatusBar'
import { Timeline } from '@/editor/Timeline'
import { TopBar } from '@/editor/TopBar'
import { useEditor } from '@/store/editor'
import { hostOf } from '@shared/host'
import { aiToolPalette, AiLayout } from './AiLayout'
import { Hosted, HostProvider, Slot, useHost } from './hosted'
import { layoutStorage } from './layoutStorage'
import { PageBar } from './PageBar'
import { layoutRegions } from './layoutRegions'
import { pageContent } from './pageContent'
import { PageLayout, regionsOf } from './PageLayout'
import { useCollapsiblePanel } from './useCollapsiblePanel'
import { ViewerRegion } from './ViewerRegion'
import { PlayingMark } from './PlayingMark'
import { ResolveWorkspace } from './ResolveWorkspace'

export interface WorkspaceProps {
  onHome(): void
  onExport(): void
  saving: boolean
}

const AGENT_WIDTH = '360px'

export function Workspace({ onHome, onExport, saving }: WorkspaceProps): ReactNode {
  const host = useHost()
  const page = useEditor((state) => state.page)
  const content = pageContent(page)
  const layoutMode = useEditor((state) => state.layoutMode)
  const aiPanels = useEditor((state) => state.aiPanels)
  const regions = layoutRegions(layoutMode, aiPanels)
  // A project edited in DaVinci Resolve has no use for bay's pages: `ResolveWorkspace` replaces
  // both layouts. A string, so this re-renders only when the host changes.
  const inResolve = useEditor((state) => hostOf(state.project)) === 'resolve'
  // Smart mode: the palette follows the footage. Assets change on import, not per frame.
  const assets = useEditor((state) => state.project.assets)
  const palette = useMemo(() => aiToolPalette(assets), [assets])

  const dockLayout = useDefaultLayout({ id: 'bay.layout.dock', storage: layoutStorage })
  const agentDocked = useEditor((state) => state.agentDocked)
  const setAgentDocked = useEditor((state) => state.setAgentDocked)
  const setAgentHidden = useCallback((hidden: boolean) => setAgentDocked(!hidden), [setAgentDocked])
  const agent = useCollapsiblePanel(!agentDocked, setAgentHidden, AGENT_WIDTH, 'agent panel')

  return (
    <HostProvider host={host}>
      <PlayingMark />
      <TopBar onExport={onExport} saving={saving} regions={regionsOf(content)} panelToggles={regions.panelToggles && !inResolve} />

      {inResolve ? (
        <ResolveWorkspace onHome={onHome} />
      ) : regions.agent === 'primary' ? (
        <AiLayout drawers={regions.drawers} onExport={onExport} onHome={onHome} />
      ) : (
      /* Every boundary between regions is a separator that can be dragged or moved with the
          arrow keys, and every layout is remembered. */
      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup
          id="bay.layout.dock"
          orientation="horizontal"
          defaultLayout={dockLayout.defaultLayout}
          onLayoutChanged={dockLayout.onLayoutChanged}
        >
          <ResizablePanel id="page" minSize="50%">
            {/* Keyed by page: each page's groups mount fresh with their own remembered sizes. */}
            <PageLayout key={page} page={page} content={content} />
          </ResizablePanel>
          <ResizableHandle aria-label="Resize agent panel" />
          <ResizablePanel
            id="agent"
            defaultSize={agentDocked ? AGENT_WIDTH : '0px'}
            minSize="300px"
            maxSize="600px"
            groupResizeBehavior="preserve-pixel-size"
            collapsible
            collapsedSize="0px"
            panelRef={agent.panelRef}
            onResize={agent.onResize}
          >
            {/* The one hosted AgentPanel is placed here only while docked; undocked it waits,
                still mounted, in the parking box rather than sitting at 0px. */}
            <div inert={!agentDocked} className="h-full min-h-0 border-l border-line">
              {agentDocked && <Slot name="agent" />}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      )}

      <StatusBar saving={saving} />
      {regions.pageBar && !inResolve && <PageBar onHome={onHome} />}

      {/* After the page, so its slots have placed these nodes before anything inside measures. */}
      <Hosted name="viewer">
        <ViewerRegion />
      </Hosted>
      {/* One AgentPanel for the window, placed by the dock or the AI layout. The tool palette
          is the AI layout's; the dock keeps the starters grid only. */}
      <Hosted name="agent">
        <ErrorBoundary region="the agent panel">
          <AgentPanel palette={regions.agent === 'primary' && !inResolve ? palette : undefined} />
        </ErrorBoundary>
      </Hosted>
      <Hosted name="timeline">
        <ErrorBoundary region="the timeline">
          <Timeline />
        </ErrorBoundary>
      </Hosted>
    </HostProvider>
  )
}
