import type { ReactNode } from 'react'
import { FolderOpen, LayoutTemplate, ScrollText, Sparkles, Type as TypeIcon } from 'lucide-react'
import { Tooltip } from '@/components'
import { cn } from '@/lib/cn'
import { useEditor, type PanelId } from '@/store/editor'
import { EffectsPanel } from './EffectsPanel'
import { MediaPanel } from './MediaPanel'
import { TemplatesPanel } from './TemplatesPanel'
import { TextPanel } from './TextPanel'
import { TranscriptPanel } from './TranscriptPanel'

/** The rail's pages: the Edit page's libraries. */
type RailPage = Exclude<PanelId, 'agent' | 'export'>

const PAGES: { id: RailPage; label: string; detail: string; icon: ReactNode }[] = [
  { id: 'media', label: 'Media', detail: 'Imported footage, audio and stills', icon: <FolderOpen className="size-4" /> },
  { id: 'text', label: 'Text', detail: 'Titles and subtitles', icon: <TypeIcon className="size-4" /> },
  { id: 'transcript', label: 'Transcript', detail: 'Transcribe, search and cut by words', icon: <ScrollText className="size-4" /> },
  { id: 'templates', label: 'Templates', detail: 'Lower thirds, captions and cards', icon: <LayoutTemplate className="size-4" /> },
  { id: 'effects', label: 'Effects', detail: 'Frame, fade and speed presets', icon: <Sparkles className="size-4" /> }
]

/**
 * The rail's page for a `panel` that is no longer a rail page. The agent is a dock and export is
 * the Deliver page now (`setPanel` maps both there); the rail then keeps showing the library the
 * store last chose rather than an empty panel, and never a second agent beside the docked one.
 */
function railPage(panel: PanelId, libraryTab: string): RailPage {
  if (panel !== 'agent' && panel !== 'export') return panel
  if (libraryTab === 'transcript') return 'transcript'
  if (libraryTab === 'effects') return 'effects'
  return 'media'
}

/**
 * The Edit page's library strip: a labelled button per library, the active one marked with the
 * accent bar and a filled background. Labels under the icons, because three of the five glyphs
 * could not be guessed. The page it selects is `SidePanel`, in the resizable panel beside it; the
 * strip itself does not resize.
 */
export function LeftRail(): ReactNode {
  const panel = useEditor((state) => state.panel)
  const libraryTab = useEditor((state) => state.libraryTab)
  const setPanel = useEditor((state) => state.setPanel)
  const sideHidden = useEditor((state) => state.hiddenRegions.side)
  const setRegionHidden = useEditor((state) => state.setRegionHidden)
  const current = railPage(panel, libraryTab)

  // The page already showing, clicked again, hides the panel — the gesture every editor with a
  // rail uses. Any page clicked while it is hidden brings it back, on that page.
  const choose = (id: RailPage): void => {
    if (id === current && !sideHidden) {
      setRegionHidden('side', true)
      return
    }
    setPanel(id)
    setRegionHidden('side', false)
  }

  return (
    <nav
      aria-label="Libraries"
      className="flex w-[68px] shrink-0 flex-col items-stretch gap-0.5 border-r border-line bg-chrome px-1 py-1.5"
    >
      {PAGES.map((page) => {
        const on = current === page.id && !sideHidden
        return (
          <Tooltip key={page.id} side="right" label={page.label} detail={page.detail}>
            <button
              type="button"
              aria-label={page.label}
              aria-pressed={on}
              onClick={() => choose(page.id)}
              className={cn(
                't-fast relative flex h-11 flex-col items-center justify-center gap-1 rounded-sm text-[10px] leading-none font-medium',
                on ? 'bg-surface-3 text-ink-0' : 'text-ink-2 hover:bg-surface-3 hover:text-ink-0'
              )}
            >
              {current === page.id && (
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 -left-1 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-accent"
                />
              )}
              <span className={on ? 'text-accent' : undefined}>{page.icon}</span>
              <span className="max-w-full truncate px-0.5">{page.label}</span>
            </button>
          </Tooltip>
        )
      })}
    </nav>
  )
}

/** Whichever library the rail has selected. */
export function SidePanel(): ReactNode {
  const panel = useEditor((state) => state.panel)
  const libraryTab = useEditor((state) => state.libraryTab)
  const page = railPage(panel, libraryTab)
  return (
    <div className="h-full min-w-0">
      {page === 'media' && <MediaPanel />}
      {page === 'text' && <TextPanel />}
      {page === 'templates' && <TemplatesPanel />}
      {page === 'transcript' && <TranscriptPanel />}
      {page === 'effects' && <EffectsPanel />}
    </div>
  )
}
