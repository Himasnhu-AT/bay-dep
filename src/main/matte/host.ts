/**
 * The app's one `MatteService`: its pack directory in the cache, bay's ffmpeg, the `bay://` rule
 * for which paths it may read, and one Apple Vision process.
 *
 * The Vision process is killed on quit (`stopSubjectMattes` from `will-quit`) and two minutes after
 * the last running job ends (`IdleGate`), like the visual search worker; the next job starts another
 * in ~0.3 s. Packs count toward the media cache budget (`budgetedCacheDirs`) and are marked in use
 * whenever this session computes or reads one.
 */

import { ffmpegBin } from '../ffmpeg/ffmpeg'
import { MATTE_CACHE_FAMILY, matteCacheDir } from '../media/cache-budget'
import { noteCacheHit } from '../media/cache-upkeep'
import { cacheDir } from '../paths'
import { isAllowed } from '../protocol'
import { IdleGate } from './idle'
import { sweepMattePartFiles } from './pack'
import { MatteService } from './service'
import { VisionSegmenter } from './vision-jxa'

export { MATTE_CACHE_FAMILY }

/** Two idle minutes after the last job and the Vision process goes. */
const IDLE_MS = 120_000

let service: MatteService | null = null
let segmenter: VisionSegmenter | null = null
const idle = new IdleGate(IDLE_MS, () => segmenter?.stop())

export function subjectMattes(): MatteService {
  if (!service) {
    segmenter = new VisionSegmenter()
    service = new MatteService({
      dir: matteCacheDir(cacheDir()),
      ffmpeg: ffmpegBin,
      engine: segmenter,
      isAllowed,
      // The budget groups files by the first 24 hex characters of their name (`entryKeyFor`).
      onUse: (key, path) => noteCacheHit(key.slice(0, 24), path)
    })
  }
  return service
}

/** A job through the service, counted so the idle stop waits for every running job. */
export async function ensureSubjectMatte(request: Parameters<MatteService['ensure']>[0]): ReturnType<MatteService['ensure']> {
  idle.begin()
  try {
    return await subjectMattes().ensure(request)
  } finally {
    idle.end()
  }
}

/** Startup: the `.part` of a job a crash or a kill interrupted — bay's own packs only. */
export function sweepInterruptedMattes(): Promise<string[]> {
  return sweepMattePartFiles(matteCacheDir(cacheDir()))
}

/** Quit: the running job stops and the `osascript` process is killed. */
export function stopSubjectMattes(): void {
  idle.cancel()
  service?.dispose()
}
