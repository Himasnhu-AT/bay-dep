import type { ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { TextStyle } from '@shared/project'
import type { TextFill, TextJoin } from '@shared/text-style'
import { ColorField, Field, IconButton, NumberField, Section, SegmentedControl, Select, Switch } from '@/components'
import { LIVE } from './liveGesture'

/**
 * The paint stack's controls: gradient and hollow fills, a second outline, a second shadow, a
 * glow, and how the plate is shaped. Each sits with the single control it extends, in the same
 * sections, with the same primitives.
 *
 * The panel edits the first layer of each stack — a second outline, a second shadow — and a
 * gradient's two end stops. A longer stack (an agent's, through `edit_item`) is kept as it is:
 * editing here changes the layer shown and leaves the rest in place, and the count is said.
 */
export interface LayerControlsProps {
  style: TextStyle
  /** Applies a partial style to every selected title as one undo step. */
  set(patch: Partial<TextStyle>): void
  /** Removes fields from every selected title — `undefined` in a patch would leave the key behind. */
  unset(...keys: ('fills' | 'strokes' | 'shadows' | 'glow' | 'plate')[]): void
}

type FillMode = 'solid' | 'linear' | 'radial' | 'hollow'

const GRADIENT_ON = [
  { at: 0, color: '#FFD36E' },
  { at: 1, color: '#FF5E7E' }
]
const STROKE_ON = { color: '#FFFFFF', width: 4 }
const SHADOW_ON = { color: '#000000', blur: 0, offsetX: 4, offsetY: 4 }
const GLOW_ON = { color: '#39E6FF', blur: 24 }

const JOINS: { value: TextJoin; label: string }[] = [
  { value: 'round', label: 'Round' },
  { value: 'miter', label: 'Sharp' },
  { value: 'bevel', label: 'Bevel' }
]

function more(count: number, what: string): ReactNode {
  if (count <= 1) return null
  return <p className="mt-1 text-[10px] text-ink-2">{`${count - 1} more ${what}${count === 2 ? '' : 's'} on this title, kept as set.`}</p>
}

/** The fill: the plain colour, a two-stop gradient, or none at all. */
export function FillSection({ style, set, unset }: LayerControlsProps): ReactNode {
  const top = style.fills?.[style.fills.length - 1]
  const mode: FillMode = style.fills === undefined ? 'solid' : style.fills.length === 0 ? 'hollow' : top && top.kind !== 'solid' ? top.kind : 'solid'
  const gradient = top && top.kind !== 'solid' ? top : null
  const stops = gradient?.stops ?? GRADIENT_ON

  /** Replaces the top fill, keeping any fills under it (an offset copy for a lifted look). */
  const setTop = (fill: TextFill): void => set({ fills: [...(style.fills ?? []).slice(0, -1), fill] })

  const choose = (next: FillMode): void => {
    if (next === 'solid') unset('fills')
    else if (next === 'hollow') set({ fills: [] })
    else if (next === 'linear') set({ fills: [{ kind: 'linear', angle: gradient && gradient.kind === 'linear' ? gradient.angle : 90, stops }] })
    else set({ fills: [{ kind: 'radial', stops }] })
  }
  const setStop = (index: 0 | 1, color: string): void => {
    if (!gradient) return
    const at = index === 0 ? 0 : gradient.stops.length - 1
    setTop({ ...gradient, stops: gradient.stops.map((stop, i) => (i === at ? { ...stop, color } : stop)) })
  }

  return (
    <Section id="inspector.fill" title="Fill" collapsible defaultOpen={mode !== 'solid'}>
      <SegmentedControl
        label="Fill kind"
        value={mode}
        onChange={choose}
        options={[
          { value: 'solid', label: 'Colour' },
          { value: 'linear', label: 'Linear' },
          { value: 'radial', label: 'Radial' },
          { value: 'hollow', label: 'Hollow' }
        ]}
      />
      {gradient ? (
        <div className="mt-1.5 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <ColorField label="Gradient start colour" gesture={LIVE} value={stops[0]!.color} onCommit={(color) => setStop(0, color)} />
            <ColorField label="Gradient end colour" gesture={LIVE} value={stops[stops.length - 1]!.color} onCommit={(color) => setStop(1, color)} />
          </div>
          {gradient.kind === 'linear' && (
            <NumberField
              row
              label="Angle"
              ariaLabel="Gradient angle"
              value={gradient.angle}
              onCommit={(angle) => setTop({ ...gradient, angle })}
              defaultValue={90}
              gesture={LIVE}
              min={-360}
              max={360}
              suffix="°"
            />
          )}
          {gradient.stops.length > 2 && <p className="text-[10px] text-ink-2">{`${gradient.stops.length - 2} stop${gradient.stops.length === 3 ? '' : 's'} between these, kept as set.`}</p>}
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] text-ink-2">
          {mode === 'hollow' ? 'No fill: only the outline draws. Add one in Outline.' : 'The colour in Type.'}
        </p>
      )}
      {more(style.fills?.length ?? 0, 'fill')}
    </Section>
  )
}

