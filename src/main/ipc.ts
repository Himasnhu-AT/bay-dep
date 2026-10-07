/**
 * Every `ipcMain.handle` in bay, in one table.
 *
 * The table is typed against `BayApi` rather than against `any`, which buys the one property
 * that matters: adding a method to the contract and forgetting to implement it is a
 * *compile* error here, not a runtime rejection the renderer discovers in a menu nobody
 * clicked during testing. The same goes for a handler whose signature has drifted.
 */

import { BrowserWindow, ipcMain, shell, app } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { AudioResult, AudioSpan, BayApi, ImportedAsset } from '@shared/ipc'
import type { McpToolResult } from '@shared/mcp'
import { IPC } from '@shared/ipc'
import {
  compositionFrameAt,
  sampleFilm,
  importCompositions,
  inspectComposition,
  release as releaseComposition,
  releasePath,
  writeComposition
} from './html/compositions'
import { agentProviders, configureAgent, disposeAgent, exportTranscript, sendToAgent, startAgent, stopAgent } from './agent/host'
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
import { audioLevels, detectSilences, measureLoudness } from './media/audio-analysis'
import { detectSceneCuts } from './media/scene-cuts'
import { sizesOf } from './media/caption-file'
import { locate, openCaptions, readCaptions, saveCaptions } from './media/files'
import { forgetPath, importDialog, importPaths } from './media/import'
import { freezeFrame } from './media/freeze-frame'
import { writeSfx } from './sfx/write'
import { ensureSubjectMatte, subjectMattes } from './matte/host'
import { ensureAudioBake } from './audio-fx/host'
import { importFromUrl } from './media/url-import'
import { isAllowed } from './protocol'
import { vision } from './vision/host'
import { checkSearchRequest, checkVisionAssets } from './vision/requests'
import { downloadsDir, generatedDir, stylesDir } from './paths'
import { listUserStyles, writeUserStyle } from './styles/store'
import * as store from './project/store'
import { openResolve, resolveStatus } from './resolve'
import { parseHost } from '@shared/host'
import * as encode from './export/encode'
import { mcpStatus, setExecutorReady, setMcpClients, settleToolCall } from './mcp/server'
import { writeGenerated, writeTemplate } from './html/templates'
import * as access from './auth/access'
import * as update from './update/updater'
import { refuseChannel } from './auth/gate'
import * as telemetry from './telemetry/service'
import { TELEMETRY_SWITCHES, type TelemetryStatus } from '@shared/telemetry'
import type { AssetKind, Project } from '@shared/project'
import {
  clearGenerationKey,
  generationDubs,
  generationJob,
  generationJobs,
  generationKeys,
  generationSpending,
  setGenerationKey,
  setGenerationLimits,
  releaseGeneration,
  reserveGeneration,
  saveGenerationDub,
  startGenerationJob
} from './generate/service'

/** Channels pushed *to* the renderer. They carry no handler, so the table excludes them. */
type PushChannel = 'exportProgress' | 'appMenuCommand' | 'mcpToolCall' | 'mcpToolCancel' | 'agentEvent' | 'whisperProgress' | 'visionChanged' | 'accessChanged' | 'updateChanged'
type InvokeChannel = Exclude<keyof typeof IPC, PushChannel | 'mcpToolResult' | 'mcpExecutorReady' | 'telemetryTrack' | 'telemetryReportError'>

interface ChannelApi {
  appVersion: BayApi['app']['version']
  appMetrics: BayApi['app']['metrics']
  appPlatform: BayApi['app']['platform']
  appMediaToolsReady: BayApi['app']['mediaToolsReady']
  appStorageReady: BayApi['app']['storageReady']
  appRepairStorage: BayApi['app']['repairStorage']
  appSetMcpClients: BayApi['app']['setMcpClients']
  appMcpReady: BayApi['app']['mcpReady']

  mediaImportDialog: BayApi['media']['importDialog']
  mediaImportPaths: BayApi['media']['importPaths']
  mediaImportUrl: BayApi['media']['importUrl']
  mediaProbe: BayApi['media']['probe']
  mediaThumbnail: BayApi['media']['thumbnail']
  mediaTranscribe: BayApi['media']['transcribe']

