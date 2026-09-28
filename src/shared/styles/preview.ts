/**
 * Style preview tiles: what the agent panel draws under a `search_styles` or `read_style` card.
 *
 * A built-in style's media ships with the app, one folder per style — `resources/styles/<id>/`
 * holding `preview.webm` and `poster.webp` — and reaches the renderer as
 * `bay://style-preview/<id>/<file>`, which main answers from that read-only folder and nothing
 * else (`stylePreviewPath` in `src/main/serve.ts`). The renderer builds the URL from the id; no
 * path ever comes from a tool result. A user style has no media: its tile is the neutral one,
 * marked "Your style". A missing file is not an error either — the tile falls back to the same
 * neutral face when the poster fails to load.
 *
 * Tool results reach the panel as text clamped to 2000 characters (`summarise` in
 * `src/main/agent/stream.ts`), and a search listing every style is longer than that. So the
 * result is parsed as JSON when it is whole, and otherwise its ids are read out in order and
 * looked up in the catalog the panel has — the built-ins bundled with it and the user's styles.
 */

import { STYLE_ID } from './index'
import { STYLE_PREVIEW_POSTER, STYLE_PREVIEW_VIDEO, type EditingStyle, type StyleOrigin } from './types'

export const STYLE_PREVIEW_HOST = 'style-preview'

/** `bay://style-preview/<id>/<file>`, or `null` for an id or file main would refuse anyway. */
export function stylePreviewUrl(id: string, file: string): string | null {
  if (!STYLE_ID.test(id) || (file !== STYLE_PREVIEW_VIDEO && file !== STYLE_PREVIEW_POSTER)) return null
  return `bay://${STYLE_PREVIEW_HOST}/${id}/${file}`
}

export interface StyleTile {
  id: string
  title: string
  summary: string
  tags: string[]
  origin: StyleOrigin
  /** Shipped media, for a built-in that names a loop; `null` draws the neutral tile. */
  media: { poster: string; video: string } | null
}

/** The catalog the panel resolves ids against: built-ins first, then the user's own. */
export interface TileCatalogEntry {
  style: EditingStyle
  origin: StyleOrigin
}

function mediaFor(style: EditingStyle, origin: StyleOrigin): StyleTile['media'] {
  if (origin !== 'built-in' || style.preview !== STYLE_PREVIEW_VIDEO) return null
  const poster = stylePreviewUrl(style.id, STYLE_PREVIEW_POSTER)
  const video = stylePreviewUrl(style.id, STYLE_PREVIEW_VIDEO)
  return poster && video ? { poster, video } : null
}

export function tileFor(style: EditingStyle, origin: StyleOrigin): StyleTile {
  return { id: style.id, title: style.title, summary: style.summary, tags: style.tags, origin, media: mediaFor(style, origin) }
}

type Hit = { id: string; source: StyleOrigin | null; title?: string; summary?: string; tags?: string[] }

function hitsFrom(result: string): Hit[] {
  try {
    const parsed: unknown = JSON.parse(result)
    const styles = (parsed as { styles?: unknown })?.styles
    if (Array.isArray(styles)) {
      return styles.flatMap((raw): Hit[] => {
        const hit = raw as Record<string, unknown> | null
        if (!hit || typeof hit.id !== 'string') return []
        const source = hit.source === 'user' || hit.source === 'built-in' ? hit.source : null
        return [
          {
            id: hit.id,
            source,
            ...(typeof hit.title === 'string' ? { title: hit.title } : {}),
            ...(typeof hit.summary === 'string' ? { summary: hit.summary } : {}),
            ...(Array.isArray(hit.tags) ? { tags: hit.tags.filter((t): t is string => typeof t === 'string') } : {})
          }
        ]
      })
    }
  } catch {
    // Clamped text: read the ids out below.
  }
  // Pretty-printed by bay's socket (`"id": "…"`). Inside a JSON string every quote is escaped,
  // so an id quoted in `next` or `skipped` cannot match; a clamped final id has no closing quote.
  return [...result.matchAll(/"id":\s*"([a-z0-9-]+)"/g)].map((m) => ({ id: m[1]!, source: null }))
}

/**
 * A `search_styles` result as tiles, in its ranking. Each id is resolved against the catalog —
 * that is where media comes from, so a result can never name a file — and a hit the catalog does
 * not know (a user style deleted since) is drawn from the result's own fields when it has them.
 */
export function styleTilesFromResult(result: string | undefined, catalog: readonly TileCatalogEntry[]): StyleTile[] {
  if (!result) return []
  const tiles: StyleTile[] = []
  for (const hit of hitsFrom(result)) {
    if (tiles.some((t) => t.id === hit.id)) continue
    const entry = catalog.find((e) => e.style.id === hit.id && (hit.source === null || e.origin === hit.source))
    if (entry) tiles.push(tileFor(entry.style, entry.origin))
    else if (hit.title !== undefined && STYLE_ID.test(hit.id)) {
      tiles.push({ id: hit.id, title: hit.title, summary: hit.summary ?? '', tags: hit.tags ?? [], origin: hit.source ?? 'user', media: null })
    }
  }
  return tiles
}

/** The one tile at the top of a `read_style` card: the style it was asked for, if the catalog has it. */
export function readStyleTile(args: Record<string, unknown>, catalog: readonly TileCatalogEntry[]): StyleTile | null {
  const entry = catalog.find((e) => e.style.id === args['id'])
  return entry ? tileFor(entry.style, entry.origin) : null
}

/**
 * What "Use this style" puts in the composer — a draft the user sends, never sent for them. The
 * id is quoted so the agent reads the exact style rather than searching the title again.
 */
export function styleDraftMessage(tile: Pick<StyleTile, 'id' | 'title'>): string {
  const title = tile.title.replace(/\s+/g, ' ').trim()
  return `Apply the ${title} style (\`${tile.id}\`) to my clip.`
}

/**
 * Whether a tile's rejected `play()` means its loop is broken. `pause()` during a pending
 * `play()` — a hover shorter than the load — rejects with `AbortError`, and treating that as a
 * failure turned the loop off for good after one quick pass of the pointer.
 */
export function playFailureDisablesLoop(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name !== 'AbortError'
}
