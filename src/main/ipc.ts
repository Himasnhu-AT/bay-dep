/**
 * Every `ipcMain.handle` in bay, in one table.
 *
 * The table is typed against `BayApi` rather than against `any`, which buys the one property
 * that matters: adding a method to the contract and forgetting to implement it is a
 * *compile* error here, not a runtime rejection the renderer discovers in a menu nobody
 * clicked during testing. The same goes for a handler whose signature has drifted.
 */

import { BrowserWindow, ipcMain, shell, app } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { BayApi } from '@shared/ipc'
import { IPC } from '@shared/ipc'
import { mediaToolsReady } from './media/ffmpeg'
import { probe } from './media/probe'
import { thumbnail, filmstrip } from './media/thumbnails'
import { waveform } from './media/waveform'
import { importDialog, importPaths } from './media/import'
import * as store from './project/store'
import * as encode from './export/encode'

/** `exportProgress` is pushed to the renderer, not invoked from it, so it has no handler. */
type InvokeChannel = Exclude<keyof typeof IPC, 'exportProgress'>

interface ChannelApi {
  appVersion: BayApi['app']['version']
  appPlatform: BayApi['app']['platform']
  appMediaToolsReady: BayApi['app']['mediaToolsReady']

  mediaImportDialog: BayApi['media']['importDialog']
  mediaImportPaths: BayApi['media']['importPaths']
  mediaProbe: BayApi['media']['probe']
  mediaThumbnail: BayApi['media']['thumbnail']
  mediaFilmstrip: BayApi['media']['filmstrip']
  mediaWaveform: BayApi['media']['waveform']
  mediaReveal: BayApi['media']['revealInFolder']

  projectInitial: BayApi['project']['initial']
  projectSave: BayApi['project']['save']
  projectSaveAs: BayApi['project']['saveAs']
  projectOpen: BayApi['project']['open']
  projectOpenPath: BayApi['project']['openPath']
  projectRecent: BayApi['project']['recent']
  projectAutosave: BayApi['project']['autosave']

  exportStart: BayApi['export']['start']
  exportPushFrame: BayApi['export']['pushFrame']
  exportFinish: BayApi['export']['finish']
  exportCancel: BayApi['export']['cancel']
  exportChoosePath: BayApi['export']['chooseOutputPath']

  windowMinimise: BayApi['window']['minimise']
  windowToggleMaximise: BayApi['window']['toggleMaximise']
  windowClose: BayApi['window']['close']
}

/** Fails to compile if a channel in `IPC` has no entry in `ChannelApi`. */
export const CHANNELS_COVERED: InvokeChannel extends keyof ChannelApi ? true : never = true

type Handler<F> = F extends (...args: infer A) => infer R
  ? (event: IpcMainInvokeEvent, ...args: A) => R
  : never

function windowOf(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

const handlers: { [K in keyof ChannelApi]: Handler<ChannelApi[K]> } = {
  appVersion: async () => app.getVersion(),
  appPlatform: async () => process.platform,
  appMediaToolsReady: async () => {
    const tools = mediaToolsReady()
    return { ready: tools.ready, ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe }
  },

  mediaImportDialog: (event) => importDialog(windowOf(event)),
  mediaImportPaths: (_event, paths) => importPaths(paths),
  mediaProbe: (_event, path) => probe(path),
  mediaThumbnail: (_event, request) => thumbnail(request),
  mediaFilmstrip: (_event, request) => filmstrip(request),
  mediaWaveform: (_event, assetId, path, buckets) => waveform(assetId, path, buckets),
  mediaReveal: async (_event, path) => {
    shell.showItemInFolder(path)
  },

  projectInitial: () => store.initial(),
  projectSave: (event, project) => store.save(project, windowOf(event)),
  projectSaveAs: (event, project) => store.saveAs(project, windowOf(event)),
  projectOpen: (event) => store.open(windowOf(event)),
  projectOpenPath: (_event, filePath) => store.openPath(filePath),
  projectRecent: () => store.recent(),
  projectAutosave: (_event, project) => store.autosave(project),

  exportStart: (event, request) => encode.start(request, event.sender),
  exportPushFrame: (_event, frame) => encode.pushFrame(frame),
  exportFinish: (_event, jobId) => encode.finish(jobId),
  exportCancel: (_event, jobId) => encode.cancel(jobId),
  exportChoosePath: (event, defaultName, format) =>
    encode.chooseOutputPath(defaultName, format, windowOf(event)),

  windowMinimise: async (event) => {
    windowOf(event)?.minimize()
  },
  windowToggleMaximise: async (event) => {
    const window = windowOf(event)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  },
  windowClose: async (event) => {
    windowOf(event)?.close()
  }
}

export function registerIpcHandlers(): void {
  for (const key of Object.keys(handlers) as (keyof ChannelApi)[]) {
    const handler = handlers[key] as unknown as (
      event: IpcMainInvokeEvent,
      ...args: unknown[]
    ) => unknown
    ipcMain.handle(IPC[key], handler)
  }
}