  whisperStatus: BayApi['whisper']['status']
  whisperDownload: BayApi['whisper']['download']
  whisperCancel: BayApi['whisper']['cancelDownload']
  whisperDelete: BayApi['whisper']['deleteModel']
  whisperInstall: BayApi['whisper']['installEngine']

  visionStatus: BayApi['vision']['status']
  visionDownload: BayApi['vision']['download']
  visionCancelDownload: BayApi['vision']['cancelDownload']
  visionDelete: BayApi['vision']['deleteModel']
  visionIndex: BayApi['vision']['index']
  visionCancelIndex: BayApi['vision']['cancelIndex']
  visionSearch: BayApi['vision']['search']
  mediaFilmstrip: BayApi['media']['filmstrip']
  mediaWaveform: BayApi['media']['waveform']
  mediaBeats: BayApi['media']['beats']
  mediaCuts: BayApi['media']['cuts']
  mediaLevels: BayApi['media']['levels']
  mediaSilences: BayApi['media']['silences']
  mediaLoudness: BayApi['media']['loudness']
  mediaReveal: BayApi['media']['revealInFolder']
  mediaStat: BayApi['media']['stat']
  mediaLocate: BayApi['media']['locate']
  mediaOpenCaptions: BayApi['media']['openCaptions']
  mediaReadCaptions: BayApi['media']['readCaptions']
  mediaSaveCaptions: BayApi['media']['saveCaptions']
  mediaFreezeFrame: BayApi['media']['freezeFrame']
  mediaScoreSfx: BayApi['media']['scoreSfx']
  mediaSubjectMatte: BayApi['media']['subjectMatte']
  mediaSubjectMatteIndex: BayApi['media']['subjectMatteIndex']
  mediaAudioEffectBake: BayApi['media']['audioEffectBake']

  projectInitial: BayApi['project']['initial']
  projectSave: BayApi['project']['save']
  projectSaveAs: BayApi['project']['saveAs']
  projectOpen: BayApi['project']['open']
  projectOpenPath: BayApi['project']['openPath']
  projectRecent: BayApi['project']['recent']
  projectAutosave: BayApi['project']['autosave']
  projectRecovery: BayApi['project']['recovery']
  projectUnsaved: BayApi['project']['unsaved']
  projectRecover: BayApi['project']['recover']
  projectDiscardRecovery: BayApi['project']['discardRecovery']
  projectRevealRecovery: BayApi['project']['revealRecovery']
  projectSetAsideRecovery: BayApi['project']['setAsideRecovery']
  projectLaunchRequest: BayApi['project']['launchRequest']
  projectCreate: BayApi['project']['create']
  resolveStatus: BayApi['resolve']['status']
  resolveOpen: BayApi['resolve']['open']
  projectForget: BayApi['project']['forget']
  projectReveal: BayApi['project']['reveal']
  projectRename: BayApi['project']['rename']
  projectDuplicate: BayApi['project']['duplicate']
  projectTrash: BayApi['project']['trash']

  generationKeys: BayApi['generation']['keys']
  generationSetKey: BayApi['generation']['setKey']
  generationClearKey: BayApi['generation']['clearKey']
  generationStart: BayApi['generation']['start']
  generationJob: BayApi['generation']['job']
  generationJobs: BayApi['generation']['jobs']
  generationSpending: BayApi['generation']['spending']
  generationSetLimits: BayApi['generation']['setLimits']
  generationReserve: BayApi['generation']['reserve']
  generationRelease: BayApi['generation']['release']
  generationDubs: BayApi['generation']['dubs']
  generationSaveDub: BayApi['generation']['saveDub']

  stylesList: BayApi['styles']['list']
  stylesWrite: BayApi['styles']['write']

  compositionInspect: BayApi['composition']['inspect']
  compositionWrite: BayApi['composition']['write']
  compositionWriteTemplate: BayApi['composition']['writeTemplate']
  compositionWriteGenerated: BayApi['composition']['writeGenerated']
  compositionImport: BayApi['composition']['import']
  compositionFrameAt: BayApi['composition']['frameAt']
  compositionFilm: BayApi['composition']['film']
  compositionRelease: BayApi['composition']['release']

