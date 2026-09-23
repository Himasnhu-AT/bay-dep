/**
 * Export: the renderer draws, main encodes.
 *
 * The split is deliberate. The renderer already knows how to composite a frame, and
 * reimplementing that in main would be a second compositor to keep in agreement with the
 * first. So the renderer pushes raw RGBA and this file owns exactly one thing: getting those
 * bytes into a container, with the timeline's audio beside them.
 *
 * Audio is a second pass, not a second pipe. ffmpeg cannot take an unsynchronised rawvideo
 * pipe and a filter graph of a dozen files in one invocation without the pipe's arrival rate
 * becoming the mux's clock — which makes the audio drift by however long the renderer paused.
 * Encoding video first and muxing against a finished audio file has no such coupling.
 */

import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { mkdir, rename, unlink, copyFile } from 'node:fs/promises'
import { join, extname, basename, dirname } from 'node:path'
import { BrowserWindow, dialog, type WebContents } from 'electron'
import type {
  ExportFormat,
  ExportFrame,
  ExportJob,
  ExportProgress,
  ExportRequest
} from '@shared/ipc'
import { IPC } from '@shared/ipc'
import type { Project, Timeline } from '@shared/project'
import { findAsset, findTimeline, timelineDuration } from '@shared/project'
import { exportScratchDir } from '../paths'
import { ffmpegBin, MediaToolError } from '../media/ffmpeg'
import { buildAudioGraph, type CompositionSounds } from './audio-graph'
import { inspectComposition } from '../html/compositions'
import type { CompositionSound } from '@shared/composition'
import { checkExportDestination } from './destination'
import { frameProblem, writeFrame } from './frame-pipe'
import { audioCodecArgs, containerArgs, extensionFor, tailOf, videoCodecArgs } from './codec-args'

const AUDIO_ONLY: ReadonlySet<ExportFormat> = new Set<ExportFormat>(['wav', 'mp3'])

interface Job {
  id: string
  request: ExportRequest
  project: Project
  timeline: Timeline
  width: number
  height: number
  fps: number
  fromFrame: number
  /** Exclusive. */
  toFrame: number
  framesTotal: number
  framesDone: number
  nextFrame: number
  /** stdin is the frame pipe, stdout is discarded, stderr is kept for the error message. */
  child: ChildProcessByStdio<Writable, null, Readable> | null
  /** Where the video-only pass writes before the audio is muxed onto it. */
  scratch: string | null
  sender: WebContents
  cancelled: boolean
  failed: boolean
  /**
   * Why the job failed, kept so `pushFrame` and `finish` can refuse with a reason.
   *
   * A failed job stays in the map rather than being deleted. Deleting it makes it
   * indistinguishable from a cancelled one, and both then return *silently* — so a renderer
   * that did not act on the `failed` event would composite an entire timeline into nothing and
   * report success. That is the failure this whole destination check exists to prevent,
   * reappearing one layer down.
   */
  failureReason: string | null
  /** Resolves when the encoder process has exited, whatever the reason. */
  exited: Promise<void> | null
  /** When this job last sent progress. Per job, so two exports do not throttle each other. */
  lastEmitMs: number
}

const jobs = new Map<string, Job>()

function emit(job: Job, progress: Omit<ExportProgress, 'jobId'>): void {
  if (job.sender.isDestroyed()) return
  job.sender.send(IPC.exportProgress, { jobId: job.id, ...progress } satisfies ExportProgress)
}

function messageOf(error: unknown): string {
  if (error instanceof MediaToolError) return error.message
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------------------
// Running ffmpeg
// ---------------------------------------------------------------------------

/** Spawns ffmpeg and resolves on a clean exit, rejecting with stderr's tail otherwise. */
function runFfmpeg(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), [...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > 16384) stderr = stderr.slice(-8192)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new MediaToolError('ffmpeg', code, tailOf(stderr)))
    })
  })
}

// ---------------------------------------------------------------------------
// Starting a job
// ---------------------------------------------------------------------------

function resolveTimeline(request: ExportRequest): Timeline {
  const timeline = findTimeline(request.project, request.timelineId)
  if (!timeline) throw new Error(`Timeline ${request.timelineId} is not in this project.`)
  return timeline
}

