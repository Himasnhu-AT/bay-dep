import type { ReactNode } from 'react'
import { MediaPool } from './library/MediaPool'

export { ASSET_DRAG_TYPE } from './AssetTile'

/**
 * The media pool in a side column: the Edit page's library slot (and the old left rail's Media
 * page). The pool itself — toolbar, bin, source monitor, action bar — is `library/MediaPool`.
 */
export function MediaPanel(): ReactNode {
  return <MediaPool variant="panel" />
}
