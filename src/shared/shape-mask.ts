/**
 * Shape masks: a rectangle, an ellipse or a freeform path that says which part of a clip's picture
 * is kept. Several on one clip combine in list order.
 *
 * **Geometry is in the clip's own frame.** `x`, `y`, `width` and `height` are fractions of the
 * clip's uncropped picture — (0.5, 0.5) is its centre, width 1 its whole width — so a mask moves,
 * scales, rotates and animates with the clip: layout, crop, keyframed transforms and a cut-out's
 * borrowed framing all carry it without knowing it exists. `rotation` turns the shape about its
 * own centre in the frame's pixels (so a rotated rectangle stays a rectangle on a 16:9 clip), and
 * `feather` is a width in timeline pixels — the same unit as the subject mask's — measured across
 * the edge.
 *
 * **Coverage is one pure function, and the picture is drawn from it.** `masksCoverage` answers
 * "how much of this point is kept" from exact signed distances; `rasterMasks` evaluates it over a
 * grid of pixels, and the compositor multiplies the picture's alpha by that grid
 * (`engine/shapeMask.ts`). There is no second implementation — no blur filter approximating a
 * feather, no shader to drift — so the numbers `shape-mask.test.ts` pins are the numbers on screen.
 *
 * The feather is a real ramp: coverage is 1 at `feather / 2` inside the edge, 0 at `feather / 2`
 * outside it, 0.5 on the edge, and falls monotonically (a smoothstep) between. With no feather the
 * ramp is one output pixel wide, which is the edge's antialiasing.
 *
 * Every parameter is a plain number, so each can take keyframes later. Nothing here animates.
 */

/** How a mask joins the ones before it in the list. Absent is `add`. */
export type MaskCombine = 'add' | 'subtract' | 'intersect'

export const MASK_COMBINES: readonly MaskCombine[] = ['add', 'subtract', 'intersect']

interface ShapeMaskBase {
  /** Centre, as a fraction of the clip's frame: 0 is its left/top edge, 1 its right/bottom. */
  x: number
  y: number
  /** Size, as a fraction of the clip's frame width and height. */
  width: number
  height: number
  /** Degrees clockwise about the mask's own centre. Absent or 0: upright. */
  rotation?: number
  /** Width of the soft edge in timeline pixels, centred on the shape's edge. Absent or 0: a hard edge. */
  feather?: number
  /** Keep everything *except* the shape. */
  invert?: boolean
  /** How strongly this mask counts, 0..1. Absent is 1. */
  opacity?: number
  /** How this mask joins the ones before it. Absent is `add`. */
  combine?: MaskCombine
}

export interface RectMask extends ShapeMaskBase {
  kind: 'rect'
  /** Corner rounding, 0 (square corners) to 1 (the shorter side is a full half-circle). Absent is 0. */
  radius?: number
}

export interface EllipseMask extends ShapeMaskBase {
  kind: 'ellipse'
}

/**
 * A point of a freeform path, inside the mask's own box: (0, 0) is the box's top-left, (1, 1) its
 * bottom-right. `in*`/`out*` are bezier handles as offsets from the point in the same units; a
 * segment whose two ends have no handles facing it is a straight line.
 */
export interface PathPoint {
  x: number
  y: number
  inX?: number
  inY?: number
  outX?: number
  outY?: number
}

export interface PathMask extends ShapeMaskBase {
  kind: 'path'
  /** The closed outline, in order. The last point joins the first. */
  points: PathPoint[]
}

export type ShapeMask = RectMask | EllipseMask | PathMask

export const SHAPE_MASK_KINDS = ['rect', 'ellipse', 'path'] as const

/** The most shape masks one clip may carry. Each is evaluated per pixel of the clip. */
export const MAX_SHAPE_MASKS = 8
/** The widest feather, in timeline pixels. */
export const MAX_SHAPE_FEATHER = 1000
export const MIN_PATH_POINTS = 3
export const MAX_PATH_POINTS = 64
/** The legal range of each number, which the validator's errors quote. */
export const SHAPE_MASK_RANGES = {
  x: [-2, 3],
  y: [-2, 3],
  width: [0.001, 8],
  height: [0.001, 8],
  rotation: [-3600, 3600],
  feather: [0, MAX_SHAPE_FEATHER],
  opacity: [0, 1],
  radius: [0, 1],
  point: [-4, 5],
  handle: [-4, 4]
} as const satisfies Record<string, readonly [number, number]>

