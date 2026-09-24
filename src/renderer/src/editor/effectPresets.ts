/**
 * The Effects panel's presets as data: what each one writes, and whether the selection already
 * has it — so the panel can show the active one instead of a row of buttons that all look the
 * same whatever the clip is doing. Pure: no store, no React, tested beside it.
 *
 * Only presets over fields the engine draws. Every one is a shortcut to a value the inspector can
 * also type, which is the test for adding another.
 */

import {
  containLayout,
  coverLayout,
  defaultLayout,
  type Item,
  type Layout,
  type Timeline
} from '@shared/project'

export type FramePreset = 'fill' | 'fit' | 'centre' | 'reset'

/** Half a pixel: layouts are stored rounded, so a preset applied and read back matches exactly. */
const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.5

function sameBox(a: Layout, b: Layout): boolean {
  return near(a.left, b.left) && near(a.top, b.top) && near(a.width, b.width) && near(a.height, b.height)
}

/** The layout a frame preset gives `item`, or null when it has nothing to say (no timeline). */
export function framePresetLayout(
  preset: FramePreset,
  item: Item,
  timeline: Pick<Timeline, 'width' | 'height'>,
  source: { width: number | null; height: number | null } | undefined
): Layout {
  if (preset === 'reset') return defaultLayout(timeline)
  if (preset === 'centre') {
    return {
      ...item.layout,
      left: Math.round((timeline.width - item.layout.width) / 2),
      top: Math.round((timeline.height - item.layout.height) / 2)
    }
  }
  if (!source?.width || !source.height) return defaultLayout(timeline)
  const fitted = preset === 'fill'
    ? coverLayout(timeline, source.width, source.height)
    : containLayout(timeline, source.width, source.height)
  return fitted
}

/**
 * Whether every item already sits where `preset` would put it. Reset and Fill coincide for a
 * source of the canvas's own shape, and both then read active — which is true of both.
 */
export function framePresetActive(
  preset: FramePreset,
  items: readonly Item[],
  timeline: Pick<Timeline, 'width' | 'height'>,
  sourceOf: (item: Item) => { width: number | null; height: number | null } | undefined
): boolean {
  if (items.length === 0) return false
  return items.every((item) => sameBox(item.layout, framePresetLayout(preset, item, timeline, sourceOf(item))))
}

/** The fade a preset writes on `item`: both ends, capped at half the clip. */
export function fadePresetFrames(frames: number, item: Item): number {
  return Math.min(frames, Math.floor(item.durationInFrames / 2))
}

export function fadePresetActive(frames: number, items: readonly Item[]): boolean {
  if (items.length === 0) return false
  return items.every((item) => {
    const capped = fadePresetFrames(frames, item)
    return item.fadeInFrames === capped && item.fadeOutFrames === capped
  })
}

export function speedPresetActive(speed: number, items: readonly Item[]): boolean {
  return items.length > 0 && items.every((item) => Math.abs(item.speed - speed) < 1e-9)
}
