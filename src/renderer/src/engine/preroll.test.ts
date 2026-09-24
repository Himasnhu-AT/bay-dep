/**
 * The cut during playback: prerolling the incoming clip, and not restarting a slow seek.
 *
 * The report was "when watching video the screen goes black, coming from s3 to s4". Measured in
 * the app (`test/app/cut-playback.mjs`): one black picture at every cut, cold and warm, graded or
 * not, because the incoming clip's element was only told where to be by the draw at the cut, and
 * a seeking element has nothing to draw. These tests hold the two engine changes that fixed it —
 * the preroll, and a playback seek left to land instead of being restarted every two frames —
 * against stand-ins for the media elements, which are the only DOM the compositor needs.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project, Timeline, Track, Transition } from '@shared/project'
import { Compositor, prerollTargets } from './compositor'
import type { MediaEntry, MediaPool } from './mediaPool'
import { sourceSecondsAt } from './sync'

// -- stand-ins ---------------------------------------------------------------------------------

/**
 * A <video> that seeks only when told to land, so a test controls exactly when a seek finishes.
 *
 * Like the real one, `currentTime` reads the seek's target from the moment it is set, while
 * `seeking` is still true — the first version of this stand-in kept the old time until the seek
 * landed, and a fix that only worked against that stand-in passed here and did nothing in the app.
 */
class FakeVideo {
  paused = true
  seeking = false
  readyState = 1
  videoWidth = 0
  videoHeight = 0
  playbackRate = 1
  /** Every `currentTime` assignment, in order: the seeks the compositor issued. */
  readonly seeks: number[] = []
  #time = 0
  get currentTime(): number {
    return this.#time
  }
  set currentTime(value: number) {
    this.seeks.push(value)
    this.#time = value
    this.seeking = true
    this.readyState = 1
  }
  /** The seek in flight completes: the element holds a decoded picture at its target. */
  land(): void {
    this.seeking = false
    this.readyState = 4
    this.videoWidth = 768
    this.videoHeight = 1344
  }
  play(): Promise<void> {
    this.paused = false
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
}

const g = globalThis as Record<string, unknown>
g.HTMLVideoElement ??= FakeVideo
g.HTMLImageElement ??= class FakeImage {}
g.HTMLMediaElement ??= { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 }
// The compositor checks `instanceof HTMLVideoElement`; whichever class is installed is the one used.
const Video = g.HTMLVideoElement as unknown as typeof FakeVideo

/** The pool surface the compositor uses: one element per (asset, slot), and who is using what. */
class FakePool {
  readonly entries = new Map<string, MediaEntry>()
  readonly used = new Set<string>()
  beginGeneration(): void {
    this.used.clear()
  }
  acquire(asset: Asset, slot = 0): MediaEntry {
    const key = `${asset.id}#${slot}`
    this.used.add(key)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { assetId: asset.id, slot, kind: asset.kind, element: new Video() as unknown as HTMLVideoElement, status: 'loading' }
      this.entries.set(key, entry)
    }
    return entry
  }
  inUse(assetId: string, slot = 0): boolean {
    return this.used.has(`${assetId}#${slot}`)
  }
  video(assetId: string, slot = 0): FakeVideo | undefined {
    return this.entries.get(`${assetId}#${slot}`)?.element as unknown as FakeVideo | undefined
  }
}

/** A 2D context that accepts everything and records what was drawn. */
function fakeContext(): { ctx: CanvasRenderingContext2D; drawn: unknown[] } {
  const drawn: unknown[] = []
  const target: Record<string, unknown> = {
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1 }),
    drawImage: (source: unknown) => drawn.push(source)
  }
  const ctx = new Proxy(target, {
    get: (t, key) => (key in t ? t[key as string] : () => {}),
    set: () => true
  }) as unknown as CanvasRenderingContext2D
  return { ctx, drawn }
}

// -- fixtures ----------------------------------------------------------------------------------

const FPS = 24

function asset(id: string, extra: Partial<Asset> = {}): Asset {
  return {
    id, kind: 'video', name: id, path: `/media/${id}.mp4`, durationUs: 5_166_667, width: 768, height: 1344,
    fps: 24, hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0, ...extra
  }
}

