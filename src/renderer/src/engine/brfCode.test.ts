/**
 * The code runtime when a worker fails: every caller gets an answer.
 *
 * Found by breaking the packaged app on purpose (test.md §2.9): with the worker file missing from
 * `app.asar`, `write_brf` never replied at all — the page garbage-collected the pending promise.
 * The worker's `onerror` fired, `#fail` cleared the waiters' timers and dropped them without
 * resolving, so nothing could ever settle them, not even the 3s timeout. The same drop stranded a
 * runner's *other* requests when one of them timed out.
 *
 * Each test races the call against a deadline and reports "never answered" as the failure, so a
 * regression is a named red rather than a cancelled test.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BrfCodeRuntime, type BrfWorkerReply, type BrfWorkerRequest, type WorkerLike } from './brfCode'
import { createHandler } from './brfWorkerCore'

const NEVER = Symbol('never answered')
const within = <T>(promise: Promise<T>, ms: number): Promise<T | typeof NEVER> =>
  Promise.race([promise, new Promise<typeof NEVER>((r) => setTimeout(() => r(NEVER), ms))])

const MODULE = `export default ({ t }) => <scene duration={2}><rect w={10} h={10} fill="#fff" /></scene>`

/** A worker whose script cannot be loaded: it errors once, and never answers a message. */
const unloadable = (): WorkerLike => {
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage() {},
    terminate() {}
  }
  setTimeout(() => worker.onerror?.({ message: '' } as ErrorEvent), 5)
  return worker
}

/** An in-process worker through the real handler — the positive control. */
const working = (): WorkerLike => {
  const handle = createHandler()
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      queueMicrotask(() => worker.onmessage?.({ data: handle(message as BrfWorkerRequest) } as MessageEvent<BrfWorkerReply>))
    },
    terminate() {}
  }
  return worker
}

test('the control: a working worker answers meta', { timeout: 5000 }, async () => {
  const runtime = new BrfCodeRuntime()
  runtime.useWorkers(working)
  const result = await within(runtime.meta(MODULE), 1000)
  assert.notEqual(result, NEVER)
  assert.equal(result !== NEVER && result.ok, true)
})

test('a worker that cannot load is reported as crashed, at once, not left hanging', { timeout: 5000 }, async () => {
  const runtime = new BrfCodeRuntime()
  runtime.useWorkers(unloadable)
  // Well under the 3s request timeout: the answer must come from the error, not be rescued by it.
  const result = await within(runtime.meta(MODULE), 1000)
  assert.notEqual(result, NEVER, 'meta() never answered after the worker errored')
  assert.equal(result !== NEVER && !result.ok && result.error, 'crashed: the worker could not start (its script failed to load) or stopped without a message')
})

test('a worker that cannot load leaves nothing in flight, so settle returns at once', { timeout: 5000 }, async () => {
  const runtime = new BrfCodeRuntime()
  runtime.useWorkers(unloadable)
  const first = runtime.scene(MODULE, {}, 0, 30, 640, 360)
  assert.deepEqual(first, { pending: true })
  assert.equal(runtime.stats.inflight, 1, 'the specimen must actually put a chunk in flight')
  const started = Date.now()
  await runtime.settle(2000)
  assert.ok(Date.now() - started < 1000, `settle waited ${Date.now() - started}ms for a chunk that can never arrive`)
  assert.equal(runtime.stats.inflight, 0)
  assert.deepEqual(runtime.scene(MODULE, {}, 0, 30, 640, 360), { error: 'crashed: the worker could not start (its script failed to load) or stopped without a message' })
})

test('when one request times out, the runner’s other requests are answered too', { timeout: 10_000 }, async () => {
  const runtime = new BrfCodeRuntime()
  // Loads, then never answers a render: two chunks (current + read-ahead) wait on one runner.
  runtime.useWorkers((): WorkerLike => {
    const handle = createHandler()
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(message) {
        const request = message as BrfWorkerRequest
        if (request.type === 'render') return
        queueMicrotask(() => worker.onmessage?.({ data: handle(request) } as MessageEvent<BrfWorkerReply>))
      },
      terminate() {}
    }
    return worker
  })
  // Frame 10 is in the second half of the first 15-frame chunk, so the next chunk is asked for too.
  runtime.scene(MODULE, {}, 10, 30, 640, 360)
  assert.equal(runtime.stats.inflight, 2, 'the specimen must have two chunks in flight on one runner')
  await runtime.settle(6000)
  assert.equal(runtime.stats.inflight, 0, 'a chunk was stranded when its sibling timed out')
})

test('nine modules on one frame: the runner evicted to make room is not blamed for its own eviction', { timeout: 15_000 }, async () => {
  // The runtime keeps 8 workers; a 9th module evicts the least recently used. A terminated worker
  // answers nothing, so what the evicted runner was still waiting on ran into the 3s timeout, and
  // the timeout recorded "took longer than 3s … look for a loop that never ends" against a module
  // that had done nothing wrong. Every later frame of it then answered that error.
  const runtime = new BrfCodeRuntime()
  runtime.useWorkers((): WorkerLike => {
    const handle = createHandler()
    let alive = true
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(message) {
        // Answers a little later, like a real worker, and never after it is terminated.
        setTimeout(() => {
          if (alive) worker.onmessage?.({ data: handle(message as BrfWorkerRequest) } as MessageEvent<BrfWorkerReply>)
        }, 20)
      },
      terminate() {
        alive = false
      }
    }
    return worker
  })
  const modules = Array.from({ length: 9 }, (_, i) =>
    `export default ({ t }) => <scene duration={2}><rect w={${10 + i}} h={10} fill="#fff" /></scene>`)
  for (const m of modules) assert.deepEqual(runtime.scene(m, {}, 0, 30, 640, 360), { pending: true })
  assert.equal(runtime.stats.runners, 8, 'the specimen must actually evict: nine modules, eight runners')
  await runtime.settle(5000)
  await new Promise((r) => setTimeout(r, 3300)) // past the timeout a stranded request would hit
  const errors = modules.map((m) => runtime.scene(m, {}, 0, 30, 640, 360)).filter((r) => 'error' in r)
  assert.deepEqual(errors, [], 'an evicted module must be re-run on demand, not marked failed')
  assert.equal(runtime.stats.errors, 0)
  // And it comes back: asked again, every module draws.
  await runtime.settle(5000)
  const drawn = modules.map((m) => runtime.scene(m, {}, 0, 30, 640, 360)).filter((r) => 'doc' in r)
  assert.equal(drawn.length, modules.length, 'every module draws once its chunk is back')
})
