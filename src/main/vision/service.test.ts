/**
 * `VisionService`'s decisions against real files, a stand-in model and a stand-in worker: what
 * counts as installed, what a dry run reports, what is refused and how, what a search answers.
 * The real model and the real worker are `model.test.ts`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { VISION_NOT_INSTALLED, type VisionAssetRef, type VisionModelSpec } from '@shared/visual-search'
import { contentKey, indexFileName, writeFrameIndex } from './cache'
import type { VisionWorker } from './local-worker'
import { VisionService } from './service'

const MODEL: VisionModelSpec = {
  id: 'test-model',
  label: 'Test model',
  repo: 'x/y',
  revision: '0'.repeat(40),
  files: [
    { name: 'vision_model.onnx', repoPath: 'v', bytes: 5, sha256: 'a'.repeat(64) },
    { name: 'text_model.onnx', repoPath: 't', bytes: 3, sha256: 'b'.repeat(64) }
  ]
}

interface Fixture {
  service: VisionService
  root: string
  cacheDir: string
  indexed: string[]
  downloads: string[]
  asset(name: string, bytes: string, durationUs?: number): VisionAssetRef
  install(): void
}

/** Text embeds to [1,0,0] for "red", [0,1,0] for anything else; indexing writes each file's frames from `frames`, by file name. */
function fixture(frames: Record<string, [number, number[]][]> = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'bay-vision-service-'))
  const modelsDir = join(root, 'models')
  const cacheDir = join(root, 'cache')
  const indexed: string[] = []
  const downloads: string[] = []
  const worker: VisionWorker = {
    async embedText(texts) {
      return texts.map((t) => Float32Array.from(t.includes('red') ? [1, 0, 0] : [0, 1, 0]))
    },
    async indexFile(request, onFrames) {
      indexed.push(request.path)
      const rows = frames[basename(request.path)] ?? [[0, [0, 0, 1]]]
      await writeFrameIndex(request.cacheDir, request.cacheName, {
        modelId: MODEL.id,
        intervalUs: 2_000_000,
        dims: 3,
        timesUs: rows.map(([t]) => t),
        vectors: Float32Array.from(rows.flatMap(([, v]) => v))
      })
      onFrames(rows.length)
      return rows.length
    },
    stop() {}
  }
  const service = new VisionService({
    modelsDir,
    cacheDir,
    model: MODEL,
    worker: () => worker,
    download: async (url, dest) => {
      downloads.push(url)
      const file = MODEL.files.find((f) => dest.endsWith(f.name))!
      await writeFile(dest, 'x'.repeat(file.bytes))
    }
  })
  return {
    service,
    root,
    cacheDir,
    indexed,
    downloads,
    asset(name, bytes, durationUs = 10_000_000) {
      const path = join(root, name)
      writeFileSync(path, bytes)
      return { assetId: `id-${name}`, name, path, kind: name.endsWith('.png') ? 'image' : 'video', durationUs }
    },
    install() {
      mkdirSync(service.modelDir, { recursive: true })
      for (const file of MODEL.files) writeFileSync(join(service.modelDir, file.name), 'x'.repeat(file.bytes))
    }
  }
}

test('installed means every file at its pinned size; a partial or wrong-sized file is not installed', async () => {
  const f = fixture()
  assert.equal(await f.service.installed(), false)
  mkdirSync(f.service.modelDir, { recursive: true })
  writeFileSync(join(f.service.modelDir, 'vision_model.onnx'), 'x'.repeat(5))
  assert.equal(await f.service.installed(), false, 'one file of two')
  writeFileSync(join(f.service.modelDir, 'text_model.onnx'), 'x'.repeat(4))
  assert.equal(await f.service.installed(), false, 'a size that does not match its pin')
  writeFileSync(join(f.service.modelDir, 'text_model.onnx'), 'x'.repeat(3))
  assert.equal(await f.service.installed(), true)
})

