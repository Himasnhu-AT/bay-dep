/**
 * Where a subject matte lands on the timeline. Its own module with no imports, so the in-app probe
 * (`test/app/mask.mjs`) can load it under plain Node as its independent account of where the
 * person is — `@shared/matte` re-exports it for everything else.
 */

/**
 * Where the whole source frame — and so the whole matte — lands on the timeline for an item, in
 * timeline pixels: its layout box, zoomed about the centre by `layout.scale`. A matte covers exactly
 * the source frame (Vision's 4:3 or 3:4 mask is the whole frame scaled on each axis), and a crop
 * cuts the source *within* that box without moving it, so neither the matte's own aspect, the crop,
 * nor a pillar- or letterboxed fit changes this rectangle. Rotation is not included (`rotation`
 * says how much the caller must still apply about the centre).
 *
 * A matte pixel (mx, my) of a `mw × mh` matte is at `left + (mx + 0.5) / mw * width` across.
 * The compositor's `matteRect` + crop destination is this mapping; `test/app/mask.mjs` uses this
 * function as its independent account of where the person is on the canvas.
 */
export function sourceFrameOnTimeline(layout: { left: number; top: number; width: number; height: number; scale?: number; rotation?: number }): {
  left: number
  top: number
  width: number
  height: number
  rotation: number
} {
  const zoom = layout.scale !== undefined && Number.isFinite(layout.scale) && layout.scale >= 0 ? layout.scale : 1
  const cx = layout.left + layout.width / 2
  const cy = layout.top + layout.height / 2
  const width = layout.width * zoom
  const height = layout.height * zoom
  return { left: cx - width / 2, top: cy - height / 2, width, height, rotation: Number.isFinite(layout.rotation) ? (layout.rotation ?? 0) : 0 }
}
