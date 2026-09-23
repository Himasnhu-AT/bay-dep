/**
 * Minting an `Asset` from a probed file — the pure half of import, so it is testable.
 *
 * Split out of `import.ts`, which imports Electron and so cannot load under `pnpm test`. This is
 * where every imported asset's persisted keys are written, which makes it the writer the `.bay`
 * format's additive-only rule has to hold still (see `asset-mint.test.ts`).
 */

import { randomUUID } from 'node:crypto'
import { basename, extname } from 'node:path'
import type { ProbeResult } from '@shared/ipc'
import type { Asset, AssetKind } from '@shared/project'

export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mpg', 'mpeg', 'wmv', 'flv']
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aiff', 'aif']
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'tif', 'tiff', 'heic']

export function kindFor(path: string, result: ProbeResult): AssetKind {
  const extension = extname(path).slice(1).toLowerCase()
  if (extension === 'gif') return 'gif'
  if (result.hasVideo && result.hasAudio) return 'video'
  if (result.hasVideo) {
    // A single-frame source with no rate is a still, however it is packaged. The importer
    // has to get this right: a still placed as a one-frame video is unusable on a timeline.
    if (result.fps === null || result.durationUs === 0) return 'image'
    return 'video'
  }
  if (result.hasAudio) return 'audio'
  return IMAGE_EXTENSIONS.includes(extension) ? 'image' : 'video'
}

export function assetFrom(path: string, result: ProbeResult): Asset {
  const kind = kindFor(path, result)
  return {
    id: randomUUID(),
    kind,
    name: basename(path),
    path,
    durationUs: result.durationUs,
    width: result.width,
    height: result.height,
    fps: result.fps,
    hasAudio: result.hasAudio,
    hasVideo: result.hasVideo,
    posterPath: null,
    waveformPath: null,
    createdAt: Date.now()
  }
}

export function failedAsset(path: string, message: string): Asset {
  return {
    id: randomUUID(),
    kind: 'video',
    name: basename(path),
    path,
    durationUs: 0,
    width: null,
    height: null,
    fps: null,
    hasAudio: false,
    hasVideo: false,
    posterPath: null,
    waveformPath: null,
    createdAt: Date.now(),
    error: message
  }
}
