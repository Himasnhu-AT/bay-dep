import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Wand2 } from 'lucide-react'
import { BUILT_IN_STYLES, readUserStyles } from '@shared/styles'
import {
  readStyleTile,
  styleDraftMessage,
  styleTilesFromResult,
  type StyleTile,
  type TileCatalogEntry
} from '@shared/styles/preview'
import { bay } from '@/lib/bay'
import { cn } from '@/lib/cn'

/**
 * Editing styles as tiles under a `search_styles` card (and one at the top of a `read_style`
 * card): the poster, the loop on hover or focus, the title, one line of summary, the tags, and
 * "Use this style", which drafts a message in the composer and never sends it.
 *
 * Media comes from the catalog by id (`@shared/styles/preview`), never from the result text, and
 * a poster that fails to load — no media shipped yet — leaves the neutral tile.
 */

const BUILT_IN: TileCatalogEntry[] = BUILT_IN_STYLES.map((style) => ({ style, origin: 'built-in' }))

/** The built-ins at once; the user's own styles once main has listed them. */
function useStyleCatalog(): TileCatalogEntry[] {
  const [user, setUser] = useState<TileCatalogEntry[]>([])
  useEffect(() => {
    const api = bay()
    if (!api) return
    let live = true
    void api.styles
      .list()
      .then((listed) => {
        if (live) setUser(readUserStyles(listed.styles).styles.map((style) => ({ style, origin: 'user' })))
      })
      .catch(() => {
        // Without the user's styles the built-ins still draw; a user hit falls back to its own fields.
      })
    return () => {
      live = false
    }
  }, [])
  return useMemo(() => [...BUILT_IN, ...user], [user])
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function StyleSearchTiles({ result, onUse }: { result: string | undefined; onUse: (text: string) => void }): ReactNode {
  const catalog = useStyleCatalog()
  const tiles = useMemo(() => styleTilesFromResult(result, catalog), [result, catalog])
  if (tiles.length === 0) return null
  return (
    <ul aria-label="Editing styles" className="@container grid grid-cols-1 gap-1.5 border-t border-line p-1.5 @[280px]:grid-cols-2">
      {tiles.map((tile) => (
        <li key={`${tile.origin}:${tile.id}`} className="min-w-0">
          <StyleTileCard tile={tile} onUse={onUse} />
        </li>
      ))}
    </ul>
  )
}

export function ReadStyleTile({ args, onUse }: { args: Record<string, unknown>; onUse: (text: string) => void }): ReactNode {
  const catalog = useStyleCatalog()
  const tile = useMemo(() => readStyleTile(args, catalog), [args, catalog])
  if (!tile) return null
  return (
    <div className="border-t border-line p-1.5">
      <StyleTileCard tile={tile} onUse={onUse} />
    </div>
  )
}

function StyleTileCard({ tile, onUse }: { tile: StyleTile; onUse: (text: string) => void }): ReactNode {
  const [posterOk, setPosterOk] = useState(true)
  const [videoOk, setVideoOk] = useState(true)
  const [active, setActive] = useState(false)
  const video = useRef<HTMLVideoElement | null>(null)
  const media = tile.media && posterOk ? tile.media : null
  const play = active && media !== null && videoOk && !prefersReducedMotion()

  useEffect(() => {
    const element = video.current
    if (!element) return
    if (play) {
      element.currentTime = 0
      void element.play().catch(() => setVideoOk(false))
    } else element.pause()
  }, [play])

  return (
    <article
      aria-label={tile.title}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false)
      }}
      className="t-fast flex h-full min-w-0 flex-col overflow-hidden rounded-md border border-line bg-surface-1 hover:border-line-hover focus-within:border-line-hover"
    >
      {media && (
        <div className="relative aspect-video w-full overflow-hidden bg-surface-3">
          <img
            src={media.poster}
            alt=""
            draggable={false}
            onError={() => setPosterOk(false)}
            className="absolute inset-0 size-full object-cover"
          />
          {videoOk && (
            <video
              ref={video}
              src={play ? media.video : undefined}
              muted
              loop
              playsInline
              preload="none"
              aria-hidden="true"
              tabIndex={-1}
              onError={() => setVideoOk(false)}
              className={cn('absolute inset-0 size-full object-cover transition-opacity', play ? 'opacity-100' : 'opacity-0')}
            />
          )}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-1.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <h4 className="min-w-0 flex-1 truncate text-[12px] leading-snug font-medium text-ink-0">{tile.title}</h4>
          {tile.origin === 'user' && (
            <span className="shrink-0 text-[9px] font-semibold tracking-[0.08em] text-accent uppercase">Your style</span>
          )}
        </div>
        {tile.summary && (
          <p title={tile.summary} className="line-clamp-1 text-[11px] leading-snug text-ink-2">
            {tile.summary}
          </p>
        )}
        {tile.tags.length > 0 && (
          <p className="truncate font-mono text-[10px] text-ink-3">{tile.tags.slice(0, 4).join(' · ')}</p>
        )}
        <button
          type="button"
          onClick={() => onUse(styleDraftMessage(tile))}
          aria-label={`Use the ${tile.title} style: adds a message to the composer`}
          className="t-fast t-press mt-auto inline-flex h-6 items-center justify-center gap-1 self-start rounded-sm border border-line bg-surface-2 px-2 text-[11px] text-ink-0 hover:border-line-strong hover:bg-surface-3 active:scale-[0.96]"
        >
          <Wand2 aria-hidden="true" className="size-3" />
          Use this style
        </button>
      </div>
    </article>
  )
}
