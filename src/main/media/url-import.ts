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
 *   otherwise download all of it), no live streams, at most 1080p, and a wall-clock limit after
 *   which the process is killed. The size cap is bay's: `--max-filesize` refuses only a size the
 *   server announces, so the folder is measured while yt-dlp runs and the process group killed
 *   past the cap. One download at a time. Every download running when bay quits is killed too.
 * - **Public hosts only.** Loopback, private, link-local and CGNAT literals and `localhost` names
 *   are refused (`checkDownloadUrl`); only the tests' own allowance admits 127.0.0.1.
 * - **Into bay's folder.** A fresh folder per download under `<userData>/downloads`; the path
 *   yt-dlp reports is checked to be inside it before anything imports it. A failed or killed
 *   download's folder is removed, so no half-file is ever found and imported later; a finished
 *   one is marked, and a folder a crash left unmarked is swept at the next startup.
 * - **Merged by bay's ffmpeg** (`--ffmpeg-location`), into an `.mp4`, preferring H.264 so the
 *   clip plays and exports without surprises.
 *
 * Injectable throughout (`UrlImportDeps`), so the tests run the real argument list against a
 * stand-in binary and a local server — never the network.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
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
    // An early refusal when the size is known up front; bay's own folder cap covers the rest.
    '--max-filesize',
    String(plan.maxBytes ?? URL_IMPORT_MAX_BYTES),
    // A live stream has no end to wait for: refused rather than recorded until the clock runs out.
    '--match-filter',
    '!is_live',
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
  /** How often the download folder is measured against `maxBytes`. */
  pollMs?: number
  spawnProcess?: (bin: string, args: string[]) => ChildProcess
  /**
   * Tests only: admit loopback and private addresses, so the real yt-dlp can be run against a
   * server on 127.0.0.1. `ipc.ts` never sets it, and nothing a tool call carries reaches it.
   */
  allowPrivateHostsForTests?: boolean
}

/** Written into a download's folder once the file is checked; a folder without it is a crash's leftovers. */
export const DOWNLOAD_COMPLETE_MARKER = '.bay-complete'

const running = new Set<ChildProcess>()
/** Folders of downloads in progress, which the startup sweep must leave alone. */
const inProgress = new Set<string>()
/** One download at a time: two 2 GB downloads at once is twice the disk and bandwidth nobody asked for. */
let busy = false

const UUID_FOLDER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Removes download folders a crash left behind: bay's own UUID-named folders under
 * `downloadsDir` with no completion marker. Anything else there — a file, a folder of another
 * name, a finished download, one in progress — is left alone. Resolves to the names removed;
 * never rejects.
 */
export async function sweepIncompleteDownloads(downloadsDir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(downloadsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !UUID_FOLDER.test(entry.name)) continue
    const folder = join(downloadsDir, entry.name)
    if (inProgress.has(folder)) continue
    try {
      await lstat(join(folder, DOWNLOAD_COMPLETE_MARKER))
      continue
    } catch {
      // No marker: unfinished.
    }
    await rm(folder, { recursive: true, force: true }).catch(() => undefined)
    removed.push(entry.name)
  }
  return removed
}

