/**
 * Which paths a project opened from disk may put on the `bay://` allowlist — the pure half of
 * `adoptAssets`, split out of `import.ts` (which imports Electron) so it runs under `pnpm test`.
 *
 * A `.bay` is a document someone may have sent you, and every asset path in it used to be
 * admitted on open: `adoptAssets` allow-listed each one unconditionally, so the dot-folder rule
 * in `admissibleFromProject` — applied a line later in `project/store.ts` — refused nothing. A
 * project naming `~/.ssh/id_rsa` as a clip made it readable by the page. Now one function decides,
 * and a refused path is neither allowed nor remembered for dedupe (a remembered asset is returned
 * as `reused` by the next import, which then skips allow-listing — the user importing the file
 * themselves would get an asset that can never load).
 *
 * The one exception is bay's own: an imported font's copy in bay's fonts folder is admitted
 * whatever folder that is in, because bay wrote it — a profile under `~/.something` still keeps
 * its fonts. Only a `kind: 'font'` asset, and only inside that folder.
 */

import { resolve, sep } from 'node:path'
import type { Asset } from '@shared/project'
import { admissibleFromProject } from '../serve'

export interface Adoption {
  admitted: string[]
  refused: string[]
}

export function adoptProjectAssets(
  assets: readonly Asset[],
  byPath: Map<string, Asset>,
  allow: (path: string) => void,
  fontsDir: string
): Adoption {
  const out: Adoption = { admitted: [], refused: [] }
  const fonts = resolve(fontsDir)
  for (const asset of assets) {
    if (!asset.path) continue
    const absolute = resolve(asset.path)
    const bays = asset.kind === 'font' && absolute.startsWith(fonts + sep)
    if (!bays && !admissibleFromProject(asset.path)) {
      out.refused.push(absolute)
      continue
    }
    byPath.set(absolute, asset)
    allow(absolute)
    out.admitted.push(absolute)
  }
  return out
}
