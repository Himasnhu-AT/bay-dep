/**
 * App lifecycle.
 *
 * Almost nothing lives here on purpose — one window, the handlers it needs, and the macOS
 * conventions. Anything with a decision in it belongs in the module that owns the decision.
 */

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { registerBayScheme, registerBayProtocolHandler } from './protocol'
import { registerIpcHandlers } from './ipc'
import { closeStore } from './project/store'
import { cacheDir } from './paths'
import { sweepStaleCaches } from './media/cache-key'
import { cancelAll } from './export/encode'

// The main bundle is ESM, where `__dirname` does not exist. Everything loaded by path — the
// preload script and the production renderer — is resolved from here.
const here = fileURLToPath(new URL('.', import.meta.url))

// Before `whenReady`, without exception: Electron reads the privileged-scheme table during
// startup and a later registration is accepted and then ignored.
registerBayScheme()

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    // The window is painted before the renderer has anything to show. Without a dark ground
    // that gap is a white flash on every launch, which is the single loudest way an app says
    // it is a web page in a costume.
    backgroundColor: '#0b0d10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 20 } : undefined,
    webPreferences: {
      preload: join(here, '../preload/index.mjs'),
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

  // An external link in an editor is always a mistake in-window; it belongs in the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Nothing bay does should ever navigate the shell away from its own document.
  window.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env['ELECTRON_RENDERER_URL']
    if (devServer && url.startsWith(devServer)) return
    event.preventDefault()
  })

  window.on('closed', () => {
    void cancelAll()
  })

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devServer) void window.loadURL(devServer)
  else void window.loadFile(join(here, '../renderer/index.html'))

  return window
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.freeholt.bay')

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerBayProtocolHandler()
  registerIpcHandlers()

  // Reclaims thumbnail and waveform directories left by an older cache scheme. Nothing else
  // in bay evicts, so without this a scheme change leaks its entire previous cache for the
  // life of the install. Startup is the only moment nothing is reading them.
  void sweepStaleCaches(cacheDir()).then((removed) => {
    if (removed.length > 0) {
      console.log(`[bay] Reclaimed ${removed.length} stale cache director${removed.length === 1 ? 'y' : 'ies'}: ${removed.join(', ')}`)
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS keeps the app alive with no windows; every other platform expects a quit.
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  closeStore()
})
