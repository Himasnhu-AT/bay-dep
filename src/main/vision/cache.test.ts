import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CACHE_SCHEME, sweepStaleCaches } from '../media/cache-key'
import { contentKey, hasFrameIndex, indexFileName, readFrameIndex, VISION_CACHE_FAMILY, visionCacheDir, writeFrameIndex, type FrameIndex } from './cache'

const dir = (): string => mkdtempSync(join(tmpdir(), 'bay-vision-cache-'))

test('the content key follows the bytes, not the path', async () => {
  const root = dir()
  const bytes = Buffer.alloc(5 * 1024 * 1024, 7)
  writeFileSync(join(root, 'a.mov'), bytes)
  writeFileSync(join(root, 'moved-copy.mov'), bytes)
  const changed = Buffer.from(bytes)
  changed[changed.length - 10] = 8 // inside the last window
  writeFileSync(join(root, 'reexport.mov'), changed)
  const middle = Buffer.from(bytes)
  middle[Math.floor(middle.length / 2)] = 9 // inside the middle window
  writeFileSync(join(root, 'middle.mov'), middle)

  const a = await contentKey(join(root, 'a.mov'))
  assert.equal(await contentKey(join(root, 'moved-copy.mov')), a, 'the same footage at another path is the same index')
  assert.notEqual(await contentKey(join(root, 'reexport.mov')), a, 'a re-export over the same name is a new index')
  assert.notEqual(await contentKey(join(root, 'middle.mov')), a)
  // A small file is hashed whole.
  writeFileSync(join(root, 's1.png'), 'one')
  writeFileSync(join(root, 's2.png'), 'two')
  assert.notEqual(await contentKey(join(root, 's1.png')), await contentKey(join(root, 's2.png')))
})

test('the index name changes with the content, the model and the interval', () => {
  const base = indexFileName('c1', 'model-a', 2_000_000)
  assert.match(base, /^[0-9a-f]{32}\.json$/)
  assert.equal(indexFileName('c1', 'model-a', 2_000_000), base)
  assert.notEqual(indexFileName('c2', 'model-a', 2_000_000), base)
  assert.notEqual(indexFileName('c1', 'model-b', 2_000_000), base, 'a new model is a new index')
  assert.notEqual(indexFileName('c1', 'model-a', 1_000_000), base)
})

const sample = (): FrameIndex => ({ modelId: 'm', intervalUs: 2_000_000, dims: 3, timesUs: [0, 2_000_000], vectors: Float32Array.from([1, 0, 0, 0, 0.6, 0.8]) })

test('an index written is read back exactly; another model or a short file reads as absent', async () => {
  const root = dir()
  assert.equal(await hasFrameIndex(root, 'x.json'), false)
  await writeFrameIndex(root, 'x.json', sample())
  assert.equal(await hasFrameIndex(root, 'x.json'), true)
  assert.deepEqual(readdirSync(root), ['x.json'], 'no .part left behind')
  const back = await readFrameIndex(root, 'x.json', 'm')
  assert.ok(back)
  assert.deepEqual(back.timesUs, [0, 2_000_000])
  assert.deepEqual(Array.from(back.vectors), Array.from(sample().vectors))
  assert.equal(await readFrameIndex(root, 'x.json', 'other-model'), null)
  // Vectors that do not fill times × dims (a truncated write from an old build, a hand edit).
  writeFileSync(join(root, 'bad.json'), JSON.stringify({ modelId: 'm', intervalUs: 1, dims: 3, timesUs: [0, 1], vectors: Buffer.from(new Float32Array(3).buffer).toString('base64') }))
  assert.equal(await readFrameIndex(root, 'bad.json', 'm'), null)
  assert.equal(await readFrameIndex(root, 'missing.json', 'm'), null)
})

test('the index lives in a versioned directory, and an older scheme is swept at startup', async () => {
  const root = dir()
  assert.equal(visionCacheDir(root), join(root, `vision-${CACHE_SCHEME}`))
  mkdirSync(visionCacheDir(root))
  mkdirSync(join(root, 'vision-v0'))
  mkdirSync(join(root, 'vision'))
  mkdirSync(join(root, 'not-ours'))
  const removed = await sweepStaleCaches(root, ['thumbs', 'peaks', VISION_CACHE_FAMILY])
  assert.deepEqual(removed.sort(), ['vision', 'vision-v0'])
  assert.deepEqual(readdirSync(root).sort(), ['not-ours', `vision-${CACHE_SCHEME}`].sort())
})
