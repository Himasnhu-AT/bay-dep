/**
 * One file → its frame index: sample (`sampler.ts`), embed in batches (`encoder.ts`), return the
 * times and unit vectors. Nothing here decides *which* files; `worker.ts` runs this per request.
 * No Electron import.
 */

import { IMAGE_SIZE, rgbToPlanes, SAMPLE_INTERVAL_US, VISION_MODEL } from '@shared/visual-search'
import type { FrameIndex } from './cache'
import { IMAGE_BATCH, type Encoder } from './encoder'
import { sampleFrames, type SampleOptions } from './sampler'

export interface IndexFileOptions extends SampleOptions {
  modelId?: string
  /** After each batch: how many frames are embedded so far. */
  onFrames?: (framesDone: number) => void
}

const PLANE = 3 * IMAGE_SIZE * IMAGE_SIZE

export async function indexFile(encoder: Encoder, path: string, options: IndexFileOptions): Promise<FrameIndex | null> {
  const intervalUs = options.intervalUs ?? SAMPLE_INTERVAL_US
  const timesUs: number[] = []
  const rows: Float32Array[] = []
  const batch = new Float32Array(IMAGE_BATCH * PLANE)
  let batchTimes: number[] = []

  const flush = async (): Promise<void> => {
    if (batchTimes.length === 0) return
    const vectors = await encoder.embedImages(batch, batchTimes.length)
    timesUs.push(...batchTimes)
    rows.push(...vectors)
    batchTimes = []
    options.onFrames?.(timesUs.length)
  }

  for await (const frame of sampleFrames(path, options)) {
    rgbToPlanes(frame.rgb, batch, batchTimes.length * PLANE)
    batchTimes.push(frame.us)
    if (batchTimes.length === IMAGE_BATCH) await flush()
    if (options.signal?.aborted) return null
  }
  if (options.signal?.aborted) return null
  await flush()

  const dims = rows[0]?.length ?? 0
  const vectors = new Float32Array(rows.length * dims)
  rows.forEach((row, i) => vectors.set(row, i * dims))
  return { modelId: options.modelId ?? VISION_MODEL.id, intervalUs, dims, timesUs, vectors }
}
