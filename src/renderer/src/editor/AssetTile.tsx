import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import {
  AlertTriangle,
  Code2,
  FileQuestion,
  FilmIcon,
  ImageIcon,
  LoaderCircle,
  Music2,
  Palette,
  Plus,
  Sparkles,
  Type as TypeIcon,
  type LucideIcon
} from 'lucide-react'
import type { Asset, AssetKind } from '@shared/project'
import { assetFacts } from '@shared/media-library'
import { IconButton, TextField, Tooltip } from '@/components'
import { formatSourceDuration } from '@/lib/bay'
import { cn } from '@/lib/cn'
import { usePoster } from '@/lib/useMediaCache'

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
  lut: Palette,
  font: TypeIcon
}

/**
 * The card's second line when there are no pixel dimensions to show. It was an em dash for
 * every text clip, which is a line of the card spent saying nothing.
 */
const KIND_NOTE: Record<AssetKind, string> = {
  video: 'Video',
  audio: 'Audio only',
  image: 'Image',
  gif: 'Animated image',
  text: 'Text clip',
  html: 'HTML composition',
  brf: 'Motion graphic',
  lut: 'Colour LUT',
  font: 'Font'
}

/** A font or LUT is applied from elsewhere, never placed: it gets no + and no double-click. */
export const placeable = (asset: Asset): boolean => !asset.error && asset.kind !== 'font' && asset.kind !== 'lut'

export interface AssetTileProps {
  asset: Asset
  view: 'grid' | 'list'
  selected: boolean
  missing: boolean
  uses: number
  bytes: number | undefined
  /** A running action's words ("Detecting beats…"), shown in place of the facts. */
  busy: string | undefined
  renaming: boolean
  onSelect(): void
  onPlace(): void
  onMenu(at: { x: number; y: number }): void
  onRename(name: string | null): void
}

/** The one-line facts: size, rate, file size and how often it is used. */
function factsLine(asset: Asset, bytes: number | undefined, uses: number): string {
  const facts = assetFacts(asset, bytes ?? null)
  if (facts.length === 0) facts.push(KIND_NOTE[asset.kind])
  if (uses > 0) facts.push(`used ${uses}×`)
  return facts.join(' · ')
}

/**
 * One asset in the Media panel, as a card (grid) or a row (list). A click selects it — never
 * edits the timeline; double-click, Enter, the + button or a drag places it. Right-click, or
 * Shift+F10 / the context-menu key, opens its menu.
 */
