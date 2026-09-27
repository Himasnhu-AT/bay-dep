/**
 * The user's editing styles on disk: one `<id>.json` per style in `<userData>/styles`.
 *
 * Written only through `writeUserStyle`, which runs the shared `checkStyle` itself rather than
 * trusting the renderer's check — main is the lock for what lands on disk. A style is text: this
 * module parses JSON and writes JSON, and nothing in a style is ever run. Reading hands the parsed
 * files back unvalidated, and the renderer checks each again (`readUserStyles`), because a file in
 * the folder may have been dropped there or edited by hand.
 *
 * Takes its folder as an argument, with no `electron` import, so the tests run it in a temp dir.
 */

import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BUILT_IN_STYLE_IDS, STYLE_LIMITS, checkStyle, type EditingStyle } from '@shared/styles'

const FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/

/** The ids of the styles saved in `dir`, by file name. */
async function savedIds(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).map((name) => FILE.exec(name)?.[1]).filter((id): id is string => id !== undefined)
  } catch {
    return []
  }
}

/** Every saved style, parsed but not checked. Files too large to be a style, or not JSON, are left out. */
export async function listUserStyles(dir: string): Promise<unknown[]> {
  const out: unknown[] = []
  for (const id of (await savedIds(dir)).sort().slice(0, STYLE_LIMITS.userStyles)) {
    const path = join(dir, `${id}.json`)
    try {
      if ((await stat(path)).size > STYLE_LIMITS.file * 2) continue
      out.push(JSON.parse(await readFile(path, 'utf8')))
    } catch {
      // Unreadable or not JSON: it is not a style, and the list is still the list.
    }
  }
  return out
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
  const part = `${path}.${process.pid}.part`
  await writeFile(part, JSON.stringify(style, null, 2) + '\n', { mode: 0o600 })
  await rename(part, path)
  return { ok: true, style, replaced }
}
