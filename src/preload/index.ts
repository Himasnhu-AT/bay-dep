/**
 * The bridge.
 *
 * This is the entire surface the renderer has onto the machine. `ipcRenderer` itself is never
 * exposed — handing it over would let any script in the page invoke any channel, including
 * ones added later for something else entirely, and the type-safety of `BayApi` would become
 * decoration. What crosses is a fixed set of functions with fixed names.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  BayApi,
  ExportFormat,
  ExportFrame,
  ExportJob,
  ExportProgress,
  ExportRequest,
  FilmstripRequest,
  ImportedAsset,
  MenuCommand,
  ProbeResult,
  RecentProject,
  ThumbnailRequest
} from '@shared/ipc'
import { IPC } from '@shared/ipc'
import type { AgentEntry, AgentEvent } from '@shared/agent'
import type { McpToolCall, McpToolResult } from '@shared/mcp'
import type { Project } from '@shared/project'
import type { WhisperDownload } from '@shared/whisper'

const api: BayApi = {
  app: {
    metrics: () => ipcRenderer.invoke(IPC.appMetrics),
    version: () => ipcRenderer.invoke(IPC.appVersion) as Promise<string>,
    platform: () => ipcRenderer.invoke(IPC.appPlatform) as Promise<NodeJS.Platform>,
    mediaToolsReady: () =>
      ipcRenderer.invoke(IPC.appMediaToolsReady) as Promise<{
        ready: boolean
        ffmpeg: string | null
        ffprobe: string | null
      }>,
    storageReady: () =>
      ipcRenderer.invoke(IPC.appStorageReady) as Promise<{
        ready: boolean
        error: string | null
      }>,
    mcpReady: () =>
      ipcRenderer.invoke(IPC.appMcpReady) as Promise<{
        ready: boolean
        error: string | null
        socketPath: string | null
        connectionsSeen: number
      }>,
    onMenuCommand: (listener: (command: MenuCommand) => void) => {
      // The wrapper is held for the same reason as `onProgress`: `removeListener` matches by
      // identity, so building a fresh arrow inside the unsubscribe would remove nothing.
      const wrapped = (_event: unknown, command: MenuCommand): void => listener(command)
      ipcRenderer.on(IPC.appMenuCommand, wrapped)
      return () => {
        ipcRenderer.removeListener(IPC.appMenuCommand, wrapped)
      }
    }
  },

  media: {
    importDialog: () => ipcRenderer.invoke(IPC.mediaImportDialog) as Promise<ImportedAsset[]>,
    importPaths: (paths: string[]) =>
      ipcRenderer.invoke(IPC.mediaImportPaths, paths) as Promise<ImportedAsset[]>,
    probe: (path: string) => ipcRenderer.invoke(IPC.mediaProbe, path) as Promise<ProbeResult>,
    transcribe: (path: string, language?: string, options?: { download?: boolean; model?: string | null }) =>
      ipcRenderer.invoke(IPC.mediaTranscribe, path, language, options),
    thumbnail: (request: ThumbnailRequest) =>
      ipcRenderer.invoke(IPC.mediaThumbnail, request) as Promise<string | null>,
    filmstrip: (request: FilmstripRequest) =>
      ipcRenderer.invoke(IPC.mediaFilmstrip, request) as Promise<string[]>,
    waveform: (assetId: string, path: string, buckets: number) =>
      ipcRenderer.invoke(IPC.mediaWaveform, assetId, path, buckets) as Promise<number[]>,
    revealInFolder: (path: string) =>
      ipcRenderer.invoke(IPC.mediaReveal, path) as Promise<void>,
    pathForFile: (file: File) => {
      // A `File` is one of the few complex objects contextBridge passes through intact
      // rather than proxying, which is what makes this work at all. It throws for a File
      // the browser has no path for — a synthesised one, or a directory entry — and a drop
      // handler should fall back to the Import button rather than see an exception.
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },

  whisper: {
    status: (preferredModel) => ipcRenderer.invoke(IPC.whisperStatus, preferredModel),
    download: (modelId) => ipcRenderer.invoke(IPC.whisperDownload, modelId),
    cancelDownload: () => ipcRenderer.invoke(IPC.whisperCancel),
    deleteModel: (file) => ipcRenderer.invoke(IPC.whisperDelete, file),
    installEngine: () => ipcRenderer.invoke(IPC.whisperInstall),
    onDownload: (listener) => {
      const handler = (_event: unknown, payload: WhisperDownload): void => listener(payload)
      ipcRenderer.on(IPC.whisperProgress, handler)
      return () => ipcRenderer.removeListener(IPC.whisperProgress, handler)
    }
  },

  agent: {
    start: () => ipcRenderer.invoke(IPC.agentStart),
    send: (text: string) => ipcRenderer.invoke(IPC.agentSend, text),
    stop: () => ipcRenderer.invoke(IPC.agentStop),
    dispose: () => ipcRenderer.invoke(IPC.agentDispose),
    exportTranscript: (projectName: string, log: AgentEntry[]) =>
      ipcRenderer.invoke(IPC.agentExportTranscript, projectName, log),
    // Same push-and-unsubscribe shape as `export.onProgress`: one listener pattern in this
    // bridge, not two. The wrapper drops `event` so the renderer never sees an Electron type.
    onEvent: (listener: (event: AgentEvent) => void) => {
      const handler = (_event: unknown, payload: AgentEvent): void => listener(payload)
      ipcRenderer.on(IPC.agentEvent, handler)
      return () => ipcRenderer.removeListener(IPC.agentEvent, handler)
    }
  },

  composition: {
    inspect: (path, includeHtml) =>
      ipcRenderer.invoke(IPC.compositionInspect, path, includeHtml),
    write: (path, html) => ipcRenderer.invoke(IPC.compositionWrite, path, html),
    writeTemplate: (templateId, width, height) =>
      ipcRenderer.invoke(IPC.compositionWriteTemplate, templateId, width, height),
    writeGenerated: (name, html) => ipcRenderer.invoke(IPC.compositionWriteGenerated, name, html),
    import: (paths) => ipcRenderer.invoke(IPC.compositionImport, paths),
    frameAt: (request) => ipcRenderer.invoke(IPC.compositionFrameAt, request),
    release: (assetId) => ipcRenderer.invoke(IPC.compositionRelease, assetId)
  },

  project: {
    initial: () => ipcRenderer.invoke(IPC.projectInitial) as Promise<Project>,
    save: (project: Project) =>
      ipcRenderer.invoke(IPC.projectSave, project) as Promise<{ filePath: string }>,
    saveAs: (project: Project) =>
      ipcRenderer.invoke(IPC.projectSaveAs, project) as Promise<{ filePath: string } | null>,
    open: () => ipcRenderer.invoke(IPC.projectOpen) as Promise<Project | null>,
    openPath: (filePath: string) =>
      ipcRenderer.invoke(IPC.projectOpenPath, filePath) as Promise<Project>,
    recent: () => ipcRenderer.invoke(IPC.projectRecent) as Promise<RecentProject[]>,
    autosave: (project: Project) =>
      ipcRenderer.invoke(IPC.projectAutosave, project) as Promise<void>,
    launchRequest: () => ipcRenderer.invoke(IPC.projectLaunchRequest) as Promise<Project | null>,
    create: () => ipcRenderer.invoke(IPC.projectCreate) as Promise<Project>,
    forget: (filePath: string) => ipcRenderer.invoke(IPC.projectForget, filePath) as Promise<void>,
    reveal: (filePath: string) => ipcRenderer.invoke(IPC.projectReveal, filePath) as Promise<void>
  },

  export: {
    start: (request: ExportRequest) =>
      ipcRenderer.invoke(IPC.exportStart, request) as Promise<ExportJob>,
    pushFrame: (frame: ExportFrame) =>
      ipcRenderer.invoke(IPC.exportPushFrame, frame) as Promise<void>,
    finish: (jobId: string) => ipcRenderer.invoke(IPC.exportFinish, jobId) as Promise<void>,
    cancel: (jobId: string) => ipcRenderer.invoke(IPC.exportCancel, jobId) as Promise<void>,
    chooseOutputPath: (defaultName: string, format: ExportFormat) =>
      ipcRenderer.invoke(IPC.exportChoosePath, defaultName, format) as Promise<string | null>,
    onProgress: (listener: (progress: ExportProgress) => void) => {
      // The wrapper has to be held onto: `removeListener` matches by identity, so building a
      // fresh arrow inside the unsubscribe would remove nothing and leak a listener per
      // export panel mount.
      const wrapped = (_event: unknown, progress: ExportProgress): void => listener(progress)
      ipcRenderer.on(IPC.exportProgress, wrapped)
      return () => {
        ipcRenderer.removeListener(IPC.exportProgress, wrapped)
      }
    }
  },

  mcp: {
    onToolCall: (handler: (call: McpToolCall) => Promise<McpToolResult>) => {
      // Preload owns the correlation, so the renderer's handler never sees an id: it takes a
      // call and returns a result, and the id is copied back onto the reply here. A handler
      // that throws still answers — an unanswered call would sit until main's timeout, which
      // costs the agent 30 seconds to learn something the exception already knew.
      const wrapped = (_event: unknown, call: McpToolCall): void => {
        handler(call)
          .then((result) => ipcRenderer.send(IPC.mcpToolResult, { ...result, id: call.id }))
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            ipcRenderer.send(IPC.mcpToolResult, { id: call.id, ok: false, error: message })
          })
      }
      // At most one executor, per the contract: a second registration replaces the first.
      ipcRenderer.removeAllListeners(IPC.mcpToolCall)
      ipcRenderer.on(IPC.mcpToolCall, wrapped)
      // Only now is anything listening, so only now may main send. Said from here rather than
      // by the renderer because this is the line that makes it true.
      ipcRenderer.send(IPC.mcpExecutorReady, true)
      return () => {
        ipcRenderer.removeListener(IPC.mcpToolCall, wrapped)
        ipcRenderer.send(IPC.mcpExecutorReady, false)
      }
    }
  },

  window: {
    minimise: () => ipcRenderer.invoke(IPC.windowMinimise) as Promise<void>,
    toggleMaximise: () => ipcRenderer.invoke(IPC.windowToggleMaximise) as Promise<void>,
    close: () => ipcRenderer.invoke(IPC.windowClose) as Promise<void>
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('bay', api)
} else {
  // Only reachable if someone turns contextIsolation off, which bay does not. Assigning
  // directly keeps that configuration debuggable rather than silently broken.
  ;(globalThis as unknown as { bay: BayApi }).bay = api
}
