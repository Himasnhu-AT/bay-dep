import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDownUp,
  ArrowRightToLine,
  AudioWaveform,
  Captions,
  Code2,
  FilmIcon,
  FolderPlus,
  FolderSearch,
  LayoutGrid,
  Link2,
  List,
  Pencil,
  Plus,
  Replace,
  ScrollText,
  Sparkles,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import type { Asset } from '@shared/project'
import { binOf, groupByBin } from '@shared/bins'
import {
  filterAssets,
  kindGroup,
  MEDIA_KIND_GROUPS,
  MEDIA_SORTS,
  sortAssets,
  mediaPoolAssets,
  usageCounts,
  type MediaKindFilter,
  type MediaSort
} from '@shared/media-library'
import {
  Button,
  ContextMenu,
  EmptyState,
  IconButton,
  InlineAlert,
  Menu,
  Modal,
  ScrollArea,
  SearchField,
  Select,
  ToolButton,
  useFloatingTrigger,
  type MenuEntry
} from '@/components'

import { call } from '@/lib/bay'
import { cn } from '@/lib/cn'
import { shortcutOf } from '@/lib/commands'
import {
  detectBeatsFor,
  endOfTimeline,
  exportCaptions,
  hasCaptions,
  importMediaDialog,
  importCaptionsDialog,
  locateAndRelink,
  placeAssetRange
} from '@/lib/mediaActions'
import { requestFocus } from '@/lib/focusRequest'
import { revealItem } from '@/lib/revealItem'
import { useFileStatus } from '@/lib/useFileStatus'
import { editAsset } from '@/mcp/assets'
import { selectTimeline, useEditor } from '@/store/editor'
import { AssetTile } from '../AssetTile'
import { CodeEditorModal, createMotionGraphic } from '../CodeEditorModal'
import { SourceViewer } from '../SourceViewer'
import { assetActions, type AssetAction, type AssetActionId } from './assetActions'
import { AssetDetails } from './AssetDetails'
import { BinSection, newBinName } from './BinSection'
import { ImportUrlDialog } from './ImportUrlDialog'
import { LibraryHeader } from './LibraryHeader'
import { onLibraryRequest, requestLibrary, takeLibraryRequest, useMediaSelection } from './librarySignals'

type View = 'grid' | 'list'
const VIEW_KEY = 'bay.media.view'
const SORT_KEY = 'bay.media.sort'

/** A per-viewer preference; a storage that throws (private window) just means the default. */
function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Still applies for this session.
  }
}

/** A question the pool needs answered before it goes on: a relink that looks wrong, a removal. */
interface Ask {
  title: string
  body: string
  confirm: string
  danger?: boolean
  resolve(yes: boolean): void
}

const ACTION_ICON: Record<AssetActionId, LucideIcon> = {
  place: Plus,
  append: ArrowRightToLine,
  transcribe: ScrollText,
  beats: AudioWaveform,
  subtitles: Captions,
  reveal: FolderSearch,
  rename: Pencil,
  relink: Replace,
  code: Code2,
  remove: Trash2
}

export interface MediaPoolProps {
  /**
   * `panel` is the Edit page's library slot (a narrow column, with a small source monitor over
   * the bin); `browser` is the Media page's pool (large cards and a details column, with the
   * source viewer mounted beside it by the workspace).
   */
  variant?: 'panel' | 'browser'
  /** The small source monitor inside the pool. Default: on in `panel`, off in `browser`. */
  inlineSource?: boolean
  title?: string
}

/**
 * The media pool: everything imported into the project, searchable, filterable by kind, sorted and
 * shown as cards or rows, under a toolbar of labelled buttons for every way media comes in (files,
 * a web address, captions, a new motion graphic). Selecting an asset opens it in the source viewer
 * and shows its action bar — every item of its right-click menu as a visible button. Nothing about
 * browsing edits the timeline.
 */