export function isShapeMask(mask: { kind: string } | null | undefined): mask is ShapeMask {
  return !!mask && (SHAPE_MASK_KINDS as readonly string[]).includes(mask.kind)
}

/** A new mask of a kind, centred on the clip, covering the middle half of it. */
export function defaultShapeMask(kind: ShapeMask['kind']): ShapeMask {
  const base = { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
  if (kind === 'rect') return { kind, ...base }
  if (kind === 'ellipse') return { kind, ...base }
  // A diamond: four straight sides, a point on each edge of the box, ready to be dragged.
  return { kind, ...base, points: [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }] }
}

// ---------------------------------------------------------------------------
// Validation, for tools and the loader
// ---------------------------------------------------------------------------

type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

const BASE_KEYS = ['kind', 'x', 'y', 'width', 'height', 'rotation', 'feather', 'invert', 'opacity', 'combine'] as const
const POINT_KEYS = ['x', 'y', 'inX', 'inY', 'outX', 'outY'] as const

function inRange(value: unknown, [low, high]: readonly [number, number]): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high
}

const EXAMPLE = '{ "kind": "ellipse", "x": 0.5, "y": 0.5, "width": 0.6, "height": 0.8, "feather": 40 }'

/**
 * One shape mask as a tool or file gave it, checked. `path` is how the error names it
 * (`masks[1]`). The result is canonical: defaults are stored as absence, so a mask set to its
 * defaults and one never touched are the same bytes.
 */
export function checkShapeMask(raw: unknown, path: string): Checked<ShapeMask> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: `${path} must be an object like ${EXAMPLE}` }
  const m = raw as Record<string, unknown>
  const kind = m.kind
  if (kind !== 'rect' && kind !== 'ellipse' && kind !== 'path') {
    return { ok: false, error: `${path}.kind must be "rect", "ellipse", "path" or "subject"; got ${JSON.stringify(kind)}` }
  }
  const allowed: readonly string[] = [...BASE_KEYS, ...(kind === 'rect' ? ['radius'] : kind === 'path' ? ['points'] : [])]
  const extra = Object.keys(m).filter((key) => !allowed.includes(key))
  if (extra.length > 0) {
    return { ok: false, error: `${path} has no field "${extra[0]}". A ${kind} mask accepts ${allowed.filter((k) => k !== 'kind').join(', ')}.` }
  }
  const R = SHAPE_MASK_RANGES
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (!inRange(m[key], R[key])) {
      const what = key === 'x' || key === 'y' ? 'the centre, as a fraction of the clip\'s frame (0.5 is the middle)' : `a fraction of the clip's frame ${key} (1 is all of it)`
      return { ok: false, error: `${path}.${key} must be a number from ${R[key][0]} to ${R[key][1]} — ${what}; got ${JSON.stringify(m[key])}` }
    }
  }
  const base = { x: m.x as number, y: m.y as number, width: m.width as number, height: m.height as number }
  let mask: ShapeMask
  if (kind === 'path') {
    const points = m.points
    if (!Array.isArray(points) || points.length < MIN_PATH_POINTS || points.length > MAX_PATH_POINTS) {
      return {
        ok: false,
        error:
          `${path}.points must be a list of ${MIN_PATH_POINTS} to ${MAX_PATH_POINTS} points like { "x": 0.5, "y": 0 }, each inside the mask's own box ` +
          `(0,0 its top-left, 1,1 its bottom-right); got ${Array.isArray(points) ? `${points.length} points` : JSON.stringify(points)}`
      }
    }
    const out: PathPoint[] = []
    for (const [i, rawPoint] of points.entries()) {
      if (!rawPoint || typeof rawPoint !== 'object' || Array.isArray(rawPoint)) return { ok: false, error: `${path}.points[${i}] must be an object like { "x": 0.5, "y": 0 }` }
      const p = rawPoint as Record<string, unknown>
      const unknown = Object.keys(p).filter((key) => !(POINT_KEYS as readonly string[]).includes(key))
      if (unknown.length > 0) return { ok: false, error: `${path}.points[${i}] has no field "${unknown[0]}". A point accepts ${POINT_KEYS.join(', ')}.` }
      for (const key of ['x', 'y'] as const) {
        if (!inRange(p[key], R.point)) return { ok: false, error: `${path}.points[${i}].${key} must be a number from ${R.point[0]} to ${R.point[1]} (0..1 is inside the mask's box); got ${JSON.stringify(p[key])}` }
      }
      const point: PathPoint = { x: p.x as number, y: p.y as number }
      for (const key of ['inX', 'inY', 'outX', 'outY'] as const) {
        if (p[key] === undefined) continue
        if (!inRange(p[key], R.handle)) return { ok: false, error: `${path}.points[${i}].${key} must be a number from ${R.handle[0]} to ${R.handle[1]} — a bezier handle as an offset from the point; got ${JSON.stringify(p[key])}` }
        if (p[key] !== 0) point[key] = p[key] as number
      }
      out.push(point)
    }
    mask = { kind, ...base, points: out }
  } else if (kind === 'rect') {
    mask = { kind, ...base }
    if (m.radius !== undefined) {
      if (!inRange(m.radius, R.radius)) return { ok: false, error: `${path}.radius must be a number from 0 (square corners) to 1 (fully round ends); got ${JSON.stringify(m.radius)}` }
      if (m.radius > 0) mask.radius = m.radius
    }
  } else {
    mask = { kind, ...base }
  }
  if (m.rotation !== undefined) {
    if (!inRange(m.rotation, R.rotation)) return { ok: false, error: `${path}.rotation must be a number of degrees from ${R.rotation[0]} to ${R.rotation[1]}; got ${JSON.stringify(m.rotation)}` }
    if (m.rotation !== 0) mask.rotation = m.rotation
  }
  if (m.feather !== undefined) {
    if (!inRange(m.feather, R.feather)) return { ok: false, error: `${path}.feather must be a number of timeline pixels from 0 to ${MAX_SHAPE_FEATHER} — the width of the soft edge; got ${JSON.stringify(m.feather)}` }
    if (m.feather > 0) mask.feather = m.feather
  }
  if (m.invert !== undefined) {
    if (typeof m.invert !== 'boolean') return { ok: false, error: `${path}.invert must be true or false; got ${JSON.stringify(m.invert)}` }
    if (m.invert) mask.invert = true
  }
  if (m.opacity !== undefined) {
    if (!inRange(m.opacity, R.opacity)) return { ok: false, error: `${path}.opacity must be a number from 0 to 1; got ${JSON.stringify(m.opacity)}` }
    if (m.opacity !== 1) mask.opacity = m.opacity
  }
  if (m.combine !== undefined) {
    if (!(MASK_COMBINES as readonly unknown[]).includes(m.combine)) return { ok: false, error: `${path}.combine must be "add", "subtract" or "intersect"; got ${JSON.stringify(m.combine)}` }
    if (m.combine !== 'add') mask.combine = m.combine as MaskCombine
  }
  return { ok: true, value: mask }
}

