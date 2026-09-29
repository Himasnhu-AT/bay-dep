/**
 * The user's editing styles on disk: one `<id>.json` per style in `<userData>/styles`.
 *
 * Written only through `writeUserStyle`, which runs the shared `checkStyle` itself rather than
 * trusting the renderer's check — main is the lock for what lands on disk. A style is text: this
 * module parses JSON and writes JSON, and nothing in a style is ever run. Reading hands the parsed
 * files back unvalidated, and the renderer checks each again (`readUserStyles`), because a file in
 * the folder may have been dropped there or edited by hand. A file that is not read back is
 * named in `skipped`, never dropped silently: a style that saved and then vanished reads to the
 * agent as "there is no such style".
 *
 * Takes its folder as an argument, with no `electron` import, so the tests run it in a temp dir.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BUILT_IN_STYLE_IDS, STYLE_LIMITS, checkStyle, styleFileText, type EditingStyle } from '@shared/styles'

const FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/

/** The ids of the styles saved in `dir`, by file name. */
async function savedIds(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).map((name) => FILE.exec(name)?.[1]).filter((id): id is string => id !== undefined)
  } catch {
    return []
  }
}

/**
 * Every saved style, parsed but not checked, and every style-named file that was not read with
 * the reason. Files whose name is not a style id (`notes.txt`) are not styles and are not listed.
 */
export async function listUserStyles(dir: string): Promise<{ styles: unknown[]; skipped: string[] }> {
  const styles: unknown[] = []
  const skipped: string[] = []
  const ids = (await savedIds(dir)).sort()
  for (const id of ids.slice(STYLE_LIMITS.userStyles)) skipped.push(`${id}.json: past the ${STYLE_LIMITS.userStyles} styles bay reads.`)
  for (const id of ids.slice(0, STYLE_LIMITS.userStyles)) {
    const name = `${id}.json`
    const path = join(dir, name)
    try {
      const size = (await stat(path)).size
      if (size > STYLE_LIMITS.fileBytes) {
        skipped.push(`${name}: ${size} bytes, over the ${STYLE_LIMITS.fileBytes}-byte limit for a style file.`)
        continue
      }
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      const inner = typeof parsed === 'object' && parsed !== null ? (parsed as { id?: unknown }).id : undefined
      if (inner !== id) {
        skipped.push(`${name}: its id is ${JSON.stringify(inner)}, not "${id}" — rename the file or fix the id.`)
        continue
      }
      styles.push(parsed)
    } catch (error) {
      skipped.push(`${name}: not readable as JSON (${error instanceof Error ? error.message : String(error)}).`)
    }
  }
  return { styles, skipped }
}

export async function writeUserStyle(
  dir: string,
  input: unknown,
  options: { replace?: boolean } = {}
): Promise<{ ok: true; style: EditingStyle; replaced: boolean } | { ok: false; error: string }> {
  const checked = checkStyle(input, { origin: 'user', builtInIds: BUILT_IN_STYLE_IDS })
  if (!checked.ok) return { ok: false, error: `The style was not saved. ${checked.errors.join(' ')}` }
  // checkStyle holds the id to the slug rule, which is what makes it safe as a file name.
  const style = checked.style
  // Measured on exactly the bytes written, against the same limit a read applies.
  const text = styleFileText(style)
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > STYLE_LIMITS.fileBytes) {
    return {
      ok: false,
      error:
        `The style was not saved: as a file it is ${bytes} bytes, and the limit is ${STYLE_LIMITS.fileBytes} ` +
        `(text outside Latin script takes up to 3 bytes a character). Shorten the body or params.`
    }
  }

  const existing = await savedIds(dir)
  const replaced = existing.includes(style.id)
  if (replaced && options.replace !== true) {
    return {
      ok: false,
      error:
        `You already have a style called "${style.id}". Pass replace: true to save over it, or choose another id. ` +
        `Your styles: ${existing.join(', ')}.`
    }
  }
  if (!replaced && existing.length >= STYLE_LIMITS.userStyles) {
    return { ok: false, error: `You have ${existing.length} saved styles, the most bay keeps. Replace one of them (replace: true with its id).` }
  }

  await mkdir(dir, { recursive: true })
  const path = join(dir, `${style.id}.json`)
  const part = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.part`
  try {
    await writeFile(part, text, { mode: 0o600 })
    await rename(part, path)
  } catch (error) {
    await unlink(part).catch(() => undefined)
    return { ok: false, error: `The style could not be written: ${error instanceof Error ? error.message : String(error)}.` }
  }
  return { ok: true, style, replaced }
}
