/**
 * What an open project looks like when it is edited in DaVinci Resolve (`hostOf(project)`).
 *
 * The timeline is in Resolve, so bay's pages are not where the work is: this layout is the
 * agent's conversation as the main area, the media pool beside it (bay still imports,
 * transcribes and generates media for a Resolve project) and the Resolve connection.
 *
 * It places only the hosted agent panel. The viewer and the timeline stay mounted exactly once,
 * in `Workspace`, and wait in the parking box (`hosted.tsx`) as the timeline does on the Media
 * page — so the engine is never disposed and the viewer's canvas is still the first in the
 * document.
 */

import type { ReactNode } from 'react'
import { useDefaultLayout } from 'react-resizable-panels'
import { House, Settings2 } from 'lucide-react'
import { HOST_LABEL } from '@shared/host'
import { ErrorBoundary, IconButton } from '@/components'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { MediaPool } from '@/editor/library/MediaPool'
import { ResolveStatusLine } from '@/editor/resolve/ResolveStatusLine'
import { useResolveStatus } from '@/editor/resolve/useResolveStatus'
import { runCommand } from '@/lib/commands'
import { Slot } from './hosted'
import { layoutStorage } from './layoutStorage'

export function ResolveWorkspace({ onHome }: { onHome(): void }): ReactNode {
  const layout = useDefaultLayout({ id: 'bay.layout.resolveHost', storage: layoutStorage })
  return (
    <div data-resolve-workspace="" className="flex min-h-0 flex-1">
      <ResizablePanelGroup
        id="bay.layout.resolveHost"
        orientation="horizontal"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
      >
        <ResizablePanel id="side" defaultSize="34%" minSize="280px">
          <div className="flex h-full min-h-0 flex-col">
            <ResolvePanel onHome={onHome} />
            <div className="min-h-0 flex-1">
              <ErrorBoundary region="the media pool">
                <MediaPool variant="panel" inlineSource={false} />
              </ErrorBoundary>
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize agent panel" />
        <ResizablePanel id="agent" minSize="360px">
          {/* The window's one AgentPanel (`hosted.tsx`). */}
          <div className="h-full min-h-0 border-l border-line">
            <Slot name="agent" />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

/** The Resolve connection: polled while there is something to fix, and slowly once connected. */
function ResolvePanel({ onHome }: { onHome(): void }): ReactNode {
  const connection = useResolveStatus(true, true)
  return (
    <section
      aria-label="DaVinci Resolve connection"
      data-resolve-panel=""
      className="shrink-0 border-b border-line bg-surface-1 p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[12px] font-semibold text-ink-0">{HOST_LABEL.resolve}</h2>
        {/* The page bar is not shown for a Resolve project; its two buttons live here. */}
        <div className="flex items-center gap-0.5">
          <IconButton label="All projects" icon={<House className="size-4" />} onClick={onHome} />
          <IconButton
            label="Project Settings"
            icon={<Settings2 className="size-4" />}
            onClick={() => runCommand('file.projectSettings')}
          />
        </div>
      </div>
      <p className="mb-2.5 text-[11px] leading-relaxed text-pretty text-ink-2">
        This project’s timeline is in Resolve. Ask the agent for edits here; they are made there.
      </p>
      <ResolveStatusLine connection={connection} />
    </section>
  )
}