// ---------------------------------------------------------------------------
// Distance: how far a point is from a shape's edge
// ---------------------------------------------------------------------------

/** The clip's frame in pixels — its layout box. Masks are fractions of it. */
export interface MaskFrame {
  width: number
  height: number
}

/** A mask with its trigonometry and outline worked out once, for evaluating many points. */
export interface PreparedShape {
  mask: ShapeMask
  cx: number
  cy: number
  /** Half the shape's size, in frame pixels. */
  hx: number
  hy: number
  cos: number
  sin: number
  /** Corner radius in frame pixels (rect). */
  radius: number
  /** The flattened outline in the shape's own unrotated pixels, x then y, closed implicitly (path). */
  polygon: Float64Array | null
}

/** Straight pieces per curved segment of a path. */
const BEZIER_STEPS = 16

export function prepareShape(mask: ShapeMask, frame: MaskFrame): PreparedShape {
  const w = Math.abs(mask.width) * frame.width
  const h = Math.abs(mask.height) * frame.height
  const angle = ((mask.rotation ?? 0) * Math.PI) / 180
  const prepared: PreparedShape = {
    mask,
    cx: mask.x * frame.width,
    cy: mask.y * frame.height,
    hx: w / 2,
    hy: h / 2,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
    radius: mask.kind === 'rect' ? Math.min(1, Math.max(0, mask.radius ?? 0)) * Math.min(w, h) / 2 : 0,
    polygon: null
  }
  if (mask.kind === 'path') prepared.polygon = flattenPath(mask.points, w, h)
  return prepared
}

