import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDownUp, FilmIcon, LayoutGrid, List, MoreHorizontal, Plus } from 'lucide-react'
import type { Asset } from '@shared/project'
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
import { canRelink } from '@shared/relink'
import {
  Button,
  ContextMenu,
  EmptyState,
  IconButton,
  InlineAlert,
  Menu,
  Modal,
  Panel,
  ScrollArea,
  SearchField,
  Select,
  useFloatingTrigger,
  type MenuEntry
} from '@/components'
import { completeBrfImports } from '@/lib/brfImport'
import { call, importMessage } from '@/lib/bay'
import { shortcutOf } from '@/lib/commands'
import {
  detectBeatsFor,
  endOfTimeline,
  exportCaptions,
  hasCaptions,
  importCaptionsDialog,
  locateAndRelink,
  placeAssetRange
} from '@/lib/mediaActions'
import { requestFocus } from '@/lib/focusRequest'
import { revealItem } from '@/lib/revealItem'
import { useFileStatus } from '@/lib/useFileStatus'
import { editAsset } from '@/mcp/assets'
import { selectTimeline, useEditor } from '@/store/editor'
import { AssetTile, placeable } from './AssetTile'
import { CodeEditorModal, createMotionGraphic } from './CodeEditorModal'
import { SourceViewer } from './SourceViewer'

export { ASSET_DRAG_TYPE } from './AssetTile'

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

/** A question the panel needs answered before it goes on: a relink that looks wrong, a removal. */
interface Ask {
  title: string
  body: string
  confirm: string
  danger?: boolean
  resolve(yes: boolean): void
}

/**
 * The media pool: everything imported into the project, searchable, filterable by kind, sorted
 * and shown as cards or rows. Selecting an asset opens it in a small source monitor; nothing
 * about browsing edits the timeline. Each asset's menu holds what can be done to it — place,
 * rename, reveal, relink, detect beats, transcribe, edit its code, remove.
 */
