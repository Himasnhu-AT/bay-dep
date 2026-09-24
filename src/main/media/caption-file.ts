/**
 * Which files the caption channels may read, and how the size of a batch of paths is answered —
 * the pure half of `media/files.ts`, which imports Electron.
 *
 * `readCaptions` takes a path from the renderer, so it is a read primitive; it is kept to what a
 * caption file is — an `.srt` or `.vtt`, small enough to be text a person wrote — so a renderer
 * that asks for anything else is refused by name rather than handed the bytes.
 */

import { stat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'

export const CAPTION_EXTENSIONS = ['srt', 'vtt']

/** An hour of dense subtitles is ~100 KB; anything this large is not a caption file. */
export const MAX_CAPTION_BYTES = 5 * 1024 * 1024

/** Why a file is not one the caption channels will read, or null when it is. */
export function captionFileProblem(path: string, bytes: number): string | null {
  const extension = extname(path).slice(1).toLowerCase()
  if (!CAPTION_EXTENSIONS.includes(extension)) {
    return `${path} is not a caption file. Choose an .srt or .vtt file.`
  }
  if (bytes > MAX_CAPTION_BYTES) return `${path} is too large to be a caption file.`
  return null
}

/** Most paths one `stat` call answers — a media pool, not a disk scan. */
export const MAX_STAT_PATHS = 5000

/**
 * The size of each file, or null where there is no file: missing, a folder, or a path that is
 * not absolute (a relative path would be resolved against main's working directory, which is
 * not anything the project means).
 */
export async function sizesOf(paths: readonly unknown[]): Promise<(number | null)[]> {
  return Promise.all(
    paths.slice(0, MAX_STAT_PATHS).map(async (path) => {
      if (typeof path !== 'string' || !isAbsolute(path)) return null
      try {
        const info = await stat(path)
        return info.isFile() ? info.size : null
      } catch {
        return null
      }
    })
  )
}