/** The outline as straight pieces, in pixels about the box's centre. */
export function flattenPath(points: readonly PathPoint[], width: number, height: number): Float64Array {
  const out: number[] = []
  const n = points.length
  const px = (v: number): number => (v - 0.5) * width
  const py = (v: number): number => (v - 0.5) * height
  for (let i = 0; i < n; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    const ox = a.outX ?? 0
    const oy = a.outY ?? 0
    const ix = b.inX ?? 0
    const iy = b.inY ?? 0
    out.push(px(a.x), py(a.y))
    if (ox === 0 && oy === 0 && ix === 0 && iy === 0) continue
    const x0 = px(a.x), y0 = py(a.y)
    const x1 = px(a.x + ox), y1 = py(a.y + oy)
    const x2 = px(b.x + ix), y2 = py(b.y + iy)
    const x3 = px(b.x), y3 = py(b.y)
    for (let s = 1; s < BEZIER_STEPS; s += 1) {
      const t = s / BEZIER_STEPS
      const u = 1 - t
      const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t
      out.push(k0 * x0 + k1 * x1 + k2 * x2 + k3 * x3, k0 * y0 + k1 * y1 + k2 * y2 + k3 * y3)
    }
  }
  return Float64Array.from(out)
}

function rectDistance(x: number, y: number, hx: number, hy: number, radius: number): number {
  const qx = Math.abs(x) - (hx - radius)
  const qy = Math.abs(y) - (hy - radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - radius
}

/**
 * Exact distance to an ellipse's edge. There is no closed form short enough to trust, so this
 * walks to the nearest point on the curve: from a guess on the ellipse, take the centre of
 * curvature there, aim from it at the query point, and step along the curve by that arc. Four
 * steps land within a thousandth of a pixel for the shapes a mask can be (the test compares it
 * with a dense search of the outline).
 */
function ellipseDistance(x: number, y: number, a: number, b: number): number {
  const px = Math.abs(x)
  const py = Math.abs(y)
  if (a <= 0 || b <= 0) return Math.hypot(px, py)
  if (Math.abs(a - b) < 1e-9) return Math.hypot(px, py) - a
  let tx = Math.SQRT1_2
  let ty = Math.SQRT1_2
  for (let i = 0; i < 4; i += 1) {
    const ex = ((a * a - b * b) * tx * tx * tx) / a
    const ey = ((b * b - a * a) * ty * ty * ty) / b
    const rx = a * tx - ex
    const ry = b * ty - ey
    const qx = px - ex
    const qy = py - ey
    const r = Math.hypot(rx, ry)
    const q = Math.hypot(qx, qy)
    if (q === 0) break
    tx = Math.min(1, Math.max(0, ((qx * r) / q + ex) / a))
    ty = Math.min(1, Math.max(0, ((qy * r) / q + ey) / b))
    const t = Math.hypot(tx, ty)
    if (t === 0) break
    tx /= t
    ty /= t
  }
  const distance = Math.hypot(px - a * tx, py - b * ty)
  const inside = (px * px) / (a * a) + (py * py) / (b * b) < 1
  return inside ? -distance : distance
}

/** Distance to a closed polygon, negative inside (even-odd: a self-crossing outline has holes). */
function polygonDistance(x: number, y: number, polygon: Float64Array): number {
  const n = polygon.length / 2
  let best = Number.POSITIVE_INFINITY
  let inside = false
  let ax = polygon[(n - 1) * 2]!
  let ay = polygon[(n - 1) * 2 + 1]!
  for (let i = 0; i < n; i += 1) {
    const bx = polygon[i * 2]!
    const by = polygon[i * 2 + 1]!
    const ex = bx - ax
    const ey = by - ay
    const wx = x - ax
    const wy = y - ay
    const length2 = ex * ex + ey * ey
    const t = length2 > 0 ? Math.min(1, Math.max(0, (wx * ex + wy * ey) / length2)) : 0
    const dx = wx - ex * t
    const dy = wy - ey * t
    const d2 = dx * dx + dy * dy
    if (d2 < best) best = d2
    if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * ex) inside = !inside
    ax = bx
    ay = by
  }
  const distance = Math.sqrt(best)
  return inside ? -distance : distance
}

