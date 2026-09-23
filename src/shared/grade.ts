/**
 * A per-clip colour grade: the model, and every piece of its arithmetic that does not need a GPU.
 *
 * **Why this exists beside `Adjustments`.** Those are CSS filters, and a CSS filter cannot express
 * lift/gamma/gain, a curve, a LUT, grain or halation. A grade is drawn by a WebGL pass inside the
 * compositor (`renderer/src/engine/grade.ts`), so preview, `preview_frame` and export still share
 * one path: the compositor is the only thing that draws, and it is the only thing that grades.
 *
 * What lives here is what the shader is *given*: the resolved numbers, the curve lookup table, the
 * white-balance gains and the grain hash. Each is pure so it can be tested without a window, and
 * each is computed once per draw on the CPU rather than re-derived per pixel.
 *
 * **Every field is optional and absence is the identity**, so an item written before grades
 * existed is an item with no grade, and a `.bay` file gains nothing it did not ask for. That is
 * the additive rule (CLAUDE.md, "The .bay format changes additively").
 *
 * **Identity must skip the pass entirely** — {@link resolveGrade} returns `null` — for the same
 * reason `adjustmentFilter` returns `'none'` rather than `brightness(1)`: a clip carrying an
 * all-default grade would otherwise pay a GPU upload and a copy per frame for a picture nobody
 * can tell apart from the ungraded one.
 */

/** An RGB offset — how a colour wheel is stored. 0 on every channel is the identity. */
export interface GradeWheel {
  r: number
  g: number
  b: number
}

/** `[input, output]`, both 0..1. */
export type CurvePoint = [number, number]

/**
 * Curves, applied per channel first and then master — ffmpeg's `curves` order, so a grade
 * written as an ffmpeg filter ports across by copying its points.
 */
export interface GradeCurves {
  master?: CurvePoint[]
  r?: CurvePoint[]
  g?: CurvePoint[]
  b?: CurvePoint[]
}

/** A 3D LUT, by reference to a `kind: 'lut'` asset, mixed in at `intensity`. */
export interface GradeLut {
  assetId: string
  /** 0..1. 0 is off, 1 is the LUT's full effect. */
  intensity: number
}

export interface GradeGrain {
  /** 0..1. Around 0.15 is a fine 35mm grain at 1080 wide; 0 is off. */
  amount: number
  /** Grain cell size in timeline pixels. 1 is finest. */
  size: number
}

export interface GradeHalation {
  /** 0..1 — how bright a pixel must be before it glows. Keep high so skin never qualifies. */
  threshold: number
  /** Blur radius (Gaussian sigma) in timeline pixels. */
  radius: number
  /** 0..1 — opacity of the screened glow. 0 is off. */
  amount: number
  /** The glow's tint, hex. Warm red-amber by default — the colour film's halation actually is. */
  color?: string
}

export interface GradeVignette {
  /** 0..1 — how dark the corners go. 0 is off. */
  amount: number
}

/**
 * A clip's grade. Order of operations, fixed and documented because order changes the picture:
 *
 *     white balance (temperature, tint; in linear light)
 *   → lift / gamma / gain
 *   → saturation
 *   → curves (channels, then master)
 *   → LUT (mixed at intensity)
 *   → halation (screened in RGB)
 *   → vignette
 *   → grain (last, so nothing downstream smooths or tints it)
 */
export interface Grade {
  /** Added to the shadows, fading to nothing at white. Around ±0.05 is a visible move. */
  lift?: GradeWheel
  /** Bends the mids: +0.1 brightens them, −0.1 darkens. Black and white stay put. */
  gamma?: GradeWheel
  /** Multiplies: +0.1 is 10% brighter on that channel. */
  gain?: GradeWheel
  /** Kelvin shift, relative to D65. +200 is ~200 K warmer. */
  temperature?: number
  /** −1..1. Positive is magenta, negative is green. */
  tint?: number
  /** 1 is unchanged, 0 is monochrome. */
  saturation?: number
  curves?: GradeCurves
  lut?: GradeLut
  grain?: GradeGrain
  halation?: GradeHalation
  vignette?: GradeVignette
}

