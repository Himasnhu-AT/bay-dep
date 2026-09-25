import { useRef, type ReactNode } from 'react'
import { FolderOpen, ListTree, ScrollText, Sparkles } from 'lucide-react'
import { ErrorBoundary, Tabs } from '@/components'
import { useEditor, type LibraryTab } from '@/store/editor'
import { EffectsLibrary } from './EffectsLibrary'
import { IndexPanel } from './IndexPanel'
import { MediaPool } from './MediaPool'
import { TranscriptPanel } from '../TranscriptPanel'
import { useNarrow } from '../inspector/useNarrow'

const TABS: { value: LibraryTab; label: string; icon: ReactNode }[] = [
  { value: 'media', label: 'Media Pool', icon: <FolderOpen aria-hidden="true" className="size-3.5" /> },
  { value: 'effects', label: 'Effects', icon: <Sparkles aria-hidden="true" className="size-3.5" /> },
  { value: 'index', label: 'Index', icon: <ListTree aria-hidden="true" className="size-3.5" /> },
  { value: 'transcript', label: 'Transcript', icon: <ScrollText aria-hidden="true" className="size-3.5" /> }
]

export interface LibraryProps {
  /**
   * The small source monitor over the Media Pool's bin. On by default; pass false once the page
   * has a source viewer of its own (`MediaSourceViewer`), so the pool is all bin.
   */
  inlineSource?: boolean
}

/**
 * The Edit page's library slot, as Resolve's upper-left: tabs for the Media Pool, the Effects
 * Library, the Index (markers, comments, edits, visual search) and the Transcript, each with its
 * own title strip and ⋯ options. The tab lives in the store (`libraryTab`), so `setPanel` and the
 * agent's "open the transcript" land on it.
 */
export function Library({ inlineSource = true }: LibraryProps): ReactNode {
  const tab = useEditor((state) => state.libraryTab)
  const setTab = useEditor((state) => state.setLibraryTab)
  // Four icon-and-word tabs need ~380px; the slot defaults to 300. Below that the row is icons
  // (named in the tooltip) rather than "Media … Effe… In…" — each panel's title strip names it.
  const root = useRef<HTMLDivElement>(null)
  const narrow = useNarrow(root, 380)
  return (
    <div ref={root} className="flex h-full min-h-0 min-w-0 flex-col bg-surface-1">
      <Tabs<LibraryTab> label="Library" value={tab} items={TABS} onChange={setTab} iconsOnly={narrow} />
      <div className="min-h-0 flex-1">
        <ErrorBoundary key={tab} region={`the ${TABS.find((t) => t.value === tab)?.label ?? 'library'}`}>
          {tab === 'media' && <MediaPool variant="panel" inlineSource={inlineSource} />}
          {tab === 'effects' && <EffectsLibrary />}
          {tab === 'index' && <IndexPanel />}
          {tab === 'transcript' && <TranscriptPanel />}
        </ErrorBoundary>
      </div>
    </div>
  )
}
