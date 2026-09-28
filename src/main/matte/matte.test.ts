/**
 * Subject mattes in main: the smoothing, the pack, the decode, the service's cache, and the real
 * Apple Vision process (on a Mac; skipped loudly elsewhere).
 *
 * The decode runs bay's own ffmpeg on a generated clip with a fake engine, so frame times and
 * sizes are checked exactly. Vision itself is checked on a test pattern, which has no person —
 * the input `put_behind_subject` refuses — and on a clip with a person when
 * `BAY_MATTE_PERSON_CLIP` names one (skipped loudly otherwise: the repo holds no footage of people).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { MatteSmoother, oneFrameDelay, quantiseMatte, subjectArea } from './smooth'
import { MattePackWriter, PACK_MAGIC, readPackFrame, readPackIndex, sweepMattePartFiles } from './pack'
import { computeSubjectMatte, matteDecodeArgs, MatteStalledError, megabytesPerMinute, showinfoFrame, type MaskFrame, type MatteEngine, type RgbaFrame } from './compute'
import { IdleGate } from './idle'
import { budgetedCacheDirs, enforceCacheBudget, matteCacheDir } from '../media/cache-budget'
import { MatteService } from './service'
import { VisionSegmenter } from './vision-jxa'

const TOOLS = vendoredTools()
const SKIP_FFMPEG = TOOLS ? false : NO_VENDORED_FFMPEG
const SKIP_VISION = process.platform !== 'darwin' ? 'Apple Vision is macOS only (this check did not run)' : SKIP_FFMPEG
const PERSON_CLIP = process.env.BAY_MATTE_PERSON_CLIP
const SKIP_PERSON = SKIP_VISION || (PERSON_CLIP && existsSync(PERSON_CLIP) ? false : 'set BAY_MATTE_PERSON_CLIP to a clip with a person in it (this check did not run)')

const scratch = (): string => mkdtempSync(join(tmpdir(), 'bay-matte-test-'))

// -- smoothing -------------------------------------------------------------------------------------

test('OFD replaces a one-frame flicker with its neighbours\' mean and leaves real change alone', () => {
  const prev = Uint8Array.from([0, 0, 200, 0])
  const cur = Uint8Array.from([255, 10, 0, 128])
  const next = Uint8Array.from([0, 0, 200, 255])
  const out = new Uint8Array(4)
  const changed = oneFrameDelay(prev, cur, next, out)
  // [0] flickers up and back: replaced. [1] moves 10 (under the threshold): kept. [2] flickers
  // down: replaced. [3] rises steadily 0 → 128 → 255, the neighbours disagree: kept.
  assert.deepEqual([...out], [0, 10, 200, 128])
  assert.equal(changed, 2)
})

test('quantising snaps the extremes and steps the soft band by 4', () => {
  const alpha = Uint8Array.from([0, 8, 9, 130, 131, 246, 247, 255])
  quantiseMatte(alpha)
  assert.deepEqual([...alpha], [0, 0, 8, 132, 132, 248, 255, 255])
})

test('the streaming smoother returns every frame once, a frame late, in order', () => {
  const s = new MatteSmoother()
  const frames = [0, 1, 2, 3].map((k) => ({ ptsUs: k * 40_000, alpha: Uint8Array.from([k === 2 ? 255 : 0, 100]) }))
  const out = frames.map((f) => s.push(f)).concat([s.flush()]).filter((f) => f !== null)
  assert.deepEqual(out.map((f) => f!.ptsUs), [0, 40_000, 80_000, 120_000])
  assert.equal(out[2]!.alpha[0], 0, 'the flicker at frame 2 is gone')
  assert.equal(out[2]!.alpha[1], 100)
  assert.ok(Math.abs(subjectArea(Uint8Array.from([255, 255, 0, 0])) - 0.5) < 1e-9)
})

// -- the pack --------------------------------------------------------------------------------------

test('a pack reads back frame by frame; a damaged one is not believed', async () => {
  const dir = scratch()
  const path = join(dir, 'k.bmat')
  const writer = await MattePackWriter.create(path)
  const a = new Uint8Array(12).fill(255)
  const b = Uint8Array.from({ length: 12 }, (_, i) => (i % 2 ? 0 : 128))
  await writer.append(0, 4, 3, a)
  await writer.append(40_000, 4, 3, b)
  await writer.append(40_000, 4, 3, a) // the same time twice: dropped, times stay ascending
  assert.ok(existsSync(`${path}.part`) && !existsSync(path), 'written aside until finished')
  const { bytes } = await writer.finish({ engine: 'e', engineBuild: 'b', fromUs: 0, toUs: 80_000, report: { frames: 2, coverage: 1, meanArea: 1, msPerFrame: 1, visionMsMedian: 1, visionMsP90: 1, engineBuild: 'b', seconds: 1 } })
  assert.ok(existsSync(path) && !existsSync(`${path}.part`))
  const read = await readPackIndex(path)
  assert.ok(read)
  assert.equal(read.bytes, bytes)
  assert.deepEqual(read.index.frames.map((f) => f[0]), [0, 40_000])
  assert.deepEqual([...(await readPackFrame(path, read.index, 0))], [...a])
  assert.deepEqual([...(await readPackFrame(path, read.index, 1))], [...b])

  const whole = readFileSync(path)
  writeFileSync(join(dir, 'truncated.bmat'), whole.subarray(0, whole.length - 3))
  assert.equal(await readPackIndex(join(dir, 'truncated.bmat')), null, 'a truncated pack')
  const wrongMagic = Buffer.from(whole)
  wrongMagic.write('XXXX', wrongMagic.length - PACK_MAGIC.length, 'latin1')
  writeFileSync(join(dir, 'magic.bmat'), wrongMagic)
  assert.equal(await readPackIndex(join(dir, 'magic.bmat')), null, 'a wrong magic')
  assert.equal(await readPackIndex(join(dir, 'absent.bmat')), null)
})

test('an abandoned pack leaves nothing behind', async () => {
  const dir = scratch()
  const writer = await MattePackWriter.create(join(dir, 'k.bmat'))
  await writer.append(0, 2, 2, new Uint8Array(4))
  await writer.abort()
  assert.deepEqual(readdirSync(dir), [])
})

test('MB per minute comes from the frames\' own timing', () => {
  const frames: [number, number, number][] = Array.from({ length: 31 }, (_, i) => [i * 40_000, 0, 1])
  // 25 fps: 1,500 frames a minute; 1 MiB over 31 frames.
  assert.equal(megabytesPerMinute(1024 * 1024, { frames }), Math.round((1500 / 31) * 100) / 100)
})

// -- the decode ------------------------------------------------------------------------------------

test('showinfo frame lines give time and size; other lines nothing', () => {
  const line = '[Parsed_showinfo_2 @ 0x77f03c780] n:   0 pts:     60 pts_time:0.0025  duration:   1001 duration_time:0.0417083 fmt:rgba cl:unspecified sar:1/1 s:960x540 i:P iskey:0'
  assert.deepEqual(showinfoFrame(line), { us: 2500, width: 960, height: 540 })
  assert.equal(showinfoFrame('[Parsed_showinfo_2 @ 0x1] config in time_base: 1/24000, frame_rate: 24000/1001'), null)
  assert.equal(showinfoFrame('Stream #0:0: Video: h264, s:960x540 pts_time:4'), null)
})

test('the path follows -i, so a file named like an option is still a file', () => {
  const args = matteDecodeArgs('-evil.mov', 1_500_000, 3_000_000)
  assert.equal(args[args.indexOf('-i') + 1], '-evil.mov')
  assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2), ['-ss', '1.500000'])
  assert.deepEqual(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2), ['-t', '1.500000'])
})

/** Answers each frame with a mask whose left `share` is the subject, and records what it was sent. */
class FakeEngine implements MatteEngine {
  readonly id = 'fake-engine'
  readonly build = 'fake 1'
  readonly sent: { width: number; height: number }[] = []
  stopped = 0
  delayMs = 0
  share = 0.5
  async start(): Promise<string> { return this.build }
  reset(): void {}
  async segment(frame: RgbaFrame): Promise<MaskFrame> {
    this.sent.push({ width: frame.width, height: frame.height })
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs))
    const w = 8, h = 6
    const alpha = new Uint8Array(w * h)
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) alpha[y * w + x] = x < w * this.share ? 255 : 0
    return { width: w, height: h, alpha, ms: 1 }
  }
  stop(): void { this.stopped += 1 }
}

