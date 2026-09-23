/**
 * Posters and filmstrips.
 *
 * Both write JPEGs into the user-data cache and hand back `bay://` URLs, so the renderer
 * loads them through the same allowlisted scheme as the media itself and never learns a
 * filesystem path. Both are keyed by the source file's stamp, which is what makes them
 * survive a relaunch and expire when the footage changes.
 */

import { access, constants } from 'node:fs/promises'
import { join } from 'node:path'
import type { FilmstripRequest, ThumbnailRequest } from '@shared/ipc'
import { US_PER_SECOND } from '@shared/project'
import { thumbsDir } from '../paths'
import { mediaUrl } from '../protocol'
import { ffmpegBin, run } from './ffmpeg'
import { cacheKey, stampOf } from './cache-key'
import { once, withSlot } from './queue'
import { noteCacheHit, scheduleCacheUpkeep } from './cache-upkeep'
import { probe } from './probe'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/** Longest-edge scaling without knowing the orientation up front. */
function longestEdgeFilter(size: number): string {
  const even = Math.max(2, Math.round(size / 2) * 2)
  return `scale='if(gt(iw,ih),${even},-2)':'if(gt(iw,ih),-2,${even})'`
}

function evenHeightFilter(height: number): string {
  return `scale=-2:${Math.max(2, Math.round(height / 2) * 2)}`
}

export async function thumbnail(request: ThumbnailRequest): Promise<string | null> {
  const file = await thumbnailFile(request)
  return file ? mediaUrl(file) : null
}

/**
 * The same thumbnail as a file path rather than a `bay://` URL — for main's own use, such as the
 * projects screen's posters, where nothing goes through the renderer's protocol.
 */
export async function thumbnailFile(request: ThumbnailRequest): Promise<string | null> {
  const stamp = await stampOf(request.path)
  const atUs = Math.max(0, Math.round(request.atUs))
  const size = Math.max(16, Math.round(request.size))
  const key = cacheKey(stamp, 'thumb', atUs, size)
  const out = join(thumbsDir(), `${key}.jpg`)

  return once(key, async () => {
    if (await exists(out)) {
      noteCacheHit(key, out)
      return out
    }
    await withSlot(() =>
      run(ffmpegBin(), [
        '-nostdin',
        '-v',
        'error',
        // Seeking before `-i` is the fast path: ffmpeg jumps to the nearest keyframe rather
        // than decoding from zero. A poster does not need frame-exact accuracy, and a
        // 40-minute source decoded from zero would take longer than the user will wait.
        '-ss',
        (atUs / US_PER_SECOND).toFixed(6),
        '-i',
        stamp.path,
        '-frames:v',
        '1',
        '-vf',
        longestEdgeFilter(size),
        '-q:v',
        '3',
        '-y',
        out
      ])
    )
    // ffmpeg exits 0 having written nothing when the seek lands past the end of the source.
    if (!(await exists(out))) return null
    noteCacheHit(key, out)
    scheduleCacheUpkeep()
    return out
  })
}

export async function filmstrip(request: FilmstripRequest): Promise<string[]> {
  const stamp = await stampOf(request.path)
  const count = Math.max(1, Math.min(200, Math.round(request.count)))
  const height = Math.max(16, Math.round(request.height))
  const key = cacheKey(stamp, 'strip', count, height)

  return once(key, async () => {
    const paths = Array.from({ length: count }, (_, i) =>
      join(thumbsDir(), `${key}_${String(i + 1).padStart(3, '0')}.jpg`)
    )
    const present = await Promise.all(paths.map(exists))
    if (present.every(Boolean)) {
      noteCacheHit(key, paths[0]!)
      return paths.map(mediaUrl)
    }

    const info = await probe(stamp.path)
    const durationSeconds = info.durationUs / US_PER_SECOND

    if (count === 1 || durationSeconds <= 0) {
      const single = await thumbnail({
        assetId: request.assetId,
        path: stamp.path,
        atUs: 0,
        size: height * 4
      })
      return single ? Array.from({ length: count }, () => single) : []
    }

    // One spawn, not `count` of them. The `fps` filter emits a frame every `duration/count`
    // seconds from t=0, which is exactly the even spacing a clip body wants, and a single
    // decode pass costs a fraction of N seeks into the same file.
    const rate = count / durationSeconds
    await withSlot(() =>
      run(ffmpegBin(), [
        '-nostdin',
        '-v',
        'error',
        '-i',
        stamp.path,
        '-vf',
        `fps=${rate.toFixed(6)},${evenHeightFilter(height)}`,
        '-frames:v',
        String(count),
        '-q:v',
        '4',
        '-y',
        join(thumbsDir(), `${key}_%03d.jpg`)
      ])
    )

    // A source whose real duration is shorter than the container claims yields fewer frames
    // than asked for. Returning the short strip is honest; padding it with a repeat would
    // draw a clip body that lies about its own content.
    const written = await Promise.all(paths.map(exists))
    const made = paths.filter((_, i) => written[i] === true)
    if (made.length > 0) {
      noteCacheHit(key, made[0]!)
      scheduleCacheUpkeep()
    }
    return made.map(mediaUrl)
  })
}
