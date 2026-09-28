/**
 * In-app updates, in main. electron-updater against a generic feed (`@shared/update-feed`), with
 * the decisions in `./policy` and `@shared/update`, both Electron-free and unit-tested.
 *
 * - Checks at launch and every six hours, and never downloads until the user presses Update
 *   (`autoDownload = false`).
 * - Only this module's session reaches the network, and only the feed's origin plus, for a
 *   GitHub Releases feed, GitHub's asset hosts (`allowUpdateRequest`, enforced in `onBeforeRequest` on electron-updater's partition, which
 *   carries all its requests and their redirects). The renderer stays offline.
 * - Installing is Squirrel.Mac. It swaps the bundle only for one signed by the same Developer ID
 *   as the running app, so a feed cannot install anything else.
 * - Works while bay is locked: the update channels are in `OPEN_WHILE_LOCKED`. Updating is how a
 *   locked-out build gets fixed.
 * - Restarting is the renderer's to ask for, because the renderer holds the project. It saves or
 *   autosaves first (`restartPlan`), then calls `install`.
 */

import { app, autoUpdater as nativeUpdater, BrowserWindow, session } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import electronUpdater from 'electron-updater'
import { IPC } from '@shared/ipc'
import { UPDATE_FEED } from '@shared/update-feed'
import { UPDATE_CHECK_INTERVAL_MS, isNewer, releaseNotesText, updateErrorMessage, type UpdateStatus, type UpdateStep } from '@shared/update'
import { allowUpdateRequest, updaterConfigYaml, updaterMode, type UpdaterMode } from './policy'

type AppUpdater = typeof electronUpdater.autoUpdater

let mode: UpdaterMode = { kind: 'off', soon: false, reason: 'Updates have not started yet.' }
let status: UpdateStatus = { state: 'disabled', current: '0.0.0', reason: mode.reason, soon: false }
let updater: AppUpdater | null = null
let timer: NodeJS.Timeout | null = null
let feedLabel = ''
let lastStep: UpdateStep = 'check'
/** The host guard's last refusal: Chromium reports it only as ERR_BLOCKED_BY_CLIENT. */
let lastRefusal: string | null = null
const listeners = new Set<(status: UpdateStatus) => void>()

export function updateStatus(): UpdateStatus {
  return status
}

export function onUpdateChange(listener: (status: UpdateStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(next: UpdateStatus): UpdateStatus {
  status = next
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.updateChanged, status)
  }
  for (const listener of listeners) listener(status)
  return status
}

function fail(error: unknown, during: UpdateStep): UpdateStatus {
  const raw = error instanceof Error ? error.message : String(error)
  console.warn(`[bay] update: ${during} failed: ${raw.split('\n')[0]}`)
  const next = 'next' in status ? status.next : null
  const notes = 'notes' in status ? status.notes : ''
  return publish({ state: 'error', current: app.getVersion(), feed: feedLabel, during, message: updateErrorMessage(raw, during, feedLabel, lastRefusal), next, notes })
}

