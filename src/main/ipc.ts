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
import type { McpToolResult } from '@shared/mcp'
import { IPC } from '@shared/ipc'
import {
  compositionFrameAt,
  importCompositions,
  inspectComposition,
  release as releaseComposition,
  releasePath,
  writeComposition
} from './html/compositions'
import { disposeAgent, exportTranscript, sendToAgent, startAgent, stopAgent } from './agent/host'
import { mediaToolsReady } from './ffmpeg/ffmpeg'
import { collectMetrics } from './metrics'
import { probe } from './ffmpeg/probe'
import { thumbnail, filmstrip } from './media/thumbnails'
import {
  cancelWhisperDownload,
  deleteWhisperModel,
  downloadWhisperModel,
  installWhisperEngine,
  onWhisperDownload,
  transcribeFile,
  whisperStatus
} from './media/whisper'
import { homedir } from 'node:os'
import { waveform } from './media/waveform'
import { detectBeats } from './media/beats'
import { sizesOf } from './media/caption-file'
import { locate, openCaptions, readCaptions, saveCaptions } from './media/files'
import { forgetPath, importDialog, importPaths } from './media/import'
import { freezeFrame } from './media/freeze-frame'
import * as store from './project/store'
import * as encode from './export/encode'
import { mcpStatus, setExecutorReady, settleToolCall } from './mcp/server'
import { writeGenerated, writeTemplate } from './html/templates'
import * as access from './auth/access'
import * as update from './update/updater'
import { refuseChannel } from './auth/gate'

/** Channels pushed *to* the renderer. They carry no handler, so the table excludes them. */
type PushChannel = 'exportProgress' | 'appMenuCommand' | 'mcpToolCall' | 'agentEvent' | 'whisperProgress' | 'accessChanged' | 'updateChanged'
type InvokeChannel = Exclude<keyof typeof IPC, PushChannel | 'mcpToolResult' | 'mcpExecutorReady'>

interface ChannelApi {
  appVersion: BayApi['app']['version']
  appMetrics: BayApi['app']['metrics']
  appPlatform: BayApi['app']['platform']
  appMediaToolsReady: BayApi['app']['mediaToolsReady']
  appStorageReady: BayApi['app']['storageReady']
  appMcpReady: BayApi['app']['mcpReady']

  mediaImportDialog: BayApi['media']['importDialog']
  mediaImportPaths: BayApi['media']['importPaths']
  mediaProbe: BayApi['media']['probe']
  mediaThumbnail: BayApi['media']['thumbnail']
  mediaTranscribe: BayApi['media']['transcribe']

  whisperStatus: BayApi['whisper']['status']
  whisperDownload: BayApi['whisper']['download']
  whisperCancel: BayApi['whisper']['cancelDownload']
  whisperDelete: BayApi['whisper']['deleteModel']
  whisperInstall: BayApi['whisper']['installEngine']
  mediaFilmstrip: BayApi['media']['filmstrip']
  mediaWaveform: BayApi['media']['waveform']
  mediaBeats: BayApi['media']['beats']
  mediaReveal: BayApi['media']['revealInFolder']
  mediaStat: BayApi['media']['stat']
  mediaLocate: BayApi['media']['locate']
  mediaOpenCaptions: BayApi['media']['openCaptions']
  mediaReadCaptions: BayApi['media']['readCaptions']
  mediaSaveCaptions: BayApi['media']['saveCaptions']
  mediaFreezeFrame: BayApi['media']['freezeFrame']

  projectInitial: BayApi['project']['initial']
  projectSave: BayApi['project']['save']
  projectSaveAs: BayApi['project']['saveAs']
  projectOpen: BayApi['project']['open']
  projectOpenPath: BayApi['project']['openPath']
  projectRecent: BayApi['project']['recent']
  projectAutosave: BayApi['project']['autosave']
  projectLaunchRequest: BayApi['project']['launchRequest']
  projectCreate: BayApi['project']['create']
  projectForget: BayApi['project']['forget']
  projectReveal: BayApi['project']['reveal']
  projectRename: BayApi['project']['rename']
  projectDuplicate: BayApi['project']['duplicate']
  projectTrash: BayApi['project']['trash']

  compositionInspect: BayApi['composition']['inspect']
  compositionWrite: BayApi['composition']['write']
  compositionWriteTemplate: BayApi['composition']['writeTemplate']
  compositionWriteGenerated: BayApi['composition']['writeGenerated']
  compositionImport: BayApi['composition']['import']
  compositionFrameAt: BayApi['composition']['frameAt']
  compositionRelease: BayApi['composition']['release']

  agentStart: BayApi['agent']['start']
  agentSend: BayApi['agent']['send']
  agentStop: BayApi['agent']['stop']
  agentDispose: BayApi['agent']['dispose']
  agentExportTranscript: BayApi['agent']['exportTranscript']

