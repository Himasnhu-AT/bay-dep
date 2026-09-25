/**
 * SigLIP, loaded: the two ONNX towers on onnxruntime-node, and the tokenizer.
 *
 * Runs inside the vision utility process (`worker.ts`), never in main itself: the model holds
 * ~0.8–1.3 GB resident while loaded (measured RSS 823 MB int8, 1308 MB fp32 in a bare Node), and a
 * native crash there should cost a search, not the editor. No Electron import, so `pnpm test`
 * drives it against the real model when one is on this machine.
 *
 * Runtime choice, measured on an M5 Pro with the model at the pinned revision:
 * - onnxruntime-node 1.30.0 loads under Electron 44 (Node 24.21, NAPI 10) with no rebuild — it is
 *   an N-API module (`bin/napi-v6/darwin/arm64`), so there is no Electron ABI to match.
 * - CPU, not CoreML: the CoreML provider was no faster (fp32 batch-8 30.0 vs 30.6 ms/frame; int8
 *   27.1 vs 23.2) and took more memory (1969 vs 1308 MB) and longer to load (1.4 s vs 0.5 s).
 * - Four intra-op threads: 32 ms/frame against ~30 with every core, leaving the rest for playback.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InferenceSession, Tensor } from 'onnxruntime-node'
import { checkPreprocessorConfig, IMAGE_SIZE, normalise, VISION_MODEL, type VisionModelSpec } from '@shared/visual-search'
import { loadTokenizer, TEXT_TOKENS, type Tokenizer } from './tokenizer'

export const EMBED_THREADS = 4
/** Frames per forward pass: the per-frame cost is flat past 8 (measured 25.1 at 1, 23.2 at 8). */
export const IMAGE_BATCH = 8

export interface Encoder {
  readonly dims: number
  /** `planes` holds `count` frames of CHW floats (`rgbToPlanes`); one unit vector each. */
  embedImages(planes: Float32Array, count: number): Promise<Float32Array[]>
  embedText(texts: readonly string[]): Promise<Float32Array[]>
  release(): Promise<void>
}

/** The model folder for a spec, under the folder bay keeps vision models in. */
export const modelFolder = (modelsDir: string, model: VisionModelSpec = VISION_MODEL): string => join(modelsDir, model.id)

function fileOf(model: VisionModelSpec, name: string): string {
  const file = model.files.find((f) => f.name.includes(name))
  if (!file) throw new Error(`The visual search model has no ${name} file.`)
  return file.name
}

/**
 * Load from a folder holding the spec's files. Throws in words: a config that disagrees with the
 * preprocessing bay implements is refused before a single frame is embedded with it.
 */
export async function loadEncoder(dir: string, model: VisionModelSpec = VISION_MODEL): Promise<Encoder> {
  const config = JSON.parse(await readFile(join(dir, 'preprocessor_config.json'), 'utf8')) as unknown
  const mismatch = checkPreprocessorConfig(config)
  if (mismatch) throw new Error(mismatch)
  const tokenizer: Tokenizer = loadTokenizer(await readFile(join(dir, 'tokenizer.json'), 'utf8'))

  // Imported here, not at the top: a module that only asks "is the model installed?" must not
  // load a native library to answer.
  const ort = await import('onnxruntime-node')
  const options: InferenceSession.SessionOptions = {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    intraOpNumThreads: EMBED_THREADS
  }
  const vision = await ort.InferenceSession.create(join(dir, fileOf(model, 'vision_model')), options)
  const text = await ort.InferenceSession.create(join(dir, fileOf(model, 'text_model')), options)

  // `pooler_output` is SigLIP's embedding for both towers — the attention-pool head for images,
  // the head over the last position for text (what `get_image_features`/`get_text_features` return).
  const rows = (tensor: Tensor | undefined, count: number): Float32Array[] => {
    if (!tensor) throw new Error('The visual search model returned no embedding (no pooler_output).')
    const dims = tensor.dims[tensor.dims.length - 1] ?? 0
    const data = tensor.data as Float32Array | Uint16Array
    if (!(data instanceof Float32Array)) throw new Error('The visual search model returned half floats; bay expects float32 outputs.')
    return Array.from({ length: count }, (_, i) => normalise(data.subarray(i * dims, (i + 1) * dims)))
  }

  let dims = 0
  return {
    get dims() {
      return dims
    },
    async embedImages(planes, count) {
      if (count === 0) return []
      const size = 3 * IMAGE_SIZE * IMAGE_SIZE
      if (planes.length < count * size) throw new Error(`${count} frames need ${count * size} values; got ${planes.length}.`)
      const input = new ort.Tensor('float32', planes.subarray(0, count * size), [count, 3, IMAGE_SIZE, IMAGE_SIZE])
      const out = await vision.run({ pixel_values: input })
      const vectors = rows(out['pooler_output'], count)
      dims = vectors[0]?.length ?? dims
      return vectors
    },
    async embedText(texts) {
      if (texts.length === 0) return []
      const ids = new BigInt64Array(texts.length * TEXT_TOKENS)
      texts.forEach((t, i) => tokenizer.encode(t).forEach((id, j) => (ids[i * TEXT_TOKENS + j] = BigInt(id))))
      const out = await text.run({ input_ids: new ort.Tensor('int64', ids, [texts.length, TEXT_TOKENS]) })
      const vectors = rows(out['pooler_output'], texts.length)
      dims = vectors[0]?.length ?? dims
      return vectors
    },
    async release() {
      await vision.release()
      await text.release()
    }
  }
}
