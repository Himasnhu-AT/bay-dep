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
import type { AgentEntry, AgentEvent } from './agent'
import type { TranscriptSegment } from './transcribe'
import type { WhisperDownload, WhisperStatus } from './whisper'
import type { CompositionFault, CompositionInfo } from './composition'
import type { McpToolCall, McpToolResult } from './mcp'

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
// HTML compositions
// ---------------------------------------------------------------------------

/**
 * One frame of a composition, asked for by time.
 *
 * `atUs` rather than a frame index because a composition has no frame rate of its own — it is
 * a continuous timeline that can be sampled anywhere, and the timeline asking for it decides
 * the rate. Sampling is what makes it legal to place one composition on a 24fps and a 60fps
 * timeline at once.
 *
 * `width`/`height` are the size to rasterise at, not the composition's authored size. An
 * offscreen 1920x1080 page costs the same to seek whether the preview needs 480px or the
 * export needs the full frame, but it does not cost the same to read back — so the caller
 * asks for what it will actually draw.
 */
export interface CompositionFrameRequest {
  assetId: string
  path: string
  compositionId: string
  atUs: number
  width: number
  height: number
  /**
   * The values this clip renders with — already resolved against the composition's declared
   * defaults, so main applies them without needing to know what was declared.
   *
   * Part of the request rather than set once per window because two clips of one composition
   * can carry different values, and they share a window.
   */
  variables?: Record<string, string | number | boolean>
  /**
   * The same values written as CSS custom properties, with declared units attached.
   *
   * Sent alongside rather than derived in main, because main has no access to the declarations
   * and so cannot know that `inset` is a number measured in px. A number is one string in CSS
   * and a different one in text, and only the renderer knows which is which.
   */
  cssVariables?: Record<string, string>
}

export interface CompositionFrame {
  /** Raw RGBA, `width * height * 4` bytes. The renderer turns it into an ImageBitmap. */
  data: ArrayBuffer
  width: number
  height: number
  /**
   * True when the page did not repaint for this seek, so these are the previous frame's
   * pixels — and correctly so, because the composition is holding.
   *
   * Worth reporting rather than hiding: a caller filling a cache can store one entry for the
   * run instead of N copies, and a probe measuring "does this composition animate" needs to
   * tell a held frame from a fresh one. Identical pixels alone cannot say which it was.
   */
  held: boolean
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
// Menu and document commands
// ---------------------------------------------------------------------------

/**
 * A command raised by the application menu, or by macOS handing bay a document.
 *
 * These travel main → renderer, which is the opposite of everything else here, and they have
 * to: the renderer owns the project. `project.save(project)` takes the project as an argument
 * and a menu item in the main process does not have one, so a File menu without this channel
 * is a File menu whose every item is dead.
 */
export type MenuCommand =
  | { type: 'open' }
  | { type: 'save' }
  | { type: 'save-as' }
  | { type: 'import' }
  | { type: 'export' }
  /**
   * macOS handed us a `.bay` file — a double-click, or a drop on the Dock icon.
   *
   * Only needed while bay is already running. At launch, `open-file` fires before `ready`,
   * so main queues the path and `project.initial()` returns that project instead of the
   * last-opened one, which needs no channel at all. Same message either way, so the
   * renderer's handler does not care which case it is.
   */
  | { type: 'open-path'; path: string }
  /** View → Toggle Debug Mode: shows debug tools such as transcript export. */
  | { type: 'toggle-debug' }
  /** bay → Settings… (⌘,). */
  | { type: 'open-settings' }

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

export interface BayApi {
  app: {
    version(): Promise<string>
    platform(): Promise<NodeJS.Platform>
    /** Whether a usable ffmpeg/ffprobe pair was found. Everything media degrades without it. */
    mediaToolsReady(): Promise<{ ready: boolean; ffmpeg: string | null; ffprobe: string | null }>
    /**
     * Whether the project database opened. Recents and reopen-last-project degrade without it.
     *
     * This exists because the degradation is otherwise undetectable from the outside: the
     * database failed to open in every build before this one, and the app presented a working
     * recents list that was permanently empty. A subsystem that has never worked and one that
     * simply has nothing in it look identical unless something says which.
     */
    storageReady(): Promise<{ ready: boolean; error: string | null }>
    /**
     * Whether bay can be driven over MCP, and whether anything has.
     *
     * `connectionsSeen` is the reason this is not a boolean. "The socket never opened" and
     * "the socket is fine and no agent has ever connected" are indistinguishable from the UI —
     * nothing is happening either way — and that is precisely the shape that let a database
     * which had never loaded pass for one nobody had used. `socketPath` is here because it is
     * what a user pastes into an MCP client's config, so a status line can offer it.
     */
    mcpReady(): Promise<{
      ready: boolean
      error: string | null
      socketPath: string | null
      connectionsSeen: number
    }>
    /**
     * Menu and document-open commands. Returns an unsubscribe function.
     *
     * Deliberately the same push-and-unsubscribe shape as `export.onProgress` — one listener
     * pattern in this interface, not two.
     */
    onMenuCommand(listener: (command: MenuCommand) => void): () => void
  }

