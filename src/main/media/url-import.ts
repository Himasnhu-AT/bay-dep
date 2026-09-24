/**
 * Downloading a video from a web page with the user's own `yt-dlp`, into a folder bay owns.
 *
 * bay does not ship yt-dlp and does not fetch it: a site's rules about downloading are between
 * the user and the site, and the tool that decides how to talk to each one is theirs, installed
 * and updated by them (`brew install yt-dlp`). bay finds it the way it finds `claude` and
 * `whisper-cli` (`../search-dirs`), because a Finder-launched app sees none of the shell's PATH.
 *
 * What bay controls is how it is run, and every choice here is about an address that came from an
 * agent, which may have read it somewhere hostile:
 *
 * - **No shell.** Arguments are an array, and `--` ends the options before the address, so even an
 *   address that got past `checkDownloadUrl` could not be read as `--exec`.
 * - **No configuration but ours.** `--ignore-config` and `--no-config-locations`: a config file
 *   can carry `--exec`, cookies or an output template writing anywhere. `--no-plugin-dirs` keeps
 *   plugin code out; `--no-exec` clears any exec hook; no cookies, no batch file.
 * - **One video, capped.** `--no-playlist` and `--playlist-items 1` (a bare playlist address would
 *   otherwise download all of it), at most 1080p, `--max-filesize`, and a wall-clock limit after
 *   which the process is killed. Every download running when bay quits is killed too.
 * - **Into bay's folder.** A fresh folder per download under `<userData>/downloads`; the path
 *   yt-dlp reports is checked to be inside it before anything imports it. A failed or killed
 *   download's folder is removed, so no half-file is ever found and imported later.
 * - **Merged by bay's ffmpeg** (`--ffmpeg-location`), into an `.mp4`, preferring H.264 so the
 *   clip plays and exports without surprises.
 *
 * Injectable throughout (`UrlImportDeps`), so the tests run the real argument list against a
 * stand-in binary and a local server — never the network.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, realpath, rm, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import {
  URL_IMPORT_MAX_BYTES,
  URL_IMPORT_MAX_HEIGHT,
  URL_IMPORT_TIMEOUT_MS,
  checkDownloadUrl,
  type UrlImportResult
} from '@shared/url-import'
import { defaultIsExecutable, searchDirs, type LocateOptions } from '../search-dirs'

export interface YtDlpPlan {
  url: string
  /** Absolute; the only folder the download may write into. */
  outDir: string
  /** bay's ffmpeg, for merging video and audio. Null lets yt-dlp look for its own. */
  ffmpeg: string | null
  maxHeight?: number
  maxBytes?: number
}

/** The whole argument list, address last after `--`. Pure, so the tests read exactly what runs. */
export function ytDlpArgs(plan: YtDlpPlan): string[] {
  const height = plan.maxHeight ?? URL_IMPORT_MAX_HEIGHT
  return [
    '--ignore-config',
    '--no-config-locations',
    '--no-plugin-dirs',
    '--no-exec',
    '--no-batch-file',
    '--no-cookies',
    '--no-cookies-from-browser',
    '--no-playlist',
    '--playlist-items',
    '1',
    '--format',
    `bv*[height<=?${height}]+ba/b[height<=?${height}]`,
    '--format-sort',
    'vcodec:h264,res,acodec:aac',
    '--merge-output-format',
    'mp4',
    '--max-filesize',
    String(plan.maxBytes ?? URL_IMPORT_MAX_BYTES),
    '--socket-timeout',
    '30',
    '--no-mtime',
    '--no-progress',
    '--paths',
    plan.outDir,
    '--output',
    '%(title).120B [%(id)s].%(ext)s',
    '--print',
    'after_move:filepath',
    '--no-simulate',
    ...(plan.ffmpeg ? ['--ffmpeg-location', plan.ffmpeg] : []),
    '--',
    plan.url
  ]
}

/** `yt-dlp`, or null. Never throws: a missing binary is an answer, not a fault. */
export async function findYtDlp(options: LocateOptions = {}): Promise<{ path: string; from: string } | null> {
  const isExecutable = options.isExecutable ?? defaultIsExecutable
  const names = (options.platform ?? process.platform) === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp']
  for (const dir of await searchDirs(options)) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (await isExecutable(candidate)) return { path: candidate, from: dir }
    }
  }
  return null
}

export function ytDlpMissingMessage(searched: number): string {
  return (
    `yt-dlp is not installed, or bay cannot see it (bay looked in ${searched} places, including PATH ` +
    `and Homebrew). bay uses the user's own yt-dlp to download from web pages and does not install it. ` +
    `Tell the user to install it with \`brew install yt-dlp\` (or \`pipx install yt-dlp\`), then try again.`
  )
}

export interface UrlImportDeps {
  locate?: () => Promise<{ path: string } | null>
  /** How many places `locate` looked, for the not-found message. */
  searched?: () => Promise<number>
  /** `<userData>/downloads`. */
  downloadsDir: string
  ffmpeg: string | null
  timeoutMs?: number
  maxBytes?: number
  spawnProcess?: (bin: string, args: string[]) => ChildProcess
}

