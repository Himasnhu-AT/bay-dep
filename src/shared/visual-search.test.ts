import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkPreprocessorConfig,
  cosine,
  describeDuration,
  expectedSamples,
  IMAGE_SIZE,
  needsFullDecode,
  rankFrames,
  rgbToPlanes,
  sampleFilter,
  SAME_MOMENT_US,
  VISION_MODEL,
  VISION_MODEL_BYTES,
  VISION_NOT_INSTALLED,
  visionFileUrl,
  type FrameCandidate
} from './visual-search'

/**
 * The checkpoint's `preprocessor_config.json` at the pinned revision, spelled out byte for byte
 * (sha256 21ee046a…, the same file the download is pinned to). A literal, not read from the
 * constants: a test that derived it from `IMAGE_MEAN` would move with any edit to them.
 */
const PREPROCESSOR_CONFIG = `{
  "do_normalize": true,
  "do_rescale": true,
  "do_resize": true,
  "image_processor_type": "SiglipImageProcessor",
  "image_mean": [
    0.5,
    0.5,
    0.5
  ],
  "processor_class": "SiglipProcessor",
  "resample": 3,
  "rescale_factor": 0.00392156862745098,
  "size": {
    "height": 224,
    "width": 224
  },
  "image_std": [
    0.5,
    0.5,
    0.5
  ]
}
`

test('the preprocessing constants match the model config', () => {
  assert.equal(new TextEncoder().encode(PREPROCESSOR_CONFIG).length, VISION_MODEL.files.find((f) => f.name === 'preprocessor_config.json')!.bytes)
  assert.equal(checkPreprocessorConfig(JSON.parse(PREPROCESSOR_CONFIG)), null)
})

test('a config asking for other preprocessing is refused, naming what differs', () => {
  const base = JSON.parse(PREPROCESSOR_CONFIG) as Record<string, unknown>
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ size: { height: 384, width: 384 } }, /size/],
    [{ image_mean: [0.481, 0.458, 0.408] }, /normalisation/],
    [{ image_std: [0.269, 0.261, 0.276] }, /normalisation/],
    [{ rescale_factor: 1 }, /rescale/],
    [{ resample: 2 }, /bilinear|resample 2/],
    [{ do_normalize: false }, /normalisation/]
  ]
  for (const [change, words] of cases) {
    const message = checkPreprocessorConfig({ ...base, ...change })
    assert.ok(message, `${JSON.stringify(change)} must be refused`)
    assert.match(message, words)
  }
})

test('rgbToPlanes: 0 → −1, 255 → 1, and each channel lands in its own plane (CHW, RGB order)', () => {
  const plane = IMAGE_SIZE * IMAGE_SIZE
  const red = new Uint8Array(plane * 3)
  for (let i = 0; i < plane; i++) red[i * 3] = 255
  const out = rgbToPlanes(red)
  assert.equal(out.length, 3 * plane)
  assert.ok(out.subarray(0, plane).every((v) => Math.abs(v - 1) < 1e-6), 'R plane is +1')
  assert.ok(out.subarray(plane).every((v) => Math.abs(v + 1) < 1e-6), 'G and B planes are −1')
  // A mid-grey is 0 after (v/255 − 0.5)/0.5, to within the half-step 127.5 cannot reach.
  const grey = rgbToPlanes(new Uint8Array(plane * 3).fill(128))
  assert.ok(Math.abs(grey[0]! - (128 / 255 - 0.5) / 0.5) < 1e-6)
  assert.throws(() => rgbToPlanes(new Uint8Array(10)), /bytes/)
})

test('rgbToPlanes writes at an offset without touching the frames before it', () => {
  const plane = 3 * IMAGE_SIZE * IMAGE_SIZE
  const batch = new Float32Array(plane * 2).fill(7)
  rgbToPlanes(new Uint8Array(plane).fill(255), batch, plane)
  assert.ok(batch.subarray(0, plane).every((v) => v === 7))
  assert.ok(batch.subarray(plane).every((v) => Math.abs(v - 1) < 1e-6))
})

test('cosine of unit vectors: itself 1, opposite −1, orthogonal 0, mismatched lengths 0', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1)
  assert.equal(cosine([1, 0], [-1, 0]), -1)
  assert.equal(cosine([1, 0], [0, 1]), 0)
  assert.equal(cosine([1, 0], [1, 0, 0]), 0)
})

const frame = (key: string, us: number, vector: number[]): FrameCandidate => ({ key, us, vector })

test('rankFrames orders by score, best first, and reports how far the winner stands apart', () => {
  const ranking = rankFrames([1, 0], [frame('b', 0, [0, 1]), frame('a', 0, [1, 0]), frame('c', 0, [0.6, 0.8])], 3)
  assert.deepEqual(ranking.hits.map((h) => h.key), ['a', 'c', 'b'])
  assert.equal(ranking.searched, 3)
  // Median is c (0.6): 1 − 0.6.
  assert.equal(ranking.separation, 0.4)
  const flat = rankFrames([1, 0], [frame('a', 0, [0, 1]), frame('b', 0, [0, 1]), frame('c', 0, [0, 1])], 3)
  assert.equal(flat.separation, 0)
})

