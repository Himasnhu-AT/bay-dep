/**
 * The arithmetic of the effect shaders, as plain functions.
 *
 * A fragment shader cannot run under Node, so the parts of each effect that are *decisions* — how
 * a pixel's distance from the key colour becomes alpha, which bands a glitch tears on frame N,
 * what the blur kernel weighs — are written here and the GLSL in `engine/effectShaders.ts` is
 * written from them, line for line, each block naming the function it mirrors. The tests hold the
 * requirement on these (a green pixel keys out and a skin tone does not; the same frame tears the
 * same way; a kernel sums to one); `test/app/effects.mjs` is what holds the shader to the picture.
 *
 * Written from the textbook forms: BT.709 luma and colour difference, a Gaussian, an unsharp
 * mask. Nothing here is taken from another editor.
 */

import { grainHash } from '../grade'

export type Rgb = readonly [number, number, number]

/** BT.709 luma weights — the ones `engine/grade.ts` uses. */
export const LUMA: Rgb = [0.2126, 0.7152, 0.0722]

/** BT.709 colour-difference scales: Cb = (B − Y) / CB_SCALE, Cr = (R − Y) / CR_SCALE, each −0.5..0.5. */
export const CB_SCALE = 1.8556
export const CR_SCALE = 1.5748

export function luma(c: Rgb): number {
  return c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2]
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/** GLSL's `smoothstep`, for `edge0 < edge1`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

// ---------------------------------------------------------------------------
// Chroma key
// ---------------------------------------------------------------------------

/** A colour's chroma: where it sits in the Cb/Cr plane, with brightness taken out. */
export function chroma(c: Rgb): [number, number] {
  const y = luma(c)
  return [(c[2] - y) / CB_SCALE, (c[0] - y) / CR_SCALE]
}

/** Narrowest soft edge, so `smoothness: 0` is a hard edge rather than a division by zero. */
export const MIN_KEY_SOFTNESS = 1e-4

/**
 * How much of a pixel the key keeps: 0 where it is the screen, 1 where it is the subject.
 *
 * The distance is measured in the Cb/Cr plane, with luma subtracted: white, grey and black all sit
 * at its origin, the same distance from the key, so no brightness of a neutral subject keys out.
 * Chroma still shrinks as a colour darkens, so a screen's shadowed folds are nearer the origin
 * than its lit parts and need more `similarity` — light the screen evenly, as for any keyer.
 * Inside `similarity` the pixel is screen; over the next `smoothness` it ramps to kept.
 */
export function keyMatte(c: Rgb, key: Rgb, similarity: number, smoothness: number): number {
  const a = chroma(c)
  const b = chroma(key)
  const distance = Math.hypot(a[0] - b[0], a[1] - b[1])
  return smoothstep(similarity, similarity + Math.max(smoothness, MIN_KEY_SOFTNESS), distance)
}

/**
 * Takes the key colour's cast off a kept pixel: the part of its chroma that points the same way as
 * the key's is scaled down by `spill`, and its brightness is left alone. A pixel whose chroma
 * points away from the key (skin against green) has no such part and is returned unchanged.
 */
export function despill(c: Rgb, key: Rgb, spill: number): [number, number, number] {
  const k = chroma(key)
  const length = Math.hypot(k[0], k[1])
  if (length < 1e-4 || spill <= 0) return [c[0], c[1], c[2]]
  const dir: [number, number] = [k[0] / length, k[1] / length]
  const cc = chroma(c)
  const along = Math.max(0, cc[0] * dir[0] + cc[1] * dir[1])
  const cb = cc[0] - dir[0] * along * spill
  const cr = cc[1] - dir[1] * along * spill
  const y = luma(c)
  const r = y + CR_SCALE * cr
  const b = y + CB_SCALE * cb
  const g = (y - LUMA[0] * r - LUMA[2] * b) / LUMA[1]
  return [clamp01(r), clamp01(g), clamp01(b)]
}

// ---------------------------------------------------------------------------
// Blur kernels
// ---------------------------------------------------------------------------

/** Taps each side of the centre in the separable Gaussian pass. */
export const GAUSS_TAPS = 24
/** The widest sigma, in texels, those taps cover to three sigma. */
export const GAUSS_MAX_SIGMA = GAUSS_TAPS / 3
/** The most the blurred layer is shrunk before blurring. */
export const GAUSS_MAX_DOWN = 8

/**
 * A Gaussian's weights from the centre outward (`[w0, w1, …]`, each side taking `w1…`), cut at
 * three sigma and normalised so centre plus both sides sum to 1 — a blur must not change how
 * bright a flat area is.
 */
