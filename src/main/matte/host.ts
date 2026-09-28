/**
 * The app's one `MatteService`: its pack directory in the cache, bay's ffmpeg, the `bay://` rule
 * for which paths it may read, and one Apple Vision process.
 *
 * The Vision process is killed on quit (`stopSubjectMattes` from `will-quit`) and after two idle
 * minutes, like the visual search worker; the next job starts another in ~0.3 s.
 */

import { join } from 'node:path'
import { ffmpegBin } from '../ffmpeg/ffmpeg'
import { CACHE_SCHEME } from '../media/cache-key'
import { cacheDir } from '../paths'
import { isAllowed } from '../protocol'
import { MatteService } from './service'
import { VisionSegmenter } from './vision-jxa'

export const MATTE_CACHE_FAMILY = 'mattes'
export const matteCacheDir = (cacheRoot: string): string => join(cacheRoot, `${MATTE_CACHE_FAMILY}-${CACHE_SCHEME}`)

/** Two idle minutes and the Vision process goes. */
const IDLE_MS = 120_000

let service: MatteService | null = null
let segmenter: VisionSegmenter | null = null
let idle: ReturnType<typeof setTimeout> | null = null

function armIdle(): void {
  if (idle) clearTimeout(idle)
  idle = setTimeout(() => segmenter?.stop(), IDLE_MS)
}

export function subjectMattes(): MatteService {
  if (!service) {
    segmenter = new VisionSegmenter()
    service = new MatteService({ dir: matteCacheDir(cacheDir()), ffmpeg: ffmpegBin, engine: segmenter, isAllowed })
  }
  return service
}

/** A job through the service, with the idle timer re-armed when it ends. */
export async function ensureSubjectMatte(request: Parameters<MatteService['ensure']>[0]): ReturnType<MatteService['ensure']> {
  if (idle) clearTimeout(idle)
  try {
    return await subjectMattes().ensure(request)
  } finally {
    armIdle()
  }
}

/** Quit: the running job stops and the `osascript` process is killed. */
export function stopSubjectMattes(): void {
  if (idle) clearTimeout(idle)
  idle = null
  service?.dispose()
}
