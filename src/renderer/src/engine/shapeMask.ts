/**
 * Drawing shape masks: the third source transform in `#drawSource`, after the grade and the
 * subject matte.
 *
 *     picture (graded, matted, or the element's crop rect) → `pic` at the size it will be drawn
 *     rasterMasks(masks, the clip's frame, which part of it `pic` shows) → an alpha canvas
 *     pic ∘ destination-in ∘ alpha → drawn by the caller with the item's alpha, blend, filter and rotation
 *
 * The alpha is `@shared/shape-mask`'s `rasterMasks` and nothing else — the same function the unit
 * tests measure — written into a canvas once and kept: the masks, the frame and the view are the
 * whole key, so a still mask on a still clip is rasterised once however long it plays, and the
 * preview, `preview_frame` and export each get the grid for their own output size. A clip whose
 * size on screen changes every frame (a keyframed zoom) rasterises every frame; that costs a pass
 * over its pixels in script, which is the price of the picture and the measured function being one.
 *
 * Nothing here runs for a clip with no shape mask.
 */

import { rasterMasks, type MaskFrame, type MaskView, type ShapeMask } from '@shared/shape-mask'
import type { MaskCanvas, MaskContext, MaskScratch } from './subjectMask'

/** A canvas that can take raw pixels — an `OffscreenCanvas` in the app, a software one in the tests. */
export interface AlphaCanvas {
  width: number
  height: number
  getContext(kind: '2d'): AlphaContext | null
}

export interface AlphaContext {
  createImageData(width: number, height: number): { data: Uint8ClampedArray }
  putImageData(image: { data: Uint8ClampedArray }, x: number, y: number): void
}

export type MakeAlphaCanvas = (width: number, height: number) => AlphaCanvas

const makeOffscreen: MakeAlphaCanvas = (width, height) => new OffscreenCanvas(width, height) as unknown as AlphaCanvas

/**
 * Which part of the clip's frame a picture of `width × height` output pixels shows, given the
 * item's box and the rect the picture is drawn into (the box, or the crop's part of it). The
 * frame is the box, so a crop only moves the window: the mask stays where it was on the picture.
 */
export function shapeView(
  box: { left: number; top: number; width: number; height: number },
  dest: { dx: number; dy: number; dw: number; dh: number },
  width: number,
  height: number
): { frame: MaskFrame; view: MaskView } {
  return {
    frame: { width: box.width, height: box.height },
    view: { width, height, originX: dest.dx - box.left, originY: dest.dy - box.top, stepX: dest.dw / width, stepY: dest.dh / height }
  }
}

/** Kept coverage canvases: enough for the clips of one frame and both sides of a transition. */
const KEPT = 4

/**
 * Coverage canvases by what they were made from. The oldest is reused when a fifth is asked for;
 * `release` gives the memory back when the engine resets.
 */
export class ShapeMaskCache {
  readonly #make: MakeAlphaCanvas
  readonly #entries: { key: string; canvas: AlphaCanvas }[] = []
  /** How many grids have been rasterised — what a test reads to see the cache held. */
  rasterised = 0

  constructor(make: MakeAlphaCanvas = makeOffscreen) {
    this.#make = make
  }

  /** A canvas whose alpha is the masks' coverage of `view`; null when no canvas could be had. */
  get(masks: readonly ShapeMask[], frame: MaskFrame, view: MaskView): AlphaCanvas | null {
    const width = Math.max(1, Math.round(view.width))
    const height = Math.max(1, Math.round(view.height))
    const key = `${JSON.stringify(masks)}|${frame.width}x${frame.height}|${width}x${height}|${view.originX},${view.originY},${view.stepX},${view.stepY}`
    const at = this.#entries.findIndex((entry) => entry.key === key)
    if (at >= 0) {
      const [hit] = this.#entries.splice(at, 1)
      this.#entries.push(hit!)
      return hit!.canvas
    }
    let canvas: AlphaCanvas
    if (this.#entries.length >= KEPT) {
      canvas = this.#entries.shift()!.canvas
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
    } else {
      canvas = this.#make(width, height)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const coverage = rasterMasks(masks, frame, { ...view, width, height })
    this.rasterised += 1
    const image = ctx.createImageData(width, height)
    const data = image.data
    for (let i = 0, o = 0; i < coverage.length; i += 1, o += 4) {
      data[o] = 255
      data[o + 1] = 255
      data[o + 2] = 255
      data[o + 3] = coverage[i]!
    }
    ctx.putImageData(image, 0, 0)
    this.#entries.push({ key, canvas })
    return canvas
  }

  release(): void {
    for (const entry of this.#entries) {
      entry.canvas.width = 1
      entry.canvas.height = 1
    }
    this.#entries.length = 0
  }
}

/** The picture on the `pic` scratch surface at the size it will be drawn, for a clip with shapes and no subject matte. */
export function copiedPicture(
  request: { source: unknown; sx: number; sy: number; sw: number; sh: number; width: number; height: number },
  scratch: MaskScratch
): MaskCanvas | null {
  const width = Math.max(1, Math.round(request.width))
  const height = Math.max(1, Math.round(request.height))
  const pic = scratch.get('pic', width, height)
  const p = pic.getContext('2d')
  if (!p) return null
  reset(p)
  p.clearRect(0, 0, width, height)
  p.drawImage(request.source, request.sx, request.sy, request.sw, request.sh, 0, 0, width, height)
  return pic
}

function reset(p: MaskContext): void {
  p.setTransform(1, 0, 0, 1, 0, 0)
  p.globalCompositeOperation = 'source-over'
  p.filter = 'none'
}

/**
 * `picture` with its alpha multiplied by the masks' coverage, in place. Null when the coverage
 * could not be made — the caller then draws nothing and says so, never the picture unmasked.
 */
export function shapedPicture(
  picture: MaskCanvas,
  masks: readonly ShapeMask[],
  where: { frame: MaskFrame; view: MaskView },
  cache: ShapeMaskCache
): MaskCanvas | null {
  const p = picture.getContext('2d')
  if (!p) return null
  let alpha: AlphaCanvas | null
  try {
    alpha = cache.get(masks, where.frame, where.view)
  } catch {
    return null
  }
  if (!alpha) return null
  reset(p)
  p.globalCompositeOperation = 'destination-in'
  p.drawImage(alpha, 0, 0, alpha.width, alpha.height, 0, 0, picture.width, picture.height)
  p.globalCompositeOperation = 'source-over'
  return picture
}
