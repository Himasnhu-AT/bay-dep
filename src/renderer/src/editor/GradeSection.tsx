import type { ReactNode } from 'react'
import type { Asset, Item } from '@shared/project'
import {
  DEFAULT_GRAIN_SIZE,
  DEFAULT_HALATION_COLOR,
  DEFAULT_HALATION_RADIUS,
  DEFAULT_HALATION_THRESHOLD,
  resolveGrade,
  type Grade,
  type GradeWheel
} from '@shared/grade'
import { ColorField, Field, NumberField, Section, SectionReset, Select, SliderField } from '@/components'
import { useEditor } from '@/store/editor'
import { Disclosure } from './Disclosure'

/**
 * Colour grade. The common controls first — white balance, saturation, the three wheels as
 * master sliders, a LUT, texture — and the per-channel wheels one level down in "Channels",
 * which is where a colour cast is set. Ranges are the agent's (`edit_item.grade`), so nothing
 * the agent can set reads back here as a pinned slider, and nothing set here is refused there.
 * Curves stay agent-only: a curve editor is a canvas widget of its own.
 *
 * The master sliders move all three channels together and keep any per-channel offset already
 * set, so nudging Lift never erases a cast.
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
  { key: 'temperature', label: 'Temperature (K)', caption: 'Temp', min: -3000, max: 3000, step: 10, identity: 0, format: (v) => (v === 0 ? 'Neutral' : `${signed(0)(v)}K`) },
  { key: 'tint', label: 'Tint', caption: 'Tint', min: -1, max: 1, step: 0.01, identity: 0, format: signed(2) },
  // "Grade saturation" in the accessible name: Adjustments has a saturation too, a CSS filter
  // drawn over the graded picture, and the two are different fields.
  { key: 'saturation', label: 'Grade saturation', caption: 'Saturation', min: 0, max: 4, step: 0.01, identity: 1, format: percent }
]

/** The agent's ranges (`mcp/grade.ts`), per channel. */
const WHEELS: { key: WheelKey; label: string; min: number; max: number; hint: string }[] = [
  { key: 'lift', label: 'Lift', min: -1, max: 1, hint: 'shadows' },
  { key: 'gamma', label: 'Gamma', min: -0.9, max: 4, hint: 'mid-tones' },
  { key: 'gain', label: 'Gain', min: -1, max: 4, hint: 'highlights' }
]

const CHANNELS: { key: keyof GradeWheel; label: string }[] = [
  { key: 'r', label: 'Red' },
  { key: 'g', label: 'Green' },
  { key: 'b', label: 'Blue' }
]

const AMOUNTS: { key: Amount; label: string }[] = [
  { key: 'halation', label: 'Halation' },
  { key: 'vignette', label: 'Vignette' },
  { key: 'grain', label: 'Grain' }
]