/** Call once, after `ready`. */
export async function startUpdates(): Promise<void> {
  const current = app.getVersion()
  mode = updaterMode(app.isPackaged, process.env, UPDATE_FEED)
  if (mode.kind !== 'feed') {
    const reason = mode.reason
    publish({ state: 'disabled', current, reason, soon: mode.kind === 'off' && mode.soon })
    if (mode.kind === 'invalid') console.warn(`[bay] update: off: ${reason}`)
    return
  }
  const feed = mode.url
  feedLabel = new URL(feed).host
  if (mode.local) console.log(`[bay] update: using the local feed ${feed} (BAY_UPDATE_FEED)`)

  // The host guard, installed before the updater exists so its first request is covered.
  const updaterSession = session.fromPartition('electron-updater', { cache: false })
  updaterSession.webRequest.onBeforeRequest((details, callback) => {
    const verdict = allowUpdateRequest(details.url, feed, details.method)
    if (!verdict.ok) {
      lastRefusal = verdict.reason
      console.warn(`[bay] update: ${verdict.reason}`)
    }
    callback({ cancel: !verdict.ok })
  })

  // electron-updater reads its provider from a file. bay writes it here from `mode`, so the feed
  // is a constant in the source and a local feed needs no rebuilt bundle.
  const configPath = join(app.getPath('userData'), 'updater.yml')
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(configPath, updaterConfigYaml(feed))

  const instance = electronUpdater.autoUpdater
  instance.updateConfigPath = configPath
  instance.forceDevUpdateConfig = !app.isPackaged
  instance.autoDownload = false
  // A downloaded update also installs when the user quits normally. That quit is theirs, with
  // whatever it does about unsaved work. Restarting from the banner saves first.
  instance.autoInstallOnAppQuit = true
  instance.allowPrerelease = false
  instance.allowDowngrade = false
  instance.logger = {
    info: (message?: unknown) => console.log(`[bay] update: ${String(message)}`),
    warn: (message?: unknown) => console.warn(`[bay] update: ${String(message)}`),
    error: (message?: unknown) => console.warn(`[bay] update: ${String(message).split('\n')[0]}`),
    // Kept on: electron-updater's hand-off to Squirrel.Mac is reported only at debug level, and
    // it is the step that fails silently.
    debug: (message?: unknown) => console.log(`[bay] update (debug): ${String(message)}`)
  }
  // On a Mac, electron-updater says "downloaded" when ITS copy of the zip is on disk. Squirrel.Mac
  // then fetches the zip from it, unpacks it and checks its signature, and only then can it
  // install. So "Restart to update" is offered only once Squirrel says it is ready. Until then
  // the status stays at downloading, 100%, which reads "Preparing…". An unpackaged bay has no
  // Squirrel and cannot install, so there electron-updater's word is final.
  const waitForSquirrel = process.platform === 'darwin' && app.isPackaged
  let downloaded: { next: string; notes: string } | null = null
  let squirrelReady = false
  const offerRestart = (): void => {
    if (!downloaded || (waitForSquirrel && !squirrelReady)) return
    publish({ state: 'ready', current, feed: feedLabel, next: downloaded.next, notes: downloaded.notes })
  }
  nativeUpdater.on('update-downloaded', () => {
    console.log('[bay] update: Squirrel has the update ready to install')
    squirrelReady = true
    offerRestart()
  })
  nativeUpdater.on('before-quit-for-update', () => console.log('[bay] update: quitting to install'))

  instance.on('update-available', (info) => {
    if (!isNewer(info.version, current)) return
    publish({ state: 'available', current, feed: feedLabel, next: info.version, notes: releaseNotesText(info.releaseNotes), releaseDate: info.releaseDate ?? null })
  })
  instance.on('update-not-available', () => {
    publish({ state: 'current', current, feed: feedLabel, checkedAt: Date.now() })
  })
  instance.on('download-progress', (progress) => {
    if (status.state !== 'downloading') return
    publish({ ...status, percent: progress.percent, transferred: progress.transferred, total: progress.total })
  })
  instance.on('update-downloaded', (info) => {
    downloaded = { next: info.version, notes: 'notes' in status ? status.notes : releaseNotesText(info.releaseNotes) }
    if (status.state === 'downloading') publish({ ...status, percent: 100, transferred: status.total, total: status.total })
    offerRestart()
  })
  instance.on('error', (error) => {
    fail(error, lastStep)
  })

  updater = instance
  publish({ state: 'idle', current, feed: feedLabel })
  void checkForUpdates()
  timer = setInterval(() => {
    // A background check never interrupts a download or an update waiting to be installed.
    if (status.state === 'downloading' || status.state === 'ready') return
    void checkForUpdates()
  }, UPDATE_CHECK_INTERVAL_MS)
  timer.unref()
}

export function stopUpdates(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!updater) return status
  if (status.state === 'checking' || status.state === 'downloading') return status
  lastStep = 'check'
  const keep = status
  publish({ state: 'checking', current: app.getVersion(), feed: feedLabel })
  try {
    const result = await updater.checkForUpdates()
    // Events set the status. Nothing was reported (updater inactive): go back to what was there.
    // (Read through `updateStatus()`: the events changed `status` during the await.)
    if (updateStatus().state === 'checking') publish(result ? { state: 'current', current: app.getVersion(), feed: feedLabel, checkedAt: Date.now() } : keep)
  } catch (error) {
    if (updateStatus().state === 'checking') fail(error, 'check')
  }
  return status
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!updater) return status
  const from = status
  if (from.state !== 'available' && !(from.state === 'error' && from.during === 'download' && from.next)) return status
  lastStep = 'download'
  const next = from.next
  if (!next) return status
  publish({ state: 'downloading', current: app.getVersion(), feed: feedLabel, next, notes: from.notes, percent: 0, transferred: 0, total: 0 })
  try {
    await updater.downloadUpdate()
  } catch (error) {
    if (updateStatus().state === 'downloading') fail(error, 'download')
  }
  return status
}

/**
 * Quits and relaunches into the downloaded update. The renderer calls this only after it has
 * saved or autosaved the open project (`restartPlan`/`runRestart` in `@shared/update`).
 */
export async function installUpdate(): Promise<UpdateStatus> {
  if (!updater) return status
  const retrying = status.state === 'error' && status.during === 'install' && status.next !== null
  if (status.state !== 'ready' && !retrying) return status
  if (mode.kind === 'feed' && !mode.canInstall) {
    return fail(new Error('A development build cannot replace itself. The update was downloaded but not installed.'), 'install')
  }
  lastStep = 'install'
  console.log(`[bay] update: restarting into ${'next' in status ? status.next : '?'}`)
  // Squirrel's install is asynchronous. Its failure arrives as an `error` event, not a throw.
  setImmediate(() => updater?.quitAndInstall(false, true))
  return status
}
