/**
 * One camera over one continuous world.
 *
 * Author every layer in the frame's own layout — the picture as it looks from the *home* camera,
 * which is centred on the frame at zoom 1 — and draw each layer through `layerMatrix(camera)`.
 * A camera is `{ x, y, zoom, rot }`: the world point at the centre of the frame, how much larger
 * than home the focus plane is drawn, and a roll in degrees.
 *
 * Depth is a real pinhole: a layer `depth` behind the focus plane (0 is the focus plane, positive
 * is farther, negative nearer, above −1) moves 1/(1 + depth) as far when the camera pans, and
 * grows more slowly when it pushes in, by the same rule a dolly obeys. Parallax, in other words,
 * comes from one camera rather than from a speed chosen per layer.
 *
 * What a viewer sees move is the screen, not the world: report boxes with `boxToScreen`, and
 * size motion blur from `frameTravel` and `boxTravel`.
 */

import { FRAME, clamp, easeOf, lerp, progress, rng, type Curve, type Frame, type Point } from './core'
import { matApply, matInvert, type Matrix } from './matrix'

export interface Camera {
  x: number
  y: number
  zoom: number
  /** Roll, degrees, clockwise. */
  rot: number
}

export interface CameraKey {
  t: number
  x?: number
  y?: number
  zoom?: number
  rot?: number
  /** The curve of the move that ARRIVES at this key. Default `sineInOut`; `expoInOut` for a snap. */
  curve?: Curve
}

/** The camera that shows the frame's layout as authored. */
export function homeCamera(frame: Frame = FRAME): Camera {
  return { x: frame.w / 2, y: frame.h / 2, zoom: 1, rot: 0 }
}

/**
 * The camera at time `t` from keys in ascending time. A key that leaves a field out keeps the
 * value before it (the first key's missing fields are home's). Position and roll move along the
 * arriving key's curve; zoom is interpolated in log space, so a push from 1× to 8× is a steady
 * approach instead of spending most of its time near 8×. Held at the first key before it and at
 * the last after it.
 */
export function cameraAt(t: number, keys: readonly CameraKey[], options: { frame?: Frame } = {}): Camera {
  let from = homeCamera(options.frame ?? FRAME)
  let fromT = -Infinity
  for (const key of keys) {
    const to: Camera = { x: key.x ?? from.x, y: key.y ?? from.y, zoom: key.zoom ?? from.zoom, rot: key.rot ?? from.rot }
    if (!(to.zoom > 0)) throw new Error(`cameraAt: the key at t=${key.t} has zoom ${to.zoom}; zoom must be above 0`)
    if (t < key.t) {
      // Before the first key there is nothing to move from: hold it.
      if (fromT === -Infinity) return to
      const p = easeOf(key.curve ?? 'sineInOut')(progress(t, fromT, key.t))
      return {
        x: lerp(from.x, to.x, p),
        y: lerp(from.y, to.y, p),
        zoom: Math.exp(lerp(Math.log(from.zoom), Math.log(to.zoom), p)),
        rot: lerp(from.rot, to.rot, p)
      }
    }
    from = to
    fromT = key.t
  }
  return from
}

/**
 * How large a layer at `depth` is drawn, relative to how it was authored. The focus plane (depth
 * 0) is drawn at `zoom`; a far layer grows less than that as the camera pushes in and a near one
 * more. A near layer the camera has reached or passed (1 + depth·zoom ≤ 0) has no size; it is
 * capped at 1000× rather than turning inside out.
 */
export function layerScale(camera: Camera, depth = 0): number {
  if (!(depth > -1)) throw new Error(`depth must be above -1 (0 is the focus plane, positive is farther); got ${depth}`)
  const reach = 1 + depth * camera.zoom
  return reach > (camera.zoom * (1 + depth)) / 1000 ? (camera.zoom * (1 + depth)) / reach : 1000
}

/**
 * The matrix that draws a layer at `depth` through `camera`: layout coordinates in, screen pixels
 * out. `ctx.setTransform(...BM.matCanvas(M, dpr))` on a canvas, or
 * `el.style.transform = BM.matCss(M)` with `transform-origin: 0 0` on a layer positioned at 0,0.
 * The home camera gives the identity at every depth.
 */