  exportStart: BayApi['export']['start']
  exportPushFrame: BayApi['export']['pushFrame']
  exportFinish: BayApi['export']['finish']
  exportCancel: BayApi['export']['cancel']
  exportChoosePath: BayApi['export']['chooseOutputPath']
  exportReveal: BayApi['export']['reveal']
  exportOpen: BayApi['export']['open']

  accessStatus: BayApi['access']['status']
  accessSignIn: BayApi['access']['signIn']
  accessCancelSignIn: BayApi['access']['cancelSignIn']
  accessSignOut: BayApi['access']['signOut']
  accessRecheck: BayApi['access']['recheck']
  accessRequestAccess: BayApi['access']['requestAccess']
  accessRefer: BayApi['access']['refer']

  updateStatus: BayApi['update']['status']
  updateCheck: BayApi['update']['check']
  updateDownload: BayApi['update']['download']
  updateInstall: BayApi['update']['install']

  windowMinimise: BayApi['window']['minimise']
  windowToggleMaximise: BayApi['window']['toggleMaximise']
  windowClose: BayApi['window']['close']
}

/**
 * Fails to compile if a channel in `IPC` has no entry in `ChannelApi`.
 *
 * `export`ed with no importer on purpose, and it must stay that way: `noUnusedLocals` deletes
 * an unused local, so a non-exported assertion would be a compile error rather than a check.
 * It will show up in any sweep for exported symbols with no callers — it is the one entry in
 * that list that is correct as it stands.
 */
export const CHANNELS_COVERED: InvokeChannel extends keyof ChannelApi ? true : never = true

type Handler<F> = F extends (...args: infer A) => infer R
  ? (event: IpcMainInvokeEvent, ...args: A) => R
  : never