const mean = (w: GradeWheel | undefined): number => (w ? (w.r + w.g + w.b) / 3 : 0)
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

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

  const setWheel = (key: WheelKey, value: number): void => {
    const range = WHEELS.find((w) => w.key === key)!
    update((g) => {
      const delta = value - mean(g[key])
      const w = g[key] ?? { r: 0, g: 0, b: 0 }
      return {
        ...g,
        [key]: {
          r: clamp(w.r + delta, range.min, range.max),
          g: clamp(w.g + delta, range.min, range.max),
          b: clamp(w.b + delta, range.min, range.max)
        }
      }
    })
  }

  const setChannel = (key: WheelKey, channel: keyof GradeWheel, value: number): void =>
    update((g) => ({ ...g, [key]: { r: 0, g: 0, b: 0, ...g[key], [channel]: value } }))

  const setAmount = (key: Amount, amount: number): void =>
    update((g) => {
      if (amount <= 0) {
        const { [key]: _removed, ...rest } = g
        return rest
      }
      if (key === 'grain') return { ...g, grain: { size: g.grain?.size ?? DEFAULT_GRAIN_SIZE, amount } }
      if (key === 'halation') {
        return {
          ...g,
          halation: {
            threshold: g.halation?.threshold ?? DEFAULT_HALATION_THRESHOLD,
            radius: g.halation?.radius ?? DEFAULT_HALATION_RADIUS,
            ...(g.halation?.color ? { color: g.halation.color } : {}),
            amount
          }
        }
      }
      return { ...g, vignette: { amount } }
    })

  /** Whether the selection disagrees on one control, so its readout can say "Mixed". */
  const mixedOf = (read: (grade: Grade) => number | string): boolean => {
    const value = read(grade)
    return items.some((item) => read(item.grade ?? {}) !== value)
  }

  const touched = items.some((item) => item.grade)
  const active = items.some((item) => resolveGrade(item.grade) !== null)
  const lutOptions = [{ value: '', label: 'None' }, ...luts.map((lut) => ({ value: lut.id, label: lut.name }))]
  const halation = grade.halation
  const grain = grade.grain

  return (
    <Section
      id="inspector.grade"
      title="Grade"
      collapsible
      actions={
        <SectionReset
          show={touched}
          label="Reset grade"
          onReset={() => transact(() => items.forEach((item) => patchItem(item.id, { grade: undefined })))}
        />
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
            ariaLabel={`${control.label} (${control.hint}), all channels`}
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
      <Disclosure id="inspector.grade.channels" label="Channels — colour casts per wheel">
        <div className="space-y-2">
          {WHEELS.map((control) => (
            <div key={control.key} className="space-y-1">
              <p className="text-[10px] text-ink-2">
                {control.label} · {control.hint}
              </p>
              {CHANNELS.map((channel) => (
                <NumberField
                  key={channel.key}
                  row
                  label={channel.label}
                  ariaLabel={`${control.label} ${channel.label.toLowerCase()}`}
                  value={grade[control.key]?.[channel.key] ?? 0}
                  mixed={mixedOf((g) => g[control.key]?.[channel.key] ?? 0)}
                  min={control.min}
                  max={control.max}
                  step={0.005}
                  precision={3}
                  onCommit={(next) => setChannel(control.key, channel.key, next)}
                />
              ))}
            </div>
          ))}
          <p className="text-[10px] leading-relaxed text-ink-2">
            Equal red, green and blue is a brightness move; unequal is a cast. Curves are set by
            the agent (edit_item grade.curves).
          </p>
        </div>
      </Disclosure>

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
        {luts.length === 0 && (
          <p className="text-[10px] leading-relaxed text-ink-2">
            No LUT in this project yet. Import a .cube file in the Media panel and it appears here.
          </p>
        )}
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
      {(halation || grain) && (
        <Disclosure id="inspector.grade.texture" label="Halation and grain detail">
          <div className="space-y-1.5">
            {halation && (
              <>
                <SliderField
                  label="Threshold"
                  ariaLabel="Halation threshold: how bright a pixel must be to glow"
                  value={halation.threshold ?? DEFAULT_HALATION_THRESHOLD}
                  mixed={mixedOf((g) => g.halation?.threshold ?? DEFAULT_HALATION_THRESHOLD)}
                  min={0}
                  max={0.99}
                  step={0.01}
                  format={percent}
                  onCommit={(next) =>
                    update((g) => (g.halation ? { ...g, halation: { ...g.halation, threshold: next } } : g))
                  }
                />
                <NumberField
                  row
                  label="Radius"
                  ariaLabel="Halation radius in pixels"
                  value={halation.radius ?? DEFAULT_HALATION_RADIUS}
                  mixed={mixedOf((g) => g.halation?.radius ?? DEFAULT_HALATION_RADIUS)}
                  min={0.5}
                  max={200}
                  step={0.5}
                  precision={1}
                  suffix="px"
                  onCommit={(next) =>
                    update((g) => (g.halation ? { ...g, halation: { ...g.halation, radius: next } } : g))
                  }
                />
                <Field label="Glow">
                  <ColorField
                    label="Halation colour"
                    value={halation.color ?? DEFAULT_HALATION_COLOR}
                    onCommit={(color) =>
                      update((g) => (g.halation ? { ...g, halation: { ...g.halation, color } } : g))
                    }
                  />
                </Field>
              </>
            )}
            {grain && (
              <NumberField
                row
                label="Grain size"
                ariaLabel="Grain size in pixels"
                value={grain.size ?? DEFAULT_GRAIN_SIZE}
                mixed={mixedOf((g) => g.grain?.size ?? DEFAULT_GRAIN_SIZE)}
                min={0.5}
                max={16}
                step={0.1}
                precision={1}
                suffix="px"
                onCommit={(next) => update((g) => (g.grain ? { ...g, grain: { ...g.grain, size: next } } : g))}
              />
            )}
          </div>
        </Disclosure>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-ink-2">
        {active
          ? 'Graded on the GPU, identically in preview and export.'
          : 'No grade — the clip draws untouched, at no extra cost.'}
      </p>
    </Section>
  )
}