export function AssetTile(props: AssetTileProps): ReactNode {
  const { asset, view, selected, missing, uses, bytes, busy, renaming } = props
  const broken = Boolean(asset.error)
  const canPlace = placeable(asset)
  const Icon = KIND_ICON[asset.kind]

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      // Enter places, the way double-click does; Space (the button's own click) selects.
      event.preventDefault()
      event.stopPropagation()
      if (canPlace) props.onPlace()
    } else if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault()
      const box = event.currentTarget.getBoundingClientRect()
      props.onMenu({ x: box.left + 8, y: box.top + 8 })
    }
  }

  const common = {
    type: 'button' as const,
    'aria-pressed': selected,
    onClick: props.onSelect,
    onDoubleClick: () => {
      if (canPlace) props.onPlace()
    },
    onKeyDown,
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault()
      props.onSelect()
      props.onMenu({ x: event.clientX, y: event.clientY })
    }
  }

  const status = broken ? (
    <span className="flex items-center gap-1 text-danger">
      <AlertTriangle aria-hidden="true" className="size-3 shrink-0" />
      Could not be read
    </span>
  ) : missing ? (
    <span className="flex items-center gap-1 text-warning">
      <FileQuestion aria-hidden="true" className="size-3 shrink-0" />
      File missing — right-click to locate
    </span>
  ) : busy ? (
    <span className="flex items-center gap-1 text-ink-1">
      <LoaderCircle aria-hidden="true" className="size-3 shrink-0 animate-spin" />
      {busy}
    </span>
  ) : (
    factsLine(asset, bytes, uses)
  )

  const name = <p className={cn('truncate text-[11px]', broken ? 'text-ink-1' : 'text-ink-0')}>{asset.name}</p>
  // Laid over the tile rather than inside its button: a text field inside a button is invalid,
  // and Space typed into it would press the button.
  const rename = renaming && <RenameField name={asset.name} onDone={props.onRename} />

  const add = canPlace && !renaming && (
    <IconButton
      label={`Add ${asset.name} at the playhead`}
      size="xs"
      variant="subtle"
      icon={<Plus className="size-3" />}
      onClick={props.onPlace}
      className="bg-surface-0/80"
    />
  )

  const detail = [asset.path ?? KIND_NOTE[asset.kind], asset.durationUs > 0 ? formatSourceDuration(asset.durationUs) : null, factsLine(asset, bytes, uses)]
    .filter(Boolean)
    .join('\n')

  if (view === 'list') {
    return (
      <div
        // Found by the clip menu's Reveal in Media, which focuses the tile's first button.
        data-asset-id={asset.id}
        draggable={!broken && canPlace && !renaming}
        onDragStart={(event) => {
          event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id)
          event.dataTransfer.effectAllowed = 'copy'
        }}
        className={cn('group relative flex items-center rounded-sm', selected ? 'bg-accent/10' : 'hover:bg-surface-3')}
      >
        <Tooltip label={asset.name} detail={<span className="whitespace-pre-line">{detail}</span>} side="right">
          <button
            {...common}
            className="t-fast flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1.5 py-1 text-left focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Thumb asset={asset} Icon={Icon} dim={broken || missing} className="h-7 w-12 shrink-0 rounded-xs" />
            <span className="min-w-0 flex-1">
              {name}
              <span className="block truncate text-[10px] text-ink-2 tabular-nums">{status}</span>
            </span>
            {asset.durationUs > 0 && (
              <span className="shrink-0 text-[10px] text-ink-2 tabular-nums">{formatSourceDuration(asset.durationUs)}</span>
            )}
          </button>
        </Tooltip>
        {add && <div className="t-fast mr-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">{add}</div>}
        {rename && <div className="absolute inset-y-0 right-1 left-15 flex items-center">{rename}</div>}
      </div>
    )
  }

  return (
    <div
      data-asset-id={asset.id}
      draggable={!broken && canPlace && !renaming}
      onDragStart={(event) => {
        event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      className="group relative"
    >
      <Tooltip label={asset.name} detail={<span className="whitespace-pre-line">{detail}</span>} side="right">
        <button
          {...common}
          className={cn(
            't-fast block w-full overflow-hidden rounded-sm border bg-surface-2 text-left focus-visible:border-accent',
            selected
              ? 'border-accent'
              : broken
                ? 'border-danger/40'
                : missing
                  ? 'border-warning/40'
                  : 'border-line hover:border-line-strong hover:bg-surface-3'
          )}
        >
          <div className="relative aspect-video w-full overflow-hidden bg-surface-0">
            <Thumb asset={asset} Icon={Icon} dim={broken || missing} className="size-full" />
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
            {name}
            <p className="truncate text-[10px] text-ink-2 tabular-nums">{status}</p>
          </div>
        </button>
      </Tooltip>
      {add && (
        <div className="t-fast absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">{add}</div>
      )}
      {rename && <div className="absolute inset-x-0 bottom-0 rounded-b-sm bg-surface-2 p-1">{rename}</div>}
    </div>
  )
}

function Thumb({ asset, Icon, dim, className }: { asset: Asset; Icon: LucideIcon; dim: boolean; className?: string }): ReactNode {
  const poster = usePoster(asset, 220)
  // A broken or missing asset dims its picture, not its explanation: the whole card at 50% put
  // "Could not be read" at ~2:1 in grey, where it read as a caption, not an error.
  return (
    <span className={cn('relative block overflow-hidden bg-surface-0', dim && 'opacity-50', className)}>
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
        <span className="flex size-full items-center justify-center">
          <Icon aria-hidden="true" className="size-4 text-ink-2" />
        </span>
      )}
    </span>
  )
}

/** The name, editable in place: Enter or leaving the field keeps it, Escape does not. */
function RenameField({ name, onDone }: { name: string; onDone(name: string | null): void }): ReactNode {
  const [draft, setDraft] = useState(name)
  return (
    <TextField
      label="Asset name"
      value={draft}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') onDone(draft)
        if (event.key === 'Escape') onDone(null)
      }}
      onBlur={() => onDone(draft)}
      className="h-6"
    />
  )
}