export function MediaPool({ variant = 'panel', inlineSource, title = 'Media Pool' }: MediaPoolProps): ReactNode {
  const projectAssets = useEditor((state) => state.project.assets)
  const timelines = useEditor((state) => state.project.timelines)
  const uses = useMemo(() => usageCounts({ timelines }), [timelines])
  // Placed caption lines are not media; they live on their Captions track (`mediaPoolAssets`).
  const assets = useMemo(() => mediaPoolAssets(projectAssets, uses), [projectAssets, uses])
  const captionLines = projectAssets.length - assets.length

  const notify = useEditor((state) => state.notify)

  const selectedId = useMediaSelection((state) => state.assetId)
  const focusToken = useMediaSelection((state) => state.focusToken)
  const startUs = useMediaSelection((state) => state.atUs)
  const select = useMediaSelection((state) => state.select)

  const browser = variant === 'browser'
  const showSource = inlineSource ?? !browser

  const [importing, setImporting] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<MediaKindFilter>('all')
  const [sort, setSort] = useState<MediaSort>(() => remembered(SORT_KEY, MEDIA_SORTS.map((s) => s.id), 'added'))
  const [view, setView] = useState<View>(() => remembered(VIEW_KEY, ['grid', 'list'] as const, 'grid'))
  const [menu, setMenu] = useState<{ assetId: string; at: { x: number; y: number } } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [busy, setBusy] = useState<ReadonlyMap<string, string>>(new Map())
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  // Bins (`@shared/bins`): the project's folders, and the one whose name is being typed.
  const bins = useEditor((state) => state.project.bins)
  const [renamingBin, setRenamingBin] = useState<string | null>(null)

  const files = useFileStatus(assets)
  const shown = useMemo(() => sortAssets(filterAssets(assets, { query, kind }), sort), [assets, query, kind, sort])
  const missingAssets = useMemo(() => assets.filter((asset) => files.missing.has(asset.id)), [assets, files.missing])
  const selected = assets.find((asset) => asset.id === selectedId)
  const sortMenu = useFloatingTrigger()

  // "Import URL" asked for from elsewhere (a command, the empty timeline) opens the form here.
  useEffect(() => {
    if (takeLibraryRequest('import-url')) setUrlOpen(true)
    return onLibraryRequest((request) => {
      if (request === 'import-url' && takeLibraryRequest('import-url')) setUrlOpen(true)
    })
  }, [])

  const confirm = (question: Omit<Ask, 'resolve'>): Promise<boolean> =>
    new Promise((resolve) => setAsk({ ...question, resolve }))

  const setBusyFor = (assetId: string, words: string | null): void =>
    setBusy((current) => {
      const next = new Map(current)
      if (words) next.set(assetId, words)
      else next.delete(assetId)
      return next
    })

  const runImport = async (): Promise<void> => {
    setImporting(true)
    try {
      await importMediaDialog()
    } finally {
      setImporting(false)
    }
  }

  const newMotionGraphic = (): void =>
    void createMotionGraphic().then((assetId) => {
      if (!assetId) return
      select(assetId)
      setEditingCode(assetId)
    })

  const place = (asset: Asset, where: 'playhead' | 'end' = 'playhead'): void => {
    const placed = placeAssetRange(asset, where === 'end' ? { atFrame: endOfTimeline() } : {})
    if (placed) revealItem(placed)
  }

  /** The first clip placing an asset on the active timeline, selected, so a panel can act on it. */
  const selectFirstUse = (asset: Asset): boolean => {
    const timeline = selectTimeline(useEditor.getState())
    const first = timeline?.tracks.flatMap((track) => track.items).find((item) => item.assetId === asset.id)
    if (!first) return false
    revealItem(first.id)
    return true
  }

  const relink = async (asset: Asset): Promise<void> => {
    await locateAndRelink(asset, missingAssets, (body) => confirm({ title: 'Use this file?', body, confirm: 'Use it' }))
    files.refresh()
  }

  const remove = async (asset: Asset): Promise<void> => {
    const count = uses.get(asset.id) ?? 0
    if (count > 0) {
      const yes = await confirm({
        title: `Remove “${asset.name}”?`,
        body:
          `It is used by ${count} clip${count === 1 ? '' : 's'} on the timeline, and ` +
          `${count === 1 ? 'that clip goes' : 'those clips go'} with it. ⌘Z brings everything back.`,
        confirm: count === 1 ? 'Remove it and its clip' : `Remove it and ${count} clips`,
        danger: true
      })
      if (!yes) return
    }
    useEditor.getState().removeAsset(asset.id)
    if (useMediaSelection.getState().assetId === asset.id) select(null)
    notify(`Removed ${asset.name} from the project. ⌘Z to undo.`)
  }

  const rename = (asset: Asset, name: string | null): void => {
    setRenamingId(null)
    if (name === null || name.trim() === asset.name) return
    try {
      // `edit_asset`'s own function, so a rename here and one by the agent are one behaviour.
      editAsset({ assetId: asset.id, name })
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const run = (asset: Asset, id: AssetActionId): void => {
    switch (id) {
      case 'place':
        return place(asset)
      case 'append':
        return place(asset, 'end')
      case 'transcribe':
        // The Transcript tab scopes itself to the selected clips, so selecting the first use is
        // what points it at this asset; its Transcribe button is then the next click.
        if (selectFirstUse(asset)) useEditor.getState().setPanel('transcript')
        return
      case 'beats':
        setBusyFor(asset.id, 'Detecting beats…')
        void detectBeatsFor(asset).finally(() => setBusyFor(asset.id, null))
        return
      case 'subtitles':
        if (!selectFirstUse(asset)) return
        useEditor.getState().setPanel('transcript')
        // The Transcript tab opens on its Subtitles view and focus goes there, not to the page.
        requestLibrary('subtitles')
        requestFocus('subtitles')
        return
      case 'reveal':
        if (asset.path) void call('Reveal in Finder', (api) => api.media.revealInFolder(asset.path as string))
        return
      case 'rename':
        setRenamingId(asset.id)
        return
      case 'relink':
        void relink(asset)
        return
      case 'code':
        setEditingCode(asset.id)
        return
      case 'remove':
        void remove(asset)
        return
    }
  }

  const actionsFor = (asset: Asset): AssetAction[] =>
    assetActions(asset, { missing: files.missing.has(asset.id), uses: uses.get(asset.id) ?? 0, busy: busy.has(asset.id) })

  const menuFor = (asset: Asset): MenuEntry[] => {
    const entries: MenuEntry[] = []
    let group: string | null = null
    for (const action of actionsFor(asset)) {
      if (group !== null && action.group !== group) entries.push({ kind: 'separator' })
      group = action.group
      entries.push({
        label: action.menuLabel,
        disabled: action.disabled,
        ...(action.danger ? { danger: true } : {}),
        ...(action.shortcut ? { shortcut: action.shortcut } : {}),
        onSelect: () => run(asset, action.id)
      })
    }
    return entries
  }

  const newBin = (): void => {
    const made = useEditor.getState().createBin(newBinName(bins ?? []))
    if ('error' in made) notify(made.error, 'error')
    else setRenamingBin(made.bin.id)
  }

  /** Where an asset can be filed, as rows of its menu: the keyboard's way to what a drag does. */
  const binMenuFor = (asset: Asset): MenuEntry[] => {
    const move = (binId: string | null): void => {
      const result = useEditor.getState().moveAssetsToBin([asset.id], binId)
      if ('error' in result) notify(result.error, 'error')
    }
    const current = binOf({ bins }, asset)
    return [
      { kind: 'separator' },
      { kind: 'label', label: 'Bin' },
      ...(bins ?? []).map((bin) => ({ label: bin.name, checked: current?.id === bin.id, onSelect: () => move(bin.id) })),
      ...(bins && bins.length > 0 ? [{ label: 'Not in a bin', checked: current === null, onSelect: () => move(null) }] : []),
      {
        label: 'New Bin with This…',
        onSelect: () => {
          const state = useEditor.getState()
          // One undo step: the bin and the asset going into it.
          let made: ReturnType<typeof state.createBin> | null = null
          state.transact(() => {
            made = state.createBin(newBinName(bins ?? []))
            if (made && 'bin' in made) state.moveAssetsToBin([asset.id], made.bin.id)
          })
          const result = made as ReturnType<typeof state.createBin> | null
          if (result && 'error' in result) notify(result.error, 'error')
          else if (result) setRenamingBin(result.bin.id)
        }
      }
    ]
  }

  const menuAsset = menu ? assets.find((asset) => asset.id === menu.assetId) : undefined
  const counts = useMemo(() => {
    const byGroup = new Map<string, number>()
    for (const asset of assets) byGroup.set(kindGroup(asset.kind), (byGroup.get(kindGroup(asset.kind)) ?? 0) + 1)
    return byGroup
  }, [assets])
  const filtered = query.trim() !== '' || kind !== 'all'
  const captionsExist = hasCaptions()

  const optionsMenu: MenuEntry[] = [
    { label: 'Import Captions (SRT, VTT)…', onSelect: () => void importCaptionsDialog() },
    {
      label: captionsExist ? 'Export Captions as SRT…' : 'Export Captions as SRT… (no captions yet)',
      disabled: !captionsExist,
      onSelect: () => void exportCaptions()
    },
    { kind: 'separator' },
    { kind: 'label', label: 'Sort by' },
    ...MEDIA_SORTS.map((option) => ({
      label: option.label,
      checked: option.id === sort,
      onSelect: () => chooseSort(option.id)
    })),
    ...(missingAssets.length > 0
      ? ([
          { kind: 'separator' },
          {
            label: `Locate ${missingAssets.length} Missing File${missingAssets.length === 1 ? '' : 's'}…`,
            onSelect: () => void relink(missingAssets[0]!)
          }
        ] satisfies MenuEntry[])
      : [])
  ]

  function chooseSort(next: MediaSort): void {
    setSort(next)
    remember(SORT_KEY, next)
  }
  const chooseView = (next: View): void => {
    setView(next)
    remember(VIEW_KEY, next)
  }

  const toolbar = (
    <div
      role="toolbar"
      aria-label={`${title} tools`}
      className="flex shrink-0 flex-wrap items-center gap-x-0.5 gap-y-0.5 border-b border-line bg-chrome px-1.5 py-1"
    >
      <ToolButton
        label="Import"
        icon={<Plus className="size-3.5" />}
        shortcut={shortcutOf('file.import')}
        disabled={importing}
        onClick={() => void runImport()}
      />
      <ToolButton label="Import URL" icon={<Link2 className="size-3.5" />} onClick={() => setUrlOpen(true)} />
      <ToolButton label="Captions" icon={<Captions className="size-3.5" />} onClick={() => void importCaptionsDialog()} />
      <ToolButton label="Motion Graphic" icon={<Sparkles className="size-3.5" />} onClick={newMotionGraphic} />
      <ToolButton label="New Bin" icon={<FolderPlus className="size-3.5" />} onClick={newBin} />
    </div>
  )

  const filters = (
    <div className={cn('flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5', !browser && 'flex-wrap')}>
      <SearchField
        label="Search media"
        placeholder="Search media…"
        value={query}
        onValueChange={setQuery}
        className={browser ? 'w-64' : 'min-w-0 basis-full'}
      />
      <Select
        label="Show"
        value={kind as string}
        onChange={(value) => setKind(value as MediaKindFilter)}
        className="min-w-0 flex-1"
        options={[
          { value: 'all', label: `All kinds (${assets.length})` },
          ...MEDIA_KIND_GROUPS.filter((group) => counts.has(group.id) || kind === group.id).map((group) => ({
            value: group.id,
            label: `${group.label} (${counts.get(group.id) ?? 0})`
          }))
        ]}
      />
      <ToolButton
        {...sortMenu.triggerProps}
        label="Sort"
        showLabel={browser}
        icon={<ArrowDownUp className="size-3.5" />}
        title={`Sort: ${MEDIA_SORTS.find((s) => s.id === sort)?.label ?? ''}`}
      />
      <Menu
        {...sortMenu.surfaceProps}
        label="Sort media"
        align="end"
        items={[
          { kind: 'label', label: 'Sort by' },
          ...MEDIA_SORTS.map((option) => ({ label: option.label, checked: option.id === sort, onSelect: () => chooseSort(option.id) }))
        ]}
      />
      <div role="group" aria-label="View" className="flex shrink-0 items-center rounded-sm bg-surface-2 p-0.5">
        <IconButton
          label="Show as grid"
          size="xs"
          aria-pressed={view === 'grid'}
          className={cn(view === 'grid' && 'bg-surface-4 text-ink-0')}
          icon={<LayoutGrid className="size-3" />}
          onClick={() => chooseView('grid')}
        />
        <IconButton
          label="Show as list"
          size="xs"
          aria-pressed={view === 'list'}
          className={cn(view === 'list' && 'bg-surface-4 text-ink-0')}
          icon={<List className="size-3" />}
          onClick={() => chooseView('list')}
        />
      </div>
    </div>
  )

  const tiles = (list: readonly Asset[]): ReactNode => (
    <div
      className={
        view === 'grid'
          ? cn('grid gap-2', browser ? 'grid-cols-[repeat(auto-fill,minmax(168px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(112px,1fr))]')
          : 'flex flex-col gap-px'
      }
    >
      {list.map((asset) => (
        <AssetTile
          key={asset.id}
          asset={asset}
          view={view}
          selected={asset.id === selectedId}
          missing={files.missing.has(asset.id)}
          uses={uses.get(asset.id) ?? 0}
          bytes={files.sizes.get(asset.id)}
          busy={busy.get(asset.id)}
          renaming={asset.id === renamingId}
          onSelect={(open) => select(asset.id, open)}
          onPlace={() => place(asset)}
          onMenu={(at) => setMenu({ assetId: asset.id, at })}
          onRename={(name) => rename(asset, name)}
        />
      ))}
    </div>
  )

  const hasBins = (bins?.length ?? 0) > 0
  const bin = (
    <ScrollArea className="min-h-0 flex-1 p-2.5">
      {hasBins ? (
        // With bins the pool is sections: each bin in the order it was made, then what is in none.
        <div className="flex flex-col gap-2">
          {groupByBin({ bins }, shown).map((group) => (
            <BinSection
              key={group.bin?.id ?? 'top'}
              bin={group.bin}
              count={group.assets.length}
              renaming={group.bin !== null && group.bin.id === renamingBin}
              onRename={() => setRenamingBin(group.bin?.id ?? null)}
              onRenamed={() => setRenamingBin(null)}
              emptyHint={filtered ? 'Nothing in this bin matches.' : 'Empty. Drag media here, or use an asset’s menu.'}
            >
              {tiles(group.assets)}
            </BinSection>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-[12px] text-ink-2">{query.trim() ? `No media matches “${query.trim()}”.` : 'No media of this kind.'}</p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => {
              setQuery('')
              setKind('all')
            }}
          >
            Show all media
          </Button>
        </div>
      ) : (
        tiles(shown)
      )}
      {(filtered || captionLines > 0) && (
        <p className="mt-3 text-[10px] leading-relaxed text-ink-2">
          {filtered ? `Showing ${shown.length} of ${assets.length}. ` : ''}
          {captionLines > 0
            ? `${captionLines} caption line${captionLines === 1 ? ' is' : 's are'} on the timeline's Captions track, not here.`
            : ''}
        </p>
      )}
    </ScrollArea>
  )

  const actionBar = (asset: Asset, layout: 'bar' | 'column'): ReactNode => (
    <ActionBar
      asset={asset}
      actions={actionsFor(asset)}
      layout={layout}
      onRun={(id) => run(asset, id)}
      onClose={() => select(null)}
    />
  )

  return (
    <section aria-label={title} className="flex h-full min-h-0 min-w-0 flex-col bg-surface-1">
      <LibraryHeader
        title={title}
        count={assets.length > 0 ? String(assets.length) : undefined}
        menu={optionsMenu}
        menuLabel="More media actions"
      />
      {toolbar}

      {assets.length === 0 ? (
        <EmptyState
          icon={<FilmIcon aria-hidden="true" className="size-6" />}
          title="No media yet"
          hint="Import video, audio, images or captions, bring one in from a web address, or drop files anywhere on the window."
          action={
            <Button variant="subtle" onClick={() => void runImport()} disabled={importing}>
              {importing ? 'Importing…' : 'Import media'}
            </Button>
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {showSource && selected && (
              <SourceViewer asset={selected} focusToken={focusToken} startUs={startUs} onClose={() => select(null)} />
            )}
            {filters}
            {missingAssets.length > 0 && (
              <div className="border-b border-line px-3 py-2">
                <InlineAlert tone="warning">
                  <span className="block">
                    {missingAssets.length === 1
                      ? `“${missingAssets[0]!.name}” is missing from where it was imported.`
                      : `${missingAssets.length} files are missing from where they were imported.`}
                  </span>
                  <Button size="sm" variant="subtle" className="mt-1.5" onClick={() => void relink(missingAssets[0]!)}>
                    {missingAssets.length === 1 ? 'Locate…' : `Locate “${missingAssets[0]!.name}”…`}
                  </Button>
                </InlineAlert>
              </div>
            )}
            {bin}
            {!browser && selected && actionBar(selected, 'bar')}
          </div>
          {browser && (
            <aside aria-label="Details" className="flex w-64 shrink-0 flex-col border-l border-line bg-surface-1">
              {selected ? (
                <AssetDetails
                  asset={selected}
                  bytes={files.sizes.get(selected.id)}
                  uses={uses.get(selected.id) ?? 0}
                  missing={files.missing.has(selected.id)}
                  actions={actionBar(selected, 'column')}
                />
              ) : (
                <p className="px-3 py-4 text-[11px] leading-relaxed text-ink-2">
                  Select a clip to see its details and what can be done with it.
                </p>
              )}
            </aside>
          )}
        </div>
      )}

      <ContextMenu
        at={menu && menuAsset ? menu.at : null}
        label={menuAsset ? `${menuAsset.name} actions` : 'Asset actions'}
        items={menuAsset ? [...menuFor(menuAsset), ...binMenuFor(menuAsset)] : []}
        onClose={() => setMenu(null)}
      />

      <CodeEditorModal assetId={editingCode} open={editingCode !== null} onClose={() => setEditingCode(null)} />
      <ImportUrlDialog open={urlOpen} onClose={() => setUrlOpen(false)} onImported={(assetId) => select(assetId)} />

      <Modal
        open={ask !== null}
        title={ask?.title ?? ''}
        width={380}
        onClose={() => {
          ask?.resolve(false)
          setAsk(null)
        }}
        footer={
          <>
            <Button
              variant="subtle"
              onClick={() => {
                ask?.resolve(false)
                setAsk(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant={ask?.danger ? 'danger' : 'primary'}
              onClick={() => {
                ask?.resolve(true)
                setAsk(null)
              }}
            >
              {ask?.confirm}
            </Button>
          </>
        }
      >
        <p className="px-4 py-3 text-[12px] leading-relaxed text-pretty text-ink-1">{ask?.body}</p>
      </Modal>
    </section>
  )
}

/**
 * The selected asset's actions as labelled buttons: a strip under the bin in the Edit page's pool,
 * a column in the Media page's details. The same list as its right-click menu (`assetActions`).
 */
function ActionBar({
  asset,
  actions,
  layout,
  onRun,
  onClose
}: {
  asset: Asset
  actions: readonly AssetAction[]
  layout: 'bar' | 'column'
  onRun(id: AssetActionId): void
  onClose(): void
}): ReactNode {
  const button = (action: AssetAction): ReactNode => {
    const Icon = ACTION_ICON[action.id]
    return (
      <ToolButton
        key={action.id}
        label={action.label}
        icon={<Icon className="size-3.5" />}
        tooltipSide="top"
        disabled={action.disabled}
        title={action.disabled ? action.hint : undefined}
        className={cn(
          action.danger && 'text-danger hover:bg-danger/12 hover:text-danger',
          action.id === 'place' && !action.disabled && 'bg-accent/14 text-ink-0 hover:bg-accent/22',
          layout === 'column' && 'justify-start'
        )}
        onClick={() => onRun(action.id)}
      />
    )
  }
  if (layout === 'column') {
    return (
      <div role="toolbar" aria-label={`${asset.name} actions`} aria-orientation="vertical" className="flex flex-col gap-0.5">
        {actions.map(button)}
      </div>
    )
  }
  return (
    <div role="toolbar" aria-label={`${asset.name} actions`} className="shrink-0 border-t border-line bg-chrome px-1.5 pt-1 pb-1.5">
      <div className="flex items-center gap-1 px-1 pb-0.5">
        <p className="min-w-0 flex-1 truncate text-[10px] font-medium tracking-wide text-ink-2 uppercase" title={asset.name}>
          {asset.name}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="t-fast rounded-xs text-[10px] text-ink-2 hover:text-ink-0 focus-visible:outline-accent"
        >
          Deselect
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-0.5">{actions.map(button)}</div>
    </div>
  )
}