const running = new Set<ChildProcess>()

/** Kill every download in progress — for quit. */
export function cancelUrlImports(): void {
  for (const child of running) killTree(child)
  running.clear()
}

/**
 * yt-dlp runs ffmpeg as its own child to merge, and killing yt-dlp alone would leave that merge
 * writing on. The default spawn puts it in its own process group, so the whole group goes.
 */
function killTree(child: ChildProcess): void {
  try {
    if (child.pid !== undefined && process.platform !== 'win32') {
      process.kill(-child.pid, 'SIGKILL')
      return
    }
  } catch {
    // Not a group leader (an injected spawn): fall through to the process itself.
  }
  child.kill('SIGKILL')
}

/** yt-dlp's own explanation: its `ERROR:` lines, else the end of what it said. */
function explain(stderr: string): string {
  const errors = stderr.split('\n').filter((line) => line.startsWith('ERROR:'))
  const text = (errors.length > 0 ? errors.join(' ') : stderr.trim().split('\n').slice(-3).join(' ')).trim()
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
}

function inside(path: string, dir: string): boolean {
  return path.startsWith(dir.endsWith(sep) ? dir : dir + sep)
}

/**
 * Download one video. With `dryRun`, checks the address and finds yt-dlp and returns the exact
 * arguments it would run, starting nothing. Resolves to a result, never rejects.
 */
export async function importFromUrl(rawUrl: unknown, deps: UrlImportDeps, options: { dryRun?: boolean } = {}): Promise<UrlImportResult> {
  const checked = checkDownloadUrl(rawUrl)
  if (!checked.ok) return checked
  const located = await (deps.locate ?? findYtDlp)()
  if (!located) {
    const searched = deps.searched ? await deps.searched() : (await searchDirs()).length
    return { ok: false, error: ytDlpMissingMessage(searched) }
  }

  const folder = join(deps.downloadsDir, randomUUID())
  const args = ytDlpArgs({ url: checked.url, outDir: folder, ffmpeg: deps.ffmpeg, ...(deps.maxBytes ? { maxBytes: deps.maxBytes } : {}) })
  if (options.dryRun) return { ok: true, dryRun: true, ytDlp: located.path, args }

  await mkdir(folder, { recursive: true })
  const spawnProcess =
    deps.spawnProcess ??
    ((bin: string, a: string[]) => spawn(bin, a, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' }))
  const timeoutMs = deps.timeoutMs ?? URL_IMPORT_TIMEOUT_MS

  const outcome = await new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; spawnError?: string }>((resolve) => {
    let child: ChildProcess
    try {
      child = spawnProcess(located.path, args)
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, spawnError: error instanceof Error ? error.message : String(error) })
      return
    }
    running.add(child)
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000)
    })
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      running.delete(child)
      resolve({ code: null, stdout, stderr, timedOut, spawnError: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      running.delete(child)
      resolve({ code, stdout, stderr, timedOut })
    })
  })

  const discard = async (error: string): Promise<UrlImportResult> => {
    await rm(folder, { recursive: true, force: true })
    return { ok: false, error }
  }

  if (outcome.spawnError) return discard(`yt-dlp at ${located.path} could not be started: ${outcome.spawnError}`)
  if (outcome.timedOut) {
    return discard(`The download from ${checked.host} was still running after ${Math.round(timeoutMs / 60_000)} minutes, so it was stopped and nothing was kept. Try a shorter video.`)
  }
  if (outcome.code !== 0) {
    const said = explain(outcome.stderr)
    if (/no such option/i.test(outcome.stderr)) {
      return discard(`The installed yt-dlp is too old for the options bay runs it with (${said}). Tell the user to update it with \`brew upgrade yt-dlp\`.`)
    }
    if (/larger than max-filesize|File is larger than/i.test(outcome.stderr)) {
      return discard(`That video is larger than bay's ${Math.round((deps.maxBytes ?? URL_IMPORT_MAX_BYTES) / 1024 ** 3)} GB limit, so it was not downloaded.`)
    }
    return discard(`yt-dlp could not download ${checked.url}${said ? `: ${said}` : ` (exit ${String(outcome.code)})`}.`)
  }

  // `--print after_move:filepath` says where the file landed. Believe it only inside our folder.
  const reported = outcome.stdout.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
  if (!reported) {
    const said = explain(outcome.stderr)
    return discard(`yt-dlp finished without a file${said ? ` (${said})` : ''} — the page may have no downloadable video, or it was over the size limit.`)
  }
  let real: string
  try {
    real = await realpath(reported)
    const info = await stat(real)
    if (!info.isFile() || info.size === 0) return discard(`yt-dlp reported ${reported}, but it is not a file with anything in it.`)
  } catch {
    return discard(`yt-dlp reported ${reported}, but there is no file there.`)
  }
  const folderReal = await realpath(folder)
  if (!inside(real, folderReal)) return discard(`yt-dlp reported a file outside bay's download folder (${reported}); it was not imported.`)
  return { ok: true, path: real, ytDlp: located.path }
}
