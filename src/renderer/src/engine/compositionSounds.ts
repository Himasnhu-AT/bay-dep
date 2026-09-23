/**
 * The sounds each composition on the timeline declares, as main reports them — for preview.
 *
 * The audio engine runs once per picture and cannot wait, while the declaration lives in a file
 * only main can read. So this answers synchronously from what it already knows and asks main
 * the first time it is asked about a composition: until the answer arrives, the composition is
 * silent — for the length of one IPC round trip, on first use only.
 *
 * Keyed by asset id *and* path. A rewritten composition is re-imported as a new asset (see
 * `forgetPath` in main), so the id changes with the file and the stale entry is simply never
 * asked for again; the path is in the key so an asset re-pointed at another file is not
 * answered with the old one's sounds.
 *
 * What main returns is already filtered: only sounds whose file exists and decodes, and whose
 * paths main has added to the `bay://` allowlist — so everything listed here can be loaded.
 */

import type { CompositionSound } from '@shared/composition'
import type { Asset } from '@shared/project'
import { bay } from '@/lib/bay'

/** The playable sounds `asset` declares; null while not yet known. */
export type SoundLookup = (asset: Asset) => readonly CompositionSound[] | null

export function inspectedSounds(): SoundLookup {
  const known = new Map<string, readonly CompositionSound[]>()
  const asking = new Set<string>()
  return (asset) => {
    if (asset.kind !== 'html' || !asset.path || asset.error) return null
    const key = `${asset.id}\u0000${asset.path}`
    const found = known.get(key)
    if (found) return found
    const api = bay()
    if (!api || asking.has(key)) return null
    asking.add(key)
    void api.composition
      .inspect(asset.path)
      .then(({ info }) => known.set(key, info?.audio ?? []))
      // An unreadable composition has no sounds, and the picture path reports why; asking again
      // every frame would be an IPC storm about a fault already on screen.
      .catch(() => known.set(key, []))
      .finally(() => asking.delete(key))
    return null
  }
}
