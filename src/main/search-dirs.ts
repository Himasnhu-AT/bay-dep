/**
 * Where a GUI application should look for a command-line tool.
 *
 * **`spawn('claude')` does not work and the reason is not obvious.** A process launched from
 * Finder or the Dock inherits `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else — no Homebrew,
 * no version manager, none of the shell's own `PATH`. Every install location that matters is
 * invisible. It appears to work during development only because the app was started from a
 * terminal, which is exactly the environment the user will not be in.
 *
 * The search list below is adapted from how ChatCut solves the same problem (`buildGuiSafeSearchDirs`
 * in their main bundle, for `claude` / `codex` / `hermes`). It is worth taking wholesale because
 * the list is not a design, it is an accumulation: each entry is somewhere a real person's
 * install turned out to be. Inventing it from first principles means rediscovering every one of
 * them from a bug report.
 *
 * It lives at the root of `main/` because two subsystems need it — the agent finding `claude`
 * (`agent/locate.ts`) and transcription finding `whisper-cli` (`media/whisper.ts`) — and a
 * shared helper filed under one of them made `media/` depend on `agent/`.
 *
 * Injectable throughout so the whole thing is testable without a filesystem — the interesting
 * cases are "a version manager the test machine does not have" and "PATH is empty", and neither
 * can be arranged by reading the real disk.
 */

import { access, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'

export interface LocateOptions {
  env?: NodeJS.ProcessEnv
  homeDir?: string
  platform?: NodeJS.Platform
  /** Whether a path exists and can be run. Injected so tests need no files. */
  isExecutable?: (path: string) => Promise<boolean>
  /** Immediate child directory names, or none if the directory is absent. */
  children?: (path: string) => Promise<string[]>
}

export async function defaultIsExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function defaultChildren(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * Every directory worth looking in, most likely first.
 *
 * Order matters: whatever is on `PATH` wins, because a user who has arranged for a particular
 * binary to be first has said which one they mean.
 */
export async function searchDirs(options: LocateOptions = {}): Promise<string[]> {
  const env = options.env ?? process.env
  const home = options.homeDir ?? homedir()
  const platform = options.platform ?? process.platform
  const children = options.children ?? defaultChildren

  const dirs: (string | undefined)[] = [
    ...(env['PATH'] ?? '').split(delimiter).filter(Boolean),
    env['PNPM_HOME'],
    binOf(env['NPM_CONFIG_PREFIX'], platform),
    binOf(env['npm_config_prefix'], platform),
    join(home, '.local', 'bin'),
    join(home, '.local', 'share', 'pnpm'),
    join(home, '.bun', 'bin'),
    join(home, '.deno', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.asdf', 'shims'),
    join(home, '.local', 'share', 'mise', 'shims'),
    // Claude Code's own installer puts a copy here.
    join(home, '.claude', 'local')
  ]

  if (platform === 'win32') {
    const appData = env['APPDATA']
    if (appData) dirs.push(join(appData, 'npm'))
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin', '/bin')
    // Version managers install per Node version, so the bin directory has a number in it that
    // nothing can guess. Listing the tree is the only way to find it.
    const versioned = await Promise.all([
      under(children, join(home, '.nvm', 'versions', 'node'), ['bin']),
      under(children, join(home, '.fnm', 'node-versions'), ['installation', 'bin']),
      under(children, join(home, '.local', 'share', 'fnm', 'node-versions'), ['installation', 'bin']),
      under(children, join(home, '.asdf', 'installs', 'nodejs'), ['bin']),
      under(children, join(home, '.local', 'share', 'mise', 'installs', 'node'), ['bin'])
    ])
    for (const list of versioned) dirs.push(...list)
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const dir of dirs) {
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    out.push(dir)
  }
  return out
}

function binOf(prefix: string | undefined, platform: NodeJS.Platform): string | undefined {
  if (!prefix) return undefined
  return platform === 'win32' ? prefix : join(prefix, 'bin')
}

async function under(
  children: (path: string) => Promise<string[]>,
  root: string,
  tail: string[]
): Promise<string[]> {
  const names = await children(root)
  return names.map((name) => join(root, name, ...tail))
}
