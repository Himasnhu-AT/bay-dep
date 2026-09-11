/**
 * Tests for the export loop.
 *
 * The one that matters is backpressure, and it is worth saying why it needs a test at all.
 * Removing the `await` from `pushFrame` breaks nothing you can see: every frame still
 * arrives, in order, and the file still encodes correctly. The only symptom is the renderer
 * compositing frames faster than ffmpeg can swallow them, which on a long 4K export is
 * 33MB a frame accumulating in an queue nothing is draining — a memory profile, not a
 * failure. No assertion about the output can catch it. What distinguishes the two is
 * *timing*: how many pushes are outstanding at once. So the fake encoder here never
 * resolves on its own, and the test counts what is in flight.
 *
 * Run with `pnpm test` — the shared resolver hook handles the `@shared/*` alias this file
 * and the exporter both need.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Project } from '@shared/project'
import { FrameExporter } from './exporter'

// --- the DOM the exporter needs, and nothing more -------------------------
// A timeline with no items draws only its background, so no media element is ever
// constructed and the pool stays empty. That keeps this a test of the loop rather than of
// a simulated <video>.

interface Recorded {
  jobId: string
  frame: number
  byteLength: number
  width: number
  height: number
}

class StubContext {
  globalAlpha = 1
  globalCompositeOperation = 'source-over'
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  transform: number[] = [1, 0, 0, 1, 0, 0]
  fills = 0
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.transform = [a, b, c, d, e, f]
  }
  save(): void {}
  restore(): void {}
  fillRect(): void {
    this.fills += 1
  }
  getImageData(_x: number, _y: number, width: number, height: number): { data: Uint8ClampedArray } {
    return { data: new Uint8ClampedArray(width * height * 4) }
  }
}

let lastContext: StubContext | null = null

class StubOffscreenCanvas {
  width: number
  height: number
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }
  getContext(): StubContext {
    lastContext = new StubContext()
    return lastContext
  }
}

globalThis.OffscreenCanvas = StubOffscreenCanvas as unknown as typeof OffscreenCanvas

/** A fake encoder that takes frames and never finishes one until told to. */
function fakeEncoder(): {
  pushed: Recorded[]
  finished: string[]
  cancelled: string[]
  releaseOne: () => void
  releaseAll: () => void
  rejectNext: (reason: Error) => void
  install: () => void
} {
  const pushed: Recorded[] = []
  const finished: string[] = []
  const cancelled: string[] = []
  const waiting: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
  let rejection: Error | null = null
  /** Once open, pushes resolve immediately — including frames not composited yet. */
  let open = false

  const api = {
    pushed,
    finished,
    cancelled,
    releaseOne(): void {
      waiting.shift()?.resolve()
    },
    releaseAll(): void {
      // Draining only what is queued right now would stall the run: resolving the pending
      // push lets the loop composite the *next* frame, whose promise nobody is left to
      // resolve. Opening the gate covers the frames that have not been pushed yet.
      open = true
      while (waiting.length > 0) waiting.shift()?.resolve()
    },
    rejectNext(reason: Error): void {
      rejection = reason
    },
    install(): void {
      const bay = {
        export: {
          async pushFrame(frame: {
            jobId: string
            frame: number
            data: ArrayBuffer
            width: number
            height: number
          }): Promise<void> {
            pushed.push({
              jobId: frame.jobId,
              frame: frame.frame,
              byteLength: frame.data.byteLength,
              width: frame.width,
              height: frame.height
            })
            if (rejection) {
              const reason = rejection
              rejection = null
              throw reason
            }
            if (open) return
            return new Promise<void>((resolve, reject) => waiting.push({ resolve, reject }))
          },
          async finish(jobId: string): Promise<void> {
            finished.push(jobId)
          },
          async cancel(jobId: string): Promise<void> {
            cancelled.push(jobId)
          }
        }
      }
      Object.defineProperty(globalThis, 'window', {
        value: { bay },
        configurable: true,
        writable: true
      })
    }
  }
  return api
}

/** Lets every pending microtask settle, so "still only one" means the loop is blocked. */
function drain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function project(): Project {
  return {
    id: 'prj',
    name: 'test',
    version: 1,
    assets: [],
    timelines: [
      {
        id: 'tl',
        name: 'Timeline 1',
        fps: 30,
        width: 16,
        height: 8,
        background: '#000000',
        tracks: [{ id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: [] }]
      }
    ],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0
  }
}

test('only one frame is ever in flight — the encoder sets the pace', { timeout: 10_000 }, async () => {
  const encoder = fakeEncoder()
  encoder.install()
  const exporter = new FrameExporter({
    project: project(),
    timelineId: 'tl',
    jobId: 'job-1',
    fromFrame: 0,
    toFrame: 4
  })

  const running = exporter.run()

  await drain()
  assert.equal(
    encoder.pushed.length,
    1,
    'the loop must block on the first push, not run ahead of the encoder'
  )

  encoder.releaseOne()
  await drain()
  assert.equal(encoder.pushed.length, 2, 'and produce the next one only once that is taken')

  encoder.releaseOne()
  await drain()
  assert.equal(encoder.pushed.length, 3)

  // Nothing further may appear while the encoder is holding on to frame 3.
  await drain()
  await drain()
  assert.equal(encoder.pushed.length, 3, 'a slow encoder cannot be outrun')

  encoder.releaseAll()
  const outcome = await running
  assert.equal(outcome.framesWritten, 5)
  assert.equal(outcome.cancelled, false)
})