test('without the model, indexing and searching refuse with where to get it; a dry run still plans', async () => {
  const f = fixture()
  const clip = f.asset('beach.mov', 'beach bytes', 30_000_000)
  const index = await f.service.index([clip])
  assert.deepEqual(index, { ok: false, error: VISION_NOT_INSTALLED })
  const search = await f.service.search({ assets: [clip], query: 'a dog', limit: 5 })
  assert.deepEqual(search, { ok: false, error: VISION_NOT_INSTALLED })
  assert.equal(f.downloads.length, 0, 'nothing reached the network')
  const dry = await f.service.index([clip], { dryRun: true })
  assert.ok(dry.ok)
  assert.equal(dry.plan.toIndex, 1)
  assert.equal(dry.plan.frames, 15)
  // Positive control: the same calls with the model in place succeed.
  f.install()
  const after = await f.service.index([clip])
  assert.ok(after.ok && after.started)
  await f.service.settled()
  assert.ok((await f.service.search({ assets: [clip], query: 'a dog', limit: 5 })).ok)
})

test('"download when needed" fetches every pinned file before indexing, and only then', async () => {
  const f = fixture()
  const clip = f.asset('a.mov', 'aaa')
  const answer = await f.service.index([clip], { download: true })
  assert.ok(answer.ok && answer.started, JSON.stringify(answer))
  assert.deepEqual(f.downloads, ['https://huggingface.co/x/y/resolve/0000000000000000000000000000000000000000/v', 'https://huggingface.co/x/y/resolve/0000000000000000000000000000000000000000/t'])
  assert.equal(await f.service.installed(), true)
  await f.service.settled()
  // Already installed: a second request downloads nothing.
  await f.service.index([f.asset('b.mov', 'bbb')], { download: true })
  assert.equal(f.downloads.length, 2)
})

test('a dry run counts what is left to index and estimates it; indexing it leaves nothing', async () => {
  const f = fixture()
  f.install()
  const clip = f.asset('long.mov', 'long', 300_000_000)
  const still = f.asset('still.png', 'png', 0)
  const gone: VisionAssetRef = { assetId: 'gone', name: 'gone.mov', path: join(f.root, 'nope.mov'), kind: 'video', durationUs: 4_000_000 }
  const dry = await f.service.index([clip, still, gone], { dryRun: true })
  assert.ok(dry.ok)
  assert.equal(dry.started, false)
  assert.deepEqual({ files: dry.plan.files, indexed: dry.plan.indexed, toIndex: dry.plan.toIndex, frames: dry.plan.frames }, { files: 3, indexed: 0, toIndex: 2, frames: 151 })
  assert.equal(dry.plan.estimatedSeconds, 9)
  assert.equal(dry.plan.unavailable.length, 1)
  assert.match(dry.plan.unavailable[0]!.error, /nope\.mov/)
  assert.equal(f.indexed.length, 0, 'a dry run starts nothing')

  const real = await f.service.index([clip, still, gone])
  assert.ok(real.ok && real.started)
  await f.service.settled()
  const status = await f.service.status()
  assert.equal(status.index?.state, 'done')
  assert.equal(status.index?.filesDone, 2)
  const again = await f.service.index([clip, still], { dryRun: true })
  assert.ok(again.ok)
  assert.deepEqual({ indexed: again.plan.indexed, toIndex: again.plan.toIndex, frames: again.plan.frames }, { indexed: 2, toIndex: 0, frames: 0 })
})

test('the same footage at another path is not indexed twice', async () => {
  const f = fixture()
  f.install()
  const a = f.asset('a.mov', 'same footage')
  const copy = f.asset('copy.mov', 'same footage')
  await f.service.index([a])
  await f.service.settled()
  const dry = await f.service.index([copy], { dryRun: true })
  assert.ok(dry.ok)
  assert.equal(dry.plan.indexed, 1)
})