/** A parsed `.cube` 3D LUT, as the renderer receives it on a `kind: 'lut'` asset. */
export interface LutData {
  /** Points per axis. */
  size: number
  title: string | null
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  /**
   * `size³` RGB triples, red fastest, as little-endian uint16 (0..65535 ↔ 0..1), base64.
   * 16 bits rather than float32 because a 65-point LUT as float is 3.3 MB of base64 in the project
   * file, and 16 bits is well below what an 8-bit output can show.
   */
  data: string
}

/**
 * The asset kinds a grade can draw on: the ones the compositor paints as a picture source. Text
 * draws its own glyphs and audio has no picture, so a grade there would be stored and do nothing.
 */
export const GRADEABLE_KINDS = ['video', 'image', 'gif', 'html', 'brf'] as const

export function isGradeableKind(kind: string | undefined): boolean {
  return (GRADEABLE_KINDS as readonly string[]).includes(kind ?? '')
}

// ---------------------------------------------------------------------------
// Defaults and resolution
// ---------------------------------------------------------------------------

export const DEFAULT_GRAIN_SIZE = 1
export const DEFAULT_HALATION_THRESHOLD = 0.85
export const DEFAULT_HALATION_RADIUS = 10
/** grade.py's halation tint: R 1, G 0.55, B 0.25. */
export const DEFAULT_HALATION_COLOR = '#FF8C40'
export const CURVE_TABLE_SIZE = 1024
export const MAX_CURVE_POINTS = 16

/** The reference white `temperature` is a shift from. */
const REFERENCE_KELVIN = 6500
const IDENTITY_EPSILON = 1e-6

