import type { ReactNode } from 'react'
import { MonitorPlay } from 'lucide-react'
import { EmptyState } from '@/components'
import { useEditor } from '@/store/editor'
import { SourceViewer } from '../SourceViewer'
import { MediaPool } from './MediaPool'
import { useMediaSelection } from './librarySignals'

/**
 * The Media page's pool: large cards (or rows), the same toolbar as the Edit page's pool, and a
 * details column for the selected asset with its actions. It has no source monitor of its own —
 * the page shows `MediaSourceViewer` beside it, which follows the same selection.
 */
export function MediaBrowser(): ReactNode {
  return <MediaPool variant="browser" />
}

/**
 * The source viewer as a region of its own: whatever asset is selected in either pool, large, with
 * its marks and Insert / Overwrite / Append. An empty state until something is selected.
 */
export function MediaSourceViewer(): ReactNode {
  const assetId = useMediaSelection((state) => state.assetId)
  const focusToken = useMediaSelection((state) => state.focusToken)
  const startUs = useMediaSelection((state) => state.atUs)
  const select = useMediaSelection((state) => state.select)
  const asset = useEditor((state) => (assetId ? state.project.assets.find((a) => a.id === assetId) : undefined))
  if (!asset) {
    return (
      <section aria-label="Source" className="flex h-full min-h-0 flex-col bg-surface-1">
        <header className="flex h-8 shrink-0 items-center border-b border-line bg-chrome-raised px-3">
          <h2 className="text-[12px] font-semibold text-ink-0">Source</h2>
        </header>
        <EmptyState
          icon={<MonitorPlay aria-hidden="true" className="size-6" />}
          title="No clip open"
          hint="Click a clip in the media pool to play it here, mark the part you want, and insert it into the timeline."
        />
      </section>
    )
  }
  return <SourceViewer asset={asset} focusToken={focusToken} startUs={startUs} variant="large" onClose={() => select(null)} />
}
