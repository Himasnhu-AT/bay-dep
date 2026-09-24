import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import type { Asset, Item } from '@shared/project'
import { resolveGrade, type Grade, type GradeWheel } from '@shared/grade'
import { Button, Field, Section, Select, SliderField } from '@/components'
import { useEditor } from '@/store/editor'

/**
 * Colour grade — the small version of the controls. The agent's `edit_item` reaches every field
 * (per-channel wheels, curves); this section holds the handful a person reaches for by hand. The
 * wheel sliders move all three channels together and keep any per-channel offset already set, so
 * nudging Lift here never erases a cast the agent put in.
 *
 * Every control is backed by the same WebGL pass preview and export draw through
 * (`engine/grade.ts`); the line at the bottom says whether the compositor will run it at all.
 */

type Scalar = 'temperature' | 'tint' | 'saturation'
type WheelKey = 'lift' | 'gamma' | 'gain'
type Amount = 'grain' | 'halation' | 'vignette'

/** A signed readout, so a slider left of its identity reads as a direction and not a size. */
const signed =
  (decimals: number) =>
  (value: number): string =>
    `${value > 0 ? '+' : ''}${value.toFixed(decimals)}`
const percent = (value: number): string => `${Math.round(value * 100)}%`

/**
 * `label` is the accessible name and what the agent's docs call the field; `caption` is what fits
 * the inspector's 64px label column. "Temperature (K)" truncated to "Temperatu…" there.
 */
const SCALARS: {
  key: Scalar
  label: string
  caption: string
  min: number
  max: number
  step: number
  identity: number
  format(value: number): string
}[] = [
  { key: 'temperature', label: 'Temperature (K)', caption: 'Temp', min: -1000, max: 1000, step: 10, identity: 0, format: (v) => `${signed(0)(v)}K` },
  { key: 'tint', label: 'Tint', caption: 'Tint', min: -1, max: 1, step: 0.01, identity: 0, format: signed(2) },
  { key: 'saturation', label: 'Saturation', caption: 'Saturation', min: 0, max: 2, step: 0.01, identity: 1, format: percent }
]

const WHEELS: { key: WheelKey; label: string; min: number; max: number }[] = [
  { key: 'lift', label: 'Lift', min: -0.2, max: 0.2 },
  { key: 'gamma', label: 'Gamma', min: -0.5, max: 0.5 },
  { key: 'gain', label: 'Gain', min: -0.5, max: 0.5 }
]

const AMOUNTS: { key: Amount; label: string }[] = [
  { key: 'halation', label: 'Halation' },
  { key: 'vignette', label: 'Vignette' },
  { key: 'grain', label: 'Grain' }
]

const mean = (w: GradeWheel | undefined): number => (w ? (w.r + w.g + w.b) / 3 : 0)

export function GradeSection({ items, luts }: { items: Item[]; luts: Asset[] }): ReactNode {
  const patchItem = useEditor((state) => state.patchItem)
  const transact = useEditor((state) => state.transact)
  const first = items[0]
  if (!first) return null
  const grade = first.grade ?? {}

  // Applied to each item's own grade, so a multi-selection keeps each clip's other settings.
  const update = (change: (grade: Grade) => Grade): void => {
    transact(() => {
      for (const item of items) {
        const next = change({ ...item.grade })
        patchItem(item.id, { grade: Object.keys(next).length > 0 ? next : undefined })
      }
    })
  }

  const setWheel = (key: WheelKey, value: number): void =>
    update((g) => {
      const delta = value - mean(g[key])
      const w = g[key] ?? { r: 0, g: 0, b: 0 }
      return { ...g, [key]: { r: w.r + delta, g: w.g + delta, b: w.b + delta } }
    })

  const setAmount = (key: Amount, amount: number): void =>
    update((g) => {
      if (amount <= 0) {
        const { [key]: _removed, ...rest } = g
        return rest
      }
      const size = key === 'grain' ? { size: g.grain?.size ?? 1 } : {}
      return { ...g, [key]: { ...g[key], ...size, amount } }
    })

  /** Whether the selection disagrees on one control, so its readout can say "Mixed". */
  const mixedOf = (read: (grade: Grade) => number): boolean => {
    const value = read(grade)
    return items.some((item) => read(item.grade ?? {}) !== value)
  }

  const active = items.some((item) => resolveGrade(item.grade) !== null)
  const lutOptions = [{ value: '', label: 'None' }, ...luts.map((lut) => ({ value: lut.id, label: lut.name }))]

  return (
    <Section
      title="Grade"
      actions={
        items.some((item) => item.grade) ? (
          <Button
            variant="ghost"
            onClick={() => transact(() => items.forEach((item) => patchItem(item.id, { grade: undefined })))}
            icon={<RotateCcw className="size-3" />}
          >
            Reset
          </Button>
        ) : undefined
      }
    >
      {/* Grouped the way a colourist reaches for them — balance, then tone, then the LUT, then
          texture — with a gap between groups rather than one undifferentiated column. */}
      <div className="space-y-0.5">
        {SCALARS.map((control) => (
          <SliderField
            key={control.key}
            label={control.caption}
            ariaLabel={control.label}
            value={grade[control.key] ?? control.identity}
            mixed={mixedOf((g) => g[control.key] ?? control.identity)}
            min={control.min}
            max={control.max}
            step={control.step}
            format={control.format}
            onCommit={(next) => update((g) => ({ ...g, [control.key]: next }))}
          />
        ))}
      </div>
      <div className="mt-2 space-y-0.5">
        {WHEELS.map((control) => (
          <SliderField
            key={control.key}
            label={control.label}
            value={mean(grade[control.key])}
            mixed={mixedOf((g) => mean(g[control.key]))}
            min={control.min}
            max={control.max}
            step={0.005}
            format={signed(3)}
            onCommit={(next) => setWheel(control.key, next)}
          />
        ))}
      </div>
      <div className="mt-2 space-y-0.5">
        <Field label="LUT">
          <Select<string>
            label="LUT"
            value={grade.lut?.assetId ?? ''}
            options={lutOptions}
            onChange={(id) =>
              update((g) => {
                if (!id) {
                  const { lut: _removed, ...rest } = g
                  return rest
                }
                return { ...g, lut: { assetId: id, intensity: g.lut?.intensity ?? 1 } }
              })
            }
            disabled={luts.length === 0}
          />
        </Field>
        {grade.lut && (
          <SliderField
            label="Intensity"
            ariaLabel="LUT intensity"
            value={grade.lut.intensity}
            min={0}
            max={1}
            step={0.01}
            format={percent}
            onCommit={(next) => update((g) => (g.lut ? { ...g, lut: { ...g.lut, intensity: next } } : g))}
          />
        )}
      </div>
      <div className="mt-2 space-y-0.5">
        {AMOUNTS.map((control) => (
          <SliderField
            key={control.key}
            label={control.label}
            value={grade[control.key]?.amount ?? 0}
            mixed={mixedOf((g) => g[control.key]?.amount ?? 0)}
            min={0}
            max={1}
            step={0.01}
            format={percent}
            onCommit={(next) => setAmount(control.key, next)}
          />
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-ink-2">
        {luts.length === 0 ? 'Import a .cube file to use a LUT. ' : ''}
        {active
          ? 'Graded on the GPU, identically in preview and export.'
          : 'No grade — the clip draws untouched, at no extra cost.'}
      </p>
    </Section>
  )
}
