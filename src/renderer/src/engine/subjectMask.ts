/**
 * Applying a subject matte to a picture: the second source transform in `#drawSource`, after the
 * grade.
 *
 *     picture (graded canvas, or the element's crop rect) → `pic` at the size it will be drawn
 *     matte (its rect in matte pixels) → `matte`, inverted and feathered if asked
 *     pic ∘ destination-in ∘ matte → drawn by the caller with the item's alpha, blend, filter and rotation
 *
 * **The matte covers the whole source frame**, so the crop rect maps onto it by scale alone
 * (`matteRect`) — and that scale is also how Vision's 4:3 mask of a 16:9 frame is stretched back:
 * x and y scale independently. Crop and matte therefore cannot disagree.
 *
 * Two scratch canvases, reused per size, never one per frame. An ungraded masked clip pays one
 * copy of the element that an ungraded unmasked clip does not (the audit's caveat); an unmasked
 * clip pays nothing, because nothing here runs without a mask.
 */

import type { MatteImage } from './subjectMatte'

/** The 2D surface this needs — an `OffscreenCanvas` in the app, a software stand-in in the tests. */
export interface MaskCanvas {
  width: number
  height: number
  getContext(kind: '2d'): MaskContext | null
}

export interface MaskContext {
  globalCompositeOperation: GlobalCompositeOperation
  filter: string
  fillStyle: string | CanvasGradient | CanvasPattern
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  drawImage(image: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void
}

export type MakeCanvas = (width: number, height: number) => MaskCanvas

const makeOffscreen: MakeCanvas = (width, height) => new OffscreenCanvas(width, height) as unknown as MaskCanvas

export interface MaskRequest {
  source: unknown
  sx: number
  sy: number
  sw: number
  sh: number
  /** Device pixels of the result — the size the picture will be drawn at. */
  width: number
  height: number
  matte: MatteImage
  /** The matte rect, in matte pixels, that corresponds to the picture rect. */
  mx: number
  my: number
  mw: number
  mh: number
  invert: boolean
  /** Device pixels of blur on the matte; 0 for a hard edge. */
  featherPx: number
}

/** The crop rect, in source pixels, mapped onto a matte that covers the whole source frame. */
export function matteRect(
  src: { sx: number; sy: number; sw: number; sh: number },
  sourceWidth: number,
  sourceHeight: number,
  matte: { width: number; height: number }
): { mx: number; my: number; mw: number; mh: number } {
  const kx = sourceWidth > 0 ? matte.width / sourceWidth : 0
  const ky = sourceHeight > 0 ? matte.height / sourceHeight : 0
  return { mx: src.sx * kx, my: src.sy * ky, mw: src.sw * kx, mh: src.sh * ky }
}

/**
 * Reusable scratch surfaces, by role. Resized when the size asked for changes; a preview drawing
 * one masked clip at one size allocates twice, ever.
 */
export class MaskScratch {
  readonly #make: MakeCanvas
  readonly #canvases = new Map<string, MaskCanvas>()

  constructor(make: MakeCanvas = makeOffscreen) {
    this.#make = make
  }

  get(role: 'pic' | 'matte', width: number, height: number): MaskCanvas {
    let canvas = this.#canvases.get(role)
    if (!canvas) {
      canvas = this.#make(width, height)
      this.#canvases.set(role, canvas)
    } else if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    return canvas
  }

  release(): void {
    for (const canvas of this.#canvases.values()) {
      canvas.width = 1
      canvas.height = 1
    }
    this.#canvases.clear()
  }
}

/**
 * The picture with the matte as its alpha, at `width × height`, or null when a canvas could not be
 * had. The caller draws it from `(0, 0, width, height)` into its destination rect.
 */
export function maskedPicture(request: MaskRequest, scratch: MaskScratch): MaskCanvas | null {
  const width = Math.max(1, Math.round(request.width))
  const height = Math.max(1, Math.round(request.height))
  const pic = scratch.get('pic', width, height)
  const matte = scratch.get('matte', width, height)
  const p = pic.getContext('2d')
  const m = matte.getContext('2d')
  if (!p || !m) return null

  p.setTransform(1, 0, 0, 1, 0, 0)
  p.globalCompositeOperation = 'source-over'
  p.filter = 'none'
  p.clearRect(0, 0, width, height)
  p.drawImage(request.source, request.sx, request.sy, request.sw, request.sh, 0, 0, width, height)

  m.setTransform(1, 0, 0, 1, 0, 0)
  m.globalCompositeOperation = 'source-over'
  m.filter = 'none'
  m.clearRect(0, 0, width, height)
  if (request.invert) {
    // Everything, minus the subject.
    m.fillStyle = '#ffffff'
    m.fillRect(0, 0, width, height)
    m.globalCompositeOperation = 'destination-out'
  }
  if (request.featherPx > 0) m.filter = `blur(${request.featherPx}px)`
  m.drawImage(request.matte.image, request.mx, request.my, request.mw, request.mh, 0, 0, width, height)
  m.filter = 'none'
  m.globalCompositeOperation = 'source-over'

  p.globalCompositeOperation = 'destination-in'
  p.drawImage(matte, 0, 0, width, height, 0, 0, width, height)
  p.globalCompositeOperation = 'source-over'
  return pic
}
