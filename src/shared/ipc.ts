/**
 * The contract between the main process and the renderer.
 *
 * The renderer never touches the filesystem, ffmpeg, or the database directly — it asks
 * for things by name through `window.bay`, and every one of those calls is listed here.
 * Keeping the shape in `shared/` means the preload bridge, the main-process handlers and
 * the React code are all checked against the same declaration rather than three copies
 * that drift.
 */

import type { Asset, Project } from './project'

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** What ffprobe told us about a file, before it becomes an Asset. */
export interface ProbeResult {
  path: string
  durationUs: number
  width: number | null
  height: number | null
  fps: number | null
  hasVideo: boolean
  hasAudio: boolean
  /** Container/codec summary, for the inspector. e.g. "h264 · aac · 1920×1080 · 29.97fps" */
  summary: string
}

export interface ImportedAsset {
  asset: Asset
  /** True when this path was already in the project and was reused rather than re-added. */
  reused: boolean
}

export interface ThumbnailRequest {
  assetId: string
  path: string
  /** Where in the source to grab, in microseconds. */
  atUs: number
  /** Longest edge of the returned image. */
  size: number
}

export interface FilmstripRequest {
  assetId: string
  path: string
  /** How many evenly spaced frames across the whole source. */
  count: number
  height: number
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportFormat = 'mp4' | 'mov' | 'webm' | 'wav' | 'mp3' | 'png-sequence'

export interface ExportRequest {
  project: Project
  timelineId: string
  format: ExportFormat
  outputPath: string
  /** Defaults to the timeline's own size when omitted. */
  width?: number
  height?: number
  fps?: number
  /** Constant-rate-factor for h264/vp9. Lower is better quality. */
  quality?: 'draft' | 'good' | 'best'
  /** Inclusive frame range. Whole timeline when omitted. */
  fromFrame?: number
  toFrame?: number
}

export interface ExportProgress {
  jobId: string
  /** 0..1, or null while the total is not yet known. */
  progress: number | null
  framesDone: number
  framesTotal: number | null
  stage: 'preparing' | 'rendering' | 'encoding' | 'done' | 'failed' | 'cancelled'
  message?: string
  outputPath?: string
  error?: string
}

export interface ExportJob {
  jobId: string
}

/**
 * One composited frame handed from the renderer to the encoder. The renderer draws the
 * frame it already knows how to draw; main only muxes. `data` is raw RGBA.
 */
export interface ExportFrame {
  jobId: string
  frame: number
  data: ArrayBuffer
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// Recent projects / persistence
// ---------------------------------------------------------------------------

export interface RecentProject {
  id: string
  name: string
  filePath: string
  updatedAt: number
  /** Data URL of a poster frame, when one has been captured. */
  poster?: string
}

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

export interface BayApi {
  app: {
    version(): Promise<string>
    platform(): Promise<NodeJS.Platform>
    /** Whether a usable ffmpeg/ffprobe pair was found. Everything media degrades without it. */
    mediaToolsReady(): Promise<{ ready: boolean; ffmpeg: string | null; ffprobe: string | null }>
  }

  media: {
    /** Opens the system file picker and probes everything the user chose. */
    importDialog(): Promise<ImportedAsset[]>
    /** Import specific paths — used by drag-and-drop onto the window. */
    importPaths(paths: string[]): Promise<ImportedAsset[]>
    /**
     * The absolute path behind a dropped `File`.
     *
     * The odd one out in this interface: synchronous, and not backed by a channel in `IPC`.
     * Electron 32 removed `File.path`, so a file from a `DataTransfer` no longer names itself
     * and `webUtils.getPathForFile` is the supported replacement — but it needs the real `File`
     * object, which cannot be serialised across IPC. So it resolves inside preload and returns
     * directly. It belongs here anyway: `window.bay` is declared globally from this file, and
     * TypeScript requires every declaration of a property to be identical, so preload cannot
     * widen it from its own side.
     */
    pathForFile(file: File): string
    probe(path: string): Promise<ProbeResult>
    /** Returns a `bay://` URL for a cached poster image. */
    thumbnail(request: ThumbnailRequest): Promise<string | null>
    /** Returns `bay://` URLs for an evenly spaced strip, for timeline clip bodies. */
    filmstrip(request: FilmstripRequest): Promise<string[]>
    /** Peak pairs, normalised 0..1, for drawing a waveform. */
    waveform(assetId: string, path: string, buckets: number): Promise<number[]>
    /** Reveals a file in Finder/Explorer. */
    revealInFolder(path: string): Promise<void>
  }

  project: {
    /** The project to show at launch: the last one opened, or a fresh empty one. */
    initial(): Promise<Project>
    save(project: Project): Promise<{ filePath: string }>
    saveAs(project: Project): Promise<{ filePath: string } | null>
    open(): Promise<Project | null>
    openPath(filePath: string): Promise<Project>
    recent(): Promise<RecentProject[]>
    /** Fire-and-forget autosave. Resolves once written. */
    autosave(project: Project): Promise<void>
  }

  export: {
    start(request: ExportRequest): Promise<ExportJob>
    /** Renderer pushes one composited frame; resolves when the encoder has taken it. */
    pushFrame(frame: ExportFrame): Promise<void>
    /** Tells the encoder no more frames are coming. */
    finish(jobId: string): Promise<void>
    cancel(jobId: string): Promise<void>
    chooseOutputPath(defaultName: string, format: ExportFormat): Promise<string | null>
    onProgress(listener: (progress: ExportProgress) => void): () => void
  }

  window: {
    minimise(): Promise<void>
    toggleMaximise(): Promise<void>
    close(): Promise<void>
  }
}

declare global {
  interface Window {
    bay: BayApi
  }
}

/** Channel names. Only the preload bridge and the main handlers should use these. */
export const IPC = {
  appVersion: 'app:version',
  appPlatform: 'app:platform',
  appMediaToolsReady: 'app:media-tools-ready',

  mediaImportDialog: 'media:import-dialog',
  mediaImportPaths: 'media:import-paths',
  mediaProbe: 'media:probe',
  mediaThumbnail: 'media:thumbnail',
  mediaFilmstrip: 'media:filmstrip',
  mediaWaveform: 'media:waveform',
  mediaReveal: 'media:reveal',

  projectInitial: 'project:initial',
  projectSave: 'project:save',
  projectSaveAs: 'project:save-as',
  projectOpen: 'project:open',
  projectOpenPath: 'project:open-path',
  projectRecent: 'project:recent',
  projectAutosave: 'project:autosave',

  exportStart: 'export:start',
  exportPushFrame: 'export:push-frame',
  exportFinish: 'export:finish',
  exportCancel: 'export:cancel',
  exportChoosePath: 'export:choose-path',
  exportProgress: 'export:progress',

  windowMinimise: 'window:minimise',
  windowToggleMaximise: 'window:toggle-maximise',
  windowClose: 'window:close'
} as const
