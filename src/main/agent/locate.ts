/**
 * Find the `claude` binary from inside a GUI application.
 *
 * Where to look is `../search-dirs.ts`, which explains why `spawn('claude')` is not enough; this
 * file only knows the binary's names and what to say when it is missing.
 */

import { join } from 'node:path'
import { defaultIsExecutable, searchDirs, type LocateOptions } from '../search-dirs'

export interface Located {
  path: string
  /** Where it was found, for a message that tells the user something useful. */
  from: string
}

/** The `claude` binary, or null. Never throws: a missing binary is an answer, not a fault. */
export async function findClaude(options: LocateOptions = {}): Promise<Located | null> {
  const platform = options.platform ?? process.platform
  const isExecutable = options.isExecutable ?? defaultIsExecutable
  // On Windows the extension is part of the filename, and `claude` alone matches nothing.
  const names = platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude']

  for (const dir of await searchDirs(options)) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (await isExecutable(candidate)) return { path: candidate, from: dir }
    }
  }
  return null
}

/**
 * What to tell someone when it is not there.
 *
 * Names the thing to install and where it looked, because "claude not found" invites the
 * reasonable and wrong conclusion that it is not installed — when the usual cause is that it is
 * installed somewhere a GUI application cannot see.
 */
export function notFoundMessage(searched: number): string {
  return (
    `Claude Code is not installed, or bay cannot see it. bay looked in ${searched} places, ` +
    `including PATH, Homebrew, and the usual version-manager directories. ` +
    `Install it with \`npm install -g @anthropic-ai/claude-code\`, or if \`claude\` already ` +
    `works in your terminal, run \`which claude\` there and tell bay that path.`
  )
}
