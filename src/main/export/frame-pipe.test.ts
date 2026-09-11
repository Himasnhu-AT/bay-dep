/**
 * Tests for the export frame pipe.
 *
 * The backpressure case is the reason this file exists. "The renderer awaits each frame and
 * the encoder paces it" is a property that survives being broken: let `writeFrame` resolve
 * early and every frame still arrives, in order, and the file still encodes byte-identically.
 * The only difference is that Node buffers the gap between the renderer and ffmpeg — 8 MB a
 * frame at 4K — and a short test export never grows enough to notice. So the test does the
 * one thing that can tell the two apart: it stalls the pipe and asserts the promise has *not*
 * settled, rather than asserting the bytes arrived.
 *
 * Writing these found a real defect rather than confirming the code: `writeFrame` resolved on
 * `write()` returning true, which beats the error callback, so an EPIPE from an ffmpeg that
 * died on the first frame was reported as every frame written successfully. The completion
 * signal is now the write callback.
 *
 * Proven against four deliberate regressions, all caught: `writeFrame` resolving without
 * waiting, and each of the three frame checks disabled in turn.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/export/frame-pipe.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { frameProblem, writeFrame } from './frame-pipe'

/**
 * A pipe that accepts nothing until told to. `highWaterMark: 1` puts every write of a real
 * frame over the limit immediately, which is the state a slow ffmpeg keeps the pipe in.
 */
class StalledPipe extends Writable {
  #waiting: (() => void)[] = []

  constructor() {
    super({ highWaterMark: 1 })
  }

  override _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.#waiting.push(() => callback())
  }

  /** Lets ffmpeg "read" what is queued, releasing the write callbacks. */
  release(): void {
    const pending = this.#waiting
    this.#waiting = []
    for (const done of pending) done()
  }
}

/**
 * True if the promise is still unsettled after the microtask queue and several macrotask
 * turns have run. A bare `Promise.race` against `setImmediate` would be decided by ordering
 * luck; letting the loop turn a few times means a promise that was going to resolve has had
 * every chance to.
 */
async function stillPending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )
  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  return !settled
}

const FRAME = Buffer.alloc(64 * 1024, 7)

test('a write to a stalled pipe does not resolve until the pipe takes it', async () => {
  const pipe = new StalledPipe()
  const promise = writeFrame(pipe, FRAME)

  assert.equal(
    await stillPending(promise),
    true,
    'writeFrame resolved while the pipe was still full — the renderer is no longer paced by ' +
      'the encoder, and a long export will buffer frames until it runs out of memory'
  )

  pipe.release()
  await promise
})

test('the second frame also waits, so a fast producer cannot run ahead', async () => {
  const pipe = new StalledPipe()
  await (async (): Promise<void> => {
    const first = writeFrame(pipe, FRAME)
    pipe.release()
    await first
  })()

  const second = writeFrame(pipe, FRAME)
  assert.equal(await stillPending(second), true)
  pipe.release()
  await second
})

test('a write the pipe accepts outright resolves promptly', async () => {
  // A pipe with room takes the frame immediately; nothing should hang waiting for a signal
  // that will never come, or the first frame of every export would stall forever.
  const taken: Buffer[] = []
  const roomy = new Writable({
    highWaterMark: 1024 * 1024,
    write(chunk: Buffer, _encoding, callback): void {
      taken.push(chunk)
      callback()
    }
  })

  await writeFrame(roomy, FRAME)
  assert.equal(taken.length, 1)
  assert.equal(taken[0]?.byteLength, FRAME.byteLength)
})

test('writing to a destroyed pipe rejects rather than hanging', async () => {
  const pipe = new StalledPipe()
  pipe.destroy()
  await assert.rejects(() => writeFrame(pipe, FRAME), /no longer running/)
})

test('a write error surfaces as a rejection rather than a silent success', async () => {
  // This is the EPIPE case: ffmpeg has died and the frame goes nowhere. It must not look
  // like a successful write, or the export reports every frame done and produces no file.
  //
  // The callback fires on a later tick and the stream carries an `error` listener, because
  // both are true of a real `child.stdin` — Node requires `_write` callbacks to be
  // asynchronous, and `encode.ts` attaches the listener so a dead encoder cannot take the
  // main process down with an unhandled event.
  const broken = new Writable({
    highWaterMark: 1024 * 1024,
    write(_chunk, _encoding, callback): void {
      process.nextTick(() => callback(new Error('EPIPE')))
    }
  })
  broken.on('error', () => undefined)

  await assert.rejects(() => writeFrame(broken, FRAME), /EPIPE/)
})

// ---------------------------------------------------------------------------
// Frame validation — a rawvideo pipe cannot report any of these itself
// ---------------------------------------------------------------------------

const EXPECTED = { nextFrame: 12, width: 64, height: 32 }
const CORRECT_BYTES = 64 * 32 * 4

function shape(overrides: Partial<Parameters<typeof frameProblem>[0]> = {}): Parameters<
  typeof frameProblem
>[0] {
  return { frame: 12, width: 64, height: 32, byteLength: CORRECT_BYTES, ...overrides }
}

test('a correct frame has no problem', () => {
  assert.equal(frameProblem(shape(), EXPECTED), null)
})

test('a frame of the wrong size is refused, naming both sizes', () => {
  const problem = frameProblem(shape({ width: 32, byteLength: 32 * 32 * 4 }), EXPECTED)
  assert.match(problem ?? '', /32×32/)
  assert.match(problem ?? '', /64×32/)
})

test('an out-of-order frame is refused, naming the one expected', () => {
  // This is the check that matters most: ffmpeg would accept frame 14 in slot 12 without
  // complaint and shear the rest of the video.
  const problem = frameProblem(shape({ frame: 14 }), EXPECTED)
  assert.match(problem ?? '', /Expected frame 12 but got 14/)
})

test('a frame that repeats the previous index is refused', () => {
  assert.notEqual(frameProblem(shape({ frame: 11 }), EXPECTED), null)
})

test('a short buffer is refused, naming both byte counts', () => {
  // The subarray trap: handing over `.buffer` of a view into a larger allocation gives too
  // many bytes, and a truncated readback gives too few. Both shear the picture.
  const short = frameProblem(shape({ byteLength: CORRECT_BYTES - 4 }), EXPECTED)
  assert.match(short ?? '', new RegExp(String(CORRECT_BYTES - 4)))
  assert.match(short ?? '', new RegExp(String(CORRECT_BYTES)))

  const long = frameProblem(shape({ byteLength: CORRECT_BYTES * 2 }), EXPECTED)
  assert.notEqual(long, null)
})
