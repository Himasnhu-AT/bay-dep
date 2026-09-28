/**
 * The AI layout: editing through the agent. Three regions stay on screen — the viewer and the
 * media pool on the left, the agent large on the right — and everything else opens on demand from
 * the slim toolbar as a drawer over them, without leaving the mode:
 *
 *     ┌ toolbar: Timeline · Inspector · Pages │ Export ··················· Projects ┐
 *     ├ viewer (hosted) ───────────┬ agent (primary) ─────────────────────────────┤
 *     │                            │                              ┌ side drawer ─┤
 *     ├ media pool ────────────────┤                              │ Inspector or │
 *     │                            │                              │ Pages        │
 *     ├ timeline drawer (hosted) ──┴──────────────────────────────┴──────────────┤
 *     └──────────────────────────────────────────────────────────────────────────┘
 *
 * The viewer, the timeline and the agent panel are the workspace's single hosted nodes (`hosted.tsx`): this layout
 * only places `<Slot>`s for them, exactly as a Resolve page does, so switching modes moves them and
 * never remounts the engine. The viewer is the first region in document order, which keeps its
 * canvas the first `<canvas>` in the document (probes read it).
 *
 * Which regions and drawers show is `layoutRegions.ts`; this file only draws them.
 */

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useDefaultLayout } from 'react-resizable-panels'
import { House, LayoutGrid, PanelBottom, PanelRight, Settings2, Upload, X } from 'lucide-react'
import { ErrorBoundary, IconButton, Tabs, ToolButton } from '@/components'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { runCommand, shortcutOf } from '@/lib/commands'
import { useTimelineTool } from '@/lib/timelineTool'
import { useEditor, WORKSPACE_PAGES, type AiPanel, type WorkspacePage } from '@/store/editor'
import { AGENT_STARTERS, type AgentStarter } from '@/editor/agentStarters'
import { Inspector } from '@/editor/Inspector'
import { MediaPool } from '@/editor/library/MediaPool'
import { Slot } from './hosted'
import { layoutStorage } from './layoutStorage'
import type { LayoutRegions } from './layoutRegions'
import { PAGES } from './PageBar'
import { pageContent } from './pageContent'

/**
 * The one-click tools near the chat, handed to the hosted AgentPanel while this layout shows it.
 * Today every bay skill (the agent's own starters); the hook for "smart mode", which will choose
 * a palette from the footage (a podcast, a talking head…) — replace this with that choice.
 */
export const AI_TOOL_PALETTE: readonly AgentStarter[] = AGENT_STARTERS

export interface AiLayoutProps {
  drawers: LayoutRegions['drawers']
  onExport(): void
  onHome(): void
}

const DRAWER_IDS = { timeline: 'ai-drawer-timeline', side: 'ai-drawer-side' } as const

export function AiLayout({ drawers, onExport, onHome }: AiLayoutProps): ReactNode {
  const main = useDefaultLayout({ id: 'bay.layout.ai.main', storage: layoutStorage })
  const stage = useDefaultLayout({ id: 'bay.layout.ai.stage', storage: layoutStorage })
  const setAiPanel = useEditor((state) => state.setAiPanel)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AiToolbar drawers={drawers} onExport={onExport} onHome={onHome} />
      <div className="relative flex min-h-0 flex-1">
        <ResizablePanelGroup
          id="bay.layout.ai.main"
          orientation="horizontal"
          defaultLayout={main.defaultLayout}
          onLayoutChanged={main.onLayoutChanged}
        >
          <ResizablePanel id="stage" defaultSize="44%" minSize="320px">
            <ResizablePanelGroup
              id="bay.layout.ai.stage"
              orientation="vertical"
              defaultLayout={stage.defaultLayout}
              onLayoutChanged={stage.onLayoutChanged}
            >
              <ResizablePanel id="viewer" defaultSize="60%" minSize="200px">
                <Slot name="viewer" />
              </ResizablePanel>
              <ResizableHandle aria-label="Resize media pool" />
              <ResizablePanel id="pool" minSize="140px">
                <ErrorBoundary region="the media pool">
                  <MediaPool variant="panel" inlineSource={false} />
                </ErrorBoundary>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle aria-label="Resize agent panel" />
          <ResizablePanel id="agent" minSize="360px">
            {/* The window's one AgentPanel (`hosted.tsx`), moved here from the dock. */}
            <div className="h-full min-h-0 border-l border-line">
              <Slot name="agent" />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* Drawers overlay the three regions rather than resizing them: opening the timeline for
            a moment should not reflow the conversation or the viewer. */}
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col">
          <div className="flex min-h-0 flex-1 justify-end">
            {drawers.side === 'inspector' && (
              <Drawer
                key="inspector"
                id={DRAWER_IDS.side}
                title="Inspector"
                onClose={() => setAiPanel('inspector', false)}
                className="w-[min(360px,60%)] border-l"
              >
                <ErrorBoundary region="the inspector">
                  <Inspector />
                </ErrorBoundary>
              </Drawer>
            )}
            {drawers.side === 'pages' && (
              <Drawer
                key="pages"
                id={DRAWER_IDS.side}
                title="Pages"
                onClose={() => setAiPanel('pages', false)}
                className="w-[min(720px,80%)] border-l"
              >
                <PagesBody />
              </Drawer>
            )}
          </div>
          {drawers.timeline && (
            <Drawer
              id={DRAWER_IDS.timeline}
              title="Timeline"
              onClose={() => setAiPanel('timeline', false)}
              // Escape belongs to the timeline first while a blade or trim is armed (it puts the
              // tool down); only a second Escape, on the Select tool, closes the drawer.
              escapeCloses={() => {
                const tools = useTimelineTool.getState()
                return tools.tool === 'select' && !tools.armed
              }}
              className="h-[42%] min-h-[220px] border-t"
            >
              <Slot name="timeline" />
            </Drawer>
          )}
        </div>
      </div>
    </div>
  )
}

