import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder, MoreHorizontal } from 'lucide-react'
import { create } from 'zustand'
import type { Bin } from '@shared/project'
import { IconButton, Menu, useFloatingTrigger, type MenuEntry } from '@/components'
import { cn } from '@/lib/cn'
import { useEditor } from '@/store/editor'
import { remember, remembered } from '@/store/prefs'
import { ASSET_DRAG_TYPE } from '../AssetTile'

/**
 * Which bins are folded shut. Per machine, not in the project: folding a bin is looking, not
 * editing — it must not mark the document unsaved or sit in the undo history between two cuts.
 * The key is a compatibility surface (a later build reads it); the value is a JSON list of ids,
 * and ids of bins that no longer exist are harmless.
 */
export const COLLAPSED_BINS_KEY = 'bay.media.collapsedBins'

function readCollapsed(): string[] {
  try {
    const parsed: unknown = JSON.parse(remembered(COLLAPSED_BINS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export const useCollapsedBins = create<{ collapsed: string[]; toggle(binId: string): void }>((set, get) => ({
  collapsed: readCollapsed(),
  toggle(binId) {
    const now = get().collapsed
    const next = now.includes(binId) ? now.filter((id) => id !== binId) : [...now, binId]
    remember(COLLAPSED_BINS_KEY, next.length > 0 ? JSON.stringify(next) : null)
    set({ collapsed: next })
  }
}))

/** A name for a new bin that no bin has: "New Bin", "New Bin 2", … */
export function newBinName(bins: readonly Bin[]): string {
  const taken = new Set(bins.map((bin) => bin.name.toLowerCase()))
  if (!taken.has('new bin')) return 'New Bin'
  let n = 2
  while (taken.has(`new bin ${n}`)) n += 1
  return `New Bin ${n}`
}

export interface BinSectionProps {
  /** Null is the top of the pool, listed last under "Not in a bin" once any bin exists. */
  bin: Bin | null
  /** How many assets are listed in it, after the pool's search and kind filter. */
  count: number
  /** True right after it was made, so the name is being typed. */
  renaming: boolean
  onRenamed(): void
  onRename(): void
  /** What an open bin with nothing listed says: it is empty, or the search hid what is in it. */
  emptyHint: string
  children: ReactNode
}

/**
 * One bin in the Media Pool: a header that folds it, takes a dropped asset and carries its menu,
 * over the assets in it. Dropping an asset on the header (or anywhere in the section) files it
 * there; dropping on "Not in a bin" takes it out. The asset's own right-click menu has the same
 * moves for the keyboard, and for fonts and LUTs, which cannot be dragged.
 */
export function BinSection({ bin, count, renaming, onRenamed, onRename, emptyHint, children }: BinSectionProps): ReactNode {
  const collapsed = useCollapsedBins((state) => (bin ? state.collapsed.includes(bin.id) : false))
  const toggle = useCollapsedBins((state) => state.toggle)
  const notify = useEditor((state) => state.notify)
  const [over, setOver] = useState(false)
  const [draft, setDraft] = useState(bin?.name ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const more = useFloatingTrigger('menu')
  const name = bin?.name ?? 'Not in a bin'

  useEffect(() => {
    if (!renaming) return
    setDraft(bin?.name ?? '')
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [renaming, bin?.name])

  const finishRename = (save: boolean): void => {
    onRenamed()
    const trimmed = draft.trim()
    if (!save || !bin || trimmed === '' || trimmed === bin.name) return
    const result = useEditor.getState().renameBin(bin.id, trimmed)
    if ('error' in result) notify(result.error, 'error')
  }

  const carriesAsset = (event: DragEvent): boolean => event.dataTransfer.types.includes(ASSET_DRAG_TYPE)
  const onDragOver = (event: DragEvent): void => {
    if (!carriesAsset(event)) return
    event.preventDefault()
    // The tile offers `copy` (it is also what the timeline takes); filing is a move, but the
    // effect has to be one the source allows or the drop is refused before it reaches here.
    event.dataTransfer.dropEffect = 'copy'
    if (!over) setOver(true)
  }
  const onDrop = (event: DragEvent): void => {
    if (!carriesAsset(event)) return
    event.preventDefault()
    setOver(false)
    const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE)
    if (!assetId) return
    const result = useEditor.getState().moveAssetsToBin([assetId], bin?.id ?? null)
    if ('error' in result) notify(result.error, 'error')
  }

  const items: MenuEntry[] = bin
    ? [
        { label: 'Rename…', onSelect: onRename },
        { kind: 'separator' },
        {
          label: count === 0 ? 'Remove Bin' : 'Remove Bin — keeps its media',
          danger: true,
          onSelect: () => {
            const result = useEditor.getState().removeBin(bin.id)
            if ('error' in result) notify(result.error, 'error')
            else notify(`Removed the bin “${result.removed.name}”. Its media is still in the pool. ⌘Z to undo.`)
          }
        }
      ]
    : []

  return (
    <section
      aria-label={bin ? `Bin ${name}` : name}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={onDrop}
      className={cn('rounded-sm', over && 'bg-accent/8 outline-1 outline-accent')}
    >
      <div className="relative flex h-6 items-center gap-1">
        {bin ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Open' : 'Close'} bin ${name}`}
            onClick={() => toggle(bin.id)}
            className="t-fast flex min-w-0 flex-1 items-center gap-1 rounded-xs px-0.5 text-left text-[11px] font-medium text-ink-1 hover:text-ink-0 focus-visible:outline-accent"
          >
            {collapsed ? <ChevronRight aria-hidden="true" className="size-3 shrink-0" /> : <ChevronDown aria-hidden="true" className="size-3 shrink-0" />}
            <Folder aria-hidden="true" className="size-3 shrink-0 text-ink-2" />
            {renaming ? null : <span className="min-w-0 truncate">{name}</span>}
            {renaming ? null : <span className="shrink-0 text-[10px] font-normal text-ink-2 tabular-nums">{count}</span>}
          </button>
        ) : (
          <p className="min-w-0 flex-1 truncate px-0.5 text-[11px] font-medium text-ink-2">
            {name} <span className="text-[10px] font-normal tabular-nums">{count}</span>
          </p>
        )}
        {bin && renaming && (
          <input
            ref={inputRef}
            value={draft}
            aria-label={`Rename bin ${name}`}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => finishRename(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') finishRename(true)
              if (event.key === 'Escape') finishRename(false)
              event.stopPropagation()
            }}
            className="absolute right-8 left-9 h-5 min-w-0 rounded-xs border border-accent/70 bg-surface-2 px-1 text-[11px] text-ink-0 outline-none"
          />
        )}
        {bin && (
          <IconButton {...more.triggerProps} size="xs" label={`${name} options`} icon={<MoreHorizontal className="size-3" />} className="shrink-0" />
        )}
      </div>
      {!collapsed && (count > 0 ? children : bin ? <p className="px-1 pb-1.5 text-[10px] text-ink-2">{emptyHint}</p> : null)}
      {bin && <Menu {...more.surfaceProps} items={items} label={`${name} bin`} align="end" />}
    </section>
  )
}
