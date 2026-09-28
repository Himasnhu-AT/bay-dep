import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  adjustmentsOf,
  defaultAdjustments,
  type Adjustments,
  type BlendMode,
  type Item,
  type Timeline
} from '@shared/project'
import { Field, Section, SectionReset, Select, SliderField } from '@/components'
import { centredRange } from '@/components/controls/Slider'
import { adjustmentFilter, NO_FILTER } from '../engine/looks'
import { useEditor } from '@/store/editor'
import { LIVE } from './liveGesture'

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
  /** The value that changes nothing; the slider fills from here. */
  identity: number
}

const CONTROLS: Control[] = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 3, step: 0.01, identity: 1 },
  { key: 'contrast', label: 'Contrast', min: 0, max: 3, step: 0.01, identity: 1 },
  // "Saturate", not "Saturation": the Grade has a saturation of its own (a GPU pass before the
  // LUT); this one is a CSS filter over the graded picture. Two controls with one name read as a
  // duplicate, and they are two fields that multiply.
  { key: 'saturate', label: 'Saturate', min: 0, max: 3, step: 0.01, identity: 1 },
  // Degrees, and the full turn is available: 360 is the identity but the wrap is how people
  // find the hue they want, so the range is not cut short at 359.
  { key: 'hueRotate', label: 'Hue', min: -180, max: 180, step: 1, unit: '°', identity: 0 },
  // Canvas pixels, deliberately not normalised. 8px is a different blur at 1080p and at 4K, so
  // a 0..1 value would be a lie at one of them; the number shown is the number drawn.
  { key: 'blur', label: 'Blur', min: 0, max: 40, step: 0.5, unit: 'px', identity: 0 },
  { key: 'grayscale', label: 'Greyscale', min: 0, max: 1, step: 0.01, identity: 0 },
  { key: 'sepia', label: 'Sepia', min: 0, max: 1, step: 0.01, identity: 0 },
  { key: 'invert', label: 'Invert', min: 0, max: 1, step: 0.01, identity: 0 }
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
 * cannot reach. The name is the honest part. The inspector puts them under Effects and the grade
 * under Color, so the two saturations (this `saturate`, the grade's `saturation`) never sit in
 * one list looking like a duplicate: they are two fields that multiply.
 *
 * Every control here is backed: `applyLook` in the compositor reads both fields on both draw
 * paths, and the filter string shown at the bottom comes from `adjustmentFilter`, the function
 * that actually composites, rather than from a second opinion that could disagree with it.
 *
 * `blend: false` leaves the blend mode out, for a caller that shows it elsewhere (the
 * inspector's Video › Composite); on its own this still renders both, as it always has.
 */
export function AdjustmentsSection({
  items,
  timeline,
  blend = true
}: {
  items: Item[]
  timeline: Timeline
  blend?: boolean
}): ReactNode {
  const patchItem = useEditor((state) => state.patchItem)
  // One slider commit is one undo step across the whole selection — see the note in
  // `Inspector.tsx`. A per-item `patchItem` loop without this is one entry per clip.
  const transact = useEditor((state) => state.transact)
  const first = items[0]
  if (!first) return null

  const read = (key: keyof Adjustments): { value: number; mixed: boolean } => {
    const of = (item: Item): number => adjustmentsOf(item.adjustments)[key]
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
          adjustments: { ...adjustmentsOf(item.adjustments), [key]: value }
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
  const touched = adjustmentsTouched(items)

  return (
    <>
      <Section
        id="inspector.adjustments"
        title="Adjustments"
        collapsible
        hint="A quick filter look drawn over the picture, after the colour grade where a clip has one. Saturate here multiplies with the grade's Saturation."
        // Not "Colour": a grade is what this explicitly is not, and the label is the promise.
        actions={<SectionReset show={touched} label="Reset adjustments" onReset={reset} />}
      >
        <div className="space-y-0.5">
          {CONTROLS.map((control) => {
            const { value, mixed } = read(control.key)
            return (
              <SliderField
                key={control.key}
                label={control.label}
                value={mixed ? control.identity : value}
                mixed={mixed}
                // Brightness, Contrast and Saturate are 0…3 at 1: the track centres the identity
                // (0…2) and stretches for a value set higher. The rest start or centre on theirs.
                {...centredRange(
                  control.identity,
                  control.identity === control.min
                    ? control.max - control.min
                    : Math.min(control.identity - control.min, control.max - control.identity),
                  mixed ? control.identity : value,
                  control
                )}
                step={control.step}
                format={(v) => formatAdjustment(v, control)}
                onCommit={(next) => set(control.key, next)}
                defaultValue={control.identity}
                gesture={LIVE}
              />
            )
          })}
        </div>

        {/* The filter the compositor will actually use, in the order it will apply it. Blur is
            last because it should act on the corrected colour — worth showing, because the
            order is not the order these sliders are in and someone will wonder. Wrapped at the
            spaces between functions: `break-all` split "identity" as "ident / ity". */}
        {filter ? (
          <p
            className="mt-2 font-mono text-[10px] leading-relaxed break-words text-ink-2"
            title="The filter the compositor applies, in its order"
          >
            {filter}
          </p>
        ) : (
          <p className="mt-2 text-[10px] text-ink-2">No filter — the clip draws untouched.</p>
        )}
      </Section>

      {blend && <BlendSection items={items} timeline={timeline} />}
    </>
  )
}

/** Whether any clip has an adjustment off its identity — the Effects tab's badge and the reset. */
export function adjustmentsTouched(items: Item[]): boolean {
  return items.some((item) => adjustmentFilter(item.adjustments) !== NO_FILTER)
}

/**
 * How a clip combines with the tracks beneath it — Resolve's Composite group. `title` is
 * "Composite" in the inspector's Video tab; standalone it is "Blend".
 */
export function BlendSection({
  items,
  timeline,
  title = 'Blend'
}: {
  items: Item[]
  timeline: Timeline
  title?: string
}): ReactNode {
  const patchItem = useEditor((state) => state.patchItem)
  const transact = useEditor((state) => state.transact)
  const first = items[0]
  if (!first) return null

  // Later tracks render on top, so the first video track is the bottom of the stack and has
  // nothing beneath it to blend with.
  const videoTracks = timeline.tracks.filter((track) => track.kind === 'video')
  const onBottom = items.every((item) => videoTracks[0]?.id === item.trackId)

  const blendValue = items.every((item) => (item.blendMode ?? 'normal') === (first.blendMode ?? 'normal'))
    ? (first.blendMode ?? 'normal')
    : 'normal'

  return (
    <Section
      id="inspector.blend"
      title={title}
      collapsible
      hint="How this clip combines with the tracks beneath it. Multiply darkens, screen lightens."
      actions={
        <SectionReset
          show={items.some((item) => (item.blendMode ?? 'normal') !== 'normal')}
          label="Reset blend mode to normal"
          onReset={() =>
            transact(() => {
              for (const item of items) patchItem(item.id, { blendMode: 'normal' })
            })
          }
        />
      }
    >
      <Field label="Mode">
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
      </Field>
      {/* Disabled with the reason, not hidden. A mode that silently does nothing is the dead
          control this codebase keeps finding; an absent one is a feature nobody knows exists. */}
      {onBottom && (
        <p
          className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-2"
          title="Every blend mode looks the same with nothing underneath. Move the clip to a higher track to blend with what is below."
        >
          <AlertTriangle aria-hidden="true" className="mt-px size-3 shrink-0" />
          <span>On the lowest video track — nothing underneath to blend with.</span>
        </p>
      )}
    </Section>
  )
}