test('search ranks indexed frames across files, names the unindexed ones, and maps hits to assets', async () => {
  const g = fixture({
    'red.mov': [[0, [0.2, 0.98, 0]], [6_000_000, [1, 0, 0]]],
    'blue.mov': [[2_000_000, [0.6, 0.8, 0]]]
  })
  g.install()
  const r = g.asset('red.mov', 'red')
  const b = g.asset('blue.mov', 'blue')
  const l = g.asset('later.mov', 'not yet')
  await g.service.index([r, b])
  await g.service.settled()
  const answer = await g.service.search({ assets: [r, b, l], query: 'something red', limit: 2 })
  assert.ok(answer.ok, JSON.stringify(answer))
  assert.deepEqual(answer.hits.map((h) => [h.assetId, h.us]), [[r.assetId, 6_000_000], [b.assetId, 2_000_000]])
  assert.deepEqual(answer.unindexed, [l.assetId])
  assert.equal(answer.framesSearched, 3)

  // similarTo: the frame nearest the time asked is the reference, and it is not its own answer.
  const like = await g.service.search({ assets: [r, b], similarTo: { assetId: r.assetId, us: 5_000_000 }, limit: 5 })
  assert.ok(like.ok, JSON.stringify(like))
  assert.deepEqual(like.reference, { assetId: r.assetId, us: 6_000_000 })
  assert.ok(!like.hits.some((h) => h.assetId === r.assetId && h.us === 6_000_000))
  assert.equal(like.hits[0]?.assetId, b.assetId)
  // …and comparing with a file that is not indexed says what to do.
  const unindexed = await g.service.search({ assets: [r, l], similarTo: { assetId: l.assetId, us: 0 }, limit: 5 })
  assert.equal(unindexed.ok, false)
  assert.match(!unindexed.ok ? unindexed.error : '', /index_footage/)
  // Asking for nothing is refused, naming both ways to ask.
  const empty = await g.service.search({ assets: [r], query: '  ', limit: 5 })
  assert.match(!empty.ok ? empty.error : '', /query.*similarTo/)
})

test('an index written for another model is not searched as this one', async () => {
  const f = fixture()
  f.install()
  const clip = f.asset('c.mov', 'c')
  await writeFrameIndex(f.cacheDir, indexFileName(await contentKey(clip.path), 'other-model', 2_000_000), {
    modelId: 'other-model', intervalUs: 2_000_000, dims: 3, timesUs: [0], vectors: Float32Array.from([1, 0, 0])
  })
  const answer = await f.service.search({ assets: [clip], query: 'red', limit: 3 })
  assert.ok(answer.ok)
  assert.deepEqual(answer.unindexed, [clip.assetId])
})

test('a file that fails to index is named with its error; the rest of the job goes on', async () => {
  const f = fixture()
  f.install()
  const good = f.asset('good.mov', 'good')
  const bad = f.asset('bad.mov', 'bad')
  const failing = new VisionService({
    modelsDir: join(f.root, 'models'),
    cacheDir: f.cacheDir,
    model: MODEL,
    worker: () => ({
      embedText: async () => [],
      indexFile: async (request) => {
        if (request.path === bad.path) throw new Error('ffmpeg could not read bad.mov: moov atom not found')
        await writeFrameIndex(request.cacheDir, request.cacheName, { modelId: MODEL.id, intervalUs: 2_000_000, dims: 1, timesUs: [0], vectors: Float32Array.from([1]) })
        return 1
      },
      stop() {}
    })
  })
  await failing.index([bad, good])
  await failing.settled()
  const job = (await failing.status()).index!
  assert.equal(job.state, 'done')
  assert.equal(job.filesDone, 2)
  assert.deepEqual(job.failed, [{ assetId: bad.assetId, name: 'bad.mov', error: 'ffmpeg could not read bad.mov: moov atom not found' }])
})

test('cancelling stops the job between files and says it was cancelled', async () => {
  const f = fixture()
  f.install()
  const files = [f.asset('1.mov', '1'), f.asset('2.mov', '2'), f.asset('3.mov', '3')]
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const slow = new VisionService({
    modelsDir: join(f.root, 'models'),
    cacheDir: f.cacheDir,
    model: MODEL,
    worker: () => ({
      embedText: async () => [],
      indexFile: async (_request, _onFrames, signal) => {
        await gate
        return signal.aborted ? null : 1
      },
      stop() {}
    })
  })
  await slow.index(files)
  // While the job holds the model, deleting it is refused in words (the positive control is below).
  assert.deepEqual(await slow.deleteModel(), { ok: false, error: 'Footage is being indexed with the model; stop indexing first.' })
  slow.cancelIndex()
  release()
  await slow.settled()
  const job = (await slow.status()).index!
  assert.equal(job.state, 'cancelled')
  assert.equal(job.filesDone, 0)
})

test('deleting the model is refused while it is in use, and removes it otherwise', async () => {
  const f = fixture()
  f.install()
  assert.deepEqual(await f.service.deleteModel(), { ok: true })
  assert.equal(await f.service.installed(), false)
})