export function MediaPanel(): ReactNode {
  const projectAssets = useEditor((state) => state.project.assets)
  const timelines = useEditor((state) => state.project.timelines)
  const uses = useMemo(() => usageCounts({ timelines }), [timelines])
  // Placed caption lines are not media; they live on their Captions track (`mediaPoolAssets`).
  const assets = useMemo(() => mediaPoolAssets(projectAssets, uses), [projectAssets, uses])
  const captionLines = projectAssets.length - assets.length
  const addAssets = useEditor((state) => state.addAssets)
  const notify = useEditor((state) => state.notify)

  const [importing, setImporting] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<MediaKindFilter>('all')
  const [sort, setSort] = useState<MediaSort>(() => remembered(SORT_KEY, MEDIA_SORTS.map((s) => s.id), 'added'))
  const [view, setView] = useState<View>(() => remembered(VIEW_KEY, ['grid', 'list'] as const, 'grid'))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Bumped when a click opens an asset, so the source viewer takes focus and I/O mark the source.
  const [sourceFocus, setSourceFocus] = useState(0)
  const [menu, setMenu] = useState<{ assetId: string; at: { x: number; y: number } } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [busy, setBusy] = useState<ReadonlyMap<string, string>>(new Map())
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)

  const files = useFileStatus(assets)
  const shown = useMemo(() => sortAssets(filterAssets(assets, { query, kind }), sort), [assets, query, kind, sort])
  const missingAssets = useMemo(() => assets.filter((asset) => files.missing.has(asset.id)), [assets, files.missing])
  const selected = assets.find((asset) => asset.id === selectedId)
  const moreMenu = useFloatingTrigger()
  const sortMenu = useFloatingTrigger()

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
    const picked = await call('Import', (api) => api.media.importDialog())
    // Null is a failure, which `call` has already reported; an empty array is the user
    // dismissing the picker, which needs no comment at all.
    if (!picked || picked.length === 0) {
      setImporting(false)
      return
    }
    const imported = await completeBrfImports(picked)
    setImporting(false)
    addAssets(imported.map((entry) => entry.asset))
    const message = importMessage(imported)
    notify(message.text, message.kind)
  }

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
    await locateAndRelink(asset, missingAssets, (body) =>
      confirm({ title: 'Use this file?', body, confirm: 'Use it' })
    )
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
    if (selectedId === asset.id) setSelectedId(null)
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

  const menuFor = (asset: Asset): MenuEntry[] => {
    const missing = files.missing.has(asset.id)
    const used = (uses.get(asset.id) ?? 0) > 0
    const audible = asset.hasAudio && asset.path !== null && (asset.kind === 'video' || asset.kind === 'audio')
    const hasCode = (asset.kind === 'brf' && asset.brfCode !== undefined) || (asset.kind === 'html' && asset.path !== null)
    const entries: MenuEntry[] = []
    if (placeable(asset)) {
      entries.push(
        // A clip of a missing file places a picture of nothing; say what to do first, the way
        // Transcript… says "(place it first)".
        missing
          ? { label: 'Add at Playhead (locate the file first)', disabled: true, onSelect: () => undefined }
          : { label: 'Add at Playhead', shortcut: 'Enter', onSelect: () => place(asset) },
        missing
          ? { label: 'Append to End (locate the file first)', disabled: true, onSelect: () => undefined }
          : { label: 'Append to End', onSelect: () => place(asset, 'end') },
        { kind: 'separator' }
      )
    }
    entries.push({ label: 'Rename', onSelect: () => setRenamingId(asset.id) })
    if (asset.path) {
      entries.push({
        label: 'Reveal in Finder',
        disabled: missing,
        onSelect: () => void call('Reveal in Finder', (api) => api.media.revealInFolder(asset.path as string))
      })
    }
    if (canRelink(asset)) {
      entries.push({ label: missing ? 'Locate Missing File…' : 'Replace File…', onSelect: () => void relink(asset) })
    }
    if (audible || hasCode) entries.push({ kind: 'separator' })
    if (audible) {
      entries.push(
        {
          label: asset.beats ? 'Detect Beats Again' : 'Detect Beats',
          disabled: missing || busy.has(asset.id),
          onSelect: () => {
            setBusyFor(asset.id, 'Detecting beats…')
            void detectBeatsFor(asset).finally(() => setBusyFor(asset.id, null))
          }
        },
        {
          label: used ? 'Transcript…' : 'Transcript… (place it first)',
          disabled: !used || missing,
          onSelect: () => {
            if (selectFirstUse(asset)) useEditor.getState().setPanel('transcript')
          }
        },
        {
          label: used ? 'Add Subtitles…' : 'Add Subtitles… (place it first)',
          disabled: !used || missing,
          onSelect: () => {
            if (!selectFirstUse(asset)) return
            useEditor.getState().setPanel('text')
            // The tile this menu closed over is unmounted by the switch; focus goes to the
            // Subtitles section instead of falling to the page.
            requestFocus('subtitles')
          }
        }
      )
    }
    if (hasCode) entries.push({ label: 'Edit Code…', onSelect: () => setEditingCode(asset.id) })
    entries.push(
      { kind: 'separator' },
      { label: used ? 'Remove from Project…' : 'Remove from Project', danger: true, onSelect: () => void remove(asset) }
    )
    return entries
  }

  const menuAsset = menu ? assets.find((asset) => asset.id === menu.assetId) : undefined
  const counts = useMemo(() => {
    const byGroup = new Map<string, number>()
    for (const asset of assets) byGroup.set(kindGroup(asset.kind), (byGroup.get(kindGroup(asset.kind)) ?? 0) + 1)
    return byGroup
  }, [assets])
  const filtered = query.trim() !== '' || kind !== 'all'
  const captionsExist = hasCaptions()

  return (
    <Panel
      title="Media"
      actions={
        <>
          <IconButton
            label="Import media"
            shortcut={shortcutOf('file.import')}
            icon={<Plus className="size-4" />}
            disabled={importing}
            onClick={() => void runImport()}
          />
          <IconButton {...moreMenu.triggerProps} label="More media actions" icon={<MoreHorizontal className="size-4" />} />
          <Menu
            {...moreMenu.surfaceProps}
            label="Media actions"
            align="end"
            items={[
              { label: 'Import Captions (SRT, VTT)…', onSelect: () => void importCaptionsDialog() },
              {
                label: captionsExist ? 'Export Captions as SRT…' : 'Export Captions as SRT… (no captions yet)',
                disabled: !captionsExist,
                onSelect: () => void exportCaptions()
              },
              { kind: 'separator' },
              {
                label: 'New Motion Graphic',
                onSelect: () =>
                  void createMotionGraphic().then((assetId) => {
                    if (!assetId) return
                    setSelectedId(assetId)
                    setEditingCode(assetId)
                  })
              },
              ...(missingAssets.length > 0
                ? ([
                    { kind: 'separator' },
                    {
                      label: `Locate ${missingAssets.length} Missing File${missingAssets.length === 1 ? '' : 's'}…`,
                      onSelect: () => void relink(missingAssets[0]!)
                    }
                  ] satisfies MenuEntry[])
                : [])
            ]}
          />
        </>
      }
      className="h-full"
      bodyClassName="flex flex-col"
    >
      {assets.length === 0 ? (
        <EmptyState
          icon={<FilmIcon aria-hidden="true" className="size-6" />}
          title="No media yet"
          hint="Import video, audio, images or captions — or drop files anywhere on the window."
          action={
            <Button variant="subtle" onClick={() => void runImport()} disabled={importing}>
              {importing ? 'Importing…' : 'Import media'}
            </Button>
          }
        />
      ) : (
        <>
          {selected && <SourceViewer asset={selected} focusToken={sourceFocus} onClose={() => setSelectedId(null)} />}

          <div className="flex flex-col gap-1.5 border-b border-line px-3 py-2">
            <SearchField label="Search media" placeholder="Search media…" value={query} onValueChange={setQuery} />
            <div className="flex items-center gap-1">
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
              <IconButton
                {...sortMenu.triggerProps}
                label={`Sort: ${MEDIA_SORTS.find((s) => s.id === sort)?.label ?? ''}`}
                icon={<ArrowDownUp className="size-3.5" />}
              />
              <Menu
                {...sortMenu.surfaceProps}
                label="Sort media"
                align="end"
                items={[
                  { kind: 'label', label: 'Sort by' },
                  ...MEDIA_SORTS.map((option) => ({
                    label: option.label,
                    checked: option.id === sort,
                    onSelect: () => {
                      setSort(option.id)
                      remember(SORT_KEY, option.id)
                    }
                  }))
                ]}
              />
              <IconButton
                label={view === 'grid' ? 'Show as list' : 'Show as grid'}
                icon={view === 'grid' ? <List className="size-3.5" /> : <LayoutGrid className="size-3.5" />}
                onClick={() => {
                  const next: View = view === 'grid' ? 'list' : 'grid'
                  setView(next)
                  remember(VIEW_KEY, next)
                }}
              />
            </div>
          </div>

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

          <ScrollArea className="flex-1 p-3">
            {shown.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-[12px] text-ink-2">
                  {query.trim() ? `No media matches “${query.trim()}”.` : 'No media of this kind.'}
                </p>
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
              <div className={view === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2' : 'flex flex-col gap-px'}>
                {shown.map((asset) => (
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
                    onSelect={(open) => {
                      setSelectedId(asset.id)
                      if (open) setSourceFocus((n) => n + 1)
                    }}
                    onPlace={() => place(asset)}
                    onMenu={(at) => setMenu({ assetId: asset.id, at })}
                    onRename={(name) => rename(asset, name)}
                  />
                ))}
              </div>
            )}
            <p className="mt-3 text-[10px] leading-relaxed text-ink-2">
              {filtered ? `Showing ${shown.length} of ${assets.length}. ` : ''}
              {captionLines > 0
                ? `${captionLines} caption line${captionLines === 1 ? ' is' : 's are'} on the timeline's Captions track, not here. `
                : ''}
              Click to preview, double-click or Enter to add at the playhead, or drag onto a track.
              Right-click for more.
            </p>
          </ScrollArea>
        </>
      )}

      <ContextMenu
        at={menu && menuAsset ? menu.at : null}
        label={menuAsset ? `${menuAsset.name} actions` : 'Asset actions'}
        items={menuAsset ? menuFor(menuAsset) : []}
        onClose={() => setMenu(null)}
      />

      <CodeEditorModal assetId={editingCode} open={editingCode !== null} onClose={() => setEditingCode(null)} />

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
    </Panel>
  )
}
