/**
 * `<glass>`'s backdrop: the part of a glass pane that is not the pane's own paint.
 *
 * A `.brf` item is painted into a surface of its own and then drawn like any source, so the
 * surface cannot see what is under it. Glass has to. The `.brf` painter therefore paints only
 * what belongs to the pane — tint, sheen, rim light (`engine/brf.ts`) — and reports each pane
 * (`glassPatches`); the compositor, just before it draws the surface, takes what the canvas
 * already holds under each pane (lower tracks, the background), and draws it back inside the
 * pane's rounded rectangle blurred, saturated and bent at the rim (`paintGlassBackdrop`). Preview,
 * `preview_frame` and export all draw through `Compositor.drawFrame`, so all three do this.
 *
 * The geometry is pure and tested (`glass.test.ts`): which device pixels a pane covers under the
 * transform, crop and rotation the surface is drawn with, and how strongly each rim band
 * magnifies. The pixel work needs a canvas and is checked in the app.
 *
 * The look is quick-liquid's vocabulary (`@shared/glass`) drawn with canvas primitives, not its
 * engine: a displacement map per pane per frame would cost what `.brf` exists to avoid. The rim
 * bend is approximated by three concentric bands, each magnifying the frosted backdrop about the
 * pane's centre a little more than the one inside it — strongest at the edge, as a lens is.
 */

import type { DrawOp, Matrix } from '@shared/brf'
import type { GlassLook } from '@shared/glass'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** One glass pane on a painted `.brf` surface. */
export interface GlassPatch {
  /** Pane-local units → surface pixels. The pane spans (0,0)–(w,h) locally. */
  matrix: Matrix
  w: number
  h: number
  radius: number
  /** Fraction revealed left to right, for the `wipe` preset. */
  wipe: number
  alpha: number
  look: GlassLook
  /**
   * The scene's own rectangle on the surface, in surface pixels. A letterboxed or boxed scene
   * draws nothing outside it — the pane's tint and rim cannot — so neither may its frost.
   */
  scene: { x: number; y: number; w: number; h: number }
}

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ]
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/**
 * The glass panes among `ops`, mapped onto the surface by `base` (document → surface pixels,
 * a scale and an offset), with the `size.width`×`size.height` scene's rectangle on the surface.
 */
export function glassPatches(ops: DrawOp[], base: Matrix, size: { width: number; height: number }): GlassPatch[] {
  const [a, b] = apply(base, 0, 0)
  const [c, d] = apply(base, size.width, size.height)
  const scene = { x: Math.min(a, c), y: Math.min(b, d), w: Math.abs(c - a), h: Math.abs(d - b) }
  const out: GlassPatch[] = []
  for (const op of ops) {
    if (op.kind !== 'glass' || op.w <= 0 || op.h <= 0 || op.alpha <= 0.0005) continue
    out.push({ matrix: multiply(base, op.matrix), w: op.w, h: op.h, radius: op.radius, wipe: op.wipe, alpha: op.alpha, look: op.look, scene })
  }
  return out
}

/**
 * Surface pixels → canvas device pixels, for a surface drawn with `drawImage(surface, sx, sy, sw,
 * sh, dx, dy, dw, dh)` under the transform `t` — the transform in force at that draw, after the
 * item's rotation and zoom. Crop is the `src`/`dest` pair; uncropped, `src` is the whole surface
 * and `dest` the item's box.
 */
export function surfaceToDevice(
  t: Matrix,
  src: { sx: number; sy: number; sw: number; sh: number },
  dest: { dx: number; dy: number; dw: number; dh: number }
): Matrix | null {
  if (!(src.sw > 0) || !(src.sh > 0)) return null
  const kx = dest.dw / src.sw
  const ky = dest.dh / src.sh
  return multiply(t, [kx, 0, 0, ky, dest.dx - src.sx * kx, dest.dy - src.sy * ky])
}