test('rankFrames keeps one hit per moment of a file, so one long shot cannot fill the list', () => {
  const candidates = [frame('a', 0, [1, 0]), frame('a', 2_000_000, [0.99, 0.141]), frame('a', 10_000_000, [0.9, 0.436]), frame('b', 2_000_000, [0.8, 0.6])]
  const ranking = rankFrames([1, 0], candidates, 3)
  assert.deepEqual(ranking.hits.map((h) => `${h.key}@${h.us}`), ['a@0', 'a@10000000', 'b@2000000'])
  // Positive control: the moment rule is what dropped a@2s — it is the second-best frame overall.
  assert.ok(2_000_000 < SAME_MOMENT_US)
  assert.equal(rankFrames([1, 0], candidates.slice(1), 1).hits[0]?.us, 2_000_000)
})

test('rankFrames: a non-finite score sorts last, a limit is kept, an excluded frame is never a hit', () => {
  const ranking = rankFrames([1, 0], [frame('bad', 0, [Number.NaN, 0]), frame('good', 0, [1, 0]), frame('ok', 0, [0.5, 0.5])], 5)
  assert.deepEqual(ranking.hits.map((h) => h.key), ['good', 'ok'])
  assert.equal(rankFrames([1, 0], [frame('a', 0, [1, 0]), frame('b', 0, [1, 0])], 1).hits.length, 1)
  const excluded = rankFrames([1, 0], [frame('a', 0, [1, 0]), frame('b', 0, [0.5, 0.5])], 5, (c) => c.key === 'a')
  assert.deepEqual(excluded.hits.map((h) => h.key), ['b'])
})

test('sampling: one frame per two seconds of video, one for an image', () => {
  assert.equal(expectedSamples(0), 1)
  assert.equal(expectedSamples(Number.NaN), 1)
  assert.equal(expectedSamples(1_000_000), 1)
  assert.equal(expectedSamples(2_000_000), 1)
  assert.equal(expectedSamples(2_000_001), 2)
  assert.equal(expectedSamples(300_000_000), 150)
})

test('keyframes are enough when they leave no hole wider than two intervals', () => {
  const every = (step: number, until: number): number[] => Array.from({ length: Math.floor(until / step) + 1 }, (_, i) => i * step)
  // A 2 s GOP over a minute: keyframes at every sample time.
  assert.equal(needsFullDecode(every(2_000_000, 58_000_000), 60_000_000), false)
  // A 10 s GOP (a screen recording): holes of 10 s, so every frame is decoded.
  assert.equal(needsFullDecode(every(10_000_000, 50_000_000), 60_000_000), true)
  // Dense keyframes that stop early leave the tail unsampled.
  assert.equal(needsFullDecode(every(2_000_000, 20_000_000), 60_000_000), true)
  // No keyframes found (ffprobe failed): decode.
  assert.equal(needsFullDecode([], 60_000_000), true)
  // A clip shorter than an interval needs only its first frame.
  assert.equal(needsFullDecode([0], 1_500_000), false)
})

test('the sample filter keeps a frame per interval, reports its time, and squashes to the model size', () => {
  const filter = sampleFilter(3_000_000)
  assert.match(filter, /prev_selected_t\\,3\)/)
  assert.match(filter, /showinfo.*scale=224:224:flags=bicubic/)
  assert.match(filter, /format=rgb24$/)
})

test('the model is pinned to a commit and its files, and a missing model says where to get it', () => {
  assert.match(VISION_MODEL.revision, /^[0-9a-f]{40}$/)
  for (const file of VISION_MODEL.files) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/)
    assert.equal(visionFileUrl(file), `https://huggingface.co/Xenova/siglip-base-patch16-224/resolve/${VISION_MODEL.revision}/${file.repoPath}`)
  }
  assert.equal(VISION_MODEL_BYTES, 409_409_211)
  // The refusal is a recovery instruction: where, what to press, the alternative, and the size.
  assert.match(VISION_NOT_INSTALLED, /Settings \(⌘,\) → Visual search/)
  assert.match(VISION_NOT_INSTALLED, /click Download/)
  assert.match(VISION_NOT_INSTALLED, /Download models when needed/)
  assert.match(VISION_NOT_INSTALLED, /409 MB/)
})

test('estimates read as estimates', () => {
  assert.equal(describeDuration(0.2), 'about 1 second')
  assert.equal(describeDuration(40), 'about 40 seconds')
  assert.equal(describeDuration(600), 'about 10 minutes')
  assert.equal(describeDuration(3 * 3600), 'about 3.0 hours')
})