/** Signed distance from a point (frame pixels) to the shape's edge: negative inside, positive outside. */
export function preparedDistance(shape: PreparedShape, px: number, py: number): number {
  const dx = px - shape.cx
  const dy = py - shape.cy
  // Into the shape's own unrotated axes.
  const x = dx * shape.cos + dy * shape.sin
  const y = dy * shape.cos - dx * shape.sin
  if (shape.mask.kind === 'rect') return rectDistance(x, y, shape.hx, shape.hy, shape.radius)
  if (shape.mask.kind === 'ellipse') return ellipseDistance(x, y, shape.hx, shape.hy)
  return shape.polygon && shape.polygon.length >= 6 ? polygonDistance(x, y, shape.polygon) : Number.POSITIVE_INFINITY
}

export function shapeDistance(mask: ShapeMask, px: number, py: number, frame: MaskFrame): number {
  return preparedDistance(prepareShape(mask, frame), px, py)
}

// ---------------------------------------------------------------------------
// Coverage: how much of a point is kept
// ---------------------------------------------------------------------------

/**
 * The edge's falloff: 1 at `ramp / 2` inside the edge (distance ≤ −ramp/2), 0 at `ramp / 2` outside,
 * 0.5 on it, a smoothstep between — monotonic, with no kink at either end. A ramp of 0 is a step.
 */
export function rampCoverage(distance: number, ramp: number): number {
  if (!(ramp > 0)) return distance < 0 ? 1 : 0
  const t = 0.5 - distance / ramp
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t * t * (3 - 2 * t)
}

/** The ramp a mask draws with: its feather, or one output pixel (`pixel`, in frame pixels) of antialiasing. */
export function rampWidth(mask: ShapeMask, pixel: number): number {
  const feather = mask.feather !== undefined && Number.isFinite(mask.feather) ? Math.min(MAX_SHAPE_FEATHER, Math.max(0, mask.feather)) : 0
  return Math.max(feather, pixel > 0 ? pixel : 0)
}

/** What one mask keeps of a point at `distance` from its edge: the ramp, inverted if asked, times its opacity. */
export function coverageAt(mask: ShapeMask, distance: number, pixel: number): number {
  const inside = rampCoverage(distance, rampWidth(mask, pixel))
  const opacity = mask.opacity === undefined || !Number.isFinite(mask.opacity) ? 1 : Math.min(1, Math.max(0, mask.opacity))
  return (mask.invert ? 1 - inside : inside) * opacity
}

/** One mask's own coverage of a point in frame pixels. `pixel` is the size of an output pixel there (0: none). */
export function shapeCoverage(mask: ShapeMask, px: number, py: number, frame: MaskFrame, pixel = 0): number {
  return coverageAt(mask, shapeDistance(mask, px, py, frame), pixel)
}

/**
 * Where a list starts before its first mask: nothing kept when the first mask adds (the usual
 * case — the shape is what shows), everything kept when it subtracts or intersects, so a lone
 * `subtract` cuts a hole and a lone `intersect` is the shape.
 */
export function initialCoverage(masks: readonly ShapeMask[]): number {
  const first = masks[0]
  return first && (first.combine === 'subtract' || first.combine === 'intersect') ? 1 : 0
}

/**
 * Joining a mask's coverage `c` to what the list has so far, `acc`: add is a union
 * (1 − (1−acc)(1−c)), subtract removes (acc·(1−c)), intersect keeps the overlap (acc·c). All three
 * stay in 0..1 and are exact at the corners: 0 and 1 behave as sets do.
 */
export function combineCoverage(acc: number, c: number, mode: MaskCombine | undefined): number {
  if (mode === 'subtract') return acc * (1 - c)
  if (mode === 'intersect') return acc * c
  return acc + c - acc * c
}

/** What a list of masks keeps of a point, in list order. An empty list keeps everything. */
export function masksCoverage(masks: readonly ShapeMask[], px: number, py: number, frame: MaskFrame, pixel = 0): number {
  if (masks.length === 0) return 1
  let acc = initialCoverage(masks)
  for (const mask of masks) acc = combineCoverage(acc, shapeCoverage(mask, px, py, frame, pixel), mask.combine)
  return acc
}

// ---------------------------------------------------------------------------
// Raster: coverage over a grid of output pixels
// ---------------------------------------------------------------------------

/**
 * Which part of the frame a grid of output pixels shows. Pixel (i, j)'s centre is at frame point
 * (`originX + (i + 0.5)·stepX`, `originY + (j + 0.5)·stepY`). An uncropped clip drawn at its box
 * size is origin 0, step 1; a crop moves the origin, a zoom or a smaller preview changes the step.
 */