/** A second outline, outside the first. Rendered inside the Outline section. */
export function SecondOutline({ style, set, unset }: LayerControlsProps): ReactNode {
  const second = style.strokes?.[0]
  const rest = style.strokes?.slice(1) ?? []
  const write = (next: typeof second): void => {
    if (next) set({ strokes: [next, ...rest] })
    else if (rest.length > 0) set({ strokes: rest })
    else unset('strokes')
  }
  return (
    <div className="mt-2 border-t border-line pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-1">Second outline</span>
        <IconButton
          size="xs"
          tooltipSide="left"
          label={second ? 'Remove the second outline' : 'Add a second outline outside the first'}
          active={Boolean(second)}
          icon={second ? <Minus className="size-3" /> : <Plus className="size-3" />}
          onClick={() => write(second ? undefined : STROKE_ON)}
        />
      </div>
      {second && (
        <>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <ColorField label="Second outline colour" gesture={LIVE} value={second.color} onCommit={(color) => write({ ...second, color })} />
            <NumberField
              label="Width"
              ariaLabel="Second outline width"
              value={second.width}
              onCommit={(width) => write({ ...second, width: Math.max(0.5, width) })}
              defaultValue={STROKE_ON.width}
              gesture={LIVE}
              min={0.5}
              max={64}
              suffix="px"
            />
          </div>
          <div className="mt-1.5">
            <Field label="Corners">
              <Select
                label="Second outline corners"
                value={second.join ?? 'round'}
                options={JOINS}
                onChange={(join) => {
                  const { join: _old, ...plain } = second
                  write(join === 'round' ? plain : { ...plain, join })
                }}
              />
            </Field>
          </div>
          {more(style.strokes?.length ?? 0, 'outline')}
        </>
      )}
    </div>
  )
}

/** A second drop shadow, behind the first. Rendered inside the Shadow section. */
export function SecondShadow({ style, set, unset }: LayerControlsProps): ReactNode {
  const second = style.shadows?.[0]
  const rest = style.shadows?.slice(1) ?? []
  const write = (next: typeof second): void => {
    if (next) set({ shadows: [next, ...rest] })
    else if (rest.length > 0) set({ shadows: rest })
    else unset('shadows')
  }
  return (
    <div className="mt-2 border-t border-line pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-1">Second shadow</span>
        <IconButton
          size="xs"
          tooltipSide="left"
          label={second ? 'Remove the second shadow' : 'Add a second shadow'}
          active={Boolean(second)}
          icon={second ? <Minus className="size-3" /> : <Plus className="size-3" />}
          onClick={() => write(second ? undefined : SHADOW_ON)}
        />
      </div>
      {second && (
        <>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <ColorField label="Second shadow colour" gesture={LIVE} value={second.color} onCommit={(color) => write({ ...second, color })} />
            <NumberField label="Blur" ariaLabel="Second shadow blur" value={second.blur} onCommit={(blur) => write({ ...second, blur: Math.max(0, blur) })} defaultValue={SHADOW_ON.blur} gesture={LIVE} min={0} max={200} suffix="px" />
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <NumberField label="X" ariaLabel="Second shadow X offset" value={second.offsetX} onCommit={(offsetX) => write({ ...second, offsetX })} defaultValue={SHADOW_ON.offsetX} gesture={LIVE} suffix="px" />
            <NumberField label="Y" ariaLabel="Second shadow Y offset" value={second.offsetY} onCommit={(offsetY) => write({ ...second, offsetY })} defaultValue={SHADOW_ON.offsetY} gesture={LIVE} suffix="px" />
          </div>
          {more(style.shadows?.length ?? 0, 'shadow')}
        </>
      )}
    </div>
  )
}

