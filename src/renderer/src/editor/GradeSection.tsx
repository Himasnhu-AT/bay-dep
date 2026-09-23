import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import type { Asset, Item } from '@shared/project'
import { resolveGrade, type Grade, type GradeWheel } from '@shared/grade'
import { Button, Section, Select, Slider } from '@/components'
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

const SCALARS: { key: Scalar; label: string; min: number; max: number; step: number; identity: number }[] = [
  { key: 'temperature', label: 'Temperature (K)', min: -1000, max: 1000, step: 10, identity: 0 },
  { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01, identity: 0 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, identity: 1 }
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
      <div className="space-y-2">
        {SCALARS.map((control) => (
          <Slider
            key={control.key}
            label={control.label}
            value={grade[control.key] ?? control.identity}
            min={control.min}
            max={control.max}
            step={control.step}
            onCommit={(next) => update((g) => ({ ...g, [control.key]: next }))}
          />
        ))}
        {WHEELS.map((control) => (
          <Slider
            key={control.key}
            label={control.label}
            value={mean(grade[control.key])}
            min={control.min}
            max={control.max}
            step={0.005}
            onCommit={(next) => setWheel(control.key, next)}
          />
        ))}
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
        {grade.lut && (
          <Slider
            label="LUT intensity"
            value={grade.lut.intensity}
            min={0}
            max={1}
            step={0.01}
            onCommit={(next) => update((g) => (g.lut ? { ...g, lut: { ...g.lut, intensity: next } } : g))}
          />
        )}
        {AMOUNTS.map((control) => (
          <Slider
            key={control.key}
            label={control.label}
            value={grade[control.key]?.amount ?? 0}
            min={0}
            max={1}
            step={0.01}
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
