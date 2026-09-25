/**
 * Find the `claude` and `codex` binaries from inside a GUI application.
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
  return findBinary('claude', options)
}

/**
 * The `codex` binary (OpenAI's Codex CLI), or null. The same search as `claude`: Homebrew's cask
 * links it into `/opt/homebrew/bin` and npm's global install into whatever version manager is
 * current, and a GUI-launched process sees neither on its `PATH`.
 */
export async function findCodex(options: LocateOptions = {}): Promise<Located | null> {
  return findBinary('codex', options)
}

async function findBinary(name: string, options: LocateOptions): Promise<Located | null> {
  const platform = options.platform ?? process.platform
  const isExecutable = options.isExecutable ?? defaultIsExecutable
  // On Windows the extension is part of the filename, and the bare name alone matches nothing.
  const names = platform === 'win32' ? [`${name}.cmd`, `${name}.exe`, name] : [name]

  for (const dir of await searchDirs(options)) {
    for (const file of names) {
      const candidate = join(dir, file)
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

/** The same, for Codex — and signing in is part of installing it, since bay borrows that login. */
export function codexNotFoundMessage(searched: number): string {
  return (
    `Codex is not installed, or bay cannot see it. bay looked in ${searched} places, ` +
    `including PATH, Homebrew, and the usual version-manager directories. ` +
    `Install it with \`brew install --cask codex\` or \`npm install -g @openai/codex\`, then sign ` +
    `in once with \`codex login\` in a terminal.`
  )
}
