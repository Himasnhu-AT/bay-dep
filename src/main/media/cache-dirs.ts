/**
 * The derived-media caches' directories, versioned by the key scheme.
 *
 * These lived in `../paths.ts`, which then had to import the scheme from here while everything
 * here imported `../paths` — a cycle, for two directories only this folder uses. The scheme
 * and the directories that carry it now live together.
 */

import { join } from 'node:path'
import { cacheDir, ensure } from '../paths'
import { CACHE_SCHEME } from './cache-key'

/**
 * Posters and filmstrip frames. Keyed by content, so it is safe to delete wholesale.
 *
 * The scheme version is in the directory name so that changing how keys are derived
 * invalidates the old entries — `sweepStaleCaches` can then find and remove them — rather
 * than orphaning them on disk where nothing will ever reclaim them.
 */
export function thumbsDir(): string {
  return ensure(join(cacheDir(), `thumbs-${CACHE_SCHEME}`))
}

/** Peak arrays, as JSON. Same disposability, and the same versioning, as the thumbnails. */
export function peaksDir(): string {
  return ensure(join(cacheDir(), `peaks-${CACHE_SCHEME}`))
}
