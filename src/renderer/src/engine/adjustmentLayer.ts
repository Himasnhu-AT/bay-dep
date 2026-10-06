/**
 * An adjustment layer's draw, in the parts that need no compositor: whether it changes anything,
 * which pixels of the canvas are "the frame so far", and the item it is drawn as.
 *
 *     the canvas so far  ──copy──▶  snapshot (the frame, at output size)
 *     the canvas so far  ──destination-out, by the layer's coverage × alpha──▶  a hole where the layer acts
 *     snapshot ──#drawSource: grade → masks → adjustments, added back (`lighter`) at that same coverage × alpha
 *
 * The result is `original × (1 − m) + adjusted × m` at every pixel, m being mask coverage times
 * the layer's opacity and fade — exactly, alpha channel included, so a transparent export keeps
 * its alpha where a plain draw of the adjusted copy over the original would thicken every soft
 * edge. The hole and the add use the same coverage canvas (`ShapeMaskCache`), so they cancel
 * where the layer changes nothing.
 *
 * **The seam for the effect stack:** the snapshot goes through `#drawSource` as any clip's
 * picture does, so whatever that function applies to an item — today the grade, shape masks and
 * the CSS adjustments — applies to a layer. An `effects` list read there needs nothing here but
 * its line in `adjustmentChangesPicture`, which already counts a non-empty `effects` array as a
 * change so such a layer is never skipped.
 */

import type { BlendMode, Item } from '@shared/project'
import { resolveGrade } from '@shared/grade'
import { adjustmentFilter, NO_FILTER } from './looks'

/**
 * Whether drawing this layer could change a pixel. A layer with no grade (or an all-neutral one)
 * and identity adjustments would copy the frame and add it back unchanged; skipping it is what
 * makes an untouched layer free.
 */
export function adjustmentChangesPicture(item: Item): boolean {
  if (item.grade && resolveGrade(item.grade) !== null) return true
  if (adjustmentFilter(item.adjustments) !== NO_FILTER) return true
  const effects = (item as { effects?: unknown }).effects
  return Array.isArray(effects) && effects.length > 0
}

export interface AdjustmentPlan {
  /** The frame's rectangle on the canvas, in device pixels — what to copy. */
  sx: number
  sy: number
  sw: number
  sh: number
  /** The snapshot's size: the frame at the output's scale. */
  width: number
  height: number
  /** The layer as `#drawSource` draws it: the whole frame, upright, added to what the hole left. */
  item: Item
}

/**
 * Where the frame is on the canvas under `transform` (the preview's or the export's scale, plus a
 * transition's offset), and the item to draw the copy as. Null under a rotated or sheared
 * transform, where the frame is not a rectangle of pixels.
 */
export function planAdjustment(
  item: Item,
  frame: { width: number; height: number },
  transform: { a: number; b: number; c: number; d: number; e: number; f: number }
): AdjustmentPlan | null {
  if (Math.abs(transform.b) > 1e-9 || Math.abs(transform.c) > 1e-9) return null
  if (!(frame.width > 0) || !(frame.height > 0) || !(Math.abs(transform.a) > 0) || !(Math.abs(transform.d) > 0)) return null
  const drawn: Item = {
    ...item,
    layout: { left: 0, top: 0, width: frame.width, height: frame.height, opacity: item.layout.opacity, rotation: 0 },
    // `lighter` is a canvas compositing operation, not one of the fifteen blend modes a clip may
    // store — it is how the adjusted copy is added into the hole. Never written to a project.
    blendMode: 'lighter' as unknown as BlendMode
  }
  delete drawn.crop
  return {
    sx: transform.e,
    sy: transform.f,
    sw: frame.width * transform.a,
    sh: frame.height * transform.d,
    // The size `#drawSource` will draw the layer at, so its mask grid and this one are one grid.
    width: Math.max(1, Math.round(frame.width * Math.abs(transform.a))),
    height: Math.max(1, Math.round(frame.height * Math.abs(transform.d))),
    item: drawn
  }
}

interface SnapshotContext {
  globalCompositeOperation: GlobalCompositeOperation
  filter: string
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  drawImage(image: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void
}

interface SnapshotCanvas {
  width: number
  height: number
  getContext(kind: '2d'): SnapshotContext | null
}

/** The one surface a layer's copy of the frame lives on, reused per size. */
export class AdjustmentScratch {
  #canvas: SnapshotCanvas | null = null

  /** The frame so far, copied off `canvas`; null when no surface could be had. */
  copy(canvas: unknown, plan: AdjustmentPlan): OffscreenCanvas | null {
    if (!this.#canvas) this.#canvas = new OffscreenCanvas(plan.width, plan.height) as unknown as SnapshotCanvas
    else if (this.#canvas.width !== plan.width || this.#canvas.height !== plan.height) {
      this.#canvas.width = plan.width
      this.#canvas.height = plan.height
    }
    const ctx = this.#canvas.getContext('2d')
    if (!ctx) return null
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.filter = 'none'
    ctx.clearRect(0, 0, plan.width, plan.height)
    ctx.drawImage(canvas, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.width, plan.height)
    return this.#canvas as unknown as OffscreenCanvas
  }

  release(): void {
    if (this.#canvas) {
      this.#canvas.width = 1
      this.#canvas.height = 1
    }
    this.#canvas = null
  }
}