/** Every byte under `folder` — parts, fragments and merges included. Files vanishing mid-count are skipped. */
async function folderBytes(folder: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(folder, { withFileTypes: true, recursive: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    try {
      total += (await lstat(join(entry.parentPath, entry.name))).size
    } catch {
      // Renamed or removed between the listing and the stat (a .part becoming the file).
    }
  }
  return total
}

function gigabytes(bytes: number): string {
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${Math.round(gb * 10) / 10} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

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
  const checked = checkDownloadUrl(rawUrl, deps.allowPrivateHostsForTests ? { allowPrivateHosts: true } : {})
  if (!checked.ok) return checked
  const located = await (deps.locate ?? findYtDlp)()
  if (!located) {
    const searched = deps.searched ? await deps.searched() : (await searchDirs()).length
    return { ok: false, error: ytDlpMissingMessage(searched) }
  }

  const folder = join(deps.downloadsDir, randomUUID())
  const maxBytes = deps.maxBytes ?? URL_IMPORT_MAX_BYTES
  const args = ytDlpArgs({ url: checked.url, outDir: folder, ffmpeg: deps.ffmpeg, maxBytes })
  if (options.dryRun) return { ok: true, dryRun: true, ytDlp: located.path, args }

  // Checked and claimed in one synchronous step, so two calls racing cannot both start.
  if (busy) {
    return {
      ok: false,
      error:
        `Another import_url download is still running, and bay downloads one at a time. Nothing was started for ${checked.host}. ` +
        `Wait for the other to finish (it stops within ${Math.round((deps.timeoutMs ?? URL_IMPORT_TIMEOUT_MS) / 60_000)} minutes at most), then call import_url again.`
    }
  }
  busy = true
  inProgress.add(folder)
  try {
    return await download(checked, located.path, folder, args, maxBytes, deps)
  } finally {
    inProgress.delete(folder)
    busy = false
  }
}

async function download(
  checked: { url: string; host: string },
  ytDlp: string,
  folder: string,
  args: string[],
  maxBytes: number,
  deps: UrlImportDeps
): Promise<UrlImportResult> {
  await mkdir(folder, { recursive: true })
  const spawnProcess =
    deps.spawnProcess ??
    ((bin: string, a: string[]) => spawn(bin, a, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' }))
  const timeoutMs = deps.timeoutMs ?? URL_IMPORT_TIMEOUT_MS
  const pollMs = deps.pollMs ?? 1000

  const outcome = await new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; overBytes: number | null; spawnError?: string }>((resolve) => {
    let child: ChildProcess
    try {
      child = spawnProcess(ytDlp, args)
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, overBytes: null, spawnError: error instanceof Error ? error.message : String(error) })
      return
    }
    running.add(child)
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let overBytes: number | null = null
    let settled = false
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
    // yt-dlp's --max-filesize only refuses a size it is told up front. A chunked response, an
    // HLS/DASH stream or a merge of video and audio grows past it unannounced, so bay measures
    // the folder itself — parts and fragments included — and stops the download at the cap.
    let measuring = false
    const meter = setInterval(() => {
      if (measuring || settled) return
      measuring = true
      void folderBytes(folder).then((bytes) => {
        measuring = false
        if (!settled && overBytes === null && bytes > maxBytes) {
          overBytes = bytes
          killTree(child)
        }
      })
    }, pollMs)
    const finish = (result: { code: number | null; spawnError?: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(meter)
      running.delete(child)
      resolve({ ...result, stdout, stderr, timedOut, overBytes })
    }
    child.on('error', (error) => finish({ code: null, spawnError: error.message }))
    child.on('close', (code) => finish({ code }))
  })

  const discard = async (error: string): Promise<UrlImportResult> => {
    await rm(folder, { recursive: true, force: true })
    return { ok: false, error }
  }
  const overCap = (bytes: number): string =>
    `The download from ${checked.host} passed bay's ${gigabytes(maxBytes)} limit (${gigabytes(bytes)} so far), so it was stopped and nothing was kept. ` +
    `The page may be a very long video or a stream with no end; try a shorter video.`

  if (outcome.spawnError) return discard(`yt-dlp at ${ytDlp} could not be started: ${outcome.spawnError}`)
  if (outcome.overBytes !== null) return discard(overCap(outcome.overBytes))
  if (outcome.timedOut) {
    return discard(`The download from ${checked.host} was still running after ${Math.round(timeoutMs / 60_000)} minutes, so it was stopped and nothing was kept. Try a shorter video.`)
  }
  if (outcome.code !== 0) {
    const said = explain(outcome.stderr)
    if (/no such option/i.test(outcome.stderr)) {
      return discard(`The installed yt-dlp is too old for the options bay runs it with (${said}). Tell the user to update it with \`brew upgrade yt-dlp\`.`)
    }
    if (/larger than max-filesize|File is larger than/i.test(outcome.stderr)) {
      return discard(`That video is larger than bay's ${gigabytes(maxBytes)} limit, so it was not downloaded.`)
    }
    return discard(`yt-dlp could not download ${checked.url}${said ? `: ${said}` : ` (exit ${String(outcome.code)})`}.`)
  }
  if (/does not pass filter \(?!is_live\)?/i.test(outcome.stdout + outcome.stderr)) {
    return discard(`${checked.url} is a live stream. bay downloads finished videos only; import it once the stream has ended and been saved.`)
  }

  // `--print after_move:filepath` says where the file landed. Believe it only inside our folder.
  const reported = outcome.stdout.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
  if (!reported) {
    const said = explain(outcome.stderr)
    return discard(
      `yt-dlp finished without a file${said ? ` (${said})` : ''} — the page may have no downloadable video, ` +
        `it may be a live stream (bay does not record those), or it was over the size limit.`
    )
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
  // A download that finished between two measurements is measured once more, whole.
  const total = await folderBytes(folder)
  if (total > maxBytes) return discard(overCap(total))
  // Only now is the folder a finished download; one without this marker is a crash's leftovers.
  try {
    await writeFile(join(folder, DOWNLOAD_COMPLETE_MARKER), '')
  } catch (error) {
    return discard(`bay could not record the download as finished (${error instanceof Error ? error.message : String(error)}), so it was not kept.`)
  }
  return { ok: true, path: real, ytDlp }
}