function clip(id: string, assetId: string, from: number, durationInFrames: number, sourceStartUs = 0, trackId = 'v1'): Item {
  return {
    id, assetId, trackId, from, durationInFrames, sourceStartUs,
    layout: { left: 0, top: 0, width: 1080, height: 1920, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
}

function track(id: string, items: Item[], extra: Partial<Track> = {}): Track {
  return { id, kind: 'video', name: id, locked: false, muted: false, hidden: false, items, ...extra }
}

function project(assets: Asset[], tracks: Track[], transitions: Transition[] = []): { project: Project; timeline: Timeline } {
  const timeline: Timeline = { id: 'tl', name: 'tl', fps: FPS, width: 1080, height: 1920, background: '#000000', tracks, transitions }
  const p: Project = { id: 'p', name: 'p', version: 1, assets, timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 }
  return { project: p, timeline }
}

/** The reporter's shape: back-to-back clips of different takes, the next trimmed to 0.85 s. */
function twoTakes() {
  const a = asset('s3')
  const b = asset('s4')
  const outgoing = clip('i3', 's3', 0, 48, 400_000)
  const incoming = clip('i4', 's4', 48, 48, 850_000)
  return { a, b, outgoing, incoming, ...project([a, b], [track('v1', [outgoing, incoming])]) }
}

// -- prerollTargets ------------------------------------------------------------------------------

test('the next clip is a preroll target once it is within the lookahead, and not before', () => {
  const { project: p, timeline, incoming } = twoTakes()
  assert.deepEqual(prerollTargets(p, timeline, 23, 24), [], '25 frames out is beyond a 24-frame lookahead')
  const targets = prerollTargets(p, timeline, 24, 24)
  assert.equal(targets.length, 1)
  assert.equal(targets[0]?.item.id, incoming.id)
  assert.equal(targets[0]?.startFrame, 48)
  assert.equal(targets[0]?.slot, 0)
  // A clip already on screen is the draw's business, not the preroll's.
  assert.deepEqual(prerollTargets(p, timeline, 48, 24), [])
})

test('a transition brings the incoming clip forward to its window, on the element the window draws it from', () => {
  // A split clip dissolving into itself: one asset, and the incoming half is drawn from slot 1
  // inside the window — prerolling slot 0 would prepare the element the outgoing half is using.
  const s = asset('take')
  const first = clip('a', 'take', 0, 48, 0)
  const second = clip('b', 'take', 48, 48, 3_000_000)
  const dissolve: Transition = { id: 'x', kind: 'cross-dissolve', fromItemId: 'a', toItemId: 'b', durationInFrames: 12 }
  const { project: p, timeline } = project([s], [track('v1', [first, second])], [dissolve])
  const targets = prerollTargets(p, timeline, 30, 24)
  assert.equal(targets.length, 1)
  assert.equal(targets[0]?.item.id, 'b')
  assert.equal(targets[0]?.startFrame, 42, 'the window opens six frames before the cut')
  assert.equal(targets[0]?.slot, 1)
})

test('hidden tracks, audio-only files and unreadable assets are not prerolled', () => {
  const pictureless = asset('wav', { hasVideo: false })
  const broken = asset('gone', { error: 'missing' })
  const hidden = asset('hid')
  const shown = asset('shown')
  const { project: p, timeline } = project([pictureless, broken, hidden, shown], [
    track('v1', [clip('w', 'wav', 10, 10), clip('g', 'gone', 11, 10), clip('s', 'shown', 12, 10)]),
    track('v2', [clip('h', 'hid', 10, 10)], { hidden: true })
  ])
  assert.deepEqual(prerollTargets(p, timeline, 0, 24).map((t) => t.item.id), ['s'])
})

test('two clips wanting one element: the sooner keeps it', () => {
  const s = asset('take')
  const { project: p, timeline } = project([s], [
    track('v1', [clip('late', 'take', 20, 5, 2_000_000)]),
    track('v2', [clip('soon', 'take', 10, 5, 1_000_000)])
  ])
  assert.deepEqual(prerollTargets(p, timeline, 0, 24).map((t) => [t.item.id, t.startFrame]), [['soon', 10]])
})

// -- the cut, drawn ------------------------------------------------------------------------------

test('without a preroll the draw at the cut has nothing: the black picture that was reported', () => {
  // The negative control for the test below: the same cut, the same fakes, and no preroll.
  const { project: p, timeline, a, b } = twoTakes()
  const pool = new FakePool()
  const compositor = new Compositor(pool as unknown as MediaPool)
  pool.acquire(a).element // the outgoing clip's element exists and holds a picture
  pool.video('s3')?.land()
  const { ctx } = fakeContext()
  const stats = compositor.drawFrame(ctx, p, timeline, 48, { mode: 'playback', now: () => 1000 })
  assert.equal(stats.pending, 1, 'the incoming clip is mid-seek at the cut')
  assert.equal(stats.drawn, 0)
  assert.deepEqual(pool.video(b.id)?.seeks, [sourceSecondsAt(twoTakes().incoming, b, 48, FPS)])
})

test('prerolled a second ahead, the incoming clip is drawn at the cut with no seek issued there', () => {
  const { project: p, timeline, b, incoming } = twoTakes()
  const pool = new FakePool()
  const compositor = new Compositor(pool as unknown as MediaPool)
  const { ctx, drawn } = fakeContext()

  // A playing frame a second before the cut, then the preroll the engine runs after it.
  compositor.drawFrame(ctx, p, timeline, 24, { mode: 'playback', now: () => 0 })
  compositor.preroll(p, timeline, 24, { now: 0 })
  const element = pool.video(b.id)
  assert.ok(element, 'the preroll created the incoming clip\'s element')
  const inPoint = sourceSecondsAt(incoming, b, 48, FPS)
  assert.deepEqual(element.seeks, [inPoint], 'seeked once, to the in-point')
  assert.equal(element.paused, true, 'and left paused until its clip starts')

  // Asked again on the next frames while the seek is in flight: not re-issued. Each preroll
  // follows a draw, as in the engine — the draw starts the generation the preroll checks.
  compositor.drawFrame(ctx, p, timeline, 25, { mode: 'playback', now: () => 42 })
  compositor.preroll(p, timeline, 25, { now: 42 })
  assert.equal(element.seeks.length, 1, 'a seek in flight is not restarted')
  element.land()
  compositor.drawFrame(ctx, p, timeline, 26, { mode: 'playback', now: () => 84 })
  compositor.preroll(p, timeline, 26, { now: 84 })
  assert.equal(element.seeks.length, 1, 'nor one that has landed')

  const stats = compositor.drawFrame(ctx, p, timeline, 48, { mode: 'playback', now: () => 1000 })
  assert.equal(stats.pending, 0)
  assert.equal(stats.drawn, 1)
  assert.equal(drawn.at(-1), element, 'the picture drawn at the cut is the incoming clip')
  assert.equal(element.seeks.length, 1, 'no seek at the cut: it was already there')
  assert.equal(element.paused, false, 'and it is playing')
})

test('a preroll seek still in flight when the clip starts is waited for, not restarted', () => {
  // Prerolled late — play pressed just before the cut, or a seek slower than the lookahead. The
  // clip starts with its element still seeking, and the clock moves on past the drift tolerance.
  const { project: p, timeline, b } = twoTakes()
  const pool = new FakePool()
  const compositor = new Compositor(pool as unknown as MediaPool)
  const { ctx } = fakeContext()
  compositor.drawFrame(ctx, p, timeline, 46, { mode: 'playback', now: () => 0 })
  compositor.preroll(p, timeline, 46, { now: 0 })
  const element = pool.video(b.id)
  assert.ok(element)
  for (let frame = 47; frame <= 52; frame++) {
    compositor.drawFrame(ctx, p, timeline, frame, { mode: 'playback', now: () => (frame - 46) * (1000 / FPS) })
    compositor.preroll(p, timeline, frame, { now: (frame - 46) * (1000 / FPS) })
  }
  assert.equal(element.seeks.length, 1, 'the one preroll seek, left to land')
})

test('an element still running from an earlier clip is paused where the next clip starts', () => {
  // Warm playback: the incoming clip's element last played as some earlier clip and was never
  // stopped. Acquired by the preroll, the idle sweep no longer pauses it — so the preroll must, or
  // it runs on past the in-point it was just put at.
  const { project: p, timeline, b } = twoTakes()
  const pool = new FakePool()
  const compositor = new Compositor(pool as unknown as MediaPool)
  const { ctx } = fakeContext()
  const element = pool.acquire(b).element as unknown as FakeVideo
  element.land()
  void element.play()
  compositor.drawFrame(ctx, p, timeline, 30, { mode: 'playback', now: () => 0 })
  compositor.preroll(p, timeline, 30, { now: 0 })
  assert.equal(element.paused, true)
  assert.equal(element.seeks.length, 1)
})

test('the preroll leaves alone an element something else is using this frame', () => {
  // A hidden track's clip is heard but never drawn: the audio engine acquires its element, the
  // compositor never sees it. Pausing and moving that element would cut its sound.
  const { project: p, timeline, b } = twoTakes()
  const pool = new FakePool()
  const compositor = new Compositor(pool as unknown as MediaPool)
  const { ctx } = fakeContext()
  compositor.drawFrame(ctx, p, timeline, 30, { mode: 'playback', now: () => 0 })
  const sound = pool.acquire(b) // the other consumer, this generation
  const element = sound.element as unknown as FakeVideo
  element.land()
  void element.play()
  compositor.preroll(p, timeline, 30, { now: 0 })
  assert.deepEqual(element.seeks, [], 'not moved')
  assert.equal(element.paused, false, 'not paused')
})

test('a slow seek during playback is left to land, and the next one aims ahead by its latency', () => {
  // The same-asset jump cut the preroll cannot help: one element, 74 frames past its keyframe.
  // Before, the target moving past the drift tolerance re-issued the seek every two frames, and a
  // seek slower than that never landed — measured as a new `currentTime` every 83 ms.
  const { project: p, timeline, b, incoming } = twoTakes()
  const pool = new FakePool()
  const compositor = new Compositor(pool as unknown as MediaPool)
  const { ctx } = fakeContext()
  const frameMs = 1000 / FPS
  const at = (frame: number) => () => 1000 + (frame - 48) * frameMs

  compositor.drawFrame(ctx, p, timeline, 48, { mode: 'playback', now: at(48) })
  const element = pool.video(b.id)
  assert.ok(element)
  assert.equal(element.seeks.length, 1)
  for (let frame = 49; frame <= 52; frame++) {
    compositor.drawFrame(ctx, p, timeline, frame, { mode: 'playback', now: at(frame) })
  }
  assert.equal(element.seeks.length, 1, 'four frames later the seek is still the first one')

  // It lands 200 ms after it was asked — five frames behind the clock.
  element.land()
  compositor.drawFrame(ctx, p, timeline, 53, { mode: 'playback', now: () => at(48)() + 200 })
  assert.equal(element.seeks.length, 2, 'landed late, so corrected once')
  const lead = Math.round(0.2 * FPS)
  assert.equal(element.seeks[1], sourceSecondsAt(incoming, b, 53 + lead, FPS),
    'aimed where the clock will be when it lands, not where it was when asked')
})

test('a fast seek is not led at all', () => {
  // Latency is read at the first draw after landing — up to a frame long already. A seek that
  // really took 25 ms must not become a one-frame lead, which opens the clip a source frame late.
  const { project: p, timeline, b, incoming } = twoTakes()
  const pool = new FakePool()
  const compositor = new Compositor(pool as unknown as MediaPool)
  const { ctx } = fakeContext()
  compositor.drawFrame(ctx, p, timeline, 48, { mode: 'playback', now: () => 1000 })
  const element = pool.video(b.id)
  assert.ok(element)
  element.land()
  compositor.drawFrame(ctx, p, timeline, 49, { mode: 'playback', now: () => 1020 })
  // Far enough on that a correction is due; the lead it carries is what is under test.
  compositor.drawFrame(ctx, p, timeline, 60, { mode: 'playback', now: () => 1500 })
  assert.equal(element.seeks.at(-1), sourceSecondsAt(incoming, b, 60, FPS))
})

test('only a playback seek times its own landing: an old scrub seek is not a latency', () => {
  // A scrub seek lands and sits there; playback starts seconds later. Reading "now minus when it
  // was asked" as that seek's latency would aim the first playback correction a second ahead.
  const { project: p, timeline, b, incoming } = twoTakes()
  const pool = new FakePool()
  const compositor = new Compositor(pool as unknown as MediaPool)
  const { ctx } = fakeContext()
  compositor.drawFrame(ctx, p, timeline, 50, { mode: 'scrub', now: () => 0 })
  const element = pool.video(b.id)
  assert.ok(element)
  element.land()
  compositor.drawFrame(ctx, p, timeline, 70, { mode: 'playback', now: () => 5000 })
  assert.equal(element.seeks.at(-1), sourceSecondsAt(incoming, b, 70, FPS), 'aimed at the clock, no lead')
})

test('scrubbing still chases the newest target: a seek in flight is replaced', () => {
  // The positive control for the patience above: it is playback's rule, not a general one.
  const { project: p, timeline, b } = twoTakes()
  const pool = new FakePool()
  const compositor = new Compositor(pool as unknown as MediaPool)
  const { ctx } = fakeContext()
  compositor.drawFrame(ctx, p, timeline, 50, { mode: 'scrub', now: () => 0 })
  compositor.drawFrame(ctx, p, timeline, 60, { mode: 'scrub', now: () => 10 })
  assert.equal(pool.video(b.id)?.seeks.length, 2)
})