test('frames arrive in order, starting at fromFrame', { timeout: 10_000 }, async () => {
  // The encoder has no frame numbers in a rawvideo pipe, so arrival order *is* the edit.
  const encoder = fakeEncoder()
  encoder.install()
  const exporter = new FrameExporter({
    project: project(),
    timelineId: 'tl',
    jobId: 'job-2',
    fromFrame: 7,
    toFrame: 11
  })
  const running = exporter.run()
  for (let i = 0; i < 8; i += 1) {
    await drain()
    encoder.releaseOne()
  }
  await running
  assert.deepEqual(
    encoder.pushed.map((p) => p.frame),
    [7, 8, 9, 10, 11]
  )
})

test('finish is called once, after the last frame', { timeout: 10_000 }, async () => {
  const encoder = fakeEncoder()
  encoder.install()
  const exporter = new FrameExporter({
    project: project(),
    timelineId: 'tl',
    jobId: 'job-3',
    fromFrame: 0,
    toFrame: 2
  })
  const running = exporter.run()
  // fromFrame 0 to toFrame 2 inclusive is three frames, and the loop must run exactly that
  // many times. The assertion is "finish has not arrived yet", which is only true while a
  // frame is still owed — on a fourth pass the exporter has correctly finished and the
  // assertion fails, reporting a bug in the exporter that is really a bug in the count.
  const frames = 3
  for (let i = 0; i < frames; i += 1) {
    await drain()
    assert.deepEqual(encoder.finished, [], 'finish must not arrive before the frames do')
    encoder.releaseOne()
  }
  await running
  assert.deepEqual(encoder.finished, ['job-3'])
  assert.deepEqual(encoder.cancelled, [])
})

test('each frame is exactly width * height * 4 bytes at the delivery size', { timeout: 10_000 }, async () => {
  // The encoder rejects anything else, and it opens ffmpeg with these dimensions. A frame
  // composited at preview size and stretched is the failure this guards.
  const encoder = fakeEncoder()
  encoder.install()
  const exporter = new FrameExporter({
    project: project(),
    timelineId: 'tl',
    jobId: 'job-4',
    fromFrame: 0,
    toFrame: 0,
    width: 64,
    height: 32
  })
  const running = exporter.run()
  await drain()
  encoder.releaseAll()
  await running

  assert.equal(encoder.pushed.length, 1)
  const frame = encoder.pushed[0]
  assert.ok(frame)
  assert.equal(frame.width, 64)
  assert.equal(frame.height, 32)
  assert.equal(frame.byteLength, 64 * 32 * 4)
  // The timeline is 16x8 and the delivery is 64x32, so the context carries the 4x scale —
  // the compositor draws in timeline coordinates and this is where the size enters.
  assert.deepEqual(lastContext?.transform, [4, 0, 0, 4, 0, 0])
})

test('cancelling stops the walk and tears the job down', { timeout: 10_000 }, async () => {
  const encoder = fakeEncoder()
  encoder.install()
  const exporter = new FrameExporter({
    project: project(),
    timelineId: 'tl',
    jobId: 'job-5',
    fromFrame: 0,
    toFrame: 100
  })
  const running = exporter.run()
  await drain()
  assert.equal(encoder.pushed.length, 1)

  exporter.cancel()
  encoder.releaseAll()
  const outcome = await running

  assert.equal(outcome.cancelled, true)
  assert.equal(encoder.pushed.length, 1, 'no frame is composited after the cancel')
  assert.deepEqual(encoder.cancelled, ['job-5'], 'the encoder is told, so ffmpeg is not orphaned')
  assert.deepEqual(encoder.finished, [], 'a cancelled export is not a finished one')
})

test('a rejected frame cancels the job rather than orphaning ffmpeg', { timeout: 10_000 }, async () => {
  const encoder = fakeEncoder()
  encoder.install()
  encoder.rejectNext(new Error('frame 0 is not the next frame in sequence'))
  const exporter = new FrameExporter({
    project: project(),
    timelineId: 'tl',
    jobId: 'job-6',
    fromFrame: 0,
    toFrame: 10
  })

  await assert.rejects(exporter.run(), /not the next frame/)
  assert.deepEqual(encoder.cancelled, ['job-6'])
  assert.deepEqual(encoder.finished, [])
})

test('a missing timeline fails before anything is pushed', { timeout: 10_000 }, async () => {
  const encoder = fakeEncoder()
  encoder.install()
  const exporter = new FrameExporter({
    project: project(),
    timelineId: 'nope',
    jobId: 'job-7'
  })
  await assert.rejects(exporter.run(), /No timeline nope/)
  assert.deepEqual(encoder.pushed, [])
})
