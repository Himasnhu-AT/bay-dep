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
 *
 * Mutation-tested: seven deliberate regressions — a fire-and-forget `pushFrame`, no cancel
 * on a rejected frame, frames pushed in reverse, the export range ignored, the delivery
 * size dropped so frames composite at timeline size, cancellation ignored mid-walk, and a
 * cancelled export still reporting `finish`. Six fail this suite. The seventh is an
 * equivalent mutant, not a gap: the loop's first cancellation check is a cost guard whose
 * removal is behaviourally invisible because the second check still stops the walk. That
 * is stated at the guard itself rather than papered over with a test that would pass
 * either way.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project } from '@shared/project'
import { brfRuntime, type WorkerLike } from './brfCode'
import { describeIncomplete, FrameExporter, writtenFrameIssues } from './exporter'

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
  getTransform(): { a: number } {
    return { a: this.transform[0] ?? 1 }
  }
  save(): void {}
  restore(): void {}
  clips: number[][] = []
  #path: number[] = []
  beginPath(): void {
    this.#path = []
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.#path = [x, y, w, h]
  }
  clip(): void {
    this.clips.push(this.#path)
  }
  fillRect(): void {
    this.fills += 1
  }
  /** The placeholder card's edge and label (16×8 is too small for the label, so only the edge). */
  strokeRect(): void {}
  fillText(): void {}
  draws = 0
  drawImage(): void {
    this.draws += 1
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
  /** A 2D context only: no WebGL2 here, as in a renderer whose GPU process has gone. */
  getContext(type = '2d'): StubContext | null {
    if (type !== '2d') return null
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

test('a delivery of another shape is the whole canvas with bars, never stretched', { timeout: 10_000 }, async () => {
  // The 16x8 (2:1) canvas into a 32x64 (1:2) vertical file. A scale per axis — what this did
  // before — is [2, 0, 0, 8, 0, 0]: the picture four times taller than it is wide. One scale,
  // centred, is 2 on both axes with the canvas 16px tall in the middle of the 64 (24 above).
  const encoder = fakeEncoder()
  encoder.install()
  const exporter = new FrameExporter({
    project: project(),
    timelineId: 'tl',
    jobId: 'job-bars',
    fromFrame: 0,
    toFrame: 0,
    width: 32,
    height: 64
  })
  const running = exporter.run()
  await drain()
  encoder.releaseAll()
  await running

  assert.deepEqual(lastContext?.transform, [2, 0, 0, 2, 0, 24])
  // Drawing is clipped to the canvas, so a clip framed past its edge stays out of the bars.
  assert.deepEqual(lastContext?.clips, [[0, 0, 16, 8]])
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

// --- frames written with a graphic still pending ----------------------------
// The requirement: an export must never put the wrong picture in a file silently. A `.brf`
// module whose worker has not answered is drawn as nothing — the background where the graphic
// should be — and that frame goes into the file. The exporter waits a bounded time and then
// writes it anyway, so what it owes the caller is a report naming the frames and the module.
//
// The worker here never answers: every frame the module is on stays pending past the wait
// (seekTimeoutMs is tiny, far below the runtime's own 3s give-up, so the scene is still on its
// way rather than failed). The frames without the module are the control.

// A `.brf` asset gets a pool entry with no element; disposing the pool still asks what kind of
// element each entry holds, so the classes must exist for `instanceof`, and nothing more.
const dom = globalThis as unknown as Record<string, unknown>
for (const name of ['HTMLImageElement', 'HTMLVideoElement', 'HTMLAudioElement']) dom[name] ??= class {}

const SILENT_WORKER =(): WorkerLike => ({ onmessage: null, onerror: null, postMessage() {}, terminate() {} })

function withModule(from: number, durationInFrames: number): Project {
  const p = project()
  const asset: Asset = {
    id: 'ast_card',
    kind: 'brf',
    name: 'Counter card',
    path: null,
    durationUs: 2_000_000,
    width: 16,
    height: 8,
    fps: 30,
    hasAudio: false,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 1,
    brfCode: 'export default () => <scene duration={2}><text x="50%" y="50%">Hi</text></scene>',
    compositionVariables: []
  }
  const item: Item = {
    id: 'itm_card',
    assetId: asset.id,
    trackId: 'v1',
    from,
    durationInFrames,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 16, height: 8, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
  p.assets.push(asset)
  const track = p.timelines[0]?.tracks[0]
  assert.ok(track)
  track.items.push(item)
  return p
}

test('frames written while a .brf scene was still pending are reported, by frame and by name', { timeout: 10_000 }, async () => {
  brfRuntime.useWorkers(SILENT_WORKER)
  try {
    const encoder = fakeEncoder()
    encoder.install()
    encoder.releaseAll()
    // The module covers frames 2..3 of an export of 0..5.
    const exporter = new FrameExporter({ project: withModule(2, 2), timelineId: 'tl', jobId: 'job-p1', fromFrame: 0, toFrame: 5, seekTimeoutMs: 5 })
    const outcome = await exporter.run()

    assert.equal(outcome.framesWritten, 6, 'the export still finishes — the file is kept')
    assert.deepEqual(encoder.finished, ['job-p1'])
    const report = outcome.incomplete
    assert.ok(report, 'an export that wrote frames without their graphic must not come back clean')
    assert.equal(report.frames, 2)
    assert.deepEqual(report.ranges, [[2, 3]])
    assert.deepEqual(report.items, [{ name: 'Counter card', frames: 2, ranges: [[2, 3]] }])
    assert.deepEqual(report.gradeIssues, [])
    // The sentence is what the user and the agent act on: it must carry the frames, the name,
    // and what to do next — not merely exist.
    assert.match(report.message, /2 frames/)
    assert.match(report.message, /frames 2-3/)
    assert.match(report.message, /"Counter card"/)
    assert.match(report.message, /Export again/)
    // Live on the exporter too, which is what track_export reads when main's `done` lands first.
    assert.deepEqual(exporter.incomplete, report)
  } finally {
    brfRuntime.dispose()
  }
})

test('the control: the same module outside the exported range reports a clean export', { timeout: 10_000 }, async () => {
  brfRuntime.useWorkers(SILENT_WORKER)
  try {
    const encoder = fakeEncoder()
    encoder.install()
    encoder.releaseAll()
    // Same project, same silent worker; the range 4..5 does not reach the module at 2..3.
    const exporter = new FrameExporter({ project: withModule(2, 2), timelineId: 'tl', jobId: 'job-p2', fromFrame: 4, toFrame: 5, seekTimeoutMs: 5 })
    const outcome = await exporter.run()
    assert.equal(outcome.framesWritten, 2)
    assert.equal(outcome.incomplete, null)
    assert.equal(exporter.incomplete, null)
  } finally {
    brfRuntime.dispose()
  }
})

test('frames written with a placeholder card are reported — an item that cannot be drawn is not a clean export', { timeout: 10_000 }, async () => {
  // Measured in the app: a `.brf` whose code threw exported as six grey "Box" cards and the
  // dialog said "Done 100%". The same card stands in for missing and unreadable media, so the
  // specimen is the module's asset marked unreadable, and the frames without it are the control.
  brfRuntime.useWorkers(SILENT_WORKER)
  try {
    const encoder = fakeEncoder()
    encoder.install()
    encoder.releaseAll()
    const p = withModule(2, 2)
    const asset = p.assets.find((a) => a.id === 'ast_card')
    assert.ok(asset)
    asset.error = 'the module threw: boom'
    const exporter = new FrameExporter({ project: p, timelineId: 'tl', jobId: 'job-ph', fromFrame: 0, toFrame: 5, seekTimeoutMs: 5 })
    const outcome = await exporter.run()

    assert.equal(outcome.framesWritten, 6, 'the file is still written')
    const report = outcome.incomplete
    assert.ok(report, 'an export that wrote placeholder cards must not come back clean')
    assert.equal(report.frames, 2)
    assert.deepEqual(report.ranges, [[2, 3]])
    assert.deepEqual(report.items, [], 'nothing was pending — waiting would not have helped')
    assert.deepEqual(report.placeholders, [{ name: 'Counter card (the module threw: boom)', frames: 2, ranges: [[2, 3]] }])
    // What the reader needs to act: the item, why, where, and that re-exporting will not help.
    assert.match(report.message, /Counter card \(the module threw: boom\) \(frames 2-3\)/)
    assert.match(report.message, /placeholder/)
    assert.match(report.message, /will not change them/)
    assert.deepEqual(exporter.incomplete, report)
  } finally {
    brfRuntime.dispose()
  }
})

test('writtenFrameIssues: a placeholder alone makes a frame wrong; a clean draw is null', () => {
  const clean = { pending: 0, pendingNames: [], placeholders: 0, placeholderNames: [] }
  assert.equal(writtenFrameIssues(3, clean), null)
  assert.deepEqual(writtenFrameIssues(3, { ...clean, placeholders: 1, placeholderNames: ['a missing asset'] }), {
    frame: 3,
    missing: [],
    gradeIssues: [],
    placeholders: ['a missing asset']
  })
})

test('describeIncomplete: ranges merge, items sort by frames, the sentence caps its list', () => {
  assert.equal(describeIncomplete([]), null)
  const one = describeIncomplete([{ frame: 7, missing: ['Title'], gradeIssues: [] }])
  assert.ok(one)
  assert.match(one.message, /^1 frame of this export is not the picture/)
  assert.match(one.message, /One frame was written before everything on it had rendered/)
  assert.match(one.message, /"Title" \(frame 7\)/)

  const many = describeIncomplete([
    ...[0, 1, 2, 5, 9, 11, 13, 15, 17].map((frame) => ({ frame, missing: ['Lower third'], gradeIssues: [] })),
    { frame: 1, missing: ['Title', 'Title'], gradeIssues: [] }
  ])
  assert.ok(many)
  assert.equal(many.frames, 9, 'a frame is counted once, however many entries name it')
  assert.deepEqual(many.ranges, [[0, 2], [5, 5], [9, 9], [11, 11], [13, 13], [15, 15], [17, 17]])
  assert.deepEqual(many.items, [
    { name: 'Lower third', frames: 9, ranges: [[0, 2], [5, 5], [9, 9], [11, 11], [13, 13], [15, 15], [17, 17]] },
    { name: 'Title', frames: 1, ranges: [[1, 1]] }
  ])
  assert.match(many.message, /frames 0-2, 5, 9, 11, 13, 15 and 1 more range/)
})

test('describeIncomplete: grade issues are deduplicated with their own ranges, and named first', () => {
  const issue = 'clip itm_a was drawn ungraded: this renderer has no WebGL2'
  const report = describeIncomplete([
    { frame: 10, missing: [], gradeIssues: [issue] },
    { frame: 11, missing: [], gradeIssues: [issue, issue] },
    { frame: 12, missing: ['Title'], gradeIssues: [issue] },
    { frame: 30, missing: ['Title'], gradeIssues: [] }
  ])
  assert.ok(report)
  assert.equal(report.frames, 4, 'a frame wrong in both ways counts once')
  assert.deepEqual(report.ranges, [[10, 12], [30, 30]])
  assert.deepEqual(report.gradeIssues, [{ issue, frames: 3, ranges: [[10, 12]] }])
  assert.deepEqual(report.items, [{ name: 'Title', frames: 2, ranges: [[12, 12], [30, 30]] }])
  // The ungraded clip hides better than a missing title, so it is named first.
  const gradeAt = report.message.indexOf('itm_a')
  const titleAt = report.message.indexOf('"Title"')
  assert.ok(gradeAt > 0 && titleAt > gradeAt, report.message)
  assert.match(report.message, /no WebGL2 \(frames 10-12\)/)
  assert.match(report.message, /fix the grade or effect it names, then export again/)
  assert.match(report.message, /2 frames were written before everything on them had rendered/)
})

// A graded still with no WebGL2 to grade it: the compositor draws it ungraded and says so in
// `gradeIssues` — which export never read, so the file held an ungraded clip under a clean "done".
test('frames written with a grade that could not run are reported, naming the clip', { timeout: 10_000 }, async () => {
  class FakeImage extends (globalThis as unknown as { HTMLImageElement: new () => object }).HTMLImageElement {
    complete = true
    naturalWidth = 16
    naturalHeight = 8
    width = 16
    height = 8
    crossOrigin: string | null = null
    decoding = 'auto'
    src = ''
    addEventListener(): void {}
    removeEventListener(): void {}
    removeAttribute(): void {}
  }
  const hadDocument = 'document' in globalThis
  Object.defineProperty(globalThis, 'document', {
    value: { createElement: () => new FakeImage() },
    configurable: true,
    writable: true
  })
  try {
    const p = project()
    p.assets.push({
      id: 'ast_still',
      kind: 'image',
      name: 'still.png',
      path: '/stills/still.png',
      durationUs: 0,
      width: 16,
      height: 8,
      fps: 0,
      hasAudio: false,
      hasVideo: true,
      posterPath: null,
      waveformPath: null,
      createdAt: 1
    })
    const graded = (id: string, from: number, grade: Item['grade']): Item => ({
      id,
      assetId: 'ast_still',
      trackId: 'v1',
      from,
      durationInFrames: 2,
      sourceStartUs: 0,
      layout: { left: 0, top: 0, width: 16, height: 8, opacity: 1, rotation: 0 },
      volume: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      speed: 1,
      ...(grade ? { grade } : {})
    })
    // Graded at 0..1; the same still ungraded at 2..3 is the control inside the same export.
    p.timelines[0]?.tracks[0]?.items.push(graded('itm_graded', 0, { saturation: 0.5 }), graded('itm_plain', 2, undefined))

    const encoder = fakeEncoder()
    encoder.install()
    encoder.releaseAll()
    const exporter = new FrameExporter({ project: p, timelineId: 'tl', jobId: 'job-g1', fromFrame: 0, toFrame: 3, seekTimeoutMs: 5 })
    const outcome = await exporter.run()
    assert.equal(outcome.framesWritten, 4)
    assert.ok(lastContext && lastContext.draws >= 4, 'the still was drawn on every frame — ungraded, not missing')
    const report = outcome.incomplete
    assert.ok(report, 'an export that wrote a clip without its grade must not come back clean')
    assert.deepEqual(report.ranges, [[0, 1]], 'only the graded clip\'s frames; the ungraded control is right as drawn')
    assert.equal(report.gradeIssues.length, 1)
    assert.equal(report.gradeIssues[0]?.frames, 2)
    assert.match(report.gradeIssues[0]?.issue ?? '', /itm_graded/)
    assert.deepEqual(report.items, [])
    assert.match(report.message, /itm_graded/)
  } finally {
    if (!hadDocument) delete (globalThis as { document?: unknown }).document
  }
})

// The same promise for the effect stack, which draws in the grade's slot and reports through its
// channel: with no WebGL2 to run a pass, a clip with a live effect is drawn without it and the
// export says so — while a stack that resolves to nothing never attempts a pass, so it has
// nothing to fail at. That second half is the `'none'` rule seen from the outside: were an idle
// stack to reach the pass, this export would report it too.
test('frames written with an effect that could not run are reported, and an idle stack is not', { timeout: 10_000 }, async () => {
  class FakeImage extends (globalThis as unknown as { HTMLImageElement: new () => object }).HTMLImageElement {
    complete = true
    naturalWidth = 16
    naturalHeight = 8
    width = 16
    height = 8
    crossOrigin: string | null = null
    decoding = 'auto'
    src = ''
    addEventListener(): void {}
    removeEventListener(): void {}
    removeAttribute(): void {}
  }
  const hadDocument = 'document' in globalThis
  Object.defineProperty(globalThis, 'document', {
    value: { createElement: () => new FakeImage() },
    configurable: true,
    writable: true
  })
  try {
    const p = project()
    p.assets.push({
      id: 'ast_still',
      kind: 'image',
      name: 'still.png',
      path: '/stills/still.png',
      durationUs: 0,
      width: 16,
      height: 8,
      fps: 0,
      hasAudio: false,
      hasVideo: true,
      posterPath: null,
      waveformPath: null,
      createdAt: 1
    })
    const clip = (id: string, from: number, effects: Item['effects']): Item => ({
      id,
      assetId: 'ast_still',
      trackId: 'v1',
      from,
      durationInFrames: 2,
      sourceStartUs: 0,
      layout: { left: 0, top: 0, width: 16, height: 8, opacity: 1, rotation: 0 },
      volume: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      speed: 1,
      ...(effects ? { effects } : {})
    })
    const glow = { amount: 0.6, radius: 16, threshold: 0.6, color: '#FFFFFF' }
    p.timelines[0]?.tracks[0]?.items.push(
      // 0..1: a glow that draws.
      clip('itm_glow', 0, [{ id: 'fx_on', kind: 'glow', params: glow }]),
      // 2..3: the same glow at amount 0, and one switched off — nothing to draw.
      clip('itm_idle', 2, [
        { id: 'fx_zero', kind: 'glow', params: { ...glow, amount: 0 } },
        { id: 'fx_off', kind: 'glow', enabled: false, params: glow }
      ]),
      // 4..5: an effect from a build this one is not.
      clip('itm_newer', 4, [{ id: 'fx_new', kind: 'lens-flare', params: {} }]),
      // 6..7: the plain control.
      clip('itm_plain', 6, undefined)
    )

    const encoder = fakeEncoder()
    encoder.install()
    encoder.releaseAll()
    const exporter = new FrameExporter({ project: p, timelineId: 'tl', jobId: 'job-fx1', fromFrame: 0, toFrame: 7, seekTimeoutMs: 5 })
    const outcome = await exporter.run()
    assert.equal(outcome.framesWritten, 8)
    assert.ok(lastContext && lastContext.draws >= 8, 'every clip was drawn on every frame — without its effect, not missing')
    const report = outcome.incomplete
    assert.ok(report, 'an export that wrote a clip without its effects must not come back clean')
    assert.deepEqual(report.ranges, [[0, 1], [4, 5]], 'the live effect and the unknown one; the idle stack and the plain clip are right as drawn')
    const issues = report.gradeIssues.map((g) => g.issue)
    assert.equal(issues.length, 2)
    assert.ok(issues.some((issue) => /itm_glow was drawn without its effects/.test(issue)), issues.join(' | '))
    assert.ok(issues.some((issue) => /itm_newer/.test(issue) && /lens-flare/.test(issue)), issues.join(' | '))
    assert.ok(!issues.some((issue) => /itm_idle|itm_plain/.test(issue)), issues.join(' | '))
    assert.match(report.message, /A grade or effect was not applied/)
  } finally {
    if (!hadDocument) delete (globalThis as { document?: unknown }).document
  }
})
