/**
 * What main accepts from the renderer for visual search, checked in main.
 *
 * The renderer names files by path, and the vision service opens, hashes and hands them to
 * ffmpeg. A renderer is not trusted with that: a path it sends is read only when `bay://` would
 * serve it (`isAllowed` — a file an import or an open project admitted), so the vision channels
 * reach no file the renderer could not already reach. The service itself refuses anything that
 * is not a regular file (`stat().isFile()`), so a FIFO or a device cannot hang the hash.
 *
 * A search's size is bounded here too — the limit, the number of files and the query's length —
 * so a bad call is refused in words rather than costing a scan of everything or a 1 MB tokenise.
 *
 * No Electron import: `ipc.ts` passes protocol's `isAllowed`, the tests a set.
 */

import { isAbsolute, resolve } from 'node:path'
import type { VisionAssetRef, VisionSearchRequest } from '@shared/visual-search'

/** More files than any project has; a search over them all is still one pass over their indexes. */
export const MAX_VISION_ASSETS = 10_000
/** SigLIP reads 64 tokens; a thousand characters is far past what can matter. */
export const MAX_QUERY_CHARS = 1_000
export const MAX_SEARCH_LIMIT = 100
export const DEFAULT_SEARCH_LIMIT = 8

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

/** A search limit: a finite number, rounded, within 1…100; anything else is the default. */
export function searchLimit(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_SEARCH_LIMIT
  return Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.round(raw)))
}

/** The files a request names, each shaped and admitted by `isAllowed`; the whole call is refused otherwise. */
export function checkVisionAssets(raw: unknown, isAllowed: (path: string) => boolean): Checked<VisionAssetRef[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'Visual search needs a list of files.' }
  if (raw.length > MAX_VISION_ASSETS) return { ok: false, error: `Visual search takes at most ${MAX_VISION_ASSETS} files at a time; this asked for ${raw.length}.` }
  const out: VisionAssetRef[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'Each file for visual search must be an asset reference.' }
    const e = entry as Record<string, unknown>
    const name = typeof e['name'] === 'string' ? e['name'] : ''
    if (typeof e['assetId'] !== 'string' || typeof e['path'] !== 'string' || (e['kind'] !== 'video' && e['kind'] !== 'image')) {
      return { ok: false, error: `"${name || String(e['assetId'])}" is not a video or image reference visual search can read.` }
    }
    const path = e['path']
    if (!isAbsolute(path)) return { ok: false, error: `"${name}" has no absolute path (${path}), so visual search will not read it.` }
    const resolved = resolve(path)
    if (!isAllowed(resolved)) {
      return { ok: false, error: `"${name}" (${path}) is not a file this project imported or opened, so visual search will not read it. Import it with import_media first.` }
    }
    const durationUs = typeof e['durationUs'] === 'number' && Number.isFinite(e['durationUs']) && e['durationUs'] > 0 ? e['durationUs'] : 0
    out.push({ assetId: e['assetId'], name, path: resolved, kind: e['kind'], durationUs })
  }
  return { ok: true, value: out }
}

/** A search request, bounded: files admitted, query capped, limit clamped, `similarTo` shaped. */
export function checkSearchRequest(raw: unknown, isAllowed: (path: string) => boolean): Checked<VisionSearchRequest> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'A search needs a request.' }
  const r = raw as Record<string, unknown>
  const assets = checkVisionAssets(r['assets'], isAllowed)
  if (!assets.ok) return assets
  let query: string | undefined
  if (r['query'] !== undefined) {
    if (typeof r['query'] !== 'string') return { ok: false, error: 'query must be text.' }
    if (r['query'].length > MAX_QUERY_CHARS) return { ok: false, error: `The description is ${r['query'].length} characters; describe the shot in at most ${MAX_QUERY_CHARS}.` }
    query = r['query']
  }
  let similarTo: VisionSearchRequest['similarTo']
  if (r['similarTo'] !== undefined) {
    const like = r['similarTo'] as Record<string, unknown> | null
    if (!like || typeof like !== 'object' || typeof like['assetId'] !== 'string') return { ok: false, error: 'similarTo needs an assetId and a time in it.' }
    const us = typeof like['us'] === 'number' && Number.isFinite(like['us']) ? Math.max(0, like['us']) : 0
    similarTo = { assetId: like['assetId'], us }
  }
  return {
    ok: true,
    value: { assets: assets.value, ...(query !== undefined ? { query } : {}), ...(similarTo ? { similarTo } : {}), limit: searchLimit(r['limit']) }
  }
}