export interface GlassPlan {
  /** Pane-local units → device pixels. */
  matrix: Matrix
  /** The whole pane, whatever the wipe: its radius and rim are the whole pane's. */
  w: number
  h: number
  radius: number
  /** How much of the pane's width is revealed, 0–1 — a plain rect clip, as the painter's. */
  wipe: number
  alpha: number
  /** Device pixels per local unit. */
  unit: number
  blurPx: number
  saturation: number
  /** The device-pixel rectangle copied from the canvas: the pane, plus room for blur and bend. */
  region: { x: number; y: number; w: number; h: number }
  bands: RefractionBand[]
}

/**
 * Where on the canvas one pane draws, at what strength, in device pixels — or null when it draws
 * nothing (off the canvas, fully transparent, zero-sized, or a transform with no area).
 */
export function planGlass(
  patch: GlassPatch,
  toDevice: Matrix,
  canvas: { width: number; height: number },
  alpha: number
): GlassPlan | null {
  const matrix = multiply(toDevice, patch.matrix)
  const unit = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]))
  const wipe = Math.max(0, Math.min(1, patch.wipe))
  const w = patch.w
  const a = alpha * patch.alpha
  if (!(unit > 0) || !(w * wipe > 0) || !(patch.h > 0) || !(a > 0.0005) || !matrix.every(Number.isFinite)) return null
  // Only the revealed part is read from the canvas.
  const shown = w * wipe
  const corners = [apply(matrix, 0, 0), apply(matrix, shown, 0), apply(matrix, 0, patch.h), apply(matrix, shown, patch.h)]
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  const blurPx = patch.look.blur * unit
  const bands = refractionBands(patch.w, patch.h, patch.look)
  // Room for the blur to sample beyond the pane. The rim needs none: magnifying about the centre
  // reads from further in, never further out.
  const margin = Math.ceil(2 * blurPx) + 2
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - margin))
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - margin))
  const x1 = Math.min(canvas.width, Math.ceil(Math.max(...xs) + margin))
  const y1 = Math.min(canvas.height, Math.ceil(Math.max(...ys) + margin))
  if (x1 <= x0 || y1 <= y0) return null
  return {
    matrix,
    w,
    h: patch.h,
    radius: Math.max(0, Math.min(patch.radius, w / 2, patch.h / 2)),
    wipe,
    alpha: Math.min(1, a),
    unit,
    blurPx,
    saturation: patch.look.saturation,
    region: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    bands
  }
}

/** A ring of the rim, `outer`–`inner` local units in from the edge, magnified by `scale`. */
export interface RefractionBand {
  outer: number
  inner: number
  scale: number
}

const BANDS = 3

/**
 * The rim bend as concentric rings, outermost first. At the very edge the backdrop is pulled in
 * by `refraction` units — a magnification of d/(d − refraction) about the centre, d the half
 * short side — easing off quadratically toward the inside of the `bezel`. No refraction or no
 * bezel is no bands: a flat pane.
 */
export function refractionBands(w: number, h: number, look: Pick<GlassLook, 'refraction' | 'bezel'>): RefractionBand[] {
  const d = Math.min(w, h) / 2
  // Short of the centre, so the innermost ring still has an inside: a ring whose inner edge had
  // collapsed to nothing would clip to the whole pane and magnify all of it.
  const bezel = Math.min(look.bezel, d * 0.9)
  // Never more than half the way to the centre, or the edge would sample past it.
  const pull = Math.min(look.refraction, d * 0.5)
  if (!(d > 0) || !(bezel > 0) || !(pull > 0)) return []
  const edge = d / (d - pull)
  const out: RefractionBand[] = []
  for (let i = 0; i < BANDS; i++) {
    const strength = ((BANDS - i) / BANDS) ** 2
    out.push({ outer: (bezel * i) / BANDS, inner: (bezel * (i + 1)) / BANDS, scale: 1 + (edge - 1) * strength })
  }
  return out
}

let copy: OffscreenCanvas | null = null
let frosted: OffscreenCanvas | null = null