/** A halo around the letters. Its own section, after Shadow. */
export function GlowSection({ style, set, unset }: LayerControlsProps): ReactNode {
  const glow = style.glow
  return (
    <Section
      id="inspector.glow"
      title="Glow"
      collapsible
      defaultOpen={Boolean(glow)}
      actions={
        <IconButton
          size="xs"
          tooltipSide="left"
          label={glow ? 'Remove glow' : 'Add glow'}
          active={Boolean(glow)}
          icon={glow ? <Minus className="size-3" /> : <Plus className="size-3" />}
          onClick={() => (glow ? unset('glow') : set({ glow: GLOW_ON }))}
        />
      }
    >
      {glow ? (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <ColorField label="Glow colour" gesture={LIVE} value={glow.color} onCommit={(color) => set({ glow: { ...glow, color } })} />
            <NumberField label="Spread" ariaLabel="Glow spread" value={glow.blur} onCommit={(blur) => set({ glow: { ...glow, blur: Math.max(1, blur) } })} defaultValue={GLOW_ON.blur} gesture={LIVE} min={1} max={200} suffix="px" />
          </div>
          <div className="mt-1.5">
            <NumberField
              row
              label="Strength"
              ariaLabel="Glow strength"
              value={glow.strength ?? 1}
              onCommit={(value) => {
                const strength = Math.max(1, Math.min(4, Math.round(value)))
                const { strength: _old, ...plain } = glow
                set({ glow: strength === 1 ? plain : { ...plain, strength } })
              }}
              defaultValue={1}
              min={1}
              max={4}
              step={1}
            />
          </div>
        </>
      ) : (
        <p className="text-[11px] text-ink-2">Off. A halo of one colour; three layers of it is a neon tube.</p>
      )}
    </Section>
  )
}

/** How the plate is shaped. Rendered inside the Plate section, when there is a plate. */
export function PlateShape({ style, set, unset }: LayerControlsProps): ReactNode {
  const background = style.background
  if (!background) return null
  const plate = style.plate ?? {}
  const write = (next: NonNullable<TextStyle['plate']>): void => {
    if (Object.keys(next).length > 0) set({ plate: next })
    else unset('plate')
  }
  const axis = (key: 'paddingX' | 'paddingY', value: number): void => {
    const { [key]: _old, ...rest } = plate
    // Equal to the plate's own padding is the default, stored as absence.
    write(value === background.padding ? rest : { ...rest, [key]: value })
  }
  return (
    <div className="mt-2 border-t border-line pt-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="inspector-plate-per-line" className="text-[11px] text-ink-1">
          A bar behind each line
        </label>
        <Switch
          id="inspector-plate-per-line"
          checked={plate.perLine === true}
          onChange={(perLine) => {
            const { perLine: _old, ...rest } = plate
            write(perLine ? { ...rest, perLine: true } : rest)
          }}
        />
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <NumberField label="Pad X" ariaLabel="Plate padding left and right" value={plate.paddingX ?? background.padding} onCommit={(value) => axis('paddingX', Math.max(0, value))} defaultValue={background.padding} gesture={LIVE} min={0} max={400} suffix="px" />
        <NumberField label="Pad Y" ariaLabel="Plate padding top and bottom" value={plate.paddingY ?? background.padding} onCommit={(value) => axis('paddingY', Math.max(0, value))} defaultValue={background.padding} gesture={LIVE} min={0} max={400} suffix="px" />
      </div>
    </div>
  )
}
