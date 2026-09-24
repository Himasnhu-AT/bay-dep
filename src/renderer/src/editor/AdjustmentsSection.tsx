import type { ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import {
  defaultAdjustments,
  type Adjustments,
  type BlendMode,
  type Item,
  type Timeline
} from '@shared/project'
import { Button, Section, Select, SliderField } from '@/components'
import { adjustmentFilter, NO_FILTER } from '../engine/looks'
import { useEditor } from '@/store/editor'

/**
 * One adjustment slider's range and units.
 *
 * `max` is a *useful* limit rather than a true one — the model accepts more, and nothing here
 * clamps what an agent can set. The sliders stop where the control stops being useful: a
 * brightness of 20 is a white rectangle, and a slider whose useful travel is the first 5% of its
 * track is a slider you cannot set.
 */
interface Control {
  key: keyof Adjustments
  label: string
  min: number
  max: number
  step: number
  /** Shown after the number. Empty for pure multipliers. */
  unit?: string
}

const CONTROLS: Control[] = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 3, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: 0, max: 3, step: 0.01 },
  { key: 'saturate', label: 'Saturation', min: 0, max: 3, step: 0.01 },
  // Degrees, and the full turn is available: 360 is the identity but the wrap is how people
  // find the hue they want, so the range is not cut short at 359.
  { key: 'hueRotate', label: 'Hue', min: -180, max: 180, step: 1, unit: '°' },
  // Canvas pixels, deliberately not normalised. 8px is a different blur at 1080p and at 4K, so
  // a 0..1 value would be a lie at one of them; the number shown is the number drawn.
  { key: 'blur', label: 'Blur', min: 0, max: 40, step: 0.5, unit: 'px' },
  { key: 'grayscale', label: 'Greyscale', min: 0, max: 1, step: 0.01 },
  { key: 'sepia', label: 'Sepia', min: 0, max: 1, step: 0.01 },
  { key: 'invert', label: 'Invert', min: 0, max: 1, step: 0.01 }
]

const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Colour dodge' },
  { value: 'color-burn', label: 'Colour burn' },
  { value: 'hard-light', label: 'Hard light' },
  { value: 'soft-light', label: 'Soft light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Colour' },
  { value: 'luminosity', label: 'Luminosity' }
]

/**
 * The readout beside a slider: the number the model stores, then the control's unit. Whole-unit
 * steps show no decimals; multipliers show two, which is the precision the step can reach.
 */
function formatAdjustment(value: number, control: Control): string {
  if (!Number.isFinite(value)) return '—'
  const decimals = control.step >= 1 ? 0 : control.step >= 0.1 ? 1 : 2
  return `${value.toFixed(decimals)}${control.unit ?? ''}`
}

/** NaN never equals itself, so a plain `===` reports one clip as "Mixed" against itself. */
function same(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b))
}

/**
 * Adjustments and blend mode.
 *
 * **Adjustments, never Colour.** These are a look control — a saturation multiplier and a hue
 * rotation are not lift/gamma/gain — and calling them a grade would promise something 2D canvas
 * cannot reach. The name is the honest part.
 *
 * Every control here is backed: `applyLook` in the compositor reads both fields on both draw
 * paths, and the filter string shown at the bottom comes from `adjustmentFilter`, the function
 * that actually composites, rather than from a second opinion that could disagree with it.
 */
export function AdjustmentsSection({
  items,
  timeline
}: {
  items: Item[]
  timeline: Timeline
}): ReactNode {
  const patchItem = useEditor((state) => state.patchItem)
  // One slider commit is one undo step across the whole selection — see the note in
  // `Inspector.tsx`. A per-item `patchItem` loop without this is one entry per clip.
  const transact = useEditor((state) => state.transact)
  const first = items[0]
  if (!first) return null

  const read = (key: keyof Adjustments): { value: number; mixed: boolean } => {
    const of = (item: Item): number => (item.adjustments ?? defaultAdjustments())[key]
    const value = of(first)
    return { value, mixed: items.some((item) => !same(of(item), value)) }
  }

  // Merged onto each item's own adjustments, not onto the first item's: a multi-selection where
  // one clip is already blurred must not have the others inherit its blur because they happened
  // to be edited together.
  const set = (key: keyof Adjustments, value: number): void => {
    transact(() => {
      for (const item of items) {
        patchItem(item.id, {
          adjustments: { ...defaultAdjustments(), ...item.adjustments, [key]: value }
        })
      }
    })
  }

  const reset = (): void => {
    transact(() => {
      for (const item of items) patchItem(item.id, { adjustments: defaultAdjustments() })
    })
  }

  const built = adjustmentFilter(first.adjustments)
  const filter = built === NO_FILTER ? null : built
  const touched = items.some((item) => adjustmentFilter(item.adjustments) !== NO_FILTER)

  // Later tracks render on top, so the first video track is the bottom of the stack and has
  // nothing beneath it to blend with.
  const videoTracks = timeline.tracks.filter((track) => track.kind === 'video')
  const onBottom = items.every((item) => videoTracks[0]?.id === item.trackId)

  const blendValue = items.every((item) => (item.blendMode ?? 'normal') === (first.blendMode ?? 'normal'))
    ? (first.blendMode ?? 'normal')
    : 'normal'

  return (
    <>
      <Section
        title="Adjustments"
        // Not "Colour": a grade is what this explicitly is not, and the label is the promise.
        actions={
          touched ? (
            <Button variant="ghost" onClick={reset} icon={<RotateCcw className="size-3" />}>
              Reset
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-0.5">
          {CONTROLS.map((control) => {
            const { value, mixed } = read(control.key)
            return (
              <SliderField
                key={control.key}
                label={control.label}
                value={mixed ? control.min : value}
                mixed={mixed}
                min={control.min}
                max={control.max}
                step={control.step}
                format={(v) => formatAdjustment(v, control)}
                onCommit={(next) => set(control.key, next)}
              />
            )
          })}
        </div>

        {/* The filter the compositor will actually use, in the order it will apply it. Blur is
            last because it should act on the corrected colour — worth showing, because the
            order is not the order these sliders are in and someone will wonder. */}
        <p className="mt-2 font-mono text-[10px] leading-relaxed break-all text-ink-2">
          {filter ?? 'No filter — every value is at its identity, so the clip draws untouched.'}
        </p>
      </Section>

      <Section title="Blend">
        <Select<BlendMode>
          label="Blend mode"
          value={blendValue}
          options={BLEND_MODES}
          onChange={(mode) => {
            transact(() => {
              for (const item of items) patchItem(item.id, { blendMode: mode })
            })
          }}
          disabled={onBottom}
        />
        {/* Disabled with the reason, not hidden. A mode that silently does nothing is the dead
            control this codebase keeps finding; an absent one is a feature nobody knows exists. */}
        {onBottom ? (
          <p className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-2">
            <AlertTriangle aria-hidden="true" className="mt-px size-3 shrink-0" />
            <span>
              Nothing is underneath this clip — it is on the lowest video track, where every
              blend mode looks the same. Move it to a higher track to blend with what is below.
            </span>
          </p>
        ) : (
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink-2">
            How this clip combines with the tracks beneath it. Multiply darkens, screen lightens.
          </p>
        )}
      </Section>
    </>
  )
}