export function layerMatrix(camera: Camera, options: { depth?: number; frame?: Frame } = {}): Matrix {
  const frame = options.frame ?? FRAME
  const depth = options.depth ?? 0
  const s = layerScale(camera, depth)
  const cx = frame.w / 2
  const cy = frame.h / 2
  // The layout point this layer shows at the centre of the frame: the camera's offset from home,
  // cut down by the layer's distance.
  const px = cx + (camera.x - cx) / (1 + depth)
  const py = cy + (camera.y - cy) / (1 + depth)
  const r = (-camera.rot * Math.PI) / 180
  const cos = Math.cos(r) * s
  const sin = Math.sin(r) * s
  return [cos, sin, -sin, cos, cx - (cos * px - sin * py), cy - (sin * px + cos * py)]
}

/** A layout point's place on screen, through a `layerMatrix`. */
export function toScreen(matrix: Matrix, x: number, y: number): Point {
  return matApply(matrix, x, y)
}

/** The layout point under a screen pixel, through the same `layerMatrix`: `toScreen` undone. */
export function toWorld(matrix: Matrix, x: number, y: number): Point {
  return matApply(matInvert(matrix), x, y)
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * A layout box as the screen box that bounds it, through a `layerMatrix` — what `__film.track`
 * should return for anything drawn under a camera. Fields other than x, y, w and h (`op`, say)
 * are carried across unchanged. Under a rolled camera the result is the upright box around the
 * rotated one.
 */
export function boxToScreen<T extends Box>(matrix: Matrix, box: T): T {
  const corners = [
    matApply(matrix, box.x, box.y),
    matApply(matrix, box.x + box.w, box.y),
    matApply(matrix, box.x, box.y + box.h),
    matApply(matrix, box.x + box.w, box.y + box.h)
  ]
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { ...box, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** Whether a screen box is on the frame: `'whole'` asks for all of it, otherwise any part will do. */
export function inFrame(box: Box, options: { whole?: boolean; frame?: Frame } = {}): boolean {
  const frame = options.frame ?? FRAME
  if (options.whole) return box.x >= 0 && box.y >= 0 && box.x + box.w <= frame.w && box.y + box.h <= frame.h
  return box.x < frame.w && box.y < frame.h && box.x + box.w > 0 && box.y + box.h > 0
}

export interface ShakeOptions {
  /** The largest offset, px. */
  amp?: number
  /** How fast it dies, per second. */
  decay?: number
  /** Shakes per second. */
  frequency?: number
  /** The largest roll, degrees. */
  rot?: number
  /** Which shake: the same seed, the same shake. */
  seed?: number
}

/**
 * A camera shake from a hit at `tHit`: exactly zero before it, loudest at it, dying away after.
 * Add `x`/`y` to the camera's position (divided by its zoom, to shake by screen pixels) and `rot`
 * to its roll. The same seed gives the same shake every time; give each hit its own seed.
 */
export function shake(t: number, tHit: number, options: ShakeOptions = {}): { x: number; y: number; rot: number } {
  const tau = t - tHit
  if (tau < 0) return { x: 0, y: 0, rot: 0 }
  const amp = options.amp ?? 14
  const w = 2 * Math.PI * (options.frequency ?? 17)
  const random = rng(options.seed ?? 1)
  const env = Math.exp(-(options.decay ?? 7) * tau)
  // Two unrelated frequencies per axis, so the path does not trace a tidy ellipse.
  const wave = (): number => {
    const phase = random() * 2 * Math.PI
    const ratio = 0.55 + random() * 0.35
    return 0.65 * Math.sin(w * tau + phase) + 0.35 * Math.sin(w * ratio * tau + phase * 1.7)
  }
  return { x: amp * env * wave(), y: amp * env * wave(), rot: (options.rot ?? 0.4) * env * wave() }
}

/**
 * The slow float of a camera held by a hand: a few px of drift that never repeats quickly. Scale
 * it to zero in the holds (multiply by an envelope) — a rest should be dead still.
 */
export function handheld(t: number, options: { amp?: number; rot?: number; seed?: number } = {}): { x: number; y: number; rot: number } {
  const amp = options.amp ?? 4
  const random = rng(options.seed ?? 1)
  const wave = (): number => {
    const a = random() * 2 * Math.PI
    const b = random() * 2 * Math.PI
    const f = 0.11 + random() * 0.08
    return 0.6 * Math.sin(2 * Math.PI * f * t + a) + 0.4 * Math.sin(2 * Math.PI * f * 2.3 * t + b)
  }
  return { x: amp * wave(), y: amp * wave(), rot: (options.rot ?? 0.15) * wave() }
}

/**
 * A far grid of dots for a camera move to slide against — on an empty ground a move does not
 * read. Set the layer's transform to `matrix`, then draw a dot of radius `r` at every multiple of
 * `spacing` from `x0` to `x1` and `y0` to `y1` (layout coordinates, already snapped to the grid
 * and covering the whole frame). `r` is chosen so each dot is `dot` px on screen at any zoom.
 */
export function farGrid(
  camera: Camera,
  options: { depth?: number; spacing?: number; dot?: number; frame?: Frame } = {}
): { matrix: Matrix; r: number; spacing: number; x0: number; x1: number; y0: number; y1: number } {
  const frame = options.frame ?? FRAME
  const depth = options.depth ?? 1.2
  const spacing = options.spacing ?? 120
  const matrix = layerMatrix(camera, { depth, frame })
  const inverse = matInvert(matrix)
  const corners = [matApply(inverse, 0, 0), matApply(inverse, frame.w, 0), matApply(inverse, 0, frame.h), matApply(inverse, frame.w, frame.h)]
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  return {
    matrix,
    r: (options.dot ?? 2) / layerScale(camera, depth),
    spacing,
    x0: Math.floor(Math.min(...xs) / spacing) * spacing,
    x1: Math.ceil(Math.max(...xs) / spacing) * spacing,
    y0: Math.floor(Math.min(...ys) / spacing) * spacing,
    y1: Math.ceil(Math.max(...ys) / spacing) * spacing
  }
}

/**
 * How far, in screen px, the camera alone moves the picture between two cameras: the farthest any
 * of the four points at the frame's corners travels. This is the camera's share of a frame's
 * motion — the length of the streak a shutter open from `c0` to `c1` would draw at the edge of
 * frame. Give `mid` (the camera halfway in time) for a move that curves or reverses, and the two
 * legs are added. `depth` measures a layer other than the focus plane.
 */
export function frameTravel(
  c0: Camera,
  c1: Camera,
  options: { mid?: Camera; depth?: number; frame?: Frame } = {}
): number {
  const frame = options.frame ?? FRAME
  const depth = options.depth ?? 0
  const leg = (a: Camera, b: Camera): number => {
    const back = matInvert(layerMatrix(a, { depth, frame }))
    const forward = layerMatrix(b, { depth, frame })
    let far = 0
    for (const [sx, sy] of [[0, 0], [frame.w, 0], [0, frame.h], [frame.w, frame.h]] as const) {
      const [wx, wy] = matApply(back, sx, sy)
      const [nx, ny] = matApply(forward, wx, wy)
      far = Math.max(far, Math.hypot(nx - sx, ny - sy))
    }
    return far
  }
  return options.mid ? leg(c0, options.mid) + leg(options.mid, c1) : leg(c0, c1)
}

/** How far, in px, the farthest corner of a box moves between two of its screen boxes. */
export function boxTravel(a: Box, b: Box): number {
  return Math.max(
    Math.hypot(b.x - a.x, b.y - a.y),
    Math.hypot(b.x + b.w - (a.x + a.w), b.y - a.y),
    Math.hypot(b.x - a.x, b.y + b.h - (a.y + a.h)),
    Math.hypot(b.x + b.w - (a.x + a.w), b.y + b.h - (a.y + a.h))
  )
}

/**
 * How many sub-frame samples to draw for a move of `travel` px in one frame, so neighbouring
 * copies sit no more than `gap` px apart: 1 (no blur needed) for a still frame, capped at `max`.
 */
export function blurSamples(travel: number, options: { gap?: number; max?: number } = {}): number {
  const gap = options.gap ?? 8
  return clamp(Math.ceil(travel / gap), 1, options.max ?? 32)
}
