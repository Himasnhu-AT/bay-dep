/**
 * App lifecycle.
 *
 * Almost nothing lives here on purpose — one window, the handlers it needs, and the macOS
 * conventions. Anything with a decision in it belongs in the module that owns the decision.
 */

import { isLocalRequest } from './offline'
import { app, BrowserWindow, Menu, shell, screen } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import type { MenuCommand } from '@shared/ipc'
import { IPC } from '@shared/ipc'
import { registerBayScheme, registerBayProtocolHandler } from './protocol'
import { registerIpcHandlers } from './ipc'
import {
  clearRecentMenu,
  closeStore,
  onRecentsChanged,
  readWindowBounds,
  recentForMenu,
  takePendingOpen,
  rememberOpenPath,
  writeWindowBounds
} from './project/store'
import type { RecentProject } from '@shared/ipc'
import { cacheDir } from './paths'
import { sweepStaleCaches } from './media/cache-key'
import { cancelCacheUpkeep, runCacheUpkeep } from './media/cache-upkeep'
import { startMcpServer, stopMcpServer } from './mcp/server'
import { isOpenableExternally } from './external'
import { describeSocket } from './mcp/socket-server'
import { cancelAll } from './export/encode'
import { menuCommandTarget, menuTemplate } from './menu'
import { restoreBounds, DEFAULT_HEIGHT, DEFAULT_WIDTH, MIN_HEIGHT, MIN_WIDTH } from './window-state'
import { onAccessChange, startAccess, stopAccess } from './auth/access'
import { startGeneration, stopGeneration } from './generate/service'
import { startUpdates, stopUpdates } from './update/updater'
import { disposeAgent } from './agent/host'
import { isEntitled } from '@shared/access'
import { appNameFor } from './app-name'

// The main bundle is ESM, where `__dirname` does not exist. Everything loaded by path — the
// preload script and the production renderer — is resolved from here.
const here = fileURLToPath(new URL('.', import.meta.url))

const APP_NAME = 'bay'

// `setName` before anything else reads it. On macOS the menu bar takes the name from the
// bundle's Info.plist in a packaged app, but the About panel, `app.getPath('userData')` and
// every dialog title come from here — so an unpackaged run says "bay" too, and userData does
// not split between "Electron" and "bay" the first time someone packages the app. A test build
// stamped with a `bay-…` productName keeps that name, and so its own data (`./app-name`).
app.setName(appNameFor(app.getName(), app.isPackaged))

// Before `whenReady`, without exception: Electron reads the privileged-scheme table during
// startup and a later registration is accepted and then ignored.
registerBayScheme()

/**
 * macOS delivers a double-clicked document through `open-file`, and it fires **before**
 * `ready` on a cold launch — earlier than any window exists to show it in. Queueing it here
 * and replaying once there is somewhere to put it is the whole trick; handling it only inside
 * `whenReady` silently drops the document that started the app.
 */
app.on('open-file', (event, path) => {
  event.preventDefault()
  const window = menuCommandTarget(BrowserWindow.getFocusedWindow(), [...editorWindows], lastFocusedEditor)
  if (window && !window.webContents.isLoading()) {
    sendCommand(window, { type: 'open-path', path })
    return
  }
  rememberOpenPath(path)
})

function sendCommand(window: BrowserWindow, command: MenuCommand): void {
  if (window.isDestroyed()) return
  window.webContents.send(IPC.appMenuCommand, command)
}

/** The windows that load the editor — the only ones a menu command may go to. */
const editorWindows = new Set<BrowserWindow>()
let lastFocusedEditor: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const saved = restoreBounds(
    readWindowBounds(),
    screen.getAllDisplays().map((display) => display.workArea)
  )

  const window = new BrowserWindow({
    ...(saved ?? { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    // The window is painted before the renderer has anything to show. Without a dark ground
    // that gap is a white flash on every launch, which is the single loudest way an app says
    // it is a web page in a costume.
    backgroundColor: '#0b0d10',
    title: APP_NAME,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 20 } : undefined,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The ffmpeg spawns need Node, and the preload script has to be able to reach the
      // bridge. Node stays out of the renderer itself, which is where it would matter.
      sandbox: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  // Saved on move/resize rather than on close, because a crash or a force-quit is exactly
  // when someone has moved the window somewhere deliberate. Debounced: a drag emits these
  // continuously and every one of them would be a database write.
  let saveTimer: NodeJS.Timeout | null = null
  const rememberBounds = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!window.isDestroyed() && !window.isMinimized() && !window.isFullScreen()) {
        writeWindowBounds(window.getNormalBounds())
      }
    }, 400)
  }
  window.on('resize', rememberBounds)
  window.on('move', rememberBounds)

  // An external link in an editor is always a mistake in-window; it belongs in the browser —
  // if it is a web page at all (see `isOpenableExternally`).
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isOpenableExternally(url)) void shell.openExternal(url)
    else console.warn(`[bay] not opening ${url.slice(0, 80)}: only https links leave the app`)
    return { action: 'deny' }
  })

  // Nothing in this window reaches the network — not the page, and not a worker it starts, which
  // the page's CSP does not bind (see offline.ts).
  const offlineDevServer = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const allowed = isLocalRequest(details.url, offlineDevServer)
    if (!allowed) console.warn(`[bay] refused a network request from the editor: ${details.url.slice(0, 120)}`)
    callback({ cancel: !allowed })
  })

  // Nothing bay does should ever navigate the shell away from its own document.
  window.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env['ELECTRON_RENDERER_URL']
    if (devServer && url.startsWith(devServer)) return
    event.preventDefault()
  })

  editorWindows.add(window)
  window.on('focus', () => {
    lastFocusedEditor = window
  })
  window.on('closed', () => {
    editorWindows.delete(window)
    if (lastFocusedEditor === window) lastFocusedEditor = null
    if (saveTimer) clearTimeout(saveTimer)
    void cancelAll()
  })

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devServer) void window.loadURL(devServer)
  else void window.loadFile(join(here, '../renderer/index.html'))

  return window
}