function spawnVideoEncoder(job: Job, target: string): ChildProcessByStdio<Writable, null, Readable> {
  const format = job.request.format
  const quality = job.request.quality ?? 'good'
  // No `-nostdin` here, unlike every other spawn in this file: stdin *is* the input.
  const args = [
    '-v',
    'error',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${job.width}x${job.height}`,
    '-r',
    String(job.fps),
    '-i',
    'pipe:0',
    '-an',
    ...videoCodecArgs(format, quality),
    '-r',
    String(job.fps),
    ...containerArgs(format),
    '-y',
    target
  ]
  const child = spawn(ffmpegBin(), args, { stdio: ['pipe', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
    if (stderr.length > 16384) stderr = stderr.slice(-8192)
  })
  // Without this, ffmpeg dying mid-export raises EPIPE on the next write as an unhandled
  // 'error' event and takes the main process with it.
  child.stdin.on('error', () => undefined)

  job.exited = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 || job.cancelled) resolve()
      else reject(new MediaToolError('ffmpeg', code, tailOf(stderr)))
    })
  })
  return child
}

export async function start(request: ExportRequest, sender: WebContents): Promise<ExportJob> {
  const timeline = resolveTimeline(request)
  const duration = timelineDuration(timeline)
  const fromFrame = Math.max(0, Math.floor(request.fromFrame ?? 0))
  const toFrame = Math.min(
    duration,
    request.toFrame === undefined ? duration : Math.floor(request.toFrame) + 1
  )

  const job: Job = {
    id: randomUUID(),
    request,
    project: request.project,
    timeline,
    width: Math.max(2, Math.round(request.width ?? timeline.width)),
    height: Math.max(2, Math.round(request.height ?? timeline.height)),
    fps: request.fps && request.fps > 0 ? request.fps : timeline.fps,
    fromFrame,
    toFrame,
    framesTotal: Math.max(0, toFrame - fromFrame),
    framesDone: 0,
    nextFrame: fromFrame,
    child: null,
    scratch: null,
    sender,
    cancelled: false,
    failed: false,
    failureReason: null,
    exited: null,
    lastEmitMs: 0
  }
  jobs.set(job.id, job)

  emit(job, {
    progress: 0,
    framesDone: 0,
    framesTotal: job.framesTotal,
    stage: 'preparing'
  })

  // Before anything is spawned or composited. A destination that cannot be written fails at
  // the ffmpeg write otherwise — after the entire render, which on a long 4K timeline is
  // minutes of work to be told the folder was wrong. One stat against the most expensive
  // operation in the app.
  //
  // A PNG sequence is checked against the folder it will create its directory *in*, since
  // the directory itself is made by the export.
  const destination =
    request.format === 'png-sequence' ? pngDirectoryFor(request.outputPath) : request.outputPath
  const problem = await checkExportDestination(destination)
  if (problem) {
    job.failed = true
    job.failureReason = problem.message
    emit(job, {
      progress: null,
      framesDone: 0,
      framesTotal: job.framesTotal,
      stage: 'failed',
      error: problem.message
    })
    return { jobId: job.id }
  }

  try {
    if (AUDIO_ONLY.has(request.format)) {
      // Nothing to render: the timeline's audio is the whole deliverable. The job completes
      // on its own and `pushFrame` becomes a no-op.
      void renderAudioOnly(job)
      return { jobId: job.id }
    }

    if (request.format === 'png-sequence') {
      const directory = pngDirectoryFor(request.outputPath)
      await mkdir(directory, { recursive: true })
      job.scratch = null
      job.child = spawnVideoEncoder(job, join(directory, 'frame_%05d.png'))
    } else {
      const scratch = join(
        exportScratchDir(),
        `${job.id}.video.${extensionFor(request.format) || 'mp4'}`
      )
      job.scratch = scratch
      job.child = spawnVideoEncoder(job, scratch)
    }

    emit(job, {
      progress: job.framesTotal > 0 ? 0 : null,
      framesDone: 0,
      framesTotal: job.framesTotal,
      stage: 'rendering'
    })
  } catch (error) {
    job.failed = true
    jobs.delete(job.id)
    emit(job, {
      progress: null,
      framesDone: 0,
      framesTotal: job.framesTotal,
      stage: 'failed',
      error: messageOf(error)
    })
  }

  return { jobId: job.id }
}

/** A PNG sequence is a folder of files, so the chosen path names the folder. */
function pngDirectoryFor(outputPath: string): string {
  const extension = extname(outputPath)
  if (!extension) return outputPath
  return join(dirname(outputPath), basename(outputPath, extension))
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/** Emitting on every frame floods the IPC channel; a 30 fps export needs far less. */
const PROGRESS_INTERVAL_MS = 120

export async function pushFrame(frame: ExportFrame): Promise<void> {
  const job = jobs.get(frame.jobId)
  if (!job || job.cancelled) return
  // A failed job refuses loudly. Cancellation stays silent above it, because cancelling is
  // something the user asked for and the renderer's loop is expected to notice on its own.
  if (job.failed) throw new Error(job.failureReason ?? 'This export has already failed.')
  if (AUDIO_ONLY.has(job.request.format)) return
  if (!job.child) throw new Error('That export job has no encoder running.')

  const buffer = Buffer.from(frame.data)
  const problem = frameProblem(
    { frame: frame.frame, width: frame.width, height: frame.height, byteLength: buffer.byteLength },
    { nextFrame: job.nextFrame, width: job.width, height: job.height }
  )
  if (problem) throw new Error(problem)

  await writeFrame(job.child.stdin, buffer)
  job.nextFrame += 1
  job.framesDone += 1

  const now = Date.now()
  if (now - job.lastEmitMs >= PROGRESS_INTERVAL_MS || job.framesDone === job.framesTotal) {
    job.lastEmitMs = now
    emit(job, {
      progress: job.framesTotal > 0 ? job.framesDone / job.framesTotal : null,
      framesDone: job.framesDone,
      framesTotal: job.framesTotal || null,
      stage: 'rendering'
    })
  }
}

// ---------------------------------------------------------------------------
// Finishing
// ---------------------------------------------------------------------------

/**
 * What each HTML composition on the timeline declares, read from its file now.
 *
 * Read at export rather than trusted from the asset, because the picture is rendered from the
 * live file too: a sound list captured at import would disagree with the frames after the
 * first edit to the composition. `inspectComposition` lists only sounds whose files exist and
 * decode, which is what keeps one missing whoosh from failing the whole mix.
 */
async function declaredSounds(job: Job): Promise<CompositionSounds> {
  const out = new Map<string, readonly CompositionSound[]>()
  const seen = new Set<string>()
  for (const track of job.timeline.tracks) {
    for (const item of track.items) {
      if (seen.has(item.assetId)) continue
      seen.add(item.assetId)
      const asset = findAsset(job.project, item.assetId)
      if (!asset || asset.kind !== 'html' || !asset.path || asset.error) continue
      const { info } = await inspectComposition(asset.path)
      if (info && info.audio.length > 0) out.set(asset.id, info.audio)
    }
  }
  return out
}

async function buildAudioTrack(job: Job): Promise<string | null> {
  const graph = buildAudioGraph(
    job.project,
    job.timeline,
    job.fromFrame,
    job.toFrame,
    await declaredSounds(job)
  )
  if (!graph) return null
  const target = join(exportScratchDir(), `${job.id}.audio.wav`)
  const duration = job.framesTotal / job.fps
  const args: string[] = ['-nostdin', '-v', 'error']
  for (const input of graph.inputs) args.push('-i', input)
  args.push(
    '-filter_complex',
    graph.filter,
    '-map',
    `[${graph.outputLabel}]`,
    '-t',
    duration.toFixed(6),
    '-c:a',
    'pcm_s16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-y',
    target
  )
  await runFfmpeg(args)
  return target
}

async function renderAudioOnly(job: Job): Promise<void> {
  try {
    emit(job, {
      progress: null,
      framesDone: 0,
      framesTotal: null,
      stage: 'encoding',
      message: 'Mixing audio'
    })
    const graph = buildAudioGraph(
      job.project,
      job.timeline,
      job.fromFrame,
      job.toFrame,
      await declaredSounds(job)
    )
    if (!graph) throw new Error('This timeline has no audio to export.')
    const duration = job.framesTotal / job.fps
    const args: string[] = ['-nostdin', '-v', 'error']
    for (const input of graph.inputs) args.push('-i', input)
    args.push(
      '-filter_complex',
      graph.filter,
      '-map',
      `[${graph.outputLabel}]`,
      '-t',
      duration.toFixed(6),
      ...audioCodecArgs(job.request.format),
      '-y',
      job.request.outputPath
    )
    await runFfmpeg(args)
    emit(job, {
      progress: 1,
      framesDone: job.framesTotal,
      framesTotal: job.framesTotal,
      stage: 'done',
      outputPath: job.request.outputPath
    })
  } catch (error) {
    emit(job, {
      progress: null,
      framesDone: 0,
      framesTotal: job.framesTotal,
      stage: 'failed',
      error: messageOf(error)
    })
  } finally {
    jobs.delete(job.id)
  }
}

async function discard(path: string | null): Promise<void> {
  if (!path) return
  await unlink(path).catch(() => undefined)
}

/**
 * Moves the finished file into place. `rename` fails across volumes — the scratch directory
 * is in userData and the user may well be exporting to an external disk — so a copy is the
 * fallback rather than the error.
 */
async function moveInto(source: string, target: string): Promise<void> {
  try {
    await rename(source, target)
  } catch {
    await copyFile(source, target)
    await unlink(source).catch(() => undefined)
  }
}

export async function finish(jobId: string): Promise<void> {
  const job = jobs.get(jobId)
  if (!job || job.cancelled) return
  if (job.failed) {
    jobs.delete(jobId)
    throw new Error(job.failureReason ?? 'This export has already failed.')
  }

  try {
    if (job.child) {
      job.child.stdin.end()
      await job.exited
    }

    if (job.request.format === 'png-sequence') {
      emit(job, {
        progress: 1,
        framesDone: job.framesDone,
        framesTotal: job.framesTotal,
        stage: 'done',
        outputPath: pngDirectoryFor(job.request.outputPath),
        message: 'PNG sequences carry no audio track.'
      })
      return
    }

    emit(job, {
      progress: null,
      framesDone: job.framesDone,
      framesTotal: job.framesTotal,
      stage: 'encoding',
      message: 'Muxing audio'
    })

    const scratch = job.scratch
    if (!scratch) throw new Error('The encoder produced no file.')

    let audioPath: string | null = null
    let audioNote: string | undefined
    try {
      audioPath = await buildAudioTrack(job)
    } catch (error) {
      // The video is real and finished; refusing to deliver it would be worse than
      // delivering it with the shortfall stated. What is not allowed is calling this a
      // clean success.
      audioNote = `Exported without audio — the audio mix failed: ${messageOf(error)}`
    }

    if (audioPath) {
      await runFfmpeg([
        '-nostdin',
        '-v',
        'error',
        '-i',
        scratch,
        '-i',
        audioPath,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'copy',
        ...audioCodecArgs(job.request.format),
        '-shortest',
        ...containerArgs(job.request.format),
        '-y',
        job.request.outputPath
      ])
      await discard(audioPath)
      await discard(scratch)
    } else {
      await moveInto(scratch, job.request.outputPath)
    }

    emit(job, {
      progress: 1,
      framesDone: job.framesDone,
      framesTotal: job.framesTotal,
      stage: 'done',
      outputPath: job.request.outputPath,
      ...(audioNote ? { message: audioNote } : {})
    })
  } catch (error) {
    job.failed = true
    await discard(job.scratch)
    emit(job, {
      progress: null,
      framesDone: job.framesDone,
      framesTotal: job.framesTotal,
      stage: 'failed',
      error: messageOf(error)
    })
  } finally {
    jobs.delete(jobId)
  }
}

export async function cancel(jobId: string): Promise<void> {
  const job = jobs.get(jobId)
  if (!job) return
  job.cancelled = true
  if (job.child) {
    job.child.stdin.destroy()
    job.child.kill('SIGKILL')
    await job.exited?.catch(() => undefined)
  }
  await discard(job.scratch)
  jobs.delete(jobId)
  emit(job, {
    progress: null,
    framesDone: job.framesDone,
    framesTotal: job.framesTotal,
    stage: 'cancelled'
  })
}

/** Kills anything still running — called when the window goes away. */
export async function cancelAll(): Promise<void> {
  await Promise.all([...jobs.keys()].map((id) => cancel(id)))
}

export async function chooseOutputPath(
  defaultName: string,
  format: ExportFormat,
  window: BrowserWindow | null
): Promise<string | null> {
  const extension = extensionFor(format)
  const base = defaultName.replace(/\.[^./\\]+$/, '') || 'Untitled'
  const options: Electron.SaveDialogOptions = {
    title: format === 'png-sequence' ? 'Choose a folder name for the frames' : 'Export',
    buttonLabel: 'Export',
    defaultPath: extension ? `${base}.${extension}` : `${base} frames`,
    filters: extension ? [{ name: format.toUpperCase(), extensions: [extension] }] : []
  }
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  return result.filePath
}
