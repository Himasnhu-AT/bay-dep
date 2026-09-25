/**
 * The app's one `VisionService`, with its worker in an Electron utility process.
 *
 * The only Electron in visual search: paths from `app`, and `utilityProcess.fork` of the bundled
 * `out/main/vision/worker.js`. Everything it asks of that process is `local-worker.ts`, which the
 * tests run in-process.
 */

import { app, utilityProcess, type UtilityProcess } from 'electron'
import { setPriority } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ffmpegBin, ffprobeBin } from '../ffmpeg/ffmpeg'
import { cacheDir } from '../paths'
import { visionCacheDir } from './cache'
import type { IndexRequest, VisionWorker } from './local-worker'
import type { VisionWorkerReply, VisionWorkerRequest } from './protocol'
import { VisionService } from './service'

/** Two idle minutes and the process (and its ~1 GB model) goes; the next call starts another. */
const IDLE_MS = 120_000
/** "Below normal": indexing yields to playback and export. Inherited by the ffmpeg it runs. */
const WORKER_NICE = 10

/** The main bundle is ESM (no `__dirname`); the worker is built beside it as `vision/worker.js`. */
const here = fileURLToPath(new URL('.', import.meta.url))

export const visionModelsDir = (): string => join(app.getPath('userData'), 'vision-models')

function utilityWorker(modelDir: string): VisionWorker {
  let child: UtilityProcess | null = null
  let nextId = 1
  let idle: ReturnType<typeof setTimeout> | null = null
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; onFrames?: (frames: number) => void }>()

  const stop = (): void => {
    if (idle) clearTimeout(idle)
    idle = null
    child?.kill()
    child = null
  }

  const armIdle = (): void => {
    if (idle) clearTimeout(idle)
    idle = pending.size === 0 ? setTimeout(stop, IDLE_MS) : null
  }

  const start = (): UtilityProcess => {
    if (child) return child
    const config = JSON.stringify({ modelDir, ffmpeg: ffmpegBin(), ffprobe: ffprobeBin() })
    const next = utilityProcess.fork(join(here, 'vision', 'worker.js'), [config], { serviceName: 'bay vision', stdio: 'inherit' })
    next.on('spawn', () => {
      try {
        if (next.pid) setPriority(next.pid, WORKER_NICE)
      } catch {
        // A priority that cannot be lowered leaves indexing at normal priority; it still works.
      }
    })
    next.on('message', (message: VisionWorkerReply) => {
      const call = pending.get(message.id)
      if (!call) return
      if (message.type === 'frames') {
        call.onFrames?.(message.frames)
        return
      }
      pending.delete(message.id)
      if (message.ok) call.resolve(message.value)
      else call.reject(new Error(message.error))
      armIdle()
    })
    next.on('exit', (code) => {
      if (child === next) child = null
      for (const [id, call] of pending) {
        pending.delete(id)
        call.reject(new Error(`The visual search process stopped (exit ${code}). Try again; if it keeps stopping, delete and re-download the model in Settings › Visual search.`))
      }
    })
    child = next
    return next
  }

  const call = <T>(message: { type: 'embedText'; texts: string[] } | { type: 'index'; request: IndexRequest }, onFrames?: (frames: number) => void): { id: number; promise: Promise<T> } => {
    const id = nextId++
    const promise = new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, ...(onFrames ? { onFrames } : {}) })
      if (idle) clearTimeout(idle)
      idle = null
      start().postMessage({ ...message, id } as VisionWorkerRequest)
    })
    return { id, promise }
  }

  return {
    async embedText(texts) {
      const rows = await call<number[][]>({ type: 'embedText', texts }).promise
      return rows.map((row) => Float32Array.from(row))
    },
    async indexFile(request: IndexRequest, onFrames, signal) {
      const { id, promise } = call<number | null>({ type: 'index', request }, onFrames)
      const cancel = (): void => {
        child?.postMessage({ type: 'cancel', id } satisfies VisionWorkerRequest)
      }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        return await promise
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    },
    stop
  }
}

let service: VisionService | null = null

export function vision(): VisionService {
  if (!service) {
    const modelsDir = visionModelsDir()
    const created: VisionService = new VisionService({
      modelsDir,
      cacheDir: visionCacheDir(cacheDir()),
      worker: () => utilityWorker(created.modelDir)
    })
    service = created
  }
  return service
}