let clipCache: string | null = null
/** Two seconds of a 25 fps 1280×720 test pattern — no person in it. */
function testClip(): string {
  if (clipCache) return clipCache
  const path = join(scratch(), 'pattern.mov')
  execFileSync(TOOLS!.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=25:d=2', '-c:v', 'mjpeg', '-q:v', '5', '-y', path])
  clipCache = path
  return path
}

test('a range decodes to every source frame at its own time, scaled to 960 on the long edge', { skip: SKIP_FFMPEG, timeout: 60_000 }, async () => {
  const engine = new FakeEngine()
  const dir = scratch()
  const result = await computeSubjectMatte({ ffmpeg: TOOLS!.ffmpeg, path: testClip(), fromUs: 500_000, toUs: 1_500_000, engine, outPath: join(dir, 'k.bmat') })
  const times = result.index.frames.map((f) => f[0])
  // Frames 12..37 of a 25 fps clip start at 0.48 s … the first one at or after 0.5 s is 0.52 s.
  assert.equal(times[0], 520_000, `first frame at ${times[0]}`)
  assert.ok(times.every((t, i) => i === 0 || t - times[i - 1]! === 40_000), `one frame every 40 ms: ${times.slice(0, 5)}`)
  assert.ok(times.length >= 24 && times.length <= 26, `${times.length} frames for one second`)
  assert.deepEqual(engine.sent[0], { width: 960, height: 540 })
  assert.equal(result.report.coverage, 1, 'the fake subject is in every frame')
  assert.equal(result.report.frames, times.length)
  const alpha = await readPackFrame(join(dir, 'k.bmat'), result.index, 3)
  assert.equal(alpha[0], 255)
  assert.equal(alpha[7], 0)
})

test('cancelling a matte stops ffmpeg and the engine and leaves no pack', { skip: SKIP_FFMPEG, timeout: 60_000 }, async () => {
  const engine = new FakeEngine()
  engine.delayMs = 50
  const dir = scratch()
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 200)
  await assert.rejects(
    computeSubjectMatte({ ffmpeg: TOOLS!.ffmpeg, path: testClip(), fromUs: 0, toUs: 2_000_000, engine, outPath: join(dir, 'k.bmat'), signal: controller.signal }),
    /cancelled|stopped/
  )
  assert.ok(engine.stopped >= 1, 'the engine was stopped')
  assert.deepEqual(readdirSync(dir), [], 'neither the pack nor its .part')
})