function windowOf(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

const handlers: { [K in keyof ChannelApi]: Handler<ChannelApi[K]> } = {
  agentStart: async () => startAgent(),
  agentSend: async (_event, text) => sendToAgent(text),
  agentStop: async () => stopAgent(),
  agentDispose: async () => disposeAgent(),
  agentExportTranscript: (_event, projectName, log) => exportTranscript(projectName, log),

  compositionInspect: async (_event, path, includeHtml) => inspectComposition(path, includeHtml),
  compositionWrite: async (_event, path, html) => {
    const result = await writeComposition(path, html)
    // Both caches are keyed on the assumption that a file does not change under them, and this
    // is the one call that changes one. `forgetPath` makes the next import build a fresh asset
    // — new duration, new declared variables — instead of returning the one built from the
    // previous version; `releasePath` drops the offscreen window still holding the old
    // document, which `open` would otherwise reuse because the asset id and path both match.
    //
    // Invalidated here rather than inside `writeComposition` because `media/import.ts` already
    // imports from `html/compositions.ts`, and reaching back the other way would make a cycle.
    // The seam that owns both is this one.
    if (result.ok) {
      forgetPath(path)
      releasePath(path)
    }
    return result
  },
  compositionWriteGenerated: async (_event, name, html) => writeGenerated(name, html),
  compositionWriteTemplate: async (_event, templateId, width, height) =>
    writeTemplate(templateId, width, height),
  compositionImport: async (_event, paths) => importCompositions(paths),
  compositionFrameAt: async (_event, request) => compositionFrameAt(request),
  compositionRelease: async (_event, assetId) => releaseComposition(assetId),

  appVersion: async () => app.getVersion(),
  appMetrics: () => collectMetrics(),
  appPlatform: async () => process.platform,
  appMediaToolsReady: async () => {
    const tools = mediaToolsReady()
    return { ready: tools.ready, ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe }
  },
  appMcpReady: async () => mcpStatus(),
  appStorageReady: async () => {
    // Opens the database on first ask if it is not open yet, so the status is the real one
    // rather than a guess made before anything tried.
    const { ready, error } = store.storageStatus()
    return { ready, error }
  },

  mediaImportDialog: (event) => importDialog(windowOf(event)),
  mediaImportPaths: (_event, paths) => importPaths(paths),
  mediaProbe: (_event, path) => probe(path),
  mediaThumbnail: (_event, request) => thumbnail(request),
  mediaTranscribe: async (_event, path, language, options) => {
    try {
      const transcript = await transcribeFile(path, {
        userDataDir: app.getPath('userData'),
        homeDir: homedir(),
        ...(language ? { language } : {}),
        download: options?.download === true,
        model: options?.model ?? null
      })
      return { ok: true as const, ...transcript }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  },
  mediaFilmstrip: (_event, request) => filmstrip(request),

  whisperStatus: (_event, preferred) => whisperStatus(app.getPath('userData'), homedir(), preferred ?? null),
  whisperDownload: async (_event, modelId) => {
    try {
      await downloadWhisperModel(modelId, app.getPath('userData'), 'user')
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  },
  whisperCancel: async () => cancelWhisperDownload(),
  whisperDelete: (_event, file) => deleteWhisperModel(app.getPath('userData'), file),
  whisperInstall: () => installWhisperEngine(),
  mediaWaveform: (_event, assetId, path, buckets) => waveform(assetId, path, buckets),
  mediaBeats: async (_event, path, options) => {
    try {
      return { ok: true as const, grid: await detectBeats(path, options ?? {}) }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  },
  mediaReveal: async (_event, path) => {
    shell.showItemInFolder(path)
  },
  mediaStat: (_event, paths) => sizesOf(Array.isArray(paths) ? paths : []),
  mediaLocate: (event, name, nearPath) => locate(windowOf(event), String(name), nearPath ?? null),
  mediaOpenCaptions: (event) => openCaptions(windowOf(event)),
  mediaReadCaptions: (_event, path) => readCaptions(String(path)),
  mediaSaveCaptions: (event, defaultName, text) => saveCaptions(windowOf(event), String(defaultName), String(text)),
  mediaFreezeFrame: (_event, request) => freezeFrame(request),

  projectInitial: () => store.initial(),
  projectSave: (event, project) => store.save(project, windowOf(event)),
  projectSaveAs: (event, project) => store.saveAs(project, windowOf(event)),
  projectOpen: (event) => store.open(windowOf(event)),
  projectOpenPath: (_event, filePath) => store.openPath(filePath),
  projectRecent: () => store.recent(),
  projectAutosave: (_event, project) => store.autosave(project),
  projectLaunchRequest: () => store.launchRequest(),
  projectCreate: () => store.create(),
  projectForget: async (_event, filePath) => store.forget(filePath),
  projectReveal: async (_event, filePath) => store.reveal(filePath),
  projectRename: (_event, filePath, name) => store.rename(filePath, name),
  projectDuplicate: (_event, filePath) => store.duplicate(filePath),
  projectTrash: (_event, filePath) => store.trash(filePath),

  exportStart: (event, request) => encode.start(request, event.sender),
  exportPushFrame: (_event, frame) => encode.pushFrame(frame),
  exportFinish: (_event, jobId) => encode.finish(jobId),
  exportCancel: (_event, jobId) => encode.cancel(jobId),
  exportChoosePath: (event, defaultName, format) =>
    encode.chooseOutputPath(defaultName, format, windowOf(event)),
  exportReveal: async (_event, outputPath) => {
    if (!encode.wasDelivered(outputPath)) return false
    shell.showItemInFolder(outputPath)
    return true
  },
  exportOpen: async (_event, outputPath) => {
    if (!encode.wasDelivered(outputPath)) return false
    // `openPath` resolves with an error string rather than rejecting; empty means it opened.
    return (await shell.openPath(outputPath)) === ''
  },

  accessStatus: async () => access.accessStatus(),
  accessSignIn: () => access.signIn(),
  accessCancelSignIn: async () => access.cancelSignIn(),
  accessSignOut: () => access.signOut(),
  accessRecheck: () => access.recheck(),
  accessRequestAccess: async () => access.requestAccess(),
  accessRefer: (_event, email) => access.refer(email),

  updateStatus: async () => update.updateStatus(),
  updateCheck: () => update.checkForUpdates(),
  updateDownload: () => update.downloadUpdate(),
  updateInstall: () => update.installUpdate(),

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
  // The renderer's answer to a tool call. A `send`, not an `invoke`, because the renderer is
  // replying rather than asking — the correlation is by the id main put on the call.
  ipcMain.on(IPC.mcpToolResult, (_event, result: McpToolResult) => {
    settleToolCall(result)
  })
  ipcMain.on(IPC.mcpExecutorReady, (event, ready: boolean) => {
    setExecutorReady(event.sender, ready === true)
  })

  // Download progress goes to every window: Settings may be open in one while a transcription in
  // another started the download.
  onWhisperDownload((download) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.whisperProgress, download)
    }
  })

  for (const key of Object.keys(handlers) as (keyof ChannelApi)[]) {
    const handler = handlers[key] as unknown as (
      event: IpcMainInvokeEvent,
      ...args: unknown[]
    ) => unknown
    // The access gate, in main: while bay is not entitled, every channel outside the access
    // screen's own (`OPEN_WHILE_LOCKED`) rejects with the unlock instructions — the editor,
    // projects, export, the agent. The renderer's access screen is UI; this is the lock.
    ipcMain.handle(IPC[key], (event, ...args: unknown[]) => {
      const refused = refuseChannel(key, access.accessStatus())
      if (refused) throw new Error(refused)
      return handler(event, ...args)
    })
  }
}