/** A drawer's toolbar button: a disclosure (`aria-expanded`), not a pressed toggle. */
const DRAWER_ON = 'aria-expanded:bg-accent/16 aria-expanded:text-accent aria-expanded:hover:bg-accent/22'

function AiToolbar({ drawers, onExport, onHome }: Pick<AiLayoutProps, 'drawers' | 'onExport' | 'onHome'>): ReactNode {
  const toggleAiPanel = useEditor((state) => state.toggleAiPanel)
  const drawerButton = (panel: AiPanel, label: string, icon: ReactNode, open: boolean, controls: string, detail: string): ReactNode => (
    <ToolButton
      label={label}
      icon={icon}
      detail={detail}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      className={DRAWER_ON}
      onClick={() => toggleAiPanel(panel)}
    />
  )
  return (
    <div role="group" aria-label="AI layout panels" className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line bg-chrome px-2">
      {drawerButton('timeline', 'Timeline', <PanelBottom className="size-4" />, drawers.timeline, DRAWER_IDS.timeline, 'Open the timeline over the layout')}
      {drawerButton('inspector', 'Inspector', <PanelRight className="size-4" />, drawers.side === 'inspector', DRAWER_IDS.side, 'The selected clip’s settings')}
      {drawerButton('pages', 'Pages', <LayoutGrid className="size-4" />, drawers.side === 'pages', DRAWER_IDS.side, 'Media, Edit, Color, Audio and Deliver panels')}
      <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line-strong" />
      <ToolButton
        label="Export"
        icon={<Upload className="size-4" />}
        detail="Render the timeline to a file"
        shortcut={shortcutOf('file.export')}
        onClick={onExport}
      />
      <div className="ml-auto flex items-center gap-0.5">
        <IconButton label="All projects" icon={<House className="size-4" />} onClick={onHome} />
        <IconButton label="Project Settings" icon={<Settings2 className="size-4" />} onClick={() => runCommand('file.projectSettings')} />
      </div>
    </div>
  )
}

/**
 * A non-modal drawer: focus moves into it when it opens and back to whatever opened it when it
 * closes (if focus was still inside, or nowhere); Escape inside it closes it.
 */
function Drawer({
  id,
  title,
  onClose,
  escapeCloses,
  className,
  children
}: {
  id: string
  title: string
  onClose(): void
  escapeCloses?: () => boolean
  className?: string
  children: ReactNode
}): ReactNode {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const node = ref.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    node?.focus()
    return () => {
      const active = document.activeElement
      const lost = active === null || active === document.body || (node !== null && node.contains(active))
      if (lost && opener?.isConnected) opener.focus()
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent): void => {
    // A menu or popover inside claims its own Escape by preventing it.
    if (event.key !== 'Escape' || event.defaultPrevented) return
    if (escapeCloses && !escapeCloses()) return
    event.preventDefault()
    onClose()
  }

  return (
    <section
      ref={ref}
      id={id}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={`pointer-events-auto flex min-h-0 flex-col border-line bg-surface-1 shadow-pop outline-none ${className ?? ''}`}
    >
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-line bg-chrome pr-1 pl-3">
        <h2 className="text-[11px] font-semibold text-ink-0 select-none">{title}</h2>
        <IconButton label={`Close ${title.toLowerCase()}`} icon={<X className="size-3.5" />} onClick={onClose} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

/**
 * The Pages drawer: a page's own panels, as `pageContent` names them, without its viewer and
 * timeline (those are already on screen, or in the timeline drawer). Choosing a tab sets the
 * store's `page`, so Resolve mode opens on the page last looked at here.
 */
function PagesBody(): ReactNode {
  const page = useEditor((state) => state.page)
  const setPage = useEditor((state) => state.setPage)
  const content = pageContent(page)
  const panels = [content.left, content.right, content.besideTimeline].filter((node) => node !== undefined)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs<WorkspacePage>
        label="Pages"
        value={page}
        items={WORKSPACE_PAGES.map((id) => ({ value: id, label: PAGES[id].label }))}
        onChange={setPage}
      />
      {content.aboveTimeline !== undefined && (
        <div className="max-h-[40%] shrink-0 overflow-hidden border-b border-line">{content.aboveTimeline}</div>
      )}
      <div className="flex min-h-0 flex-1 overflow-x-auto">
        {panels.map((node, index) => (
          <div key={`${page}-${index}`} className="flex min-h-0 min-w-[280px] flex-1 flex-col border-l border-line first:border-l-0">
            <ErrorBoundary region={`the ${PAGES[page].label} page`}>{node}</ErrorBoundary>
          </div>
        ))}
      </div>
    </div>
  )
}