export function gaussianWeights(sigma: number): number[] {
  const reach = Math.min(GAUSS_TAPS, Math.ceil(sigma * 3))
  const raw: number[] = []
  for (let i = 0; i <= reach; i += 1) raw.push(Math.exp(-(i * i) / (2 * sigma * sigma)))
  const total = raw.reduce((sum, w, i) => sum + (i === 0 ? w : 2 * w), 0)
  return raw.map((w) => w / total)
}

/**
 * How to blur by `sigmaDevice` device pixels within the tap budget: shrink the layer by `down`,
 * then blur it by `sigma` texels. `down * sigma` is the blur asked for, until the largest blur
 * the passes can make (`GAUSS_MAX_DOWN * GAUSS_MAX_SIGMA` device pixels), where it stops growing.
 */
export function blurPlan(sigmaDevice: number): { down: number; sigma: number } {
  const down = Math.min(GAUSS_MAX_DOWN, Math.max(1, Math.ceil(sigmaDevice / GAUSS_MAX_SIGMA)))
  return { down, sigma: Math.max(0.5, Math.min(GAUSS_MAX_SIGMA, sigmaDevice / down)) }
}

/** The 3×3 soft kernel an unsharp mask subtracts, rows top to bottom. Sums to 1. */
export const SOFT_KERNEL: readonly number[] = [1, 2, 1, 2, 4, 2, 1, 2, 1].map((w) => w / 16)

/**
 * Unsharp mask as one kernel: `pixel + amount × (pixel − soft)`. It sums to 1 at every amount, so
 * a flat area is left exactly as it was and only edges move.
 */
export function sharpenKernel(amount: number): number[] {
  return SOFT_KERNEL.map((w, i) => (i === 4 ? 1 + amount * (1 - w) : -amount * w))
}

/** Samples along the smear in the directional and zoom blurs. */
export const SMEAR_TAPS = 48

// ---------------------------------------------------------------------------
// Glitch
// ---------------------------------------------------------------------------

/** The furthest a torn band moves at amount 1, as a share of the clip's width. */
export const GLITCH_MAX_SHIFT = 0.25

/**
 * One band of a glitch at one moment: whether it tears, and how far sideways (−1..1 of
 * `GLITCH_MAX_SHIFT × amount` of the width).
 *
 * A pure function of (band, timeline frame, hold, seed) through the grade's integer hash, so
 * frame N is the same picture in the preview, in `preview_frame` and in the file, however often
 * each is drawn. Never `Math.random`. `amount` is the share of bands that tear.
 */
export function glitchBand(band: number, frame: number, hold: number, seed: number, amount: number): { active: boolean; shift: number } {
  const step = Math.floor(Math.max(0, frame) / Math.max(1, Math.round(hold)))
  const h = grainHash(Math.max(0, Math.floor(band)), 0, step, Math.round(seed))
  const pick = (h & 0xffff) / 65536
  const side = (h >>> 16) / 65536
  const active = pick < amount
  return { active, shift: active ? side * 2 - 1 : 0 }
}

// ---------------------------------------------------------------------------
// Pixel maps
// ---------------------------------------------------------------------------

/** The centre of the mosaic block a coordinate falls in, both in 0..1, for a block `cell` wide. */
export function pixelCell(x: number, cell: number): number {
  return (Math.floor(x / cell) + 0.5) * cell
}

/** Where a mirrored coordinate reads from: the kept side as it is, the other side reflected across `centre`. */
export function mirrorCoord(x: number, centre: number, reverse: boolean): number {
  const kept = reverse ? x >= centre : x <= centre
  return kept ? x : clamp01(2 * centre - x)
}

/** Duotone: brightness 0 is `shadows`, 1 is `highlights`, straight between. */
export function duotoneColour(l: number, shadows: Rgb, highlights: Rgb): [number, number, number] {
  const t = clamp01(l)
  return [0, 1, 2].map((i) => (shadows[i] as number) + ((highlights[i] as number) - (shadows[i] as number)) * t) as [number, number, number]
}

/** Tint: brightness 0 stays black, 0.5 is the colour, 1 stays white. */
export function tintColour(l: number, colour: Rgb): [number, number, number] {
  const t = clamp01(l)
  return [0, 1, 2].map((i) => {
    const c = colour[i] as number
    return t < 0.5 ? c * (t * 2) : c + (1 - c) * (t * 2 - 1)
  }) as [number, number, number]
}
