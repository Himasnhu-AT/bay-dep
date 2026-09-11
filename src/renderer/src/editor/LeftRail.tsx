import type { ReactNode } from 'react'
import { FolderOpen, Sparkles, Type as TypeIcon, Upload } from 'lucide-react'
import { IconButton } from '@/components'
import { useEditor, type PanelId } from '@/store/editor'
import { EffectsPanel } from './EffectsPanel'
import { ExportPanel } from './ExportPanel'
import { MediaPanel } from './MediaPanel'
import { TextPanel } from './TextPanel'

const PAGES: { id: PanelId; label: string; icon: ReactNode }[] = [
  { id: 'media', label: 'Media', icon: <FolderOpen className="size-4" /> },
  { id: 'text', label: 'Text', icon: <TypeIcon className="size-4" /> },
  { id: 'effects', label: 'Effects', icon: <Sparkles className="size-4" /> },
  { id: 'export', label: 'Export', icon: <Upload className="size-4" /> }
]

/**
 * A 44px icon strip beside a 216px panel. The strip is always visible so switching pages
 * never costs a trip through a menu, and the active page is marked with the accent bar
 * rather than a filled button — a filled tab in a column of four reads as a warning.
 */
export function LeftRail(): ReactNode {
  const panel = useEditor((state) => state.panel)
  const setPanel = useEditor((state) => state.setPanel)

  return (
    <div className="flex w-[260px] shrink-0 border-r border-line">
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

      <div className="min-w-0 flex-1">
        {panel === 'media' && <MediaPanel />}
        {panel === 'text' && <TextPanel />}
        {panel === 'effects' && <EffectsPanel />}
        {panel === 'export' && <ExportPanel />}
      </div>
    </div>
  )
}
