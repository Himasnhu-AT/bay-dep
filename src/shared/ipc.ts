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
import type { AgentEntry, AgentEvent, AgentProvider, AgentProviderStatus } from './agent'
import type { AgentAttachmentInput } from './agent-attachments'
import type { TranscriptSegment } from './transcribe'
import type { BeatGrid } from './beats'
import type { WhisperDownload, WhisperStatus } from './whisper'
import type {
  GenerationJob,
  GenerationLimits,
  GenerationProvider,
  GenerationRequest,
  GenerationSpending,
  ProviderKeyStatus,
  StartRefused
} from './generation'
import type { CompositionFault, CompositionInfo } from './composition'
import type { McpToolCall, McpToolResult } from './mcp'
import type { LoudnessReport, LoudnessTarget } from './loudness'
import type { AccessStatus, ReferralResult } from './access'
import type { UpdateStatus } from './update'
import type { Finding } from './findings'
import type { UrlImportResult } from './url-import'
import type { EditingStyle } from './styles/types'
import type { VisionAssetRef, VisionIndexAnswer, VisionSearchAnswer, VisionSearchRequest, VisionStatus } from './visual-search'

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** One scene boundary in a source file: the first frame of the new shot. */
export interface SceneCut {
  /** Source microseconds from the file's start. */
  us: number
  /** scdet's score for the change, 0–100. Higher is a harder cut. */
  score: number
}

/** A stretch of a media file's source time: where to seek, and how much to read. */
export interface AudioSpan {
  /** Source microseconds from the file's start. */
  startUs: number
  /** How much source to read, in microseconds. Non-positive or infinite reads to the end. */
  durationUs: number
}

/** One silence `silencedetect` found, in seconds from the start of the span that was read. */
export interface SilenceInterval {
  startSec: number
  endSec: number
}

/** A main-side audio measurement: its value, or ffmpeg's own words for why there is none. */
export type AudioResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** scdet's default threshold: a score (0–100) above it is a cut. */
export const DEFAULT_CUT_THRESHOLD = 10

/** The threshold scdet is run with for one asked for: it takes 1–100. The one place the range lives. */
export function clampCutThreshold(threshold: number): number {
  return Math.min(100, Math.max(1, threshold))
}