/** Everything the shader needs, with every value finite and every default filled. */
export interface ResolvedGrade {
  /** Linear-light multipliers from temperature and tint; `[1,1,1]` when neither is set. */
  whiteBalance: [number, number, number]
  lift: [number, number, number]
  /** Multipliers (1 + wheel), so the shader does no arithmetic on the offsets. */
  gain: [number, number, number]
  /** Exponents 1 / (1 + wheel). */
  gammaExponent: [number, number, number]
  saturation: number
  /** `CURVE_TABLE_SIZE` RGBA entries, or null when the curves are the identity. */
  curveTable: Float32Array | null
  lut: { assetId: string; intensity: number } | null
  grain: { amount: number; size: number } | null
  halation: { threshold: number; radius: number; amount: number; color: [number, number, number] } | null
  vignette: { amount: number } | null
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clampTo(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function near(value: number, identity: number): boolean {
  return Math.abs(value - identity) < IDENTITY_EPSILON
}

function wheel(w: GradeWheel | undefined): [number, number, number] {
  return [finite(w?.r, 0), finite(w?.g, 0), finite(w?.b, 0)]
}

/** `#RRGGBB` → 0..1 triple, or null. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match || !match[1]) return null
  const n = parseInt(match[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * The grade the shader will run, or `null` when it would change nothing — which is the signal to
 * skip the pass. Non-finite fields fall back to their identity one at a time, so a single bad value
 * cannot take the rest of the grade down with it (the filter-string lesson, `looks.ts`).
 */
export function resolveGrade(grade: Grade | undefined): ResolvedGrade | null {
  if (!grade) return null
  const lift = wheel(grade.lift)
  const gammaWheel = wheel(grade.gamma)
  const gainWheel = wheel(grade.gain)
  const temperature = finite(grade.temperature, 0)
  const tint = finite(grade.tint, 0)
  const saturation = Math.max(0, finite(grade.saturation, 1))

  const whiteBalance: [number, number, number] =
    near(temperature, 0) && near(tint, 0) ? [1, 1, 1] : whiteBalanceGains(temperature, tint)
  const gain = gainWheel.map((g) => Math.max(0, 1 + g)) as [number, number, number]
  // A gamma of 1 + wheel below ~0 is undefined; 0.01 is already an extreme darkening.
  const gammaExponent = gammaWheel.map((g) => 1 / Math.max(0.01, 1 + g)) as [number, number, number]

  const curveTable = grade.curves ? buildCurveTable(grade.curves) : null

  const lutIntensity = clampTo(finite(grade.lut?.intensity, 1), 0, 1)
  const lut = grade.lut && typeof grade.lut.assetId === 'string' && lutIntensity > IDENTITY_EPSILON
    ? { assetId: grade.lut.assetId, intensity: lutIntensity }
    : null

  const grainAmount = clampTo(finite(grade.grain?.amount, 0), 0, 1)
  const grain = grainAmount > IDENTITY_EPSILON
    ? { amount: grainAmount, size: clampTo(finite(grade.grain?.size, DEFAULT_GRAIN_SIZE), 0.5, 16) }
    : null

  const halationAmount = clampTo(finite(grade.halation?.amount, 0), 0, 1)
  const halation = halationAmount > IDENTITY_EPSILON
    ? {
        threshold: clampTo(finite(grade.halation?.threshold, DEFAULT_HALATION_THRESHOLD), 0, 0.999),
        radius: clampTo(finite(grade.halation?.radius, DEFAULT_HALATION_RADIUS), 0.5, 200),
        amount: halationAmount,
        color: hexToRgb(grade.halation?.color ?? DEFAULT_HALATION_COLOR) ??
          (hexToRgb(DEFAULT_HALATION_COLOR) as [number, number, number])
      }
    : null

  const vignetteAmount = clampTo(finite(grade.vignette?.amount, 0), 0, 1)
  const vignette = vignetteAmount > IDENTITY_EPSILON ? { amount: vignetteAmount } : null

  const colourIsIdentity =
    whiteBalance.every((v) => near(v, 1)) &&
    lift.every((v) => near(v, 0)) &&
    gain.every((v) => near(v, 1)) &&
    gammaExponent.every((v) => near(v, 1)) &&
    near(saturation, 1) &&
    curveTable === null

  if (colourIsIdentity && !lut && !grain && !halation && !vignette) return null
  return { whiteBalance, lift, gain, gammaExponent, saturation, curveTable, lut, grain, halation, vignette }
}

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

/**
 * The points a curve is drawn through: sorted, with `(0,0)` and `(1,1)` supplied when the caller
 * did not pin that end. So `[[0.25, 0.3]]` is "lift the quarter tone", not "flat at 0.3".
 */
export function curveKnots(points: readonly CurvePoint[]): CurvePoint[] {
  const clean = points
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [clampTo(p[0], 0, 1), clampTo(p[1], 0, 1)] as CurvePoint)
    .sort((a, b) => a[0] - b[0])
  // Duplicate x values make the slope undefined; the later point wins, as it would in a UI drag.
  const unique: CurvePoint[] = []
  for (const p of clean) {
    const last = unique[unique.length - 1]
    if (last && Math.abs(last[0] - p[0]) < 1e-9) unique[unique.length - 1] = p
    else unique.push(p)
  }
  const first = unique[0]
  const last = unique[unique.length - 1]
  if (!first || first[0] > 1e-9) unique.unshift([0, 0])
  if (!last || last[0] < 1 - 1e-9) unique.push([1, 1])
  return unique
}

/**
 * A monotone cubic (Fritsch–Carlson) through the knots, evaluated at `x`.
 *
 * Monotone rather than a natural spline on purpose: a natural spline through a steep S overshoots,
 * and an overshooting tone curve inverts tones — a highlight rendered darker than the tone below
 * it, which reads as a solarised band. Monotone cannot do that by construction.
 */
export function evalCurve(knots: readonly CurvePoint[], x: number): number {
  const n = knots.length
  const first = knots[0]
  const last = knots[n - 1]
  if (!first || !last) return x
  if (x <= first[0]) return first[1]
  if (x >= last[0]) return last[1]
  const tangents = curveTangents(knots)
  let i = 0
  while (i < n - 2 && x > (knots[i + 1] as CurvePoint)[0]) i += 1
  const [x0, y0] = knots[i] as CurvePoint
  const [x1, y1] = knots[i + 1] as CurvePoint
  const h = x1 - x0
  const t = (x - x0) / h
  const t2 = t * t
  const t3 = t2 * t
  const m0 = tangents[i] ?? 0
  const m1 = tangents[i + 1] ?? 0
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * h * m0 +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * h * m1
  )
}

