/**
 * Turning files the user chose into assets.
 *
 * Import is the only place a path enters the allowlist, which makes it the security boundary
 * for `bay://` as well as the front door for media. It is also where a probe failure has to
 * stay survivable: a folder of forty clips with one corrupt file must import thirty-nine and
 * list the fortieth with its error, not fail as a batch.
 */

import { randomUUID } from 'node:crypto'
import { basename, extname, resolve } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { ImportedAsset, ProbeResult } from '@shared/ipc'
import type { Asset, AssetKind } from '@shared/project'
import { allowPath } from '../protocol'
import { probe } from './probe'
import { thumbnail } from './thumbnails'

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mpg', 'mpeg', 'wmv', 'flv']
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aiff', 'aif']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'tif', 'tiff', 'heic']

/**
 * Assets already imported this session, by absolute path. The renderer owns the project and
 * could answer this itself, but then two windows — or an import that races a drag-and-drop —
 * would each add their own copy of the same file.
 */
const byPath = new Map<string, Asset>()

/** Re-seeds the map when a project is opened, so its assets dedupe against new imports. */
export function adoptAssets(assets: readonly Asset[]): void {
  for (const asset of assets) {
    if (!asset.path) continue
    const absolute = resolve(asset.path)
    byPath.set(absolute, asset)
    allowPath(absolute)
  }
}

function kindFor(path: string, result: ProbeResult): AssetKind {
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

function assetFrom(path: string, result: ProbeResult): Asset {
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

function failedAsset(path: string, message: string): Asset {
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Warms the poster cache without holding the import open. The asset comes back with
 * `posterPath: null` — a path recorded before the file exists would be a lie, and the
 * renderer asks for posters by `thumbnail()` anyway, which by then finds a cache hit.
 */
function warmPoster(asset: Asset): void {
  if (!asset.path || asset.error) return
  if (asset.kind !== 'video' && asset.kind !== 'image' && asset.kind !== 'gif') return
  const at = asset.durationUs > 0 ? Math.min(asset.durationUs / 10, 1_000_000) : 0
  void thumbnail({ assetId: asset.id, path: asset.path, atUs: at, size: 480 }).catch(() => {
    // A poster that will not generate is not an import failure; the media panel falls back
    // to a placeholder tile.
  })
}

export async function importPaths(paths: readonly string[]): Promise<ImportedAsset[]> {
  const out: ImportedAsset[] = []
  for (const raw of paths) {
    const path = resolve(raw)
    const existing = byPath.get(path)
    if (existing) {
      out.push({ asset: existing, reused: true })
      continue
    }
    allowPath(path)
    let asset: Asset
    try {
      asset = assetFrom(path, await probe(path))
    } catch (error) {
      asset = failedAsset(path, messageOf(error))
    }
    byPath.set(path, asset)
    warmPoster(asset)
    out.push({ asset, reused: false })
  }
  return out
}

export async function importDialog(window: BrowserWindow | null): Promise<ImportedAsset[]> {
  const options: Electron.OpenDialogOptions = {
    title: 'Import media',
    buttonLabel: 'Import',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Media',
        extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS, 'gif']
      },
      { name: 'Video', extensions: VIDEO_EXTENSIONS },
      { name: 'Audio', extensions: AUDIO_EXTENSIONS },
      { name: 'Images', extensions: [...IMAGE_EXTENSIONS, 'gif'] },
      { name: 'All files', extensions: ['*'] }
    ]
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return []
  return importPaths(result.filePaths)
}
