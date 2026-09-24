/**
 * Where bay's own ffmpeg and ffprobe are — the LGPL build `script/build-ffmpeg.sh` produces.
 *
 * Pure Node (no Electron import), so the tests reach the same binaries through the same rule the
 * app does instead of each spelling a path of its own.
 *
 * Two places, in order:
 * - **Packaged**: electron-builder's `extraResources` copies `vendor/ffmpeg/<platform>-<arch>/`
 *   to `Contents/Resources/ffmpeg/`. That is a real directory, not the asar archive, so the OS
 *   can spawn from it and no `app.asar.unpacked` rewrite is needed.
 * - **A checkout**: `vendor/ffmpeg/<platform>-<arch>/` at the repository root, found by walking up
 *   from this module — `src/main/ffmpeg/` under `pnpm test`, `out/main/` in a built app.
 */

import { accessSync, constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface VendoredTools {
  dir: string
  ffmpeg: string
  ffprobe: string
}

const EXE = process.platform === 'win32' ? '.exe' : ''

/** `darwin-arm64`, `darwin-x64` — the directory name `script/build-ffmpeg.sh` writes. */
export function vendorPlatformDir(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`
}

function toolsIn(dir: string): VendoredTools | null {
  const ffmpeg = join(dir, `ffmpeg${EXE}`)
  const ffprobe = join(dir, `ffprobe${EXE}`)
  try {
    accessSync(ffmpeg, constants.X_OK)
    accessSync(ffprobe, constants.X_OK)
    return { dir, ffmpeg, ffprobe }
  } catch {
    return null
  }
}

/** How far up from this module a checkout's root can be: `src/main/ffmpeg` is three levels. */
const MAX_WALK = 6

export function vendoredTools(
  from: string = fileURLToPath(import.meta.url),
  resourcesPath: string | undefined = (process as { resourcesPath?: string }).resourcesPath
): VendoredTools | null {
  if (resourcesPath) {
    const packaged = toolsIn(join(resourcesPath, 'ffmpeg'))
    if (packaged) return packaged
  }
  let dir = dirname(from)
  for (let i = 0; i < MAX_WALK; i++) {
    const found = toolsIn(join(dir, 'vendor', 'ffmpeg', vendorPlatformDir()))
    if (found) return found
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** The sentence a test prints when it cannot run, naming the one command that fixes it. */
export const NO_VENDORED_FFMPEG =
  `no vendored ffmpeg at vendor/ffmpeg/${vendorPlatformDir()}/ — run script/build-ffmpeg.sh (this check did not run)`