// -- the service -----------------------------------------------------------------------------------

test('the service computes once, then answers from the cache; a new range is a new key', { skip: SKIP_FFMPEG, timeout: 60_000 }, async () => {
  const engine = new FakeEngine()
  const service = new MatteService({ dir: scratch(), ffmpeg: () => TOOLS!.ffmpeg, engine, isAllowed: () => true })
  const request = { path: testClip(), fromUs: 0, toUs: 400_000 }
  const first = await service.ensure(request)
  assert.ok(first.ok, JSON.stringify(first))
  assert.equal(first.report.cached, false)
  const sent = engine.sent.length
  const second = await service.ensure(request)
  assert.ok(second.ok)
  assert.equal(second.report.cached, true)
  assert.equal(second.matte.key, first.matte.key)
  assert.equal(engine.sent.length, sent, 'nothing was segmented the second time')
  const other = await service.ensure({ ...request, toUs: 480_000 })
  assert.ok(other.ok)
  assert.notEqual(other.matte.key, first.matte.key)

  const index = await service.index(first.matte.key)
  assert.ok(index.ok)
  assert.equal(index.index.ptsUs.length, first.matte.frames)
  assert.match(index.index.url, /^bay:\/\/media\//)
})

test('the service refuses what bay would not serve and keys that are not keys, with how to recover', async () => {
  const service = new MatteService({ dir: scratch(), ffmpeg: () => 'ffmpeg', engine: new FakeEngine(), isAllowed: (p) => p === '/allowed.mov' })
  const refused = await service.ensure({ path: '/Users/x/.ssh/id_rsa', fromUs: 0, toUs: 1 })
  assert.equal(refused.ok, false)
  if (!refused.ok) {
    assert.equal(refused.code, 'refused')
    assert.match(refused.error, /does not serve .*import_media/)
  }
  const backwards = await service.ensure({ path: '/allowed.mov', fromUs: 5, toUs: 1 })
  assert.equal(backwards.ok, false)
  if (!backwards.ok) assert.match(backwards.error, /0 ≤ fromUs < toUs/)
  const bad = await service.index('../../etc/passwd')
  assert.equal(bad.ok, false)
  const absent = await service.index('0'.repeat(32))
  assert.equal(absent.ok, false)
  if (!absent.ok) assert.match(absent.error, /put_behind_subject again/)
})

// -- Apple Vision, for real ------------------------------------------------------------------------

test('Apple Vision through one osascript process: a test pattern has no person; stop kills the process', { skip: SKIP_VISION, timeout: 120_000 }, async () => {
  const engine = new VisionSegmenter()
  const service = new MatteService({ dir: scratch(), ffmpeg: () => TOOLS!.ffmpeg, engine, isAllowed: () => true })
  try {
    const result = await service.ensure({ path: testClip(), fromUs: 0, toUs: 2_000_000 })
    assert.ok(result.ok, JSON.stringify(result))
    assert.equal(result.matte.engine, 'apple-vision-person-balanced')
    assert.ok(result.matte.width > 0 && result.matte.height > 0)
    assert.ok(result.report.coverage < 0.5, `a test pattern is not a person: coverage ${result.report.coverage}`)
    assert.match(result.report.engineBuild, /Version \d+/)
    console.log(`# Vision on ${result.report.frames} frames: ${result.report.visionMsMedian} ms median (p90 ${result.report.visionMsP90}) in Vision, ` +
      `${result.report.msPerFrame} ms/frame wall incl. start; mask ${result.matte.width}×${result.matte.height}; ${result.report.megabytesPerMinute} MB/min`)
    const pid = engine.pid
    assert.ok(pid, 'one process, still running for the next job')
  } finally {
    const pid = engine.pid
    service.dispose()
    assert.equal(engine.running, false)
    if (pid) {
      await new Promise((r) => setTimeout(r, 200))
      assert.throws(() => process.kill(pid, 0), 'the osascript process is gone after stop')
    }
  }
})

test('Apple Vision finds the person in a clip of people', { skip: SKIP_PERSON, timeout: 300_000 }, async () => {
  const engine = new VisionSegmenter()
  const service = new MatteService({ dir: scratch(), ffmpeg: () => TOOLS!.ffmpeg, engine, isAllowed: () => true })
  try {
    const result = await service.ensure({ path: PERSON_CLIP!, fromUs: 0, toUs: 5_000_000 })
    assert.ok(result.ok, JSON.stringify(result))
    assert.ok(result.report.coverage > 0.5, `coverage ${result.report.coverage}`)
    console.log(`# person clip: ${JSON.stringify(result.report)}`)
  } finally {
    service.dispose()
  }
})

// -- review fixes ----------------------------------------------------------------------------------

test('the idle stop waits for the last running job: A ending does not stop B', async () => {
  let stops = 0
  const gate = new IdleGate(60, () => { stops += 1 })
  gate.begin() // A
  gate.begin() // B
  gate.end() // A finishes; B is still running
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(stops, 0, 'B\'s process was stopped while B was running')
  gate.end() // B finishes
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(stops, 1, 'positive control: idle after the last job, the process stops')
  gate.begin()
  gate.end()
  gate.cancel()
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(stops, 1, 'quit cancels a pending idle stop')
})

/** An engine that answers the first `answered` frames and then never again (a hung osascript). */
class HungEngine extends FakeEngine {
  answered = 3
  override async segment(frame: RgbaFrame): Promise<MaskFrame> {
    if (this.sent.length >= this.answered) {
      this.sent.push({ width: frame.width, height: frame.height })
      return new Promise<MaskFrame>(() => {})
    }
    return super.segment(frame)
  }
}

test('a hung engine is stopped by the watchdog with a clear message, and the queue goes on', { skip: SKIP_FFMPEG, timeout: 30_000 }, async () => {
  const engine = new HungEngine()
  const dir = scratch()
  const started = Date.now()
  // A backstop that is not the watchdog: without it this call would hang the test process for good
  // (ffmpeg waiting on a pipe nobody reads). Cancelled this way, the error is not a stall and fails.
  const backstop = new AbortController()
  const timer = setTimeout(() => backstop.abort(), 5_000)
  await assert.rejects(
    computeSubjectMatte({ ffmpeg: TOOLS!.ffmpeg, path: testClip(), fromUs: 0, toUs: 2_000_000, engine, outPath: join(dir, 'k.bmat'), stallMs: 300, signal: backstop.signal }),
    (error: Error) => error instanceof MatteStalledError && /nothing came back from ffmpeg or Apple Vision for 0 s.*Ask again/.test(error.message)
  )
  clearTimeout(timer)
  assert.ok(Date.now() - started < 5_000, 'stopped by the watchdog, not by the backstop')
  assert.ok(engine.stopped >= 1, 'the engine was stopped')
  assert.deepEqual(readdirSync(dir), [], 'no pack, no .part')

  // Through the service: the hung job fails in words, and the next job still runs.
  const hung = new HungEngine()
  const service = new MatteService({ dir: scratch(), ffmpeg: () => TOOLS!.ffmpeg, engine: hung, isAllowed: () => true, stallMs: 300 })
  const failed = await service.ensure({ path: testClip(), fromUs: 0, toUs: 1_000_000 })
  assert.equal(failed.ok, false)
  if (!failed.ok) assert.match(failed.error, /nothing came back/)
  hung.answered = Number.POSITIVE_INFINITY
  const next = await service.ensure({ path: testClip(), fromUs: 0, toUs: 400_000 })
  assert.ok(next.ok, `the queue continued: ${JSON.stringify(next)}`)
})

test('answers the engine owes when it dies are never unhandled rejections', { skip: SKIP_FFMPEG, timeout: 30_000 }, async () => {
  const unhandled: unknown[] = []
  const listener = (reason: unknown): void => { unhandled.push(reason) }
  process.on('unhandledRejection', listener)
  try {
    // The first answer is slow; the next three reject at once, before anything awaits them.
    class DyingEngine extends FakeEngine {
      override async segment(frame: RgbaFrame): Promise<MaskFrame> {
        const n = this.sent.length
        this.sent.push({ width: frame.width, height: frame.height })
        if (n === 0) {
          await new Promise((r) => setTimeout(r, 100))
          throw new Error('The Apple Vision process stopped (SIGKILL).')
        }
        throw new Error('The Apple Vision process stopped (SIGKILL).')
      }
    }
    await assert.rejects(
      computeSubjectMatte({ ffmpeg: TOOLS!.ffmpeg, path: testClip(), fromUs: 0, toUs: 2_000_000, engine: new DyingEngine(), outPath: join(scratch(), 'k.bmat') }),
      /stopped/
    )
    await new Promise((r) => setTimeout(r, 50))
    assert.deepEqual(unhandled.map(String), [])
  } finally {
    process.off('unhandledRejection', listener)
  }
})

test('startup sweeps interrupted .part files — bay\'s own only', async () => {
  const dir = scratch()
  const key = 'a'.repeat(32)
  writeFileSync(join(dir, `${key}.bmat.part`), 'x')
  writeFileSync(join(dir, `${'b'.repeat(32)}.bmat`), 'finished')
  writeFileSync(join(dir, 'notes.part'), 'not ours')
  writeFileSync(join(dir, `${'c'.repeat(31)}.bmat.part`), 'not a key')
  assert.deepEqual(await sweepMattePartFiles(dir), [`${key}.bmat.part`])
  assert.deepEqual(readdirSync(dir).sort(), [`${'b'.repeat(32)}.bmat`, `${'c'.repeat(31)}.bmat.part`, 'notes.part'])
  assert.deepEqual(await sweepMattePartFiles(join(dir, 'absent')), [])
})

test('matte packs count toward the cache budget, and one in use is never evicted', async () => {
  const root = scratch()
  const dirs = budgetedCacheDirs(root)
  assert.ok(dirs.includes(matteCacheDir(root)), `the budget measures ${dirs.join(', ')}`)
  assert.match(matteCacheDir(root), /mattes-v\d+$/)
  const { mkdirSync, utimesSync } = await import('node:fs')
  mkdirSync(matteCacheDir(root), { recursive: true })
  const old = join(matteCacheDir(root), `${'1'.repeat(32)}.bmat`)
  const used = join(matteCacheDir(root), `${'2'.repeat(32)}.bmat`)
  writeFileSync(old, Buffer.alloc(4000))
  writeFileSync(used, Buffer.alloc(4000))
  utimesSync(old, new Date(1000), new Date(1000))
  utimesSync(used, new Date(2000), new Date(2000))
  const result = await enforceCacheBudget(dirs, 5000, new Set(['2'.repeat(24)]))
  assert.equal(result.entriesEvicted, 1)
  assert.equal(existsSync(old), false, 'the unused pack is evicted over budget')
  assert.equal(existsSync(used), true, 'the pack in use is kept')
})

test('the service marks packs in use and keys them by the OS build', { skip: SKIP_FFMPEG, timeout: 60_000 }, async () => {
  const used: string[] = []
  const dir = scratch()
  const make = (build: string): MatteService =>
    new MatteService({ dir, ffmpeg: () => TOOLS!.ffmpeg, engine: new FakeEngine(), isAllowed: () => true, osBuild: () => build, onUse: (key) => used.push(key) })
  const request = { path: testClip(), fromUs: 0, toUs: 400_000 }
  const a = await make('25.6.0').ensure(request)
  assert.ok(a.ok)
  assert.ok(used.includes(a.matte.key), 'a computed pack is marked in use')
  used.length = 0
  const again = await make('25.6.0').ensure(request)
  assert.ok(again.ok && again.report.cached && used.includes(again.matte.key), 'a cached one too')
  const updated = await make('25.7.0').ensure(request)
  assert.ok(updated.ok)
  assert.notEqual(updated.matte.key, a.matte.key, 'after a macOS update the same range is a new pack')
  assert.equal(updated.report.cached, false)
})

test('cancelling a job whose engine has hung ends it at once', { skip: SKIP_FFMPEG, timeout: 30_000 }, async () => {
  const engine = new HungEngine()
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 300)
  const started = Date.now()
  // A backstop past the cancel: without the fix the call waits for the watchdog, which fails the time check.
  await assert.rejects(
    computeSubjectMatte({ ffmpeg: TOOLS!.ffmpeg, path: testClip(), fromUs: 0, toUs: 2_000_000, engine, outPath: join(scratch(), 'k.bmat'), signal: controller.signal, stallMs: 4_000 }),
    /cancelled|stopped/
  )
  assert.ok(Date.now() - started < 3_000, `cancelled in ${Date.now() - started} ms, not by the watchdog`)
})
