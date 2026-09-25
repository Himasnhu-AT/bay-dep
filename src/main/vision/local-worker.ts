/**
 * What the vision process does, callable in-process: embed text, index one file into the cache.
 *
 * The utility process (`worker.ts`) is this behind a message port; `pnpm test` uses it directly,
 * which is the point of the split — the model, the sampler and the cache run under plain Node
 * exactly as they run in the app, with only the message plumbing left to Electron.
 */

import { VISION_MODEL } from '@shared/visual-search'
import { writeFrameIndex } from './cache'
import { loadEncoder, type Encoder } from './encoder'
import { indexFile } from './indexer'

export interface IndexRequest {
  path: string
  kind: 'video' | 'image'
  durationUs: number
  cacheDir: string
  cacheName: string
}

export interface VisionWorker {
  embedText(texts: string[]): Promise<Float32Array[]>
  /** Index one file and write its cache entry. Resolves with the frame count; null when cancelled. */
  indexFile(request: IndexRequest, onFrames: (frames: number) => void, signal: AbortSignal): Promise<number | null>
  /** Free the model. The next call loads it again. */
  stop(): void
}

export interface WorkerConfig {
  modelDir: string
  ffmpeg: string
  ffprobe: string
}

export function localWorker(config: WorkerConfig): VisionWorker {
  let encoder: Promise<Encoder> | null = null
  const load = (): Promise<Encoder> => {
    encoder ??= loadEncoder(config.modelDir).catch((error: unknown) => {
      encoder = null
      throw error
    })
    return encoder
  }
  return {
    async embedText(texts) {
      return (await load()).embedText(texts)
    },
    async indexFile(request, onFrames, signal) {
      const index = await indexFile(await load(), request.path, {
        ffmpeg: config.ffmpeg,
        ffprobe: config.ffprobe,
        kind: request.kind,
        durationUs: request.durationUs,
        signal,
        modelId: VISION_MODEL.id,
        onFrames
      })
      if (!index) return null
      await writeFrameIndex(request.cacheDir, request.cacheName, index)
      return index.timesUs.length
    },
    stop() {
      const loaded = encoder
      encoder = null
      void loaded?.then((e) => e.release()).catch(() => undefined)
    }
  }
}
