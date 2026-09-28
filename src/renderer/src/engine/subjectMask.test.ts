/**
 * The subject mask, on pixels: a tiny software canvas stands in for the 2D context, so the
 * composition the compositor asks for — picture, then `destination-in` against the matte — is
 * checked as colours at positions, not as a list of calls.
 *
 * The scene is "text behind the subject" in miniature, 16×9: V1 a clip whose left half is the
 * person, V2 a green title card over the whole frame, V3 the same clip with a subject mask. The
 * requirement, and its control:
 *
 * - with the mask, the title shows **beside** the person (right half green) and is **hidden over**
 *   the person (left half the clip's own colour);
 * - without it (the copy unmasked), the title is hidden everywhere — the control that proves the
 *   measurement can tell the two apart.
 *
 * And the element: the cut-out is drawn from the clip's own `<video>` (one pool entry), because two
 * elements drift up to ~160 ms apart in playback. That test fails against the old `elementSlots`.
 *
 * The real thing — a person, Apple Vision, `preview_frame` against export — is `test/app/mask.mjs`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project, Timeline, Track } from '@shared/project'
import type { SubjectMatte, SubjectMatteIndex } from '@shared/matte'

// -- a software 2D canvas ------------------------------------------------------------------------

type Op = 'source-over' | 'destination-in' | 'destination-out' | 'copy'

/** Premultiplied RGBA floats. Nearest-neighbour sampling; transforms are scale + translate only. */
class SoftCanvas {
  width: number
  height: number
  px: Float32Array
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.px = new Float32Array(width * height * 4)
  }
  resize(): void {
    this.px = new Float32Array(this.width * this.height * 4)
  }
  getContext(): SoftContext {
    return new SoftContext(this)
  }
  /** Straight (un-premultiplied) 0..255 RGBA at a pixel. */
  at(x: number, y: number): [number, number, number, number] {
    const o = (y * this.width + x) * 4
    const a = this.px[o + 3]!
    if (a <= 0) return [0, 0, 0, 0]
    return [Math.round((this.px[o]! / a) * 255), Math.round((this.px[o + 1]! / a) * 255), Math.round((this.px[o + 2]! / a) * 255), Math.round(a * 255)]
  }
  static solid(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): SoftCanvas {
    const c = new SoftCanvas(width, height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [r, g, b, a] = paint(x, y)
        const o = (y * width + x) * 4
        const af = a / 255
        c.px[o] = (r / 255) * af
        c.px[o + 1] = (g / 255) * af
        c.px[o + 2] = (b / 255) * af
        c.px[o + 3] = af
      }
    }
    return c
  }
}

interface State {
  alpha: number
  op: Op
  t: [number, number, number, number, number, number]
  fill: string
  filter: string
}

function parseColour(fill: string): [number, number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fill)
  if (!m) return [0, 0, 0, 1]
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255, 1]
}

/** What a drawable is, as pixels: a SoftCanvas, or a fake element carrying one. */
function pixelsOf(source: unknown): SoftCanvas | null {
  if (source instanceof SoftCanvas) return source
  const held = (source as { pixels?: unknown } | null)?.pixels
  return held instanceof SoftCanvas ? held : null
}

