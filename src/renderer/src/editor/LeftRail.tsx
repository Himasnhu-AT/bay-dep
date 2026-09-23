import type { ReactNode } from 'react'
import { Bot, FolderOpen, LayoutTemplate, Sparkles, Type as TypeIcon, Upload } from 'lucide-react'
import { IconButton } from '@/components'
import { useEditor, type PanelId } from '@/store/editor'
import { AgentPanel } from './AgentPanel'
import { EffectsPanel } from './EffectsPanel'
import { ExportPanel } from './ExportPanel'
import { MediaPanel } from './MediaPanel'
import { TemplatesPanel } from './TemplatesPanel'
import { TextPanel } from './TextPanel'

const PAGES: { id: PanelId; label: string; icon: ReactNode }[] = [
  { id: 'agent', label: 'Agent', icon: <Bot className="size-4" /> },
  { id: 'media', label: 'Media', icon: <FolderOpen className="size-4" /> },
  { id: 'text', label: 'Text', icon: <TypeIcon className="size-4" /> },
  { id: 'templates', label: 'Templates', icon: <LayoutTemplate className="size-4" /> },
  { id: 'effects', label: 'Effects', icon: <Sparkles className="size-4" /> },
  { id: 'export', label: 'Export', icon: <Upload className="size-4" /> }
]

/**
 * The 44px icon strip. Always visible, so switching pages never costs a trip through a menu,
 * and the active page is marked with the accent bar rather than a filled button — a filled tab
 * in a column of six reads as a warning. The page it selects is `SidePanel`, which sits in a
 * resizable panel beside it; the strip itself does not resize.
 */
export function LeftRail(): ReactNode {
  const panel = useEditor((state) => state.panel)
  const setPanel = useEditor((state) => state.setPanel)

  return (
    <nav
      aria-label="Panels"
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-1 py-2"
    >
      {PAGES.map((page) => (
        <div key={page.id} className="relative flex w-full justify-center">
          {panel === page.id && (
            <span
              aria-hidden="true"
              className="absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-accent"
            />
          )}
          <IconButton
            label={page.label}
            tooltipSide="right"
            icon={page.icon}
            active={panel === page.id}
            onClick={() => setPanel(page.id)}
          />
        </div>
      ))}
    </nav>
  )
}

/** Whichever page the rail has selected. */
export function SidePanel(): ReactNode {
  const panel = useEditor((state) => state.panel)
  return (
    <div className="h-full min-w-0">
      {panel === 'agent' && <AgentPanel />}
      {panel === 'media' && <MediaPanel />}
      {panel === 'text' && <TextPanel />}
      {panel === 'templates' && <TemplatesPanel />}
      {panel === 'effects' && <EffectsPanel />}
      {panel === 'export' && <ExportPanel />}
    </div>
  )
}
