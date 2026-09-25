/**
 * The real model, end to end: bay's ffmpeg samples the pictures, onnxruntime embeds them, the
 * cache holds them, the service ranks them. Skipped loudly unless the model is on this machine —
 * where Settings › Visual search puts it (`~/Library/Application Support/bay/vision-models/…`), or
 * a folder named by `BAY_VISION_MODEL_DIR` holding the same four files.
 *
 * The ranking check is paired: a red square must rank "a red square" above "a blue circle", *and*
 * a blue circle the other way round. Either alone passes for a model that prefers one phrase for
 * every picture.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { VISION_MODEL } from '@shared/visual-search'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { loadEncoder } from './encoder'
import { localWorker } from './local-worker'
import { VisionService } from './service'
import { loadTokenizer } from './tokenizer'

const MODEL_DIR = process.env['BAY_VISION_MODEL_DIR'] || join(homedir(), 'Library', 'Application Support', 'bay', 'vision-models', VISION_MODEL.id)
const HAVE_MODEL = VISION_MODEL.files.every((f) => existsSync(join(MODEL_DIR, f.name)))
const TOOLS = vendoredTools()
const SKIP = !HAVE_MODEL
  ? `no visual search model at ${MODEL_DIR} — download it in Settings › Visual search, or set BAY_VISION_MODEL_DIR (this check did not run)`
  : !TOOLS
    ? NO_VENDORED_FFMPEG
    : false

test('the downloaded tokenizer gives the reference ids', { skip: HAVE_MODEL ? false : SKIP }, () => {
  const tok = loadTokenizer(readFileSync(join(MODEL_DIR, 'tokenizer.json'), 'utf8'))
  // From transformers.js 4.3.0's SiglipTokenizer over the same file, on canonical text. A
  // differential over 2,008 strings (random phrases, accents, CJK, emoji, punctuation) matched
  // on every one under 64 tokens; past that transformers.js drops the final </s> and bay keeps it,
  // as the Python reference does.
  const cases: [string, number[]][] = [
    ['a red square', [262, 266, 1226, 2393, 1]],
    ['a blue circle', [262, 266, 1712, 5372, 1]],
    ['a photo of a dog on a beach', [262, 266, 1304, 267, 262, 266, 1571, 277, 262, 266, 2178, 1]],
    ['State-owned', [619, 7383, 1]],
    ['Zürich café', [262, 761, 5879, 5345, 14983, 1]]
  ]
  for (const [text, ids] of cases) assert.deepEqual(tok.encode(text).slice(0, ids.length), ids, text)
})

/** A binary PPM: ffmpeg reads it like any image. */
function ppm(path: string, pixel: (x: number, y: number) => [number, number, number]): string {
  const w = 320
  const h = 240
  const body = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) body.set(pixel(x, y), (y * w + x) * 3)
  writeFileSync(path, Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), body]))
  return path
}

test('a red square ranks "a red square" first, and a blue circle "a blue circle"', { skip: SKIP, timeout: 120_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'bay-vision-model-'))
  const white: [number, number, number] = [255, 255, 255]
  const red = ppm(join(root, 'red-square.ppm'), (x, y) => (x > 90 && x < 230 && y > 50 && y < 190 ? [230, 20, 20] : white))
  const blue = ppm(join(root, 'blue-circle.ppm'), (x, y) => ((x - 160) ** 2 + (y - 120) ** 2 < 70 ** 2 ? [20, 40, 230] : white))

  const modelsDir = join(root, 'models')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(modelsDir)
  symlinkSync(MODEL_DIR, join(modelsDir, VISION_MODEL.id))
  const service = new VisionService({
    modelsDir,
    cacheDir: join(root, 'cache'),
    worker: () => localWorker({ modelDir: MODEL_DIR, ffmpeg: TOOLS!.ffmpeg, ffprobe: TOOLS!.ffprobe })
  })
  const assets = [
    { assetId: 'red', name: 'red-square.ppm', path: red, kind: 'image' as const, durationUs: 0 },
    { assetId: 'blue', name: 'blue-circle.ppm', path: blue, kind: 'image' as const, durationUs: 0 }
  ]
  const started = Date.now()
  const index = await service.index(assets)
  assert.ok(index.ok && index.started, JSON.stringify(index))
  await service.settled()
  assert.deepEqual((await service.status()).index?.failed, [])
  console.log(`# indexed 2 images with the real model in ${Date.now() - started} ms (model load included)`)

  const top = async (query: string): Promise<string[]> => {
    const answer = await service.search({ assets, query, limit: 2 })
    assert.ok(answer.ok, JSON.stringify(answer))
    return answer.hits.map((h) => h.assetId)
  }
  assert.deepEqual(await top('a red square'), ['red', 'blue'])
  assert.deepEqual(await top('a blue circle'), ['blue', 'red'])
})

test('text embeddings are 768-wide unit vectors, so a dot product is the cosine', { skip: SKIP, timeout: 120_000 }, async () => {
  const encoder = await loadEncoder(MODEL_DIR)
  try {
    const [square, circle] = await encoder.embedText(['a red square', 'a blue circle'])
    assert.equal(encoder.dims, 768)
    assert.equal(square!.length, 768)
    // Unit vectors: the service's cosine is a dot product only if this holds.
    const norm = Math.sqrt(square!.reduce((s, v) => s + v * v, 0))
    assert.ok(Math.abs(norm - 1) < 1e-4, `norm ${norm}`)
    assert.ok(circle)
  } finally {
    await encoder.release()
  }
})
