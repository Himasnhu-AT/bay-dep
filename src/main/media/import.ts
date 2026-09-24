/**
 * Turning files the user chose into assets.
 *
 * Import is the only place a path enters the allowlist, which makes it the security boundary
 * for `bay://` as well as the front door for media. It is also where a probe failure has to
 * stay survivable: a folder of forty clips with one corrupt file must import thirty-nine and
 * list the fortieth with its error, not fail as a batch.
 */

import { resolve } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { BrowserWindow, dialog } from 'electron'
import type { ImportedAsset } from '@shared/ipc'
import type { Asset } from '@shared/project'
import { allowPath } from '../protocol'
import { probe } from '../ffmpeg/probe'
import { compositionAsset } from '../html/compositions'
import { COMPOSITION_EXTENSIONS, isCompositionPath } from '@shared/composition'
import { isBrfPath } from '@shared/brf'
import { FONT_EXTENSIONS, isFontPath } from '@shared/fonts'
import { fontsDir } from '../paths'
import { importFontFile } from './font-import'
import { adoptProjectAssets, type Adoption } from './adopt'
import { thumbnail } from './thumbnails'
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  LUT_EXTENSIONS,
  assetFrom,
  failedAsset,
  isLutPath,
  lutAssetFrom
} from './asset-mint'

/**
 * Assets already imported this session, by absolute path. The renderer owns the project and
 * could answer this itself, but then two windows — or an import that races a drag-and-drop —
 * would each add their own copy of the same file.
 */
const byPath = new Map<string, Asset>()

/**
 * Admits an opened project's asset paths to `bay://` and re-seeds the dedupe map with them — only
 * the paths a project may name (`adopt.ts`). A refused path shows as offline media.
 */
export function adoptAssets(assets: readonly Asset[]): Adoption {
  return adoptProjectAssets(assets, byPath, allowPath, fontsDir())
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

/**
 * Forget a path, so the next import probes it again instead of returning the cached asset.
 *
 * Deduplication assumes a file's contents do not change under it, which is true of imported
 * media and false of a composition — bay writes those itself, and revising one is the whole
 * point of `write_composition`. Without this, a rewritten composition came back as the asset
 * built from the *previous* version: same id, same duration, same declared variables, and the
 * frame pool then handed back the window still holding the old document. The edit landed on
 * disk and changed nothing on screen, with nothing reporting a fault.
 */
export function forgetPath(path: string): void {
  byPath.delete(resolve(path))
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
      // An HTML composition declares its own duration and size, and ffprobe rejects the file
      // outright — so it takes a different route to the same Asset shape. Branching here rather
      // than in a second importer keeps deduplication and path registration in one place: two
      // import paths with separate ideas of "already imported" is how one file lands in the
      // pool twice under different ids.
      asset = isFontPath(path)
        ? await importFontFile(path, fontsDir())
        : isLutPath(path)
        ? await lutAsset(path)
        : isBrfPath(path)
        ? await brfAsset(path)
        : isCompositionPath(path)
          ? await compositionAsset(path)
          : assetFrom(path, await probe(path))
    } catch (error) {
      asset = failedAsset(path, messageOf(error))
    }
    // A font is served from bay's copy, not from where it was imported.
    if (asset.kind === 'font' && asset.path && !asset.error) allowPath(asset.path)
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
        extensions: [
          ...VIDEO_EXTENSIONS,
          ...AUDIO_EXTENSIONS,
          ...IMAGE_EXTENSIONS,
          'gif',
          ...COMPOSITION_EXTENSIONS,
          'brf',
          ...LUT_EXTENSIONS,
          ...FONT_EXTENSIONS
        ]
      },
      { name: 'Video', extensions: VIDEO_EXTENSIONS },
      { name: 'Audio', extensions: AUDIO_EXTENSIONS },
      { name: 'Images', extensions: [...IMAGE_EXTENSIONS, 'gif'] },
      { name: 'Compositions', extensions: [...COMPOSITION_EXTENSIONS, 'brf'] },
      { name: 'Colour LUTs', extensions: LUT_EXTENSIONS },
      { name: 'Fonts', extensions: [...FONT_EXTENSIONS] },
      { name: 'All files', extensions: ['*'] }
    ]
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return []
  return importPaths(result.filePaths)
}

/**
 * A `.brf` file becomes an asset carrying its source. Main reads it and never runs it: the code
 * runs only in the renderer's locked-down workers, which is also where its duration, size and
 * vars are read (`lib/brfImport.ts` fills them in before the asset reaches the project).
 */
async function brfAsset(path: string): Promise<Asset> {
  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    return failedAsset(path, `could not be read: ${messageOf(error)}`)
  }
  const base = failedAsset(path, '')
  delete base.error
  return { ...base, kind: 'brf', brfCode: source, hasVideo: true }
}

/** A `.cube` LUT: read and parsed here, so the renderer receives only the table. */
async function lutAsset(path: string): Promise<Asset> {
  let text: string
  try {
    // A 65-point cube is ~20 MB of text; anything much larger is not a LUT.
    if ((await stat(path)).size > 64 * 1024 * 1024) {
      return { ...failedAsset(path, 'is too large to be a .cube LUT'), kind: 'lut' }
    }
    text = await readFile(path, 'utf8')
  } catch (error) {
    return { ...failedAsset(path, `could not be read: ${messageOf(error)}`), kind: 'lut' }
  }
  return lutAssetFrom(path, text)
}
