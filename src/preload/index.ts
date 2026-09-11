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
  ProbeResult,
  RecentProject,
  ThumbnailRequest
} from '@shared/ipc'
import { IPC } from '@shared/ipc'
import type { Project } from '@shared/project'

const api: BayApi = {
  app: {
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
      }>
  },

  media: {
    importDialog: () => ipcRenderer.invoke(IPC.mediaImportDialog) as Promise<ImportedAsset[]>,
    importPaths: (paths: string[]) =>
      ipcRenderer.invoke(IPC.mediaImportPaths, paths) as Promise<ImportedAsset[]>,
    probe: (path: string) => ipcRenderer.invoke(IPC.mediaProbe, path) as Promise<ProbeResult>,
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
      ipcRenderer.invoke(IPC.projectAutosave, project) as Promise<void>
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
