/**
 * What a composition window may load: its own folder, and nothing else.
 *
 * A composition is local HTML that an agent — or whoever shared the project — wrote, rendered in
 * a hidden window with web access. Before this, it could `fetch('file:///Users/<you>/.ssh/id_rsa')`
 * and post the result anywhere, which made opening someone's project the same as running their
 * script. bay's composition contract already says remote resources are blocked and that
 * vendored files sit next to the composition (`remote-resource` fault in `@shared/composition`);
 * this is where that stops being a claim.
 *
 * The rule: `file:` URLs inside the composition's own folder (after resolving symlinks, so a link
 * cannot point out of it), and the self-contained schemes a page makes for itself — `data:`,
 * `blob:`, `about:`. Everything else — `http(s)`, `ws(s)`, `bay:`, `file:` anywhere else — is
 * cancelled.
 *
 * No Electron import: the decision is tested on its own; `compositions.ts` wires it to the
 * partition's `webRequest`.
 */

import { isAbsolute, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF_CONTAINED = new Set(['data:', 'blob:', 'about:'])

/** Is `path` the folder itself or anything under it? Both must already be real (resolved) paths. */
export function isInside(folder: string, path: string): boolean {
  const rel = relative(folder, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

export type SandboxVerdict = { allow: true } | { allow: false; reason: string }

/**
 * Decide a request. `realPath` resolves a filesystem path through symlinks (the caller passes
 * `fs.realpath`); a path that does not exist resolves to itself, which is then still checked.
 */
export async function decideCompositionRequest(
  url: string,
  folder: string | null,
  realPath: (path: string) => Promise<string>
): Promise<SandboxVerdict> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { allow: false, reason: `unparseable URL ${url}` }
  }
  if (SELF_CONTAINED.has(parsed.protocol)) return { allow: true }
  if (parsed.protocol !== 'file:') {
    return { allow: false, reason: `${parsed.protocol} is not allowed in a composition (no network, no app URLs)` }
  }
  if (!folder) return { allow: false, reason: 'no composition folder is known for this window' }
  let path: string
  try {
    path = fileURLToPath(parsed)
  } catch {
    return { allow: false, reason: `not a local file URL: ${url}` }
  }
  const resolve = async (p: string): Promise<string> => {
    try {
      return await realPath(p)
    } catch {
      return p
    }
  }
  const [realFolder, real] = await Promise.all([resolve(folder), resolve(path)])
  return isInside(realFolder, real)
    ? { allow: true }
    : { allow: false, reason: `${path} is outside the composition's folder ${folder}` }
}
