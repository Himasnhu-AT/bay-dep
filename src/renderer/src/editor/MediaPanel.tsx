import { useState, type ReactNode } from 'react'
import { completeBrfImports } from '@/lib/brfImport'
import {
  Code2,
  FilmIcon,
  ImageIcon,
  Music2,
  Plus,
  Trash2,
  Type as TypeIcon,
  type LucideIcon,
  Palette,
  Sparkles
} from 'lucide-react'
import type { Asset, AssetKind } from '@shared/project'
import { Button, EmptyState, IconButton, Panel, ScrollArea } from '@/components'
import { call, formatSourceDuration, importMessage } from '@/lib/bay'
import { cn } from '@/lib/cn'
import { usePoster } from '@/lib/useMediaCache'
import { useEditor } from '@/store/editor'

/** The drag payload a media card writes and a timeline lane reads. */
export const ASSET_DRAG_TYPE = 'application/x-bay-asset'

/**
 * Typed `Record<AssetKind, ...>` on purpose: an untyped literal lets a new asset kind index to
 * `undefined`, React renders `<undefined />`, and the whole tree unmounts to a blank window
 * with nothing in the console. That is not hypothetical — adding `html` did exactly that, and
 * both typecheck and the test suite stayed green because neither can see a missing key in an
 * object literal nobody declared exhaustive. The annotation turns the next one into a build
 * error.
 */
const KIND_ICON: Record<AssetKind, LucideIcon> = {
  video: FilmIcon,
  audio: Music2,
  image: ImageIcon,
  gif: ImageIcon,
  text: TypeIcon,
  html: Code2,
  brf: Sparkles,
  lut: Palette
}

function AssetCard({ asset }: { asset: Asset }): ReactNode {
  const placeAsset = useEditor((state) => state.placeAsset)
  const removeAsset = useEditor((state) => state.removeAsset)
  const poster = usePoster(asset, 220)
  const Icon = KIND_ICON[asset.kind]
  const broken = Boolean(asset.error)

  return (
    <div
      draggable={!broken}
      onDragStart={(event) => {
        event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      className="group relative"
    >
      <button
        type="button"
        disabled={broken}
        onClick={() => placeAsset(asset.id)}
        title={broken ? asset.error : `Place ${asset.name} at the playhead`}
        className={cn(
          't-fast block w-full overflow-hidden rounded-sm border border-line bg-surface-2 text-left',
          broken
            ? 'cursor-not-allowed opacity-50'
            : 'hover:border-line-strong hover:bg-surface-3 focus-visible:border-accent'
        )}
      >
        <div className="relative aspect-video w-full overflow-hidden bg-surface-0">
          {poster ? (
            <img
              src={poster}
              alt=""
              draggable={false}
              className="size-full object-cover"
              // A poster that 404s must not leave a broken-image glyph in a dark panel.
              onError={(event) => {
                event.currentTarget.style.visibility = 'hidden'
              }}
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Icon aria-hidden="true" className="size-5 text-ink-2" />
            </div>
          )}
          <span
            className={cn(
              'absolute top-1 left-1 rounded-xs px-1 text-[10px] leading-4 font-medium tracking-wide uppercase',
              asset.kind === 'audio'
                ? 'bg-clip-audio text-on-media'
                : asset.kind === 'video'
                  ? 'bg-clip-video text-on-media'
                  : 'bg-surface-3 text-ink-1'
            )}
          >
            {asset.kind}
          </span>
          {asset.durationUs > 0 && (
            <span className="absolute right-1 bottom-1 rounded-xs bg-black/70 px-1 text-[10px] leading-4 text-on-media tabular-nums">
              {formatSourceDuration(asset.durationUs)}
            </span>
          )}
        </div>
        <div className="px-1.5 py-1">
          <p className="truncate text-[11px] text-ink-0">{asset.name}</p>
          <p className="truncate text-[10px] text-ink-2">
            {broken
              ? 'Could not be read'
              : asset.width && asset.height
                ? `${asset.width}×${asset.height}`
                : asset.kind === 'audio'
                  ? 'Audio only'
                  : '—'}
          </p>
        </div>
      </button>

      <div className="t-fast absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <IconButton
          label={`Remove ${asset.name}`}
          size="xs"
          variant="danger"
          icon={<Trash2 className="size-3" />}
          onClick={() => removeAsset(asset.id)}
          className="bg-surface-0/80"
        />
      </div>
    </div>
  )
}

export function MediaPanel(): ReactNode {
  const assets = useEditor((state) => state.project.assets)
  const addAssets = useEditor((state) => state.addAssets)
  const notify = useEditor((state) => state.notify)
  const [importing, setImporting] = useState(false)

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

  return (
    <Panel
      title="Media"
      actions={
        <IconButton
          label="Import media"
          icon={<Plus className="size-4" />}
          disabled={importing}
          onClick={() => void runImport()}
        />
      }
      className="h-full"
      bodyClassName="flex flex-col"
    >
      {assets.length === 0 ? (
        <EmptyState
          icon={<FilmIcon aria-hidden="true" className="size-6" />}
          title="No media yet"
          hint="Import video, audio or images — or drop files anywhere on the window."
          action={
            <Button variant="subtle" onClick={() => void runImport()} disabled={importing}>
              {importing ? 'Importing…' : 'Import media'}
            </Button>
          }
        />
      ) : (
        <ScrollArea className="flex-1 p-3">
          <div className="grid grid-cols-2 gap-2">
            {assets.map((asset) => (
              <AssetCard key={asset.id} asset={asset} />
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-ink-2">
            Click a clip to place it at the playhead, or drag it onto a track.
          </p>
        </ScrollArea>
      )}
    </Panel>
  )
}