export interface MaskView {
  width: number
  height: number
  originX: number
  originY: number
  stepX: number
  stepY: number
}

/** Pixels per side of the squares the raster settles in one go when no edge passes near them. */
const BLOCK = 16

/**
 * Coverage of every pixel of `view`, 0..255, row by row — `masksCoverage` at each pixel centre,
 * with an output pixel's size as the antialiasing ramp.
 *
 * Whole 16-pixel squares are filled from one evaluation when no mask's ramp can reach them: a
 * signed distance changes by at most the distance moved, so if a square's centre is further from
 * every edge than half that mask's ramp plus the square's half-diagonal, every pixel in it has the
 * centre's coverage. That is an optimisation with one observable — the result — and the test
 * holds it equal to the pixel-by-pixel answer (`exact: true`).
 */
export function rasterMasks(masks: readonly ShapeMask[], frame: MaskFrame, view: MaskView, options: { exact?: boolean } = {}): Uint8ClampedArray {
  const width = Math.max(1, Math.round(view.width))
  const height = Math.max(1, Math.round(view.height))
  const out = new Uint8ClampedArray(width * height)
  if (masks.length === 0) {
    out.fill(255)
    return out
  }
  const shapes = masks.map((mask) => prepareShape(mask, frame))
  const pixel = Math.max(Math.abs(view.stepX), Math.abs(view.stepY))
  const ramps = masks.map((mask) => rampWidth(mask, pixel))
  const start = initialCoverage(masks)
  const at = (x: number, y: number): number => {
    let acc = start
    for (let k = 0; k < shapes.length; k += 1) {
      const mask = masks[k]!
      acc = combineCoverage(acc, coverageAt(mask, preparedDistance(shapes[k]!, x, y), pixel), mask.combine)
    }
    return acc * 255
  }
  for (let by = 0; by < height; by += BLOCK) {
    const bh = Math.min(BLOCK, height - by)
    for (let bx = 0; bx < width; bx += BLOCK) {
      const bw = Math.min(BLOCK, width - bx)
      let settled = !options.exact
      if (settled) {
        const centreX = view.originX + (bx + bw / 2) * view.stepX
        const centreY = view.originY + (by + bh / 2) * view.stepY
        // Half the square's diagonal in frame pixels, with a little slack for the ellipse's last thousandth.
        const reach = Math.hypot((bw / 2) * view.stepX, (bh / 2) * view.stepY) + 0.01
        for (let k = 0; k < shapes.length; k += 1) {
          if (Math.abs(preparedDistance(shapes[k]!, centreX, centreY)) < ramps[k]! / 2 + reach) {
            settled = false
            break
          }
        }
        if (settled) {
          const value = at(centreX, centreY)
          for (let j = 0; j < bh; j += 1) out.fill(value, (by + j) * width + bx, (by + j) * width + bx + bw)
        }
      }
      if (settled) continue
      for (let j = 0; j < bh; j += 1) {
        const y = view.originY + (by + j + 0.5) * view.stepY
        const row = (by + j) * width
        for (let i = 0; i < bw; i += 1) out[row + bx + i] = at(view.originX + (bx + i + 0.5) * view.stepX, y)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Geometry for the handles on the viewer
// ---------------------------------------------------------------------------

/** A point of the mask's own box (0..1 each way) as a point of the clip's frame, in frame pixels. */
export function maskPointToFrame(mask: ShapeMask, u: number, v: number, frame: MaskFrame): { x: number; y: number } {
  const lx = (u - 0.5) * mask.width * frame.width
  const ly = (v - 0.5) * mask.height * frame.height
  const angle = ((mask.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: mask.x * frame.width + lx * cos - ly * sin, y: mask.y * frame.height + lx * sin + ly * cos }
}

/** The inverse: a frame point as a point of the mask's own box. */
export function framePointToMask(mask: ShapeMask, x: number, y: number, frame: MaskFrame): { u: number; v: number } {
  const dx = x - mask.x * frame.width
  const dy = y - mask.y * frame.height
  const angle = ((mask.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const lx = dx * cos + dy * sin
  const ly = dy * cos - dx * sin
  const w = mask.width * frame.width
  const h = mask.height * frame.height
  return { u: w !== 0 ? lx / w + 0.5 : 0.5, v: h !== 0 ? ly / h + 0.5 : 0.5 }
}
