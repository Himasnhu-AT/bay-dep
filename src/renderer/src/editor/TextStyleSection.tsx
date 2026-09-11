import type { ReactNode } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlertTriangle,
  Italic,
  Minus,
  Plus
} from 'lucide-react'
import { defaultTextStyle, type Asset, type Item, type TextStyle } from '@shared/project'
import {
  ColorField,
  Field,
  IconButton,
  NumberField,
  Section,
  SegmentedControl,
  Select
} from '@/components'
import { useTextFit } from '@/lib/useTextFit'
import { useEditor } from '@/store/editor'

/**
 * Families **measured** as present on this machine, not assumed.
 *
 * A family that is not installed does not fail — canvas substitutes another silently, and
 * because the preview and the export share one renderer they substitute *together*, so the
 * swap is invisible until someone opens the delivered file somewhere else. Offering only
 * what is there is the difference between choosing a typeface and hoping for one.
 *
 * The list was checked rather than written from memory, by measuring a distinctive string
 * in each family against a deliberately absent sentinel and comparing widths. That caught
 * two entries a plausible-looking list had wrong: **SF Mono** is not reachable from the web
 * layer despite shipping with macOS, and **Haettenschweiler** is a Windows face. Both were
 * sitting mid-stack as fallbacks that would never have fired, which is exactly the kind of
 * wrong that never announces itself.
 *
 * `engine/render.ts` reports `fontAvailable` per draw, which measures the real answer on the
 * real machine — this list is what we offer, that flag is what actually happened.
 */