  agentStart: BayApi['agent']['start']
  agentConfigure: BayApi['agent']['configure']
  agentProviders: BayApi['agent']['providers']
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

  updateStatus: BayApi['update']['status']
  updateCheck: BayApi['update']['check']
  updateDownload: BayApi['update']['download']
  updateInstall: BayApi['update']['install']

  windowMinimise: BayApi['window']['minimise']
  windowToggleMaximise: BayApi['window']['toggleMaximise']
  windowClose: BayApi['window']['close']

  telemetryStatus: BayApi['telemetry']['status']
  telemetrySet: BayApi['telemetry']['set']
  telemetryDismissNotice: BayApi['telemetry']['dismissNotice']
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

/** A span from the renderer, with anything non-numeric read as "from the start, to the end". */
function checkSpan(span: unknown): AudioSpan {
  const given = (span ?? {}) as Partial<Record<keyof AudioSpan, unknown>>
  return { startUs: finiteOr(given.startUs, 0), durationUs: finiteOr(given.durationUs, 0) }
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** An audio measurement's value, or its failure in ffmpeg's words — never a rejection across IPC. */
async function audioResult<T>(work: () => Promise<T>): Promise<AudioResult<T>> {
  try {
    return { ok: true as const, value: await work() }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  }
}

const handlers: { [K in keyof ChannelApi]: Handler<ChannelApi[K]> } = {
  agentStart: async (_event, options) => startAgent(options),
  agentConfigure: async (_event, tuning) => configureAgent(tuning),
  agentProviders: async () => agentProviders(),
  agentSend: async (_event, text, attachments) => sendToAgent(text, attachments),
  agentStop: async () => stopAgent(),
  agentDispose: async () => disposeAgent(),
  agentExportTranscript: (_event, projectName, log) => exportTranscript(projectName, log),

  generationKeys: () => generationKeys(),
  generationSetKey: (_event, provider, fields) => setGenerationKey(provider, fields),
  generationClearKey: (_event, provider) => clearGenerationKey(provider),
  generationStart: (_event, request, options) => startGenerationJob(request, options),
  generationJob: (_event, id) => generationJob(id),
  generationJobs: () => generationJobs(),
  generationSpending: () => generationSpending(),
  generationSetLimits: (_event, limits) => setGenerationLimits(limits),
  generationReserve: (_event, totalUsd) => reserveGeneration(totalUsd),
  generationRelease: (_event, reservationId) => releaseGeneration(reservationId),
  generationDubs: () => generationDubs(),
  generationSaveDub: (_event, record) => saveGenerationDub(record),

  stylesList: () => listUserStyles(stylesDir()),
  stylesWrite: (_event, style, options) => writeUserStyle(stylesDir(), style, { replace: options?.replace === true }),

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
  compositionFilm: async (_event, request) => sampleFilm(request),
  compositionRelease: async (_event, assetId) => releaseComposition(assetId),

  appVersion: async () => app.getVersion(),
  appMetrics: () => collectMetrics(),
  appPlatform: async () => process.platform,
  appMediaToolsReady: async () => {
    const tools = mediaToolsReady()
    return { ready: tools.ready, ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe }
  },
  appMcpReady: async () => mcpStatus(),
  appRepairStorage: () => store.repairStorage(),
  appSetMcpClients: async (_event, on) => {
    const enabled = on === true
    store.setMcpClientsEnabled(enabled)
    return setMcpClients(enabled)
  },
  appStorageReady: async () => {
    // Opens the database on first ask if it is not open yet, so the status is the real one
    // rather than a guess made before anything tried.
    const { ready, error } = store.storageStatus()
    return { ready, error }
  },

  mediaImportDialog: async (event) => [...trackImports(await importDialog(windowOf(event)))],
  mediaImportPaths: async (_event, paths) => [...trackImports(await importPaths(paths))],
  mediaImportUrl: (_event, url, options) =>
    importFromUrl(url, { downloadsDir: downloadsDir(), ffmpeg: mediaToolsReady().ffmpeg }, { dryRun: options?.dryRun === true }),
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

  visionStatus: () => vision().status(),
  visionDownload: async () => {
    try {
      await vision().downloadModel('user')
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  },
  visionCancelDownload: async () => vision().cancelDownload(),
  visionDelete: () => vision().deleteModel(),
  visionIndex: async (_event, assets, options) => {
    try {
      // The renderer's paths are read only where `bay://` would serve them (vision/requests.ts).
      const checked = checkVisionAssets(assets, isAllowed)
      if (!checked.ok) return checked
      return await vision().index(checked.value, { dryRun: options?.dryRun === true, download: options?.download === true })
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  },
  visionCancelIndex: async () => vision().cancelIndex(),
  visionSearch: async (_event, request) => {
    try {
      const checked = checkSearchRequest(request, isAllowed)
      if (!checked.ok) return checked
      return await vision().search(checked.value)
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  },
  mediaWaveform: (_event, assetId, path, buckets) => waveform(assetId, path, buckets),
  mediaBeats: async (_event, path, options) => {
    try {
      return { ok: true as const, grid: await detectBeats(path, options ?? {}) }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  },
  mediaCuts: async (_event, path, options) => {
    try {
      const threshold = typeof options?.threshold === 'number' && Number.isFinite(options.threshold) ? options.threshold : undefined
      return { ok: true as const, cuts: await detectSceneCuts(String(path), threshold) }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  },
  mediaLevels: (_event, path, span, windowUs) =>
    audioResult(() => audioLevels(String(path), checkSpan(span), Number(windowUs))),
  mediaSilences: (_event, path, span, thresholdDb, minSilenceSec) =>
    audioResult(() => detectSilences(String(path), checkSpan(span), finiteOr(thresholdDb, -30), finiteOr(minSilenceSec, 0.5))),
  mediaLoudness: (_event, path, span) => audioResult(() => measureLoudness(String(path), checkSpan(span))),
  mediaReveal: async (_event, path) => {
    shell.showItemInFolder(path)
  },
  mediaStat: (_event, paths) => sizesOf(Array.isArray(paths) ? paths : []),
  mediaLocate: (event, name, nearPath) => locate(windowOf(event), String(name), nearPath ?? null),
  mediaOpenCaptions: (event) => openCaptions(windowOf(event)),
  mediaReadCaptions: (_event, path) => readCaptions(String(path)),
  mediaSaveCaptions: (event, defaultName, text) => saveCaptions(windowOf(event), String(defaultName), String(text)),
  mediaFreezeFrame: (_event, request) => freezeFrame(request),
  mediaScoreSfx: (_event, name, score) => writeSfx(generatedDir(), name, score),
  mediaSubjectMatte: (_event, request) => ensureSubjectMatte(request),
  mediaSubjectMatteIndex: (_event, key) => subjectMattes().index(key),
  mediaAudioEffectBake: (_event, request) => ensureAudioBake(request),

  // The project restored at launch (or double-clicked in Finder) is an open too — but only one
  // read from a file; the empty project a first launch starts with is not.
  projectInitial: async () => {
    const project = await store.initial()
    return project.filePath ? trackProjectOpen(project) : project
  },
  projectSave: (event, project) => store.save(project, windowOf(event)),
  projectSaveAs: (event, project) => store.saveAs(project, windowOf(event)),
  projectOpen: async (event) => trackProjectOpen(await store.open(windowOf(event))),
  projectOpenPath: async (_event, filePath) => trackProjectOpen(await store.openPath(filePath)),
  projectRecent: () => store.recent(),
  projectAutosave: (_event, project) => store.autosave(project),
  projectRecovery: (_event, opened) => store.recovery(opened),
  projectUnsaved: () => store.unsaved(),
  projectRecover: (_event, target) => store.recover(target),
  projectDiscardRecovery: (_event, target) => store.discardRecovery(target),
  projectRevealRecovery: async (_event, target) => store.revealRecovery(target),
  projectSetAsideRecovery: (_event, target) => store.setAsideRecovery(target),
  projectLaunchRequest: () => store.launchRequest(),
  projectCreate: (_event, options) => store.create(parseHost(options?.host)),
  resolveStatus: () => resolveStatus(),
  resolveOpen: () => openResolve(),
  projectForget: async (_event, filePath) => store.forget(filePath),
  projectReveal: async (_event, filePath) => store.reveal(filePath),
  projectRename: (_event, filePath, name) => store.rename(filePath, name),
  projectDuplicate: (_event, filePath) => store.duplicate(filePath),
  projectTrash: (_event, filePath) => store.trash(filePath),

  exportStart: (event, request) => encode.start(request, event.sender),
  exportPushFrame: (_event, frame) => encode.pushFrame(frame),
  exportFinish: (_event, jobId, summary) => encode.finish(jobId, { incomplete: summary?.incomplete === true }),
  exportCancel: (_event, jobId, reason) => encode.cancel(jobId, reason),
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
  },

  telemetryStatus: async () => telemetryStatus(),
  telemetrySet: async (_event, which, on) => {
    if (!(TELEMETRY_SWITCHES as readonly unknown[]).includes(which)) throw new Error(`There is no telemetry switch called "${String(which)}".`)
    const enabled = on === true
    store.setTelemetrySwitchStored(which, enabled)
    telemetry.setTelemetrySwitch(which, enabled)
    return telemetryStatus()
  },
  telemetryDismissNotice: async () => {
    store.dismissTelemetryNotice()
    return telemetryStatus()
  }
}

/** Preferences › Privacy's status: the client's, beside the switches and notice main's database keeps. */
function telemetryStatus(): TelemetryStatus {
  const state = telemetry.telemetryState()
  return {
    ...(state.switches ?? store.telemetrySwitches()),
    destination: state.destination,
    queued: state.queued,
    lastProblem: state.lastProblem,
    minidumpDir: telemetry.minidumpDir(),
    noticePending: store.telemetryNoticePending()
  }
}

/** One `import_media` event per kind of asset newly imported — counts only, never names. */
function trackImports(imported: readonly ImportedAsset[]): readonly ImportedAsset[] {
  const counts = new Map<string, number>()
  for (const { asset, reused } of imported) {
    if (!reused && !asset.error) counts.set(asset.kind, (counts.get(asset.kind) ?? 0) + 1)
  }
  for (const [kind, count] of counts) telemetry.track('import_media', { kind: kind as Exclude<AssetKind, 'adjustment'>, count })
  return imported
}

/** `project_open`: how big the project is, in tracks and items across its timelines. */
function trackProjectOpen<P extends Project | null>(project: P): P {
  if (project) {
    const tracks = project.timelines.flatMap((timeline) => timeline.tracks)
    telemetry.track('project_open', { tracks: tracks.length, items: tracks.reduce((sum, track) => sum + track.items.length, 0) })
  }
  return project
}

export interface IpcOptions {
  /** Whether `contents` is one of the editor's own windows — not a composition or render window. */
  isEditor: (contents: WebContents) => boolean
}

export function registerIpcHandlers({ isEditor }: IpcOptions): void {
  // The renderer's answer to a tool call. A `send`, not an `invoke`, because the renderer is
  // replying rather than asking — the correlation is by the id main put on the call.
  ipcMain.on(IPC.mcpToolResult, (_event, result: McpToolResult) => {
    settleToolCall(result)
  })
  ipcMain.on(IPC.mcpExecutorReady, (event, ready: boolean) => {
    setExecutorReady(event.sender, ready === true)
  })
  // Sends, outside the access gate: a page view carries one allow-listed word, and a locked
  // bay's own crash is still a crash. Main checks both before anything is queued — and only from
  // the editor's own windows: a composition or render window runs a document someone else may
  // have written, and must not be able to put text into a crash report or an event.
  ipcMain.on(IPC.telemetryTrack, (event, name: unknown, props: unknown) => {
    if (!isEditor(event.sender)) return
    telemetry.trackFromRenderer(name, props)
  })
  ipcMain.on(IPC.telemetryReportError, (event, report: unknown) => {
    if (!isEditor(event.sender)) return
    telemetry.reportRendererError(report, 'renderer')
  })

  // Download progress goes to every window: Settings may be open in one while a transcription in
  // another started the download.
  onWhisperDownload((download) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.whisperProgress, download)
    }
  })

  // The indexing job and the model download, to every window, for the same reason.
  vision().onChange((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.visionChanged, status)
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