/** Lets go of the scratch canvases — one full-frame pane at 4K holds about 66 MB in them. */
export function releaseGlassBuffers(): void {
  copy = null
  frosted = null
}

function scratch(canvas: OffscreenCanvas | null, w: number, h: number): OffscreenCanvas {
  if (!canvas || canvas.width < w || canvas.height < h) {
    return new OffscreenCanvas(Math.max(w, canvas?.width ?? 0), Math.max(h, canvas?.height ?? 0))
  }
  return canvas
}

function roundedRect(ctx: Ctx, inset: number, w: number, h: number, radius: number): void {
  const iw = w - 2 * inset
  const ih = h - 2 * inset
  if (iw <= 0 || ih <= 0) return
  const r = Math.max(0, Math.min(radius - inset, iw / 2, ih / 2))
  if (r > 0) ctx.roundRect(inset, inset, iw, ih, r)
  else ctx.rect(inset, inset, iw, ih)
}

/**
 * Draws what `ctx` already holds under the pane back inside it, frosted and bent. Returns false
 * when there is nothing to do it with (no OffscreenCanvas, no readable canvas). Leaves the
 * context's state as it found it.
 */
export function paintGlassBackdrop(ctx: Ctx, plan: GlassPlan): boolean {
  if (typeof OffscreenCanvas === 'undefined') return false
  const source = ctx.canvas as HTMLCanvasElement | OffscreenCanvas | undefined
  if (!source) return false
  const { x, y, w, h } = plan.region
  copy = scratch(copy, w, h)
  frosted = scratch(frosted, w, h)
  const c = copy.getContext('2d')
  const f = frosted.getContext('2d')
  if (!c || !f) return false
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.clearRect(0, 0, w, h)
  c.drawImage(source, x, y, w, h, 0, 0, w, h)
  f.setTransform(1, 0, 0, 1, 0, 0)
  f.clearRect(0, 0, w, h)
  const filters: string[] = []
  if (plan.blurPx > 0.05) filters.push(`blur(${plan.blurPx.toFixed(2)}px)`)
  if (Math.abs(plan.saturation - 1) > 1e-3) filters.push(`saturate(${plan.saturation.toFixed(3)})`)
  f.filter = filters.length > 0 ? filters.join(' ') : 'none'
  f.drawImage(copy, 0, 0, w, h, 0, 0, w, h)
  f.filter = 'none'

  ctx.save()
  try {
    ctx.globalAlpha = plan.alpha
    ctx.globalCompositeOperation = 'source-over'
    ctx.filter = 'none'
    ctx.shadowColor = 'transparent'
    ctx.setTransform(...plan.matrix)
    // The wipe first, as a plain rect over the whole pane — the order `paintBrf` clips the tint in.
    if (plan.wipe < 1) {
      ctx.beginPath()
      ctx.rect(0, 0, plan.w * plan.wipe, plan.h)
      ctx.clip()
    }
    // The body: the frosted backdrop inside the pane.
    ctx.beginPath()
    roundedRect(ctx, 0, plan.w, plan.h, plan.radius)
    ctx.clip()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(frosted, 0, 0, w, h, x, y, w, h)
    // The rim: each ring redrawn magnified about the pane's centre. A uniform scale commutes with
    // any transform, so scaling in device space about the mapped centre is the local scale.
    const [cx, cy] = apply(plan.matrix, plan.w / 2, plan.h / 2)
    for (const band of plan.bands) {
      ctx.save()
      ctx.setTransform(...plan.matrix)
      ctx.beginPath()
      roundedRect(ctx, band.outer, plan.w, plan.h, plan.radius)
      roundedRect(ctx, band.inner, plan.w, plan.h, plan.radius)
      ctx.clip('evenodd')
      ctx.setTransform(band.scale, 0, 0, band.scale, cx * (1 - band.scale), cy * (1 - band.scale))
      ctx.drawImage(frosted, 0, 0, w, h, x, y, w, h)
      ctx.restore()
    }
  } finally {
    ctx.restore()
  }
  return true
}