function installMenu(recents: readonly RecentProject[] = []): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate({
        appName: APP_NAME,
        isMac: process.platform === 'darwin',
        includeDevTools: is.dev,
        recents,
        onClearRecents: () => void clearRecentMenu(),
        onCommand: (command) => {
          // The focused editor, not the first window: a composition's hidden render window is
          // a window too, and it has no command handler (`menuCommandTarget`).
          const window = menuCommandTarget(BrowserWindow.getFocusedWindow(), [...editorWindows], lastFocusedEditor)
          if (window) sendCommand(window, command)
        }
      })
    )
  )
}

/**
 * The menu again with File › Open Recent as it is now. Rebuilds are serialised and coalesced:
 * reading the recents checks every file on disk, and two reads finishing out of order must not
 * leave the older list installed.
 */
let menuRebuild: Promise<void> | null = null
let menuStale = false
function rebuildMenu(): void {
  if (menuRebuild) {
    menuStale = true
    return
  }
  menuRebuild = recentForMenu()
    .then((recents) => installMenu(recents))
    .catch(() => installMenu())
    .finally(() => {
      menuRebuild = null
      if (menuStale) {
        menuStale = false
        rebuildMenu()
      }
    })
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.freeholt.bay')
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: 'Freeholt — runs on your Mac, and minds its own business.',
    credits: 'A video editor that keeps your footage where you put it.'
  })

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerBayProtocolHandler()
  registerIpcHandlers()

  // Access before anything can be asked of bay: until `startAccess` has read the stored state
  // the status is `signed-out`, so the gate (IPC and both sockets) refuses rather than guessing.
  // Losing access while running ends the in-app agent's session — its tool calls would all be
  // refused anyway, and a model left talking to a locked app only produces refusals.
  onAccessChange((status) => {
    if (!isEntitled(status)) void disposeAgent()
  })
  void startAccess().then((status) => console.log(`[bay] access: ${status.state}`))
  // Updates run whether or not bay is signed in (their channels are open while locked).
  void startUpdates().catch((error: unknown) => {
    console.warn(`[bay] update: could not start: ${error instanceof Error ? error.message : String(error)}`)
  })
  // Generation keys and jobs. Contacts nothing unless a job was still running at the last quit,
  // in which case its polling resumes rather than paying for the clip twice.
  void startGeneration().catch((error: unknown) => {
    console.warn(`[bay] generation: could not start: ${error instanceof Error ? error.message : String(error)}`)
  })
  installMenu()
  onRecentsChanged(rebuildMenu)
  rebuildMenu()

  // Reclaims thumbnail and waveform directories left by an older cache scheme. Nothing else
  // in bay evicts, so without this a scheme change leaks its entire previous cache for the
  // life of the install. Startup is the only moment nothing is reading them.
  void sweepStaleCaches(cacheDir()).then((removed) => {
    if (removed.length > 0) {
      console.log(
        `[bay] Reclaimed ${removed.length} stale cache director${removed.length === 1 ? 'y' : 'ies'}: ${removed.join(', ')}`
      )
    }
  })

  // One pass at startup, before anything is in use. This is the only moment the whole cache
  // is evictable, so it is where a session that ended over budget gets reclaimed — and why
  // being over budget at quit is survivable rather than permanent.
  // The agent surface. Non-fatal by construction now rather than by comment: `startMcpServer`
  // returns a status instead of throwing, and the `.catch()` is here because its absence is
  // what turned a degradation into an unhandled rejection last time.
  void startMcpServer()
    .then((status) => {
      const problem = describeSocket(status)
      if (problem) console.error(`[bay] ${problem}`)
      else console.log(`[bay] MCP socket listening at ${status.path}`)
    })
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      console.error(`[bay] The agent socket failed to start: ${reason}. bay is otherwise fine.`)
    })

  void runCacheUpkeep()

  createWindow()

  app.on('activate', () => {
    // Editors, not windows: a composition's hidden render window must not stand in for one.
    if (editorWindows.size === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS keeps the app alive with no windows; every other platform expects a quit.
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  stopAccess()
  stopGeneration()
  stopUpdates()
  cancelCacheUpkeep()
  void stopMcpServer()
  // Anything queued and never claimed — a document double-clicked at launch that the renderer
  // never asked for — is dropped here rather than surviving into the next launch as a
  // surprise project.
  takePendingOpen()
  closeStore()
})