/** What ffprobe told us about a file, before it becomes an Asset. */
export interface ProbeResult {
  path: string
  durationUs: number
  width: number | null
  height: number | null
  fps: number | null
  hasVideo: boolean
  hasAudio: boolean
  /** Channels of the first audio stream, when there is one and ffprobe says. */
  channels?: number
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

/**
 * One source frame, grabbed to a still for a freeze frame. `seconds` is where in the source the
 * compositor's element is seeking for the frame being frozen (`sourceSecondsAt`), and main writes
 * the frame an element shows there: the last one whose timestamp is at or before it.
 */
export interface FreezeFrameRequest {
  path: string
  seconds: number
  /** The clip's asset name, for the file's name. */
  name: string
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
  /**
   * The project's imported fonts, as bay's copies of the files. A composition's sandbox cannot
   * load `bay://`, so main inlines each as a `data:` `@font-face` in the window — only files in
   * bay's fonts folder, whatever the request says. Absent: none.
   */
  fonts?: {
    family: string
    path: string
    weight: string
    stretch: string
    style: string
    format: 'truetype' | 'opentype' | 'woff' | 'woff2'
  }[]
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
  /**
   * Master the audio to this integrated loudness under this true-peak ceiling, verified on the
   * encoded file (`main/export/master.ts`). Absent means no mastering — the file carries the
   * level the preview played, which is the default on purpose.
   */
  loudness?: LoudnessTarget
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
  /** On `done`, when the request asked for mastering: what the delivered file measures. */
  loudness?: LoudnessReport
  /**
   * On `done`: what reading the delivered file back found wrong with it (`@shared/findings`) —
   * no audio stream under a timeline with sound, a length off the range by more than 2%, an
   * empty or unreadable file. Empty when the file checks out; absent for a PNG sequence.
   */
  findings?: Finding[]
  /**
   * Frames written with something still not drawn. Set by the renderer, which composites the
   * frames — main encodes whatever it is handed and cannot know. Absent when every frame was
   * complete.
   */
  incomplete?: IncompleteFrames
}

/**
 * Frames an export wrote with the wrong picture, for one of three reasons:
 *
 * - **An item was still pending** — a `.brf` scene still in its worker, a composition frame not
 *   yet captured, a video that never finished seeking. The frame is in the file with that item
 *   missing: the background shows where it should be.
 * - **A clip's grade failed** — the clip is in the file ungraded (or with part of its grade
 *   skipped, such as a LUT whose asset is gone). This one hides better: an ungraded clip looks
 *   like a clip nobody graded, so it comes first in the sentence.
 * - **An item could not be drawn** — a `.brf` whose code threw, media missing or undecodable. The
 *   file shows a grey card with the item's name. Waiting does not fix it; fixing the item does.
 *
 * The file is kept (every other frame is right, and a re-export usually fixes a pending item),
 * but the export is not reported as clean: `message` is the sentence the user and the agent read.
 */
export interface IncompleteFrames {
  /** How many frames of the file are wrong in either way. */
  frames: number
  /** Those frames, as inclusive timeline-frame ranges: `[[0, 1], [15, 15]]`. */
  ranges: [number, number][]
  /** What was missing, by name, on how many frames and where. Most frames first. */
  items: { name: string; frames: number; ranges: [number, number][] }[]
  /** Each distinct grade failure (it names its clip), on how many frames and where. */
  gradeIssues: { issue: string; frames: number; ranges: [number, number][] }[]
  /**
   * Items drawn as a grey placeholder card because they could not be drawn at all — a `.brf`
   * that threw, media missing or undecodable — each named with why, on how many frames and where.
   */
  placeholders: { name: string; frames: number; ranges: [number, number][] }[]
  /** One paragraph naming the frames, what went wrong on them, and what to do about it. */
  message: string
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
  /** The folder the file is in, for display: the home folder written as `~`. */
  folder?: string
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
  /**
   * A menu item was chosen: run the command with this id (`@shared/commands`) through the
   * renderer's registry. Every menu item that needs the project — Save, Export, Undo, Split —
   * is one of these, so the menu and the keyboard run the same code.
   */
  | { type: 'command'; id: string }
  /**
   * macOS handed us a `.bay` file — a double-click, or a drop on the Dock icon.
   *
   * Only needed while bay is already running. At launch, `open-file` fires before `ready`,
   * so main queues the path and `project.initial()` returns that project instead of the
   * last-opened one, which needs no channel at all. Same message either way, so the
   * renderer's handler does not care which case it is.
   */
  | { type: 'open-path'; path: string }

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

export type ProcessGroup = 'renderer' | 'gpu' | 'main' | 'other'

/**
 * What the debug HUD shows about the machine, sampled on request. Each line a person reads:
 * "CPU 43% of one core (renderer 32 · gpu 8 · main 3)", "Memory 928 MB", "GPU 37% (whole Mac)" or
 * "GPU not reported".
 */
export interface AppMetrics {
  /** This app's processes by kind. CPU is percent of one core (as Activity Monitor shows it), so it can pass 100. */
  groups: { group: ProcessGroup; count: number; cpu: number; memoryMB: number }[]
  totals: { cpu: number; memoryMB: number }
  /** The GPU for the whole machine (macOS, from IOAccelerator) — null when not reported. */
  gpu: { utilization: number; renderer: number | null; tiler: number | null; memoryMB: number | null } | null
  /** When it was sampled, ms since the epoch. */
  at: number
}

export interface BayApi {
  app: {
    /** Debug mode's HUD: CPU and memory per process kind, and GPU utilisation where the OS reports it. */
    metrics(): Promise<AppMetrics>
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
     * Makes the project database open again with nothing lost: the old file is renamed aside
     * (never deleted), what it still yields is carried over, and the projects folder's `.bay`
     * files are listed again. Projects themselves are never touched.
     */
    repairStorage(): Promise<{ ready: boolean; error: string | null; movedAside: string[]; recents: number }>
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
      enabled: boolean
      ready: boolean
      error: string | null
      socketPath: string | null
      connectionsSeen: number
    }>
    /** Allow or stop MCP clients other than the in-app agent; remembered. Answers the new status. */
    setMcpClients(on: boolean): ReturnType<BayApi['app']['mcpReady']>
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
     * Download one video from a web page with the user's own `yt-dlp` into bay's downloads
     * folder (`main/media/url-import.ts`) — a network exception, see CLAUDE.md. Nothing is
     * imported: the renderer passes the returned path to `importPaths`. `dryRun` checks the
     * address and finds yt-dlp, and returns the argument list without running it.
     */
    importUrl(url: string, options?: { dryRun?: boolean }): Promise<UrlImportResult>
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
    /**
     * Beat grid of a media file's audio, analysed on this machine (`media/beats.ts`) and cached
     * by content. Times are in source microseconds. `ok: false` carries ffmpeg's own words.
     */
    beats(path: string, options?: { beatsPerBar?: number }): Promise<{ ok: true; grid: BeatGrid } | { ok: false; error: string }>
    /**
     * Scene cuts in a video file, found by ffmpeg's `scdet` on this machine (`media/scene-cuts.ts`).
     * Times are source microseconds from the file's start, with scdet's score (0–100) for each.
     * `threshold` is scdet's own (default 10): lower finds softer cuts and more false ones.
     */
    cuts(path: string, options?: { threshold?: number }): Promise<{ ok: true; cuts: SceneCut[] } | { ok: false; error: string }>
    /**
     * RMS level in dBFS per `windowUs` of source over `span`, on this machine (`media/audio-analysis.ts`).
     * Index k starts k·windowUs into the span; digital silence reads -120. For `switch_speakers`
     * (50 ms windows) and `sync_angles` (10 ms).
     */
    levels(path: string, span: AudioSpan, windowUs: number): Promise<AudioResult<number[]>>
    /** ffmpeg `silencedetect` over `span`: silences below `thresholdDb` lasting `minSilenceSec` or more. */
    silences(path: string, span: AudioSpan, thresholdDb: number, minSilenceSec: number): Promise<AudioResult<SilenceInterval[]>>
    /** EBU R128 integrated loudness (LUFS) and true peak (dBFS) of `span`. */
    loudness(path: string, span: AudioSpan): Promise<AudioResult<{ integratedLufs: number; truePeakDb: number }>>
    /** Reveals a file in Finder/Explorer. */
    revealInFolder(path: string): Promise<void>
    /**
     * Each path's size in bytes, or null where no file is there now — moved, deleted, or on a
     * drive that is not mounted. One call answers both what the Media panel shows (file size)
     * and what it warns about (missing media). Nothing is read or allowlisted.
     */
    stat(paths: string[]): Promise<(number | null)[]>
    /**
     * A picker for the one file a missing asset should now point at, titled with its name and
     * opened in `nearPath`'s folder when that exists. Returns the chosen path, or null when the
     * picker was dismissed. Nothing is imported: the renderer passes the path to `importPaths`,
     * which probes it and admits it to `bay://`, and relinks from what that measured.
     */
    locate(name: string, nearPath?: string | null): Promise<string | null>
    /**
     * A picker for an `.srt` or `.vtt` file, whose text is returned for `add_captions` to parse.
     * Null when dismissed. Refuses a file too large to be a caption file.
     */
    openCaptions(): Promise<{ name: string; text: string } | null>
    /** The text of a dropped `.srt`/`.vtt` — only those extensions, and only a caption-sized file. */
    readCaptions(path: string): Promise<{ name: string; text: string }>
    /** A save dialog for an `.srt`, then the file written. Returns the path, or null if dismissed. */
    saveCaptions(defaultName: string, text: string): Promise<string | null>
    /**
     * Grab one source frame to a PNG where bay keeps what it generates (`<userData>/generated`),
     * named by its content — the same frame twice is one file, and so one asset. Nothing is
     * imported: the renderer passes the path to `importPaths`, which probes it and admits it to
     * `bay://`. A time past the last frame, or a file with no picture, is refused in words.
     */
    freezeFrame(request: FreezeFrameRequest): Promise<{ ok: true; path: string } | { ok: false; error: string }>
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
   * Visual search over the project's footage (`src/shared/visual-search.ts`, `src/main/vision/`):
   * a SigLIP model on this Mac, frames indexed per file and cached by content. The model is the
   * only thing fetched — from Hugging Face, on Download or on an index with `download: true`
   * (the user's "Download models when needed"). Changes (download progress, the indexing job) are
   * pushed through `onChange`.
   */
  vision: {
    status(): Promise<VisionStatus>
    /** Resolves when every file is on disk and verified. */
    download(): Promise<{ ok: true } | { ok: false; error: string }>
    cancelDownload(): Promise<void>
    deleteModel(): Promise<{ ok: boolean; error?: string }>
    /** Index what is not indexed yet; `dryRun` plans only (counts and an estimate) and starts nothing. */
    index(assets: VisionAssetRef[], options?: { dryRun?: boolean; download?: boolean }): Promise<VisionIndexAnswer>
    cancelIndex(): Promise<void>
    search(request: VisionSearchRequest): Promise<VisionSearchAnswer>
    onChange(listener: (status: VisionStatus) => void): () => void
  }

  /**
   * AI image and video generation (`src/shared/generation.ts`, `src/main/generate/`) — bay's
   * fourth network exception. Main alone calls the providers, with keys set here and only when
   * a generation tool asks. Keys go in and never come back out: `keys` answers set/not-set.
   * Main re-validates every request against the catalog; the renderer's check is for the
   * agent's benefit, not the lock.
   */
  generation: {
    keys(): Promise<ProviderKeyStatus[]>
    setKey(provider: GenerationProvider, fields: Record<string, string>): Promise<{ ok: true; keys: ProviderKeyStatus[] } | { ok: false; error: string }>
    clearKey(provider: GenerationProvider): Promise<ProviderKeyStatus[]>
    /**
     * Persists the job, then submits it. Resolves once the submission settles or a few seconds
     * pass. Refused, with nothing sent, when the row cannot be written or the spend guard's
     * session budget or jobs-at-once limit would be passed; `spending` is where it stands after.
     */
    start(
      request: GenerationRequest,
      options?: { reservationId?: string }
    ): Promise<{ ok: true; job: GenerationJob; spending: GenerationSpending } | StartRefused>
    /**
     * Holds `totalUsd` of the session budget for jobs that will start over time (a dub's lines),
     * so a generation started meanwhile cannot take the money they need. A start that passes the
     * reservation's id draws from it; `release` drops what is left. Refused like a start that
     * would pass the budget.
     */
    reserve(totalUsd: number): Promise<{ ok: true; reservationId: string; spending: GenerationSpending } | StartRefused>
    release(reservationId: string): Promise<GenerationSpending>
    /**
     * Dubs in flight, kept by main beside the job table so a reload does not forget them. Main
     * keeps each record as the renderer wrote it (`DubRecordData` in `@shared/dub`), bounded in id,
     * size and count; the renderer checks what it reads back.
     */
    dubs(): Promise<unknown[]>
    saveDub(record: unknown): Promise<{ ok: true } | { ok: false; error: string }>
    /** The spend guard: this session's estimated spend, jobs active, and the limits main enforces. */
    spending(): Promise<GenerationSpending>
    /** Preferences › AI providers. Checked and persisted by main; the renderer cannot pass limits with a call. */
    setLimits(limits: GenerationLimits): Promise<{ ok: true; spending: GenerationSpending } | { ok: false; error: string }>
    /** One job as it stands, or null for an id main has never seen. */
    job(id: string): Promise<GenerationJob | null>
    /** Every job main remembers, newest first. */
    jobs(): Promise<GenerationJob[]>
  }

  /**
   * The user's own editing styles (`@shared/styles`), saved by `write_style` as JSON text in
   * `<userData>/styles` — one file per id. Main checks every write with the same `checkStyle` the
   * renderer uses (a built-in id, a bad slug, an oversize body are refused; markup is stripped) and
   * never runs anything in one. `list` hands back what is on disk, unvalidated: the renderer checks
   * each entry again as it reads (`readUserStyles`), because a file may have been edited by hand.
   * `skipped` names every style file main could not read (too large, not JSON, id not matching
   * the file name), so nothing vanishes without a word.
   */
  styles: {
    list(): Promise<{ styles: unknown[]; skipped: string[] }>
    /**
     * Save one style. `replace` must be true to overwrite a user style with the same id; without
     * it the refusal names the existing id. Resolves with the style as saved (cleaned).
     */
    write(style: unknown, options?: { replace?: boolean }): Promise<{ ok: true; style: EditingStyle; replaced: boolean } | { ok: false; error: string }>
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
    /**
     * Returns the runtime id, or a reason it could not start. `provider` is the Settings choice
     * (Claude when omitted); `BAY_AGENT_RUNTIME` in main's environment overrides it. Starting
     * with a provider other than the running conversation's replaces that conversation.
     */
    start(options?: { provider?: AgentProvider }): Promise<{ ok: true; id: string } | { ok: false; error: string }>
    /** Which providers' CLIs this machine has, and what each still needs before it can start. */
    providers(): Promise<AgentProviderStatus[]>
    /**
     * One message. `attachments` — images and video the user added — cross as bytes or as a
     * project asset; main checks them (`validateAttachments`) and writes what the model sees into
     * its own folder. A message whose attachments are refused is not sent.
     */
    send(text: string, attachments?: AgentAttachmentInput[]): Promise<{ ok: boolean; error?: string }>
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
    /**
     * Write a composition bay generated — a clip's subtitles — where bay keeps its own
     * (`<userData>/generated`), under a name from `name` and the content. Same document, same
     * file: regenerating identical subtitles reuses one asset.
     */
    writeGenerated(name: string, html: string): Promise<{ ok: true; path: string } | { ok: false; error: string }>
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
    /** The file written, and the name the project took from it. */
    saveAs(project: Project): Promise<{ filePath: string; name: string } | null>
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
    /**
     * Rename a project on the list: the name inside the document, and the file to `<name>.bay`
     * in the same folder when that name is free (compared case-insensitively, as the Mac's disk
     * does) — otherwise the file keeps its name. Only a `.bay` on the recents list is touched.
     */
    rename(filePath: string, name: string): Promise<RecentProject>
    /** A copy beside the original, with a new project id and the name "<name> copy". */
    duplicate(filePath: string): Promise<RecentProject>
    /** Move a project on the recents list to the Trash (restorable from Finder) and forget it. */
    trash(filePath: string): Promise<void>
  }

  export: {
    start(request: ExportRequest): Promise<ExportJob>
    /** Renderer pushes one composited frame; resolves when the encoder has taken it. */
    pushFrame(frame: ExportFrame): Promise<void>
    /** Tells the encoder no more frames are coming. */
    finish(jobId: string): Promise<void>
    cancel(jobId: string): Promise<void>
    chooseOutputPath(defaultName: string, format: ExportFormat): Promise<string | null>
    /**
     * Show a finished export in Finder, or open it in the default app. Only a path an export in
     * this session reported `done` for: anything else resolves `false` and nothing happens, so
     * these cannot be used to open an arbitrary file.
     */
    reveal(outputPath: string): Promise<boolean>
    open(outputPath: string): Promise<boolean>
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

  /**
   * Who may use bay (`src/shared/access.ts`). Main decides and enforces; this is how the access
   * screen asks and listens. Every other channel refuses while the status is not `entitled`.
   */
  access: {
    status(): Promise<AccessStatus>
    /** Opens the system browser on the sign-in page; resolves with `waiting`. */
    signIn(): Promise<AccessStatus>
    cancelSignIn(): Promise<AccessStatus>
    /** Forgets the stored sign-in on this Mac. */
    signOut(): Promise<AccessStatus>
    /** Verify now, instead of waiting for the next scheduled check. */
    recheck(): Promise<AccessStatus>
    /** Opens the website's waitlist in the browser. */
    requestAccess(): Promise<void>
    /** Grant `email` access as a referral from this account (entitled only). */
    refer(email: string): Promise<ReferralResult>
    /** Every status change, pushed. Returns an unsubscribe function. */
    onChange(listener: (status: AccessStatus) => void): () => void
  }

  /**
   * In-app updates (`src/main/update/updater.ts`, `src/shared/update.ts`). Main checks and
   * downloads. The renderer shows the status and decides when it is safe to restart. All of
   * these work while bay is locked.
   */
  update: {
    status(): Promise<UpdateStatus>
    /** Check now. Background checks run at launch and every six hours. */
    check(): Promise<UpdateStatus>
    /** Download the available update. Nothing downloads without this call. */
    download(): Promise<UpdateStatus>
    /**
     * Quit and relaunch into the downloaded update. Call only after the open project is saved
     * or autosaved (`restartPlan`).
     */
    install(): Promise<UpdateStatus>
    /** Every status change, pushed. Returns an unsubscribe function. */
    onChange(listener: (status: UpdateStatus) => void): () => void
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
  appRepairStorage: 'app:repair-storage',
  appSetMcpClients: 'app:set-mcp-clients',
  appMcpReady: 'app:mcp-ready',
  appMenuCommand: 'app:menu-command',
  appMetrics: 'app:metrics',

  /** renderer -> main: start, drive and stop the in-app agent. */
  agentStart: 'agent:start',
  agentProviders: 'agent:providers',
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
  mediaImportUrl: 'media:import-url',
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
  visionStatus: 'vision:status',
  visionDownload: 'vision:download',
  visionCancelDownload: 'vision:cancel-download',
  visionDelete: 'vision:delete',
  visionIndex: 'vision:index',
  visionCancelIndex: 'vision:cancel-index',
  visionSearch: 'vision:search',
  /** main -> renderer: the new `VisionStatus`, whenever the download or the indexing job moves. */
  visionChanged: 'vision:changed',
  mediaFilmstrip: 'media:filmstrip',
  mediaWaveform: 'media:waveform',
  mediaBeats: 'media:beats',
  mediaCuts: 'media:cuts',
  mediaLevels: 'media:levels',
  mediaSilences: 'media:silences',
  mediaLoudness: 'media:loudness',
  mediaReveal: 'media:reveal',
  mediaStat: 'media:stat',
  mediaLocate: 'media:locate',
  mediaOpenCaptions: 'media:open-captions',
  mediaReadCaptions: 'media:read-captions',
  mediaSaveCaptions: 'media:save-captions',
  mediaFreezeFrame: 'media:freeze-frame',

  /**
   * renderer -> main: AI generation (the fourth network exception). Keys in, set/not-set out;
   * jobs are started and read here and nowhere else.
   */
  generationKeys: 'generation:keys',
  generationSetKey: 'generation:set-key',
  generationClearKey: 'generation:clear-key',
  generationStart: 'generation:start',
  generationJob: 'generation:job',
  generationJobs: 'generation:jobs',
  generationSpending: 'generation:spending',
  generationSetLimits: 'generation:set-limits',
  generationReserve: 'generation:reserve',
  generationRelease: 'generation:release',
  generationDubs: 'generation:dubs',
  generationSaveDub: 'generation:save-dub',

  stylesList: 'styles:list',
  stylesWrite: 'styles:write',

  compositionInspect: 'composition:inspect',
  compositionWrite: 'composition:write',
  compositionWriteTemplate: 'composition:write-template',
  compositionWriteGenerated: 'composition:write-generated',
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
  projectRename: 'project:rename',
  projectDuplicate: 'project:duplicate',
  projectTrash: 'project:trash',

  exportStart: 'export:start',
  exportPushFrame: 'export:push-frame',
  exportFinish: 'export:finish',
  exportCancel: 'export:cancel',
  exportChoosePath: 'export:choose-path',
  exportReveal: 'export:reveal',
  exportOpen: 'export:open',
  exportProgress: 'export:progress',

  accessStatus: 'access:status',
  accessSignIn: 'access:sign-in',
  accessCancelSignIn: 'access:cancel-sign-in',
  accessSignOut: 'access:sign-out',
  accessRecheck: 'access:recheck',
  accessRequestAccess: 'access:request-access',
  accessRefer: 'access:refer',
  /** main -> renderer: the new `AccessStatus`, whenever it changes. */
  accessChanged: 'access:changed',

  updateStatus: 'update:status',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  /** main -> renderer: the new `UpdateStatus`, whenever it changes. */
  updateChanged: 'update:changed',

  windowMinimise: 'window:minimise',
  windowToggleMaximise: 'window:toggle-maximise',
  windowClose: 'window:close'
} as const
