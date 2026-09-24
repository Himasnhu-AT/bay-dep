/**
 * A font file becomes a `kind: 'font'` asset, backed by bay's own copy of the file.
 *
 * Split from `import.ts` (which imports Electron) so the whole route — read, parse, copy, mint —
 * runs under `pnpm test` against a real font. The folder is passed in; `import.ts` passes
 * `fontsDir()`.
 *
 * **Copied, content-addressed.** A font is small, and the project must keep drawing in it when the
 * original is moved or deleted — the same reason a LUT's table lives in the project. The copy is
 * named by the hash of its bytes, so importing the same face twice, from anywhere, is one file,
 * and a different face can never overwrite it.
 */

import { createHash, randomUUID } from 'node:crypto'
import { copyFile, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Asset } from '@shared/project'
import { readFontInfo } from './font-file'

/** Larger than any real single font (a CJK variable font is ~20 MB); anything bigger is not one. */
const MAX_FONT_BYTES = 64 * 1024 * 1024

function failed(path: string, message: string): Asset {
  return {
    id: randomUUID(),
    kind: 'font',
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

export async function importFontFile(path: string, fontsDir: string): Promise<Asset> {
  let bytes: Uint8Array
  try {
    if ((await stat(path)).size > MAX_FONT_BYTES) return failed(path, 'is too large to be a font file')
    bytes = new Uint8Array(await readFile(path))
  } catch (error) {
    return failed(path, `could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }
  let info
  try {
    info = readFontInfo(bytes, path)
  } catch (error) {
    return failed(path, `is not a font bay can read: ${error instanceof Error ? error.message : String(error)}`)
  }
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24)
  const copy = join(fontsDir, `${hash}${extname(path).toLowerCase()}`)
  try {
    await copyFile(path, copy)
  } catch (error) {
    return failed(path, `could not be copied into bay's fonts folder: ${error instanceof Error ? error.message : String(error)}`)
  }
  return {
    id: randomUUID(),
    kind: 'font',
    name: basename(path),
    path: copy,
    durationUs: 0,
    width: null,
    height: null,
    fps: null,
    hasAudio: false,
    hasVideo: false,
    posterPath: null,
    waveformPath: null,
    createdAt: Date.now(),
    font: info
  }
}
