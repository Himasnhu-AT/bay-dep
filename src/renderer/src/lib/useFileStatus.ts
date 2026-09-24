import { useCallback, useEffect, useState } from 'react'
import type { Asset } from '@shared/project'
import { bay } from './bay'

/**
 * Which assets' files are on disk, and how big they are — asked of main by path, since the
 * renderer cannot look. Re-asked whenever the set of paths changes and whenever the window
 * comes back to the front, because the usual way a file goes missing (or comes back) is someone
 * moving it in Finder while bay sits behind.
 *
 * Only assets with a file of their own are asked about: a text or code asset has no path, and a
 * font or LUT is bay's own copy or lives in the project.
 */
export interface FileStatus {
  /** Asset ids whose file is not there now. Empty until the first answer. */
  missing: ReadonlySet<string>
  /** Bytes by asset id, for files that are there. */
  sizes: ReadonlyMap<string, number>
  /** Ask again now — after a relink, say. */
  refresh(): void
}

const checked = (asset: Asset): boolean =>
  asset.path !== null && !asset.error && ['video', 'audio', 'image', 'gif', 'html'].includes(asset.kind)

export function useFileStatus(assets: readonly Asset[]): FileStatus {
  const [status, setStatus] = useState<{ missing: Set<string>; sizes: Map<string, number> }>({
    missing: new Set(),
    sizes: new Map()
  })
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((n) => n + 1), [])

  // Keyed on the paths, not the array: a poster arriving replaces the asset objects without
  // moving a single file, and must not send a batch of `stat`s.
  const targets = assets.filter(checked)
  const key = targets.map((asset) => `${asset.id}\u0000${asset.path}`).join('\u0001')

  useEffect(() => {
    const api = bay()
    if (!api || targets.length === 0) {
      setStatus({ missing: new Set(), sizes: new Map() })
      return
    }
    let live = true
    void api.media
      .stat(targets.map((asset) => asset.path as string))
      .then((sizes) => {
        if (!live) return
        const missing = new Set<string>()
        const known = new Map<string, number>()
        targets.forEach((asset, index) => {
          const size = sizes[index]
          if (typeof size === 'number') known.set(asset.id, size)
          else missing.add(asset.id)
        })
        setStatus({ missing, sizes: known })
      })
      // A bridge that cannot answer says nothing about the files; showing them all as missing
      // would accuse files that are fine.
      .catch(() => {})
    return () => {
      live = false
    }
    // `targets` is derived from `key`; listing it would re-run on every render.
  }, [key, tick])

  useEffect(() => {
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  return { missing: status.missing, sizes: status.sizes, refresh }
}
