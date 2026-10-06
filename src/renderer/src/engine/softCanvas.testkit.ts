/**
 * A software 2D canvas for engine tests: enough of `CanvasRenderingContext2D` for the compositor
 * to draw a frame into, as premultiplied float pixels a test can read back. So a test asserts on
 * colours at positions — what was composited — not on a list of calls.
 *
 * Deliberately small. Sampling is nearest-neighbour and transforms are scale and translate only
 * (`rotate` is a no-op), so specimens stay upright; compositing covers the operations the
 * compositor's mask and adjustment paths use. Not a test file itself (`*.testkit.ts`), so the
 * runner does not execute it.
 *
 * `installCanvasGlobals()` puts `OffscreenCanvas` and the media element classes on `globalThis`
 * for the engine modules, which read them at call time — call it before importing the compositor.
 */

export type Op = 'source-over' | 'destination-in' | 'destination-out' | 'copy' | 'lighter'

export type Rgba = [number, number, number, number]

export class SoftCanvas {
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
  at(x: number, y: number): Rgba {
    const o = (y * this.width + x) * 4
    const a = this.px[o + 3]!
    if (a <= 0) return [0, 0, 0, 0]
    return [Math.round((this.px[o]! / a) * 255), Math.round((this.px[o + 1]! / a) * 255), Math.round((this.px[o + 2]! / a) * 255), Math.round(a * 255)]
  }
  /** Premultiplied 0..1 floats at a pixel — for comparisons finer than a byte. */
  raw(x: number, y: number): Rgba {
    const o = (y * this.width + x) * 4
    return [this.px[o]!, this.px[o + 1]!, this.px[o + 2]!, this.px[o + 3]!]
  }
  static solid(width: number, height: number, paint: (x: number, y: number) => readonly number[]): SoftCanvas {
    const c = new SoftCanvas(width, height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [r, g, b, a] = paint(x, y) as Rgba
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

function parseColour(fill: string): Rgba {
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

/**
 * How a CSS filter string changes a premultiplied pixel, for the two filters the tests use:
 * `invert(1)` and `brightness(k)`. Anything else is drawn unfiltered, and recorded in `filters`.
 */
function filtered(filter: string, s: Rgba): Rgba {
  if (filter === 'none') return s
  let [r, g, b] = s
  const a = s[3]
  for (const part of filter.split(' ')) {
    const m = /^(invert|brightness)\(([\d.]+)\)$/.exec(part)
    if (!m) continue
    const k = Number(m[2])
    if (m[1] === 'invert') {
      r = r * (1 - k) + (a - r) * k
      g = g * (1 - k) + (a - g) * k
      b = b * (1 - k) + (a - b) * k
    } else {
      r = Math.min(a, r * k)
      g = Math.min(a, g * k)
      b = Math.min(a, b * k)
    }
  }
  return [r, g, b, a]
}

export class SoftContext {
  readonly canvas: SoftCanvas
  #s: State = { alpha: 1, op: 'source-over', t: [1, 0, 0, 1, 0, 0], fill: '#000000', filter: 'none' }
  readonly #stack: State[] = []
  /** Every drawImage source, in order — which element a draw read. */
  readonly sources: unknown[] = []
  /** Every filter set, in order. */
  readonly filters: string[] = []
  strokeStyle = ''
  lineWidth = 1
  font = ''
  textAlign = ''
  textBaseline = ''
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
  set filter(v: string) { this.#s.filter = v; this.filters.push(v) }
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
  arc(): void {}
  clip(): void {}
  strokeRect(): void {}
  fillText(): void {}
  strokeText(): void {}
  measureText(): { width: number } { return { width: 10 } }

  createImageData(width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(width * height * 4), width, height }
  }
  /** Straight RGBA bytes written as they are, ignoring transform, alpha and compositing — as the platform does. */
  putImageData(image: { data: Uint8ClampedArray; width?: number }, x: number, y: number): void {
    const width = image.width ?? this.canvas.width
    const height = image.data.length / 4 / width
    for (let j = 0; j < height; j += 1) {
      for (let i = 0; i < width; i += 1) {
        const px = x + i
        const py = y + j
        if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) continue
        const s = (j * width + i) * 4
        const o = (py * this.canvas.width + px) * 4
        const a = image.data[s + 3]! / 255
        this.canvas.px[o] = (image.data[s]! / 255) * a
        this.canvas.px[o + 1] = (image.data[s + 1]! / 255) * a
        this.canvas.px[o + 2] = (image.data[s + 2]! / 255) * a
        this.canvas.px[o + 3] = a
      }
    }
  }

  #blend(o: number, source: Rgba): void {
    const px = this.canvas.px
    const a = this.#s.alpha
    const s = filtered(this.#s.filter, source)
    const sr = s[0] * a, sg = s[1] * a, sb = s[2] * a, sa = s[3] * a
    const dr = px[o]!, dg = px[o + 1]!, db = px[o + 2]!, da = px[o + 3]!
    switch (this.#s.op) {
      case 'copy':
        px[o] = sr; px[o + 1] = sg; px[o + 2] = sb; px[o + 3] = sa; break
      case 'destination-in':
        px[o] = dr * sa; px[o + 1] = dg * sa; px[o + 2] = db * sa; px[o + 3] = da * sa; break
      case 'destination-out':
        px[o] = dr * (1 - sa); px[o + 1] = dg * (1 - sa); px[o + 2] = db * (1 - sa); px[o + 3] = da * (1 - sa); break
      case 'lighter':
        px[o] = Math.min(1, sr + dr); px[o + 1] = Math.min(1, sg + dg); px[o + 2] = Math.min(1, sb + db); px[o + 3] = Math.min(1, sa + da); break
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
    // Read before writing: a canvas drawn onto itself must sample what it held, not what it is becoming.
    const from = img === this.canvas ? img.px.slice() : img.px
    this.#cover(dx, dy, dw, dh, (o, u, v) => {
      const ix = Math.min(img.width - 1, Math.max(0, Math.floor(sx + u * sw)))
      const iy = Math.min(img.height - 1, Math.max(0, Math.floor(sy + v * sh)))
      const i = (iy * img.width + ix) * 4
      this.#blend(o, [from[i]!, from[i + 1]!, from[i + 2]!, from[i + 3]!])
    })
  }
}

/** A software canvas whose `width`/`height` setters clear it, as a real canvas's do. */
export function makeSoft(width: number, height: number): SoftCanvas {
  const canvas = new SoftCanvas(width, height)
  let w = width, h = height
  Object.defineProperty(canvas, 'width', { get: () => w, set: (v: number) => { w = v; canvas.resize() } })
  Object.defineProperty(canvas, 'height', { get: () => h, set: (v: number) => { h = v; canvas.resize() } })
  return canvas
}

export class FakeVideo {
  paused = true
  seeking = false
  readyState = 4
  playbackRate = 1
  #time = 0
  readonly pixels: SoftCanvas
  constructor(pixels: SoftCanvas) {
    this.pixels = pixels
  }
  get videoWidth(): number { return this.pixels.width }
  get videoHeight(): number { return this.pixels.height }
  get currentTime(): number { return this.#time }
  set currentTime(value: number) { this.#time = value }
  play(): Promise<void> { this.paused = false; return Promise.resolve() }
  pause(): void { this.paused = true }
}

export class FakeImage {
  complete = true
  readonly pixels: SoftCanvas
  constructor(pixels: SoftCanvas) {
    this.pixels = pixels
  }
  get naturalWidth(): number { return this.pixels.width }
  get naturalHeight(): number { return this.pixels.height }
}

/** The pool surface the compositor uses: one fake element per (asset, slot), painted by `pixels`. */
export class FakePool {
  readonly entries = new Map<string, { assetId: string; slot: number; kind: string; element: unknown; status: string }>()
  readonly used = new Set<string>()
  readonly #pixels: (assetId: string) => SoftCanvas
  constructor(pixels: (assetId: string) => SoftCanvas) {
    this.#pixels = pixels
  }
  beginGeneration(): void { this.used.clear() }
  acquire(asset: { id: string; kind: string }, slot = 0): { assetId: string; slot: number; kind: string; element: unknown; status: string } {
    const key = `${asset.id}#${slot}`
    this.used.add(key)
    let entry = this.entries.get(key)
    if (!entry) {
      const pixels = this.#pixels(asset.id)
      entry = { assetId: asset.id, slot, kind: asset.kind, element: asset.kind === 'image' ? new FakeImage(pixels) : new FakeVideo(pixels), status: 'ready' }
      this.entries.set(key, entry)
    }
    return entry
  }
  inUse(assetId: string, slot = 0): boolean { return this.used.has(`${assetId}#${slot}`) }
}

export function installCanvasGlobals(): void {
  const g = globalThis as Record<string, unknown>
  g.OffscreenCanvas = function OffscreenCanvas(w: number, h: number) {
    return makeSoft(w, h)
  }
  g.HTMLVideoElement = FakeVideo
  g.HTMLImageElement = FakeImage
  g.HTMLMediaElement = { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 }
}