function curveTangents(knots: readonly CurvePoint[]): number[] {
  const n = knots.length
  const secants: number[] = []
  for (let i = 0; i < n - 1; i += 1) {
    const a = knots[i] as CurvePoint
    const b = knots[i + 1] as CurvePoint
    secants.push((b[1] - a[1]) / (b[0] - a[0]))
  }
  const m: number[] = new Array<number>(n).fill(0)
  m[0] = secants[0] ?? 0
  m[n - 1] = secants[n - 2] ?? 0
  for (let i = 1; i < n - 1; i += 1) {
    const s0 = secants[i - 1] ?? 0
    const s1 = secants[i] ?? 0
    m[i] = s0 * s1 <= 0 ? 0 : (s0 + s1) / 2
  }
  // Fritsch–Carlson: scale any tangent pair that would overshoot back inside the circle of radius 3.
  for (let i = 0; i < n - 1; i += 1) {
    const s = secants[i] ?? 0
    if (s === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = (m[i] ?? 0) / s
    const b = (m[i + 1] ?? 0) / s
    const r = a * a + b * b
    if (r > 9) {
      const tau = 3 / Math.sqrt(r)
      m[i] = tau * a * s
      m[i + 1] = tau * b * s
    }
  }
  return m
}

/**
 * The composed curves as an RGBA lookup table (`CURVE_TABLE_SIZE` entries), or `null` when every
 * curve is the identity — including a curve whose points happen to lie on the diagonal, which is
 * stored and is still the identity.
 */
export function buildCurveTable(curves: GradeCurves, size = CURVE_TABLE_SIZE): Float32Array | null {
  const master = curves.master ? curveKnots(curves.master) : null
  const channels = [curves.r, curves.g, curves.b].map((c) => (c ? curveKnots(c) : null))
  const table = new Float32Array(size * 4)
  let identity = true
  for (let i = 0; i < size; i += 1) {
    const x = i / (size - 1)
    for (let c = 0; c < 3; c += 1) {
      const knots = channels[c]
      let y = knots ? evalCurve(knots, x) : x
      if (master) y = evalCurve(master, clampTo(y, 0, 1))
      y = clampTo(y, 0, 1)
      table[i * 4 + c] = y
      if (Math.abs(y - x) > 1e-5) identity = false
    }
    table[i * 4 + 3] = 1
  }
  return identity ? null : table
}

// ---------------------------------------------------------------------------
// White balance
// ---------------------------------------------------------------------------

/** CIE 1931 xy of a blackbody at `kelvin` (Kim et al.'s cubic fit, 1667–25000 K). */
export function planckianXy(kelvin: number): [number, number] {
  const t = clampTo(kelvin, 1667, 25000)
  const x =
    t <= 4000
      ? -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.17991
      : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.24039
  const y =
    t <= 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : t <= 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483
  return [x, y]
}

function linearRgbOfXy([x, y]: [number, number]): [number, number, number] {
  const X = x / y
  const Z = (1 - x - y) / y
  return [
    3.2406 * X - 1.5372 - 0.4986 * Z,
    -0.9689 * X + 1.8758 + 0.0415 * Z,
    0.0557 * X - 0.204 + 1.057 * Z
  ]
}

/**
 * Linear-light channel multipliers for a Kelvin shift and a green–magenta tint, normalised so
 * Rec.709 luminance is unchanged — warming a shot must not also brighten it.
 *
 * Positive `temperature` is warmer: the picture is multiplied by the colour of a blackbody that
 * much *cooler* than D65, relative to D65 itself.
 */
export function whiteBalanceGains(temperature: number, tint: number): [number, number, number] {
  const reference = linearRgbOfXy(planckianXy(REFERENCE_KELVIN))
  const target = linearRgbOfXy(planckianXy(REFERENCE_KELVIN - temperature))
  const t = clampTo(tint, -1, 1)
  const raw: [number, number, number] = [
    (target[0] / reference[0]) * (1 + 0.15 * t),
    (target[1] / reference[1]) * (1 - 0.3 * t),
    (target[2] / reference[2]) * (1 + 0.15 * t)
  ]
  const luma = 0.2126 * raw[0] + 0.7152 * raw[1] + 0.0722 * raw[2]
  return raw.map((v) => Math.max(0, v / luma)) as [number, number, number]
}

// ---------------------------------------------------------------------------
// Grain
// ---------------------------------------------------------------------------

/**
 * The grain hash, as the shader computes it (`GRAIN_GLSL` in the engine). Integer-only and wrapping
 * at 32 bits in both, so a frame's grain is a pure function of (cell, frame, seed): the same frame
 * exported twice is the same file, and preview_frame of frame N is the grain export writes at N.
 */
export function grainHash(x: number, y: number, frame: number, seed: number): number {
  let h = Math.imul(x >>> 0, 0x5f356495) ^ Math.imul(y >>> 0, 0x2ff1c8b9) ^ Math.imul(frame >>> 0, 0x6c8e9cf5)
  h = (h ^ (seed >>> 0)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/** −0.5..0.5, triangular: the sum of the hash's two 16-bit halves. */
export function grainValue(x: number, y: number, frame: number, seed: number): number {
  const h = grainHash(x, y, frame, seed)
  return ((h & 0xffff) + (h >>> 16)) / 131070 - 0.5
}

/** A stable per-item seed, so two graded clips do not share one grain field. FNV-1a. */
export function grainSeed(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// ---------------------------------------------------------------------------
// LUT data
// ---------------------------------------------------------------------------

/** Decodes a LUT's base64 uint16 payload to 0..1 floats. Pure JS, so both processes can use it. */
export function decodeLutData(lut: LutData): Float32Array | null {
  const expected = lut.size ** 3 * 3
  const bytes = base64ToBytes(lut.data)
  if (!bytes || bytes.length !== expected * 2) return null
  const out = new Float32Array(expected)
  for (let i = 0; i < expected; i += 1) {
    out[i] = ((bytes[i * 2] as number) | ((bytes[i * 2 + 1] as number) << 8)) / 65535
  }
  return out
}

/** Encodes 0..1 floats as the base64 uint16 payload. Values outside 0..1 are clamped. */
export function encodeLutData(values: Float32Array | readonly number[]): string {
  const bytes = new Uint8Array(values.length * 2)
  for (let i = 0; i < values.length; i += 1) {
    const q = Math.round(clampTo(values[i] as number, 0, 1) * 65535)
    bytes[i * 2] = q & 255
    bytes[i * 2 + 1] = q >> 8
  }
  return bytesToBase64(bytes)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]
    out += B64[(n >> 12) & 63]
    out += b === undefined ? '=' : B64[(n >> 6) & 63]
    out += c === undefined ? '=' : B64[n & 63]
  }
  return out
}

function base64ToBytes(text: string): Uint8Array | null {
  const clean = text.replace(/=+$/, '')
  if (/[^A-Za-z0-9+/]/.test(clean)) return null
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let value = 0
  let o = 0
  for (let i = 0; i < clean.length; i += 1) {
    value = (value << 6) | B64.indexOf(clean[i] as string)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o] = (value >> bits) & 255
      o += 1
    }
  }
  return out
}