  media: {
    /**
     * Transcribe a media file on this machine with whisper.cpp. Lines come back in seconds from
     * the start of the file. `ok: false` carries what to install or download, in words.
     *
     * `download` lets main fetch the default model when none is on this machine — the renderer
     * passes the user's "Download models when needed" setting, so the network is reached only
     * when they allowed it. `model` is the file chosen in Settings.
     */
    transcribe(
      path: string,
      language?: string,
      options?: { download?: boolean; model?: string | null }
    ): Promise<
      | { ok: true; segments: TranscriptSegment[]; model: string; language: string }
      | { ok: false; error: string }
    >
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

  /**
   * Local transcription's moving parts, for Settings: whether whisper.cpp is installed, which
   * models are on this machine, and the one download that may be running. Downloads report
   * through `onDownload` — including ones a transcription started on its own.
   */
  whisper: {
    status(preferredModel?: string | null): Promise<WhisperStatus>
    /** Resolves when the file is on disk and verified. */
    download(modelId: string): Promise<{ ok: true } | { ok: false; error: string }>
    cancelDownload(): Promise<void>
    /** Only models in bay's own folder; another app's are left alone. */
    deleteModel(file: string): Promise<{ ok: boolean; error?: string }>
    /** `brew install whisper-cpp`. Takes minutes on a cold Homebrew. */
    installEngine(): Promise<{ ok: true } | { ok: false; error: string }>
    onDownload(listener: (download: WhisperDownload) => void): () => void
  }

  /**
   * HTML compositions — HyperFrames pages, rendered as a source of pictures.
   *
   * Lives in main rather than the renderer even though the renderer is itself a browser, for
   * the reason every other filesystem-touching thing does: a composition is a path, and the
   * renderer does not open paths. Main owns an offscreen window per composition, seeks its
   * paused timeline, and hands back pixels.
   */
  /**
   * The in-app agent.
   *
   * `start` is separate from `send` because starting is where a failure is legible — no binary,
   * no socket — and a first message that silently did nothing would look like a model that
   * ignored you. Events arrive through `onEvent` rather than as a return value: a turn produces
   * many, over minutes, and the panel renders them as they land.
   */
  agent: {
    /** Returns the runtime id, or a reason it could not start. */
    start(): Promise<{ ok: true; id: string } | { ok: false; error: string }>
    send(text: string): Promise<{ ok: boolean; error?: string }>
    /** Abandon the running turn. Safe when nothing is running. */
    stop(): Promise<void>
    dispose(): Promise<void>
    /** Every event from every turn, in order. Returns an unsubscribe function. */
    onEvent(listener: (event: AgentEvent) => void): () => void
    /**
     * Debug mode: write the conversation to a new folder in Downloads — as markdown, as the
     * panel's JSON, and Claude Code's own session file — and reveal it in Finder.
     */
    exportTranscript(
      projectName: string,
      log: AgentEntry[]
    ): Promise<{ ok: true; folder: string } | { ok: false; error: string }>
  }

  composition: {
    /**
     * Read a composition's declared shape, and everything wrong with it.
     *
     * Returns faults even on success, because the ones that are not fatal are the ones that
     * matter most: a blocked CDN renders as a still frame with nothing in any log.
     */
    inspect(
      path: string,
      includeHtml?: boolean
    ): Promise<{
      info: CompositionInfo | null
      faults: CompositionFault[]
      /** The document text, when asked for. Absent otherwise — it can be large. */
      html?: string
    }>
    /**
     * Write a composition to disk.
     *
     * Here rather than in the renderer because the renderer does not touch the filesystem, and
     * here rather than in `media` because it is the only write bay performs on behalf of an
     * agent — everything else an agent does lands in the project document, which is undoable
     * and visible. A file on disk is neither, so this one refuses anything that is not a
     * composition path rather than becoming a general-purpose file writer.
     */
    write(path: string, html: string): Promise<{ ok: true } | { ok: false; error: string }>
    /**
     * Size one of bay's shipped templates to a canvas and write it to disk, ready to import.
     *
     * Main chooses the path, which is why this is not `write`: the renderer has no directory to
     * name, and a template is written where bay keeps them (`<userData>/templates`), under a
     * name derived from template, size and content — so placing the same template twice at one
     * size reuses one file and one asset, and values live on each clip. The width and height
     * are the active timeline's; an unknown id or an impossible size is refused by name.
     */
    writeTemplate(
      templateId: string,
      width: number,
      height: number
    ): Promise<{ ok: true; path: string } | { ok: false; error: string }>
    /** Import a composition as an asset, probing it the way media is probed. */
    import(paths: string[]): Promise<ImportedAsset[]>
    /** One frame, at a time. Resolves null when the composition could not be opened. */
    frameAt(request: CompositionFrameRequest): Promise<CompositionFrame | null>
    /**
     * Drop the offscreen window for this asset.
     *
     * Explicit rather than timed out, because a composition window is a whole renderer
     * process: leaving one per asset alive after the user removed the clip is the difference
     * between an editor and a memory leak with a timeline attached.
     */
    release(assetId: string): Promise<void>
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
    /**
     * The project the OS asked bay to open at launch — a `.bay` double-clicked in Finder — or
     * null. The projects screen is skipped for it: the user already said which one they wanted.
     */
    launchRequest(): Promise<Project | null>
    /**
     * A new, empty project, already written to disk in the projects folder under a name that
     * does not collide, and already in the recents list. No dialog: creating a project should
     * not start with a question.
     */
    create(): Promise<Project>
    /** Take one project off the recents list. The file itself is not touched. */
    forget(filePath: string): Promise<void>
    /** Show the project file in Finder. */
    reveal(filePath: string): Promise<void>
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

  mcp: {
    /**
     * Register the tool executor. Returns an unsubscribe function.
     *
     * The one place in this interface where the renderer *answers* rather than asks, and it
     * has to be: the store owns the project, so only the renderer can apply a tool call. The
     * handler is a plain async function — preload does the correlation, so neither side deals
     * in request ids.
     *
     * At most one executor. A second registration replaces the first rather than fanning
     * out: two handlers answering one call means the agent gets whichever result arrives
     * first, which is a coin toss dressed as a reply.
     */
    onToolCall(handler: (call: McpToolCall) => Promise<McpToolResult>): () => void
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
  appStorageReady: 'app:storage-ready',
  appMcpReady: 'app:mcp-ready',
  appMenuCommand: 'app:menu-command',

  /** renderer -> main: start, drive and stop the in-app agent. */
  agentStart: 'agent:start',
  agentSend: 'agent:send',
  agentStop: 'agent:stop',
  agentDispose: 'agent:dispose',
  agentExportTranscript: 'agent:export-transcript',
  /** main -> renderer: one `AgentEvent`, pushed as it happens. */
  agentEvent: 'agent:event',

  /** main -> renderer: one tool call, carrying its own id. */
  mcpToolCall: 'mcp:tool-call',
  /** renderer -> main: the answer, carrying the same id. */
  mcpToolResult: 'mcp:tool-result',
  /**
   * renderer -> main: the executor is (true) or is no longer (false) listening. Main holds a
   * call until this arrives, because a call pushed into a page that has not mounted is lost.
   */
  mcpExecutorReady: 'mcp:executor-ready',

  mediaImportDialog: 'media:import-dialog',
  mediaImportPaths: 'media:import-paths',
  mediaProbe: 'media:probe',
  mediaThumbnail: 'media:thumbnail',
  mediaTranscribe: 'media:transcribe',

  whisperStatus: 'whisper:status',
  whisperDownload: 'whisper:download',
  whisperCancel: 'whisper:cancel',
  whisperDelete: 'whisper:delete',
  whisperInstall: 'whisper:install',
  /** main -> renderer: one `WhisperDownload`, pushed as it changes. */
  whisperProgress: 'whisper:progress',
  mediaFilmstrip: 'media:filmstrip',
  mediaWaveform: 'media:waveform',
  mediaReveal: 'media:reveal',

  compositionInspect: 'composition:inspect',
  compositionWrite: 'composition:write',
  compositionWriteTemplate: 'composition:write-template',
  compositionImport: 'composition:import',
  compositionFrameAt: 'composition:frame-at',
  compositionRelease: 'composition:release',

  projectInitial: 'project:initial',
  projectSave: 'project:save',
  projectSaveAs: 'project:save-as',
  projectOpen: 'project:open',
  projectOpenPath: 'project:open-path',
  projectRecent: 'project:recent',
  projectAutosave: 'project:autosave',
  projectLaunchRequest: 'project:launch-request',
  projectCreate: 'project:create',
  projectForget: 'project:forget',
  projectReveal: 'project:reveal',

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
