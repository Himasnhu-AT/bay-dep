/**
 * Puts bay's move library beside a composition that asks for it (`@shared/motion-file` says how a
 * document asks, and what each outcome reads as).
 *
 * Free of `electron` on purpose: `compositions.ts` cannot load under `pnpm test`, and what
 * this does to a folder — above all what it refuses to overwrite — is worth a test.
 */

import { lstat, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MOTION_BANNER,
  MOTION_FILE,
  referencesMotionFile,
  usesMotionGlobal,
  type MotionFileResult
} from '@shared/motion-file'
import { MOTION_SCRIPT } from './motion-script.generated'

/**
 * After `html` has been written into `dir`: write `bay-motion.js` there if the document loads it,
 * and say what happened. Returns null when the document has nothing to do with the library.
 *
 * bay overwrites only its own copy — a file that starts with bay's banner, so a composition
 * written by an older bay gets the current moves — and never a link, or a file of that name that
 * someone else put there. An identical file is left untouched: a composition window may be
 * reading it.
 */
export async function ensureMotionFile(
  dir: string,
  html: string,
  script: string = MOTION_SCRIPT
): Promise<MotionFileResult | null> {
  if (!referencesMotionFile(html)) return usesMotionGlobal(html) ? { state: 'unreferenced' } : null
  const target = join(dir, MOTION_FILE)
  try {
    const existing = await lstat(target).catch(() => null)
    if (existing) {
      if (!existing.isFile()) return { state: 'foreign' }
      const current = await readFile(target, 'utf8')
      if (current === script) return { state: 'written' }
      if (!current.startsWith(MOTION_BANNER)) return { state: 'foreign' }
    }
    // Renamed into place, so a window loading the file never reads half of it.
    const part = `${target}.${process.pid}.part`
    await writeFile(part, script, 'utf8')
    await rename(part, target)
    return { state: 'written' }
  } catch (error) {
    return { state: 'failed', error: (error as Error).message }
  }
}
