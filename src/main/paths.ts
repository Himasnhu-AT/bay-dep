/**
 * Every directory bay writes to, in one place.
 *
 * These are resolved lazily: `app.getPath` is not safe to call at module-evaluation time,
 * and the main process imports most modules before the app is ready.
 */

import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE_SCHEME } from './media/cache-key'

function ensure(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

export function cacheDir(): string {
  return ensure(join(app.getPath('userData'), 'cache'))
}

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

/** Autosaves for projects that have never been saved and so have no sidecar location. */
/**
 * Where "Create new project" puts projects: a folder of the user's own, beside their other
 * video work, not somewhere inside Application Support they would never think to look.
 */
export function projectsDir(): string {
  return ensure(join(app.getPath('videos'), 'bay'))
}

export function autosaveDir(): string {
  return ensure(join(app.getPath('userData'), 'autosave'))
}

/**
 * Templates sized to a canvas, as placed from the Templates panel or `add_template`.
 *
 * Not under `cacheDir()`: a cache is safe to delete wholesale and these are not — a placed clip
 * reads its document from here for as long as the project uses it.
 */
export function templatesDir(): string {
  return ensure(join(app.getPath('userData'), 'templates'))
}

/**
 * Compositions bay generates for a project — a clip's subtitles. Kept for the same reason as
 * templates: a placed clip reads its document from here for as long as the project uses it.
 */
export function generatedDir(): string {
  return ensure(join(app.getPath('userData'), 'generated'))
}

/** Scratch space for export intermediates — half-written video before the audio is muxed. */
export function exportScratchDir(): string {
  return ensure(join(cacheDir(), 'export'))
}

export function appDbPath(): string {
  return join(ensure(app.getPath('userData')), 'app.db')
}
