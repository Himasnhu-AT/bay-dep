/**
 * The Effects panel's presets as data: what each one writes, and whether the selection already
 * has it — so the panel can show the active one instead of a row of buttons that all look the
 * same whatever the clip is doing. Pure: no store, no React, tested beside it.
 *
 * Only presets over fields the engine draws. Every one is a shortcut to a value the inspector can
 * also type, which is the test for adding another.
 */

import {
  adjustmentsOf,
  containLayout,
  coverLayout,
  defaultAdjustments,
  defaultLayout,
  type Adjustments,
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

/**
 * The one frame preset to show as current, or null. More than one can hold at once — a clip Fit
 * to the canvas is also centred at its size, and Fill and Full frame coincide for a source of the
 * canvas's shape — and the Effects panel ticked every one that held, so Fit and Centre read as
 * checked together, which looked like a bug. The most specific preset wins: Fill, Fit, Full
 * frame, then Centre (which says only where the box is, not its size).
 */
export function activeFramePreset(
  items: readonly Item[],
  timeline: Pick<Timeline, 'width' | 'height'>,
  sourceOf: (item: Item) => { width: number | null; height: number | null } | undefined
): FramePreset | null {
  for (const preset of ['fill', 'fit', 'reset', 'centre'] as const) {
    if (framePresetActive(preset, items, timeline, sourceOf)) return preset
  }
  return null
}

// -- looks --------------------------------------------------------------------------------------

export type LookPreset = 'none' | 'mono' | 'sepia' | 'punchy' | 'soft' | 'vivid' | 'muted'

/**
 * One-click adjustments. Each is a whole `Adjustments` (identity except for what it names), so
 * applying one replaces the look rather than stacking on whatever was there, and the Inspector's
 * Adjustments section shows and types the same numbers.
 */
export const LOOK_PRESETS: readonly {
  id: LookPreset
  label: string
  description: string
  adjustments: Partial<Adjustments>
}[] = [
  { id: 'none', label: 'No look', description: 'As shot, no adjustments', adjustments: {} },
  { id: 'mono', label: 'Black & white', description: 'Grayscale, a little more contrast', adjustments: { grayscale: 1, contrast: 1.1 } },
  { id: 'sepia', label: 'Sepia', description: 'A warm, faded brown tone', adjustments: { sepia: 0.8, contrast: 0.95 } },
  { id: 'punchy', label: 'Punchy', description: 'More contrast and colour', adjustments: { contrast: 1.2, saturate: 1.2 } },
  { id: 'soft', label: 'Soft', description: 'Lifted, low contrast', adjustments: { brightness: 1.05, contrast: 0.85 } },
  { id: 'vivid', label: 'Vivid', description: 'Saturation 150%', adjustments: { saturate: 1.5 } },
  { id: 'muted', label: 'Muted', description: 'Saturation 60%', adjustments: { saturate: 0.6 } }
]

/** The adjustments a look writes: every field present, identity where the look says nothing. */
export function lookAdjustments(look: LookPreset): Adjustments {
  const preset = LOOK_PRESETS.find((p) => p.id === look)
  return { ...defaultAdjustments(), ...(preset?.adjustments ?? {}) }
}

/** Whether every item already has exactly this look (an item with no adjustments has `none`). */
export function lookPresetActive(look: LookPreset, items: readonly Item[]): boolean {
  if (items.length === 0) return false
  const want = lookAdjustments(look)
  return items.every((item) => {
    const have = adjustmentsOf(item.adjustments)
    return (Object.keys(want) as (keyof Adjustments)[]).every((key) => Math.abs(have[key] - want[key]) < 1e-6)
  })
}