const FAMILIES: { value: string; label: string }[] = [
  { value: 'system-ui, -apple-system, Helvetica, Arial, sans-serif', label: 'System' },
  { value: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: 'Helvetica Neue' },
  { value: '"Avenir Next", Avenir, sans-serif', label: 'Avenir Next' },
  { value: 'Futura, "Trebuchet MS", sans-serif', label: 'Futura' },
  { value: 'Optima, Candara, sans-serif', label: 'Optima' },
  { value: '"Gill Sans", "Gill Sans MT", sans-serif', label: 'Gill Sans' },
  { value: 'Impact, sans-serif', label: 'Impact' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Didot, "Bodoni 72", serif', label: 'Didot' },
  { value: 'Baskerville, serif', label: 'Baskerville' },
  { value: 'Palatino, "Palatino Linotype", serif', label: 'Palatino' },
  { value: '"American Typewriter", serif', label: 'American Typewriter' },
  { value: 'Menlo, Monaco, monospace', label: 'Menlo' },
  { value: '"Courier New", Courier, monospace', label: 'Courier' }
]

const WEIGHTS = [
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semibold' },
  { value: '700', label: 'Bold' },
  { value: '800', label: 'Heavy' }
]

export interface TextStyleSectionProps {
  /** The text items in the selection. Every edit applies to all of them. */
  items: Item[]
  /** The first item's asset, for the words the fit is computed against. */
  asset: Asset | undefined
}

/**
 * Type controls for the selected text items.
 *
 * Every edit is one `transact`, so changing a colour across a multi-selection is one undo
 * step rather than one per clip — the same rule the MCP tools hold to, for the same reason.
 *
 * Values are read from the first selected item. Text items are usually styled one at a
 * time, and a "Mixed" readout on twelve controls would cost more than it tells; the
 * multi-selection case that matters is *applying* one value to several, which works.
 */
export function TextStyleSection({ items, asset }: TextStyleSectionProps): ReactNode {
  const patchItem = useEditor((state) => state.patchItem)
  const transact = useEditor((state) => state.transact)
  const first = items[0]
  const fit = useTextFit(first, asset, {
    left: first?.layout.left ?? 0,
    top: first?.layout.top ?? 0,
    width: first?.layout.width ?? 0,
    height: first?.layout.height ?? 0
  })

  if (!first) return null
  const style = first.text ?? defaultTextStyle()

  /** Applies a partial style to every selected text item, as one undo step. */
  const set = (patch: Partial<TextStyle>): void => {
    transact(() => {
      for (const item of items) {
        patchItem(item.id, { text: { ...(item.text ?? defaultTextStyle()), ...patch } })
      }
    })
  }

  const toggle = <K extends 'stroke' | 'shadow' | 'background'>(
    key: K,
    on: TextStyle[K]
  ): void => set({ [key]: style[key] ? null : on } as Partial<TextStyle>)

  return (
    <>
      <Section
        title={items.length > 1 ? `Type · ${items.length} selected` : 'Type'}
        actions={
          <IconButton
            size="xs"
            tooltipSide="left"
            label={style.italic ? 'Upright' : 'Italic'}
            active={style.italic}
            icon={<Italic className="size-3" />}
            onClick={() => set({ italic: !style.italic })}
          />
        }
      >
        <Field label="Font">
          <Select
            label="Font family"
            value={FAMILIES.some((f) => f.value === style.fontFamily) ? style.fontFamily : 'custom'}
            options={
              FAMILIES.some((f) => f.value === style.fontFamily)
                ? FAMILIES
                : [...FAMILIES, { value: 'custom', label: 'Custom (from a file)' }]
            }
            onChange={(value) => value !== 'custom' && set({ fontFamily: value })}
          />
        </Field>
        <div className="mt-1.5">
          <Field label="Weight">
            <Select
              label="Font weight"
              value={String(style.fontWeight)}
              options={WEIGHTS}
              onChange={(value) => set({ fontWeight: Number(value) })}
            />
          </Field>
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <NumberField
            label="Size"
            value={style.fontSize}
            onCommit={(value) => set({ fontSize: Math.max(1, value) })}
            min={1}
            max={2000}
            suffix="px"
          />
          <NumberField
            label="Line"
            value={style.lineHeight}
            onCommit={(value) => set({ lineHeight: value })}
            step={0.05}
            min={0.5}
            max={4}
            precision={2}
            suffix="×"
          />
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <NumberField
            label="Track"
            value={style.letterSpacing}
            onCommit={(value) => set({ letterSpacing: value })}
            step={0.5}
            precision={1}
            suffix="px"
          />
          <ColorField label="Colour" value={style.color} onCommit={(value) => set({ color: value })} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <SegmentedControl
            label="Horizontal alignment"
            value={style.align}
            onChange={(align) => set({ align })}
            options={[
              { value: 'left', label: 'Left', icon: <AlignLeft className="size-3.5" /> },
              { value: 'center', label: 'Centre', icon: <AlignCenter className="size-3.5" /> },
              { value: 'right', label: 'Right', icon: <AlignRight className="size-3.5" /> }
            ]}
          />
          <SegmentedControl
            label="Vertical alignment"
            value={style.verticalAlign}
            onChange={(verticalAlign) => set({ verticalAlign })}
            options={[
              { value: 'top', label: 'Top', icon: <AlignVerticalJustifyStart className="size-3.5" /> },
              { value: 'middle', label: 'Middle', icon: <AlignVerticalJustifyCenter className="size-3.5" /> },
              { value: 'bottom', label: 'Bottom', icon: <AlignVerticalJustifyEnd className="size-3.5" /> }
            ]}
          />
        </div>
        {/* The three ways text goes wrong are all invisible in the picture, so the panel
            where the size was typed is where they have to be said. */}
        {fit && fit.warnings.length > 0 ? (
          <ul className="mt-2 space-y-1 rounded-sm border border-danger/40 bg-danger/10 p-1.5">
            {fit.warnings.map((warning) => (
              <li
                key={warning}
                className="flex items-start gap-1.5 text-[10px] leading-relaxed text-danger"
              >
                <AlertTriangle aria-hidden="true" className="mt-px size-3 shrink-0" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink-2">
            {fit
              ? `Fits on ${fit.laid.lines.length} line${fit.laid.lines.length === 1 ? '' : 's'} at ${fit.laid.fontSize}px. Text wraps inside the clip’s box — set it in Transform above.`
              : 'Text wraps inside the clip’s box on the canvas — set it in Transform above.'}
          </p>
        )}
      </Section>

      <Section
        title="Outline"
        actions={
          <IconButton
            size="xs"
            tooltipSide="left"
            label={style.stroke ? 'Remove outline' : 'Add outline'}
            active={Boolean(style.stroke)}
            icon={style.stroke ? <Minus className="size-3" /> : <Plus className="size-3" />}
            onClick={() => toggle('stroke', { color: '#000000', width: 4 })}
          />
        }
      >
        {style.stroke ? (
          <div className="grid grid-cols-2 gap-1.5">
            <ColorField
              label="Outline colour"
              value={style.stroke.color}
              onCommit={(color) => set({ stroke: { ...style.stroke!, color } })}
            />
            <NumberField
              label="Width"
              value={style.stroke.width}
              onCommit={(width) => set({ stroke: { ...style.stroke!, width: Math.max(0, width) } })}
              min={0}
              max={64}
              suffix="px"
            />
          </div>
        ) : (
          <p className="text-[11px] text-ink-2">Off. An outline keeps type legible over busy footage.</p>
        )}
      </Section>

      <Section
        title="Shadow"
        actions={
          <IconButton
            size="xs"
            tooltipSide="left"
            label={style.shadow ? 'Remove shadow' : 'Add shadow'}
            active={Boolean(style.shadow)}
            icon={style.shadow ? <Minus className="size-3" /> : <Plus className="size-3" />}
            onClick={() => toggle('shadow', { color: '#000000', blur: 12, offsetX: 0, offsetY: 4 })}
          />
        }
      >
        {style.shadow ? (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <ColorField
                label="Shadow colour"
                value={style.shadow.color}
                onCommit={(color) => set({ shadow: { ...style.shadow!, color } })}
              />
              <NumberField
                label="Blur"
                value={style.shadow.blur}
                onCommit={(blur) => set({ shadow: { ...style.shadow!, blur: Math.max(0, blur) } })}
                min={0}
                max={200}
                suffix="px"
              />
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <NumberField
                label="X"
                value={style.shadow.offsetX}
                onCommit={(offsetX) => set({ shadow: { ...style.shadow!, offsetX } })}
                suffix="px"
              />
              <NumberField
                label="Y"
                value={style.shadow.offsetY}
                onCommit={(offsetY) => set({ shadow: { ...style.shadow!, offsetY } })}
                suffix="px"
              />
            </div>
          </>
        ) : (
          <p className="text-[11px] text-ink-2">Off.</p>
        )}
      </Section>

      <Section
        title="Plate"
        actions={
          <IconButton
            size="xs"
            tooltipSide="left"
            label={style.background ? 'Remove plate' : 'Add plate'}
            active={Boolean(style.background)}
            icon={style.background ? <Minus className="size-3" /> : <Plus className="size-3" />}
            onClick={() => toggle('background', { color: '#000000', padding: 24, radius: 8 })}
          />
        }
      >
        {style.background ? (
          <>
            <ColorField
              label="Plate colour"
              value={style.background.color}
              onCommit={(color) => set({ background: { ...style.background!, color } })}
            />
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <NumberField
                label="Pad"
                value={style.background.padding}
                onCommit={(padding) =>
                  set({ background: { ...style.background!, padding: Math.max(0, padding) } })
                }
                min={0}
                max={400}
                suffix="px"
              />
              <NumberField
                label="Round"
                value={style.background.radius}
                onCommit={(radius) =>
                  set({ background: { ...style.background!, radius: Math.max(0, radius) } })
                }
                min={0}
                max={400}
                suffix="px"
              />
            </div>
          </>
        ) : (
          <p className="text-[11px] text-ink-2">
            Off. A plate behind the words is the most reliable way to stay readable over anything.
          </p>
        )}
      </Section>
    </>
  )
}