class SoftContext {
  readonly canvas: SoftCanvas
  #s: State = { alpha: 1, op: 'source-over', t: [1, 0, 0, 1, 0, 0], fill: '#000000', filter: 'none' }
  readonly #stack: State[] = []
  /** Every drawImage source, in order — which element a draw read. */
  readonly sources: unknown[] = []
  constructor(canvas: SoftCanvas) {
    this.canvas = canvas
  }
  get globalAlpha(): number { return this.#s.alpha }
  set globalAlpha(v: number) { this.#s.alpha = v }
  get globalCompositeOperation(): Op { return this.#s.op }
  set globalCompositeOperation(v: Op) { this.#s.op = v }
  get fillStyle(): string { return this.#s.fill }
  set fillStyle(v: string) { this.#s.fill = v }
  get filter(): string { return this.#s.filter }
  set filter(v: string) { this.#s.filter = v }
  save(): void { this.#stack.push({ ...this.#s, t: [...this.#s.t] }) }
  restore(): void { const s = this.#stack.pop(); if (s) this.#s = s }
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const [a, b, c, d, e, f] = this.#s.t
    return { a, b, c, d, e, f }
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void { this.#s.t = [a, b, c, d, e, f] }
  translate(x: number, y: number): void { const t = this.#s.t; t[4] += x * t[0]; t[5] += y * t[3] }
  scale(x: number, y: number): void { this.#s.t[0] *= x; this.#s.t[3] *= y }
  rotate(): void {}
  beginPath(): void {}
  rect(): void {}
  clip(): void {}
  strokeRect(): void {}
  fillText(): void {}
  strokeText(): void {}
  measureText(): { width: number } { return { width: 10 } }

  #blend(o: number, s: [number, number, number, number]): void {
    const px = this.canvas.px
    const a = this.#s.alpha
    const sr = s[0] * a, sg = s[1] * a, sb = s[2] * a, sa = s[3] * a
    const dr = px[o]!, dg = px[o + 1]!, db = px[o + 2]!, da = px[o + 3]!
    switch (this.#s.op) {
      case 'copy':
        px[o] = sr; px[o + 1] = sg; px[o + 2] = sb; px[o + 3] = sa; break
      case 'destination-in':
        px[o] = dr * sa; px[o + 1] = dg * sa; px[o + 2] = db * sa; px[o + 3] = da * sa; break
      case 'destination-out':
        px[o] = dr * (1 - sa); px[o + 1] = dg * (1 - sa); px[o + 2] = db * (1 - sa); px[o + 3] = da * (1 - sa); break
      default:
        px[o] = sr + dr * (1 - sa); px[o + 1] = sg + dg * (1 - sa); px[o + 2] = sb + db * (1 - sa); px[o + 3] = sa + da * (1 - sa)
    }
  }

  /** Each device pixel whose centre falls in the transformed rect, with the rect-local fraction. */
  #cover(x: number, y: number, w: number, h: number, each: (o: number, u: number, v: number) => void): void {
    const [a, , , d, e, f] = this.#s.t
    const x0 = x * a + e, y0 = y * d + f, x1 = (x + w) * a + e, y1 = (y + h) * d + f
    for (let py = 0; py < this.canvas.height; py += 1) {
      const cy = py + 0.5
      if (cy < Math.min(y0, y1) || cy >= Math.max(y0, y1)) continue
      for (let px = 0; px < this.canvas.width; px += 1) {
        const cx = px + 0.5
        if (cx < Math.min(x0, x1) || cx >= Math.max(x0, x1)) continue
        each((py * this.canvas.width + px) * 4, (cx - x0) / (x1 - x0), (cy - y0) / (y1 - y0))
      }
    }
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const c = parseColour(this.#s.fill)
    this.#cover(x, y, w, h, (o) => this.#blend(o, [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]]))
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.#cover(x, y, w, h, (o) => { this.canvas.px.fill(0, o, o + 4) })
  }
  drawImage(source: unknown, ...args: number[]): void {
    this.sources.push(source)
    const img = pixelsOf(source)
    if (!img) return
    let sx = 0, sy = 0, sw = img.width, sh = img.height, dx: number, dy: number, dw: number, dh: number
    if (args.length === 2) [dx, dy, dw, dh] = [args[0]!, args[1]!, img.width, img.height]
    else if (args.length === 4) [dx, dy, dw, dh] = args as [number, number, number, number]
    else [sx, sy, sw, sh, dx, dy, dw, dh] = args as [number, number, number, number, number, number, number, number]
    this.#cover(dx, dy, dw, dh, (o, u, v) => {
      const ix = Math.min(img.width - 1, Math.max(0, Math.floor(sx + u * sw)))
      const iy = Math.min(img.height - 1, Math.max(0, Math.floor(sy + v * sh)))
      const i = (iy * img.width + ix) * 4
      this.#blend(o, [img.px[i]!, img.px[i + 1]!, img.px[i + 2]!, img.px[i + 3]!])
    })
  }
}

/** A software canvas where the engine's types want a real drawable. */
const drawable = (canvas: SoftCanvas): CanvasImageSource => canvas as unknown as CanvasImageSource

/** The `MaskCanvas` factory for `MaskScratch`: resizing through the setters clears, as a real canvas does. */
function makeSoft(width: number, height: number): SoftCanvas {
  const canvas = new SoftCanvas(width, height)
  let w = width, h = height
  Object.defineProperty(canvas, 'width', { get: () => w, set: (v: number) => { w = v; canvas.resize() } })
  Object.defineProperty(canvas, 'height', { get: () => h, set: (v: number) => { h = v; canvas.resize() } })
  return canvas
}

// The scratch surfaces the compositor makes are OffscreenCanvases; here, software ones.
;(globalThis as Record<string, unknown>).OffscreenCanvas = function OffscreenCanvas(w: number, h: number) {
  return makeSoft(w, h)
}

// -- media stand-ins ------------------------------------------------------------------------------

class FakeVideo {
  paused = true
  seeking = false
  readyState = 4
  playbackRate = 1
  readonly seeks: number[] = []
  #time = 0
  readonly pixels: SoftCanvas
  constructor(pixels: SoftCanvas) {
    this.pixels = pixels
  }
  get videoWidth(): number { return this.pixels.width }
  get videoHeight(): number { return this.pixels.height }
  get currentTime(): number { return this.#time }
  set currentTime(value: number) { this.seeks.push(value); this.#time = value }
  play(): Promise<void> { this.paused = false; return Promise.resolve() }
  pause(): void { this.paused = true }
}
class FakeImage {
  complete = true
  readonly pixels: SoftCanvas
  constructor(pixels: SoftCanvas) {
    this.pixels = pixels
  }
  get naturalWidth(): number { return this.pixels.width }
  get naturalHeight(): number { return this.pixels.height }
}
const g = globalThis as Record<string, unknown>
g.HTMLVideoElement = FakeVideo
g.HTMLImageElement = FakeImage
g.HTMLMediaElement = { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 }

// Imported after the globals: the compositor and pool read them at call time, not import time,
// but the order keeps that from ever mattering.
const { Compositor, elementSlots, prerollTargets } = await import('./compositor')
const { subjectMattes } = await import('./subjectMatte')
const { MaskScratch, maskedPicture, matteRect } = await import('./subjectMask')

const W = 16
const H = 9
/** The clip: warm red where the person is (left half), dark blue background (right half). */
const PERSON = [200, 40, 40, 255] as const
const BACKDROP = [20, 30, 120, 255] as const
const TITLE = [0, 220, 0, 255] as const
const clipPixels = (): SoftCanvas => SoftCanvas.solid(W, H, (x) => (x < W / 2 ? [...PERSON] : [...BACKDROP]))

/** The pool surface the compositor uses, counting the elements it creates. */
class CountingPool {
  readonly entries = new Map<string, { assetId: string; slot: number; kind: string; element: unknown; status: string }>()
  readonly used = new Set<string>()
  beginGeneration(): void { this.used.clear() }
  acquire(asset: Asset, slot = 0): { assetId: string; slot: number; kind: string; element: unknown; status: string } {
    const key = `${asset.id}#${slot}`
    this.used.add(key)
    let entry = this.entries.get(key)
    if (!entry) {
      const element = asset.kind === 'image' ? new FakeImage(SoftCanvas.solid(W, H, () => [...TITLE])) : new FakeVideo(clipPixels())
      entry = { assetId: asset.id, slot, kind: asset.kind, element, status: 'ready' }
      this.entries.set(key, entry)
    }
    return entry
  }
  inUse(assetId: string, slot = 0): boolean { return this.used.has(`${assetId}#${slot}`) }
}

const FPS = 30
const MATTE: SubjectMatte = { key: 'a'.repeat(32), fromUs: 0, toUs: 20_000_000, engine: 'apple-vision-person-balanced', frames: 600, width: 4, height: 3 }

function videoAsset(): Asset {
  return {
    id: 'ast_clip', kind: 'video', name: 'talk.mp4', path: '/m/talk.mp4', durationUs: 20_000_000, width: W, height: H, fps: 30,
    hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0, subjectMattes: [MATTE]
  }
}
const titleAsset: Asset = {
  id: 'ast_title', kind: 'image', name: 'title.png', path: '/m/title.png', durationUs: 0, width: W, height: H, fps: null,
  hasAudio: false, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0
}

function item(id: string, assetId: string, trackId: string, extra: Partial<Item> = {}): Item {
  return {
    id, assetId, trackId, from: 0, durationInFrames: 300, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: W, height: H, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
  }
}
function track(id: string, items: Item[]): Track {
  return { id, kind: 'video', name: id, locked: false, muted: false, hidden: false, items }
}
function scene(opts: { masked: boolean; copy?: Partial<Item>; base?: Partial<Item>; asset?: Asset }): { project: Project; timeline: Timeline } {
  const base = item('base', 'ast_clip', 'v1', opts.base)
  const title = item('title', 'ast_title', 'v2')
  const copy = item('cutout', 'ast_clip', 'v3', { ...opts.base, audioDetached: true, ...(opts.masked ? { masks: [{ kind: 'subject' as const }] } : {}), ...opts.copy })
  const timeline: Timeline = { id: 'tl', name: 'tl', fps: FPS, width: W, height: H, background: '#000000', tracks: [track('v1', [base]), track('v2', [title]), track('v3', [copy])], transitions: [] }
  return { project: { id: 'p', name: 'p', version: 1, assets: [opts.asset ?? videoAsset(), titleAsset], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 }, timeline }
}

/** A matte whose left half is the person — at 4×3, stretched over the 16×9 frame like Vision's 4:3 mask. */
function matteLoader(requested: number[] = []): Parameters<typeof subjectMattes.useLoader>[0] {
  return {
    async index(key) {
      const n = 600
      const index: SubjectMatteIndex = {
        key, url: 'bay://media/x', width: 4, height: 3, fromUs: 0, toUs: 20_000_000,
        ptsUs: Array.from({ length: n }, (_, i) => Math.round((i * 1_000_000) / 30)),
        offsets: Array.from({ length: n }, () => 0), lengths: Array.from({ length: n }, () => 1)
      }
      return { ok: true, index }
    },
    async frame(_index, i) {
      requested.push(i)
      return { image: drawable(SoftCanvas.solid(4, 3, (x) => (x < 2 ? [255, 255, 255, 255] : [255, 255, 255, 0]))), width: 4, height: 3 }
    }
  }
}

async function draw(s: { project: Project; timeline: Timeline }, frame = 45, pool = new CountingPool()): Promise<{ out: SoftCanvas; ctx: SoftContext; stats: ReturnType<InstanceType<typeof Compositor>['drawFrame']>; pool: CountingPool }> {
  // As `renderFrame` and the exporter do: draw, and while anything is pending, settle and draw again
  // (the index arrives first, then the frame).
  const compositor = new Compositor(pool as never)
  for (let attempt = 0; ; attempt += 1) {
    const out = new SoftCanvas(W, H)
    const ctx = out.getContext()
    const stats = compositor.drawFrame(ctx as never, s.project, s.timeline, frame)
    if (stats.pending === 0 || attempt >= 3) return { out, ctx, stats, pool }
    await subjectMattes.settle(1000)
  }
}

const near = (a: readonly number[], b: readonly number[], tol = 2): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol)

// -- the mask itself ------------------------------------------------------------------------------

test('maskedPicture keeps the picture where the matte is opaque and clears it where it is not; invert flips it', () => {
  const picture = clipPixels()
  const matte = { image: drawable(SoftCanvas.solid(4, 3, (x) => (x < 2 ? [255, 255, 255, 255] : [255, 255, 255, 0]))), width: 4, height: 3 }
  const base = { source: picture, sx: 0, sy: 0, sw: W, sh: H, width: W, height: H, matte, ...matteRect({ sx: 0, sy: 0, sw: W, sh: H }, W, H, matte), featherPx: 0 }
  const kept = maskedPicture({ ...base, invert: false }, new MaskScratch(makeSoft as never)) as unknown as SoftCanvas
  assert.ok(near(kept.at(2, 4), PERSON), `the person is kept: ${kept.at(2, 4)}`)
  assert.equal(kept.at(13, 4)[3], 0, 'the background is cleared')
  const inverted = maskedPicture({ ...base, invert: true }, new MaskScratch(makeSoft as never)) as unknown as SoftCanvas
  assert.equal(inverted.at(2, 4)[3], 0, 'inverted: the person is cleared')
  assert.ok(near(inverted.at(13, 4), BACKDROP), `inverted: the background is kept: ${inverted.at(13, 4)}`)
})

test('matteRect maps a crop onto a 4:3 matte of a 16:9 frame by scale on each axis', () => {
  // The right half of a 1920×1080 frame is the right half of Vision's 512×384 matte.
  assert.deepEqual(matteRect({ sx: 960, sy: 0, sw: 960, sh: 1080 }, 1920, 1080, { width: 512, height: 384 }), { mx: 256, my: 0, mw: 256, mh: 384 })
  assert.deepEqual(matteRect({ sx: 0, sy: 270, sw: 1920, sh: 540 }, 1920, 1080, { width: 512, height: 384 }), { mx: 0, my: 96, mw: 512, mh: 192 })
})

// -- through the compositor ------------------------------------------------------------------------

test('text behind the subject: the title shows beside the person and is hidden over them', async () => {
  subjectMattes.useLoader(matteLoader())
  const { out, stats } = await draw(scene({ masked: true }))
  assert.equal(stats.pending, 0, `complete: ${stats.pendingNames.join(', ')}`)
  assert.equal(stats.placeholders, 0, stats.placeholderNames.join(', '))
  assert.ok(near(out.at(12, 4), TITLE), `beside the person the title shows: ${out.at(12, 4)}`)
  assert.ok(near(out.at(3, 4), PERSON), `over the person the title is hidden: ${out.at(3, 4)}`)
})

test('control: an unmasked copy hides the title everywhere, so the measurement can tell the two apart', async () => {
  subjectMattes.useLoader(matteLoader())
  const { out } = await draw(scene({ masked: false }))
  assert.ok(near(out.at(12, 4), BACKDROP), `the copy covers the title beside the person too: ${out.at(12, 4)}`)
  assert.ok(near(out.at(3, 4), PERSON))
})

test('the cut-out is drawn from the clip\'s own element: one pool entry, the same element for both draws', async () => {
  subjectMattes.useLoader(matteLoader())
  const { ctx, pool } = await draw(scene({ masked: true }))
  const videos = [...pool.entries.values()].filter((e) => e.element instanceof FakeVideo)
  assert.equal(videos.length, 1, `one <video> for the clip and its cut-out, not ${videos.length} (two drift up to ~160 ms apart)`)
  // The base drew the element directly; the cut-out drew it into the mask scratch. Either way the
  // one element is the only video that reached a canvas.
  const drawnVideos = new Set(ctx.sources.filter((s) => s instanceof FakeVideo))
  assert.ok(drawnVideos.size <= 1)
})

test('elementSlots shares a slot only for the same moment of the same file (positive and negative)', () => {
  const base = item('a', 'ast_clip', 'v1')
  const copy = item('b', 'ast_clip', 'v3', { masks: [{ kind: 'subject' }], audioDetached: true })
  assert.deepEqual([...elementSlots([base, copy]).values()], [0, 0], 'the cut-out shares the clip\'s element')
  // A duplicate that sounds keeps its own: one element is one source node, and the preview would
  // play it once where export mixes it twice.
  assert.deepEqual([...elementSlots([base, item('s', 'ast_clip', 'v2')]).values()], [0, 1])
  // A transition's two halves of one file are two source times: two elements, as before.
  const later = item('c', 'ast_clip', 'v1', { from: 0, sourceStartUs: 5_000_000 })
  assert.deepEqual([...elementSlots([base, later]).values()], [0, 1])
  assert.deepEqual([...elementSlots([base, item('d', 'ast_clip', 'v2', { speed: 2 })]).values()], [0, 1], 'another speed is another moment')
})

test('preroll prepares one element for a clip and its cut-out, not two', () => {
  const s = scene({ masked: true, base: { from: 40 } })
  const targets = prerollTargets(s.project, s.timeline, 30, 30)
  const clips = targets.filter((t) => t.asset.id === 'ast_clip')
  assert.equal(clips.length, 1, `one preroll for the pair: ${JSON.stringify(clips.map((t) => [t.item.id, t.slot]))}`)
  assert.equal(clips[0]!.slot, 0)
})

test('the matte frame is the one for the source time the picture shows, through the in-point and speed', async () => {
  const requested: number[] = []
  subjectMattes.useLoader(matteLoader(requested))
  // from 30, in-point 2 s, 2× speed: timeline frame 45 is 15 frames in, so 2 + 0.5 × 2 = 3 s → matte frame 90.
  const at = { from: 30, sourceStartUs: 2_000_000, speed: 2 }
  const { stats } = await draw(scene({ masked: true, base: at }), 45)
  assert.equal(stats.pending, 0)
  assert.deepEqual(requested, [90], `asked for matte frame ${requested.join(', ')}, the frame at 3 s is 90`)
  // Control: the frame without the in-point and speed would have been 15 or 30 — the mapping is what chose 90.
  const plain: number[] = []
  subjectMattes.useLoader(matteLoader(plain))
  await draw(scene({ masked: true, base: { from: 30 } }), 45)
  assert.deepEqual(plain, [15])
})

test('a matte not decoded yet makes the cut-out pending, named, and draws nothing in its place', () => {
  subjectMattes.useLoader(matteLoader())
  const compositor = new Compositor(new CountingPool() as never)
  const out = new SoftCanvas(W, H)
  const stats = compositor.drawFrame(out.getContext() as never, scene({ masked: true }).project, scene({ masked: true }).timeline, 45)
  assert.equal(stats.pending, 1)
  assert.match(stats.pendingNames.join(' '), /talk\.mp4 \(subject matte\)/)
  // Not drawn unmasked: beside the person the title still shows.
  assert.ok(near(out.at(12, 4), TITLE), `the unmasked copy must not be drawn: ${out.at(12, 4)}`)
})

test('no matte for this moment is a named placeholder, never an unmasked copy (with its positive control)', async () => {
  subjectMattes.useLoader(matteLoader())
  const bare = { ...videoAsset(), subjectMattes: undefined }
  const missing = await draw(scene({ masked: true, asset: bare }))
  assert.equal(missing.stats.placeholders, 1)
  assert.match(missing.stats.placeholderNames.join(' '), /no subject matte for .* put_behind_subject/)
  const present = await draw(scene({ masked: true }))
  assert.equal(present.stats.placeholders, 0, 'positive control: with the record, no placeholder')
  // A clip extended past the stretch its matte covers is missing there too, not "the nearest frame".
  const short = { ...videoAsset(), subjectMattes: [{ ...MATTE, toUs: 5_000_000 }] }
  const beyond = await draw(scene({ masked: true, asset: short, base: { sourceStartUs: 8_000_000 } }))
  assert.equal(beyond.stats.placeholders, 1, beyond.stats.placeholderNames.join(' '))
})
