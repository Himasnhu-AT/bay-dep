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
 */

import { useCallback, type ReactNode } from 'react'
import { useDefaultLayout } from 'react-resizable-panels'
import { ErrorBoundary } from '@/components'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { AgentPanel } from '@/editor/AgentPanel'
import { StatusBar } from '@/editor/StatusBar'
import { Timeline } from '@/editor/Timeline'
import { TopBar } from '@/editor/TopBar'
import { useEditor } from '@/store/editor'
import { Hosted, HostProvider, useHost } from './hosted'
import { layoutStorage } from './layoutStorage'
import { PageBar } from './PageBar'
import { pageContent } from './pageContent'
import { PageLayout, regionsOf } from './PageLayout'
import { useCollapsiblePanel } from './useCollapsiblePanel'
import { ViewerRegion } from './ViewerRegion'

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

  const dockLayout = useDefaultLayout({ id: 'bay.layout.dock', storage: layoutStorage })
  const agentDocked = useEditor((state) => state.agentDocked)
  const setAgentDocked = useEditor((state) => state.setAgentDocked)
  const setAgentHidden = useCallback((hidden: boolean) => setAgentDocked(!hidden), [setAgentDocked])
  const agent = useCollapsiblePanel(!agentDocked, setAgentHidden, AGENT_WIDTH, 'agent panel')

  return (
    <HostProvider host={host}>
      <TopBar onExport={onExport} saving={saving} regions={regionsOf(content)} />

      {/* Every boundary between regions is a separator that can be dragged or moved with the
          arrow keys, and every layout is remembered. */}
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
            {/* Mounted only while docked: one AgentPanel at a time, and none sitting at 0px. */}
            <div inert={!agentDocked} className="h-full min-h-0 border-l border-line">
              {agentDocked && (
                <ErrorBoundary region="the agent panel">
                  <AgentPanel />
                </ErrorBoundary>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <StatusBar saving={saving} />
      <PageBar onHome={onHome} />

      {/* After the page, so its slots have placed these nodes before anything inside measures. */}
      <Hosted name="viewer">
        <ViewerRegion />
      </Hosted>
      <Hosted name="timeline">
        <ErrorBoundary region="the timeline">
          <Timeline />
        </ErrorBoundary>
      </Hosted>
    </HostProvider>
  )
}
