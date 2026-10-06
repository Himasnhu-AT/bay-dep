import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Circle, PenTool, Square, Trash2 } from 'lucide-react'
import type { Item } from '@shared/project'
import { cutoutPartner } from '@shared/behind-subject'
import {
  defaultShapeMask,
  isShapeMask,
  MAX_SHAPE_FEATHER,
  MAX_SHAPE_MASKS,
  type MaskCombine,
  type ShapeMask
} from '@shared/shape-mask'
import { Button, Field, IconButton, NumberField, Section, SectionReset, Select, SliderField, Switch } from '@/components'
import { cn } from '@/lib/cn'
import { useViewer } from '@/lib/viewer'
import { selectTimeline, useEditor } from '@/store/editor'
import { LIVE } from './liveGesture'

/**
 * Shape masks on the selected clip: the list, in the order the masks combine, and the numbers of
 * the one being edited. Choosing a mask here puts its handles on the viewer (`MaskOverlay`), so
 * the row that is highlighted is the mask the pointer moves.
 *
 * Every number is the stored one (`@shared/shape-mask`) in the unit a person reads: position and
 * size as percentages of the clip's own frame, rotation in degrees, feather in timeline pixels.
 * The ranges are the agent's (`edit_item.masks`), so nothing set here is refused there.
 *
 * With a subject cut-out selected the masks shown are its clip's — the cut-out draws its clip's
 * picture, masks included — and a clip's subject mask is not in the list: it is
 * `put_behind_subject`'s.
 */

const KIND_LABEL: Record<ShapeMask['kind'], string> = { rect: 'Rectangle', ellipse: 'Ellipse', path: 'Path' }

const COMBINES: { value: MaskCombine; label: string }[] = [
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'intersect', label: 'Intersect' }
]

const percent = (fraction: number): number => Math.round(fraction * 1000) / 10

export function MasksSection({ items }: { items: Item[] }): ReactNode {
  const timeline = useEditor(selectTimeline)
  const setShapeMasks = useEditor((state) => state.setShapeMasks)
  const editing = useViewer((state) => state.maskEdit)
  const setEditing = useViewer((state) => state.setMaskEdit)

  const selected = items.length === 1 ? items[0] : undefined
  // A cut-out's masks are its clip's.
  const item = selected && timeline ? (cutoutPartner(timeline, selected) ?? selected) : selected
  const shapes = (item?.masks ?? []).filter(isShapeMask)
  const active = editing !== null && editing < shapes.length ? editing : null
  const mask = active !== null ? shapes[active] : undefined

  const write = (next: ShapeMask[]): void => {
    if (item) setShapeMasks(item.id, next)
  }
  const add = (kind: ShapeMask['kind']): void => {
    if (!item || shapes.length >= MAX_SHAPE_MASKS) return
    write([...shapes, defaultShapeMask(kind)])
    setEditing(shapes.length)
  }
  const patch = (change: Partial<ShapeMask>): void => {
    if (active === null || !mask) return
    const next = shapes.slice()
    next[active] = { ...mask, ...change } as ShapeMask
    write(next)
  }
  const remove = (index: number): void => {
    write(shapes.filter((_, i) => i !== index))
    setEditing(null)
  }
  const move = (index: number, by: -1 | 1): void => {
    const to = index + by
    if (to < 0 || to >= shapes.length) return
    const next = shapes.slice()
    ;[next[index], next[to]] = [next[to]!, next[index]!]
    write(next)
    if (active === index) setEditing(to)
    else if (active === to) setEditing(index)
  }

  return (
    <Section
      id="inspector.masks"
      title="Masks"
      collapsible
      defaultOpen={false}
      hint="Show only part of the clip: rectangles, ellipses and freeform paths, combined in list order. A mask moves, scales and crops with its clip."
      actions={
        <SectionReset
          show={shapes.length > 0}
          label="Remove every mask"
          onReset={() => {
            write([])
            setEditing(null)
          }}
        />
      }
    >
      {!item ? (
        <p className="text-[11px] text-ink-2">Select one clip to mask it.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Add a mask">
            <Button size="sm" icon={<Square aria-hidden="true" className="size-3.5" />} disabled={shapes.length >= MAX_SHAPE_MASKS} onClick={() => add('rect')}>
              Rectangle
            </Button>
            <Button size="sm" icon={<Circle aria-hidden="true" className="size-3.5" />} disabled={shapes.length >= MAX_SHAPE_MASKS} onClick={() => add('ellipse')}>
              Ellipse
            </Button>
            <Button size="sm" icon={<PenTool aria-hidden="true" className="size-3.5" />} disabled={shapes.length >= MAX_SHAPE_MASKS} onClick={() => add('path')}>
              Path
            </Button>
          </div>
          {shapes.length >= MAX_SHAPE_MASKS && (
            <p className="text-[11px] text-ink-2">A clip takes up to {MAX_SHAPE_MASKS} masks.</p>
          )}

          {shapes.length > 0 && (
            <ul className="space-y-0.5" aria-label="Masks on this clip, in the order they combine">
              {shapes.map((entry, index) => (
                <li key={index} className={cn('flex items-center gap-0.5 rounded-sm', index === active && 'bg-surface-2')}>
                  <button
                    type="button"
                    aria-pressed={index === active}
                    aria-label={`${KIND_LABEL[entry.kind]} ${index + 1}: ${index === active ? 'finish editing' : 'edit on the viewer'}`}
                    onClick={() => setEditing(index === active ? null : index)}
                    className="no-drag min-w-0 flex-1 truncate rounded-sm px-1.5 py-1 text-left text-[12px] text-ink-0 outline-none focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {KIND_LABEL[entry.kind]} {index + 1}
                    <span className="ml-1.5 text-[11px] text-ink-2">
                      {index === 0 && !entry.combine ? '' : (COMBINES.find((c) => c.value === (entry.combine ?? 'add'))?.label ?? '')}
                      {entry.invert ? ' · inverted' : ''}
                    </span>
                  </button>
                  <IconButton size="xs" label={`Move mask ${index + 1} earlier`} icon={<ArrowUp aria-hidden="true" className="size-3" />} disabled={index === 0} onClick={() => move(index, -1)} />
                  <IconButton size="xs" label={`Move mask ${index + 1} later`} icon={<ArrowDown aria-hidden="true" className="size-3" />} disabled={index === shapes.length - 1} onClick={() => move(index, 1)} />
                  <IconButton size="xs" label={`Remove mask ${index + 1}`} icon={<Trash2 aria-hidden="true" className="size-3" />} onClick={() => remove(index)} />
                </li>
              ))}
            </ul>
          )}

          {shapes.length > 0 && !mask && (
            <p className="text-[11px] text-ink-2">Choose a mask to edit it here and on the viewer.</p>
          )}

          {mask && (
            <div className="space-y-1.5">
              <Field label="Combine">
                <Select
                  label="How this mask joins the ones before it"
                  value={mask.combine ?? 'add'}
                  options={COMBINES}
                  onChange={(combine) => patch({ combine })}
                />
              </Field>
              <NumberField row label="X" ariaLabel="Mask centre X, percent of the clip's width" value={percent(mask.x)} precision={1} suffix="%"
                min={-200} max={300} defaultValue={50} gesture={LIVE} onCommit={(next) => patch({ x: next / 100 })} />
              <NumberField row label="Y" ariaLabel="Mask centre Y, percent of the clip's height" value={percent(mask.y)} precision={1} suffix="%"
                min={-200} max={300} defaultValue={50} gesture={LIVE} onCommit={(next) => patch({ y: next / 100 })} />
              <NumberField row label="Width" ariaLabel="Mask width, percent of the clip's width" value={percent(mask.width)} precision={1} suffix="%"
                min={0.1} max={800} defaultValue={50} gesture={LIVE} onCommit={(next) => patch({ width: next / 100 })} />
              <NumberField row label="Height" ariaLabel="Mask height, percent of the clip's height" value={percent(mask.height)} precision={1} suffix="%"
                min={0.1} max={800} defaultValue={50} gesture={LIVE} onCommit={(next) => patch({ height: next / 100 })} />
              <NumberField row label="Rotation" ariaLabel="Mask rotation" value={mask.rotation ?? 0} precision={1} suffix="°"
                min={-3600} max={3600} defaultValue={0} gesture={LIVE} onCommit={(next) => patch({ rotation: next })} />
              {mask.kind === 'rect' && (
                <SliderField label="Corners" ariaLabel="Corner radius" value={mask.radius ?? 0} min={0} max={1} step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`} defaultValue={0} gesture={LIVE} onCommit={(next) => patch({ radius: next })} />
              )}
              <NumberField row label="Feather" ariaLabel="Feather width in pixels" value={mask.feather ?? 0} precision={1} suffix="px"
                min={0} max={MAX_SHAPE_FEATHER} defaultValue={0} gesture={LIVE} onCommit={(next) => patch({ feather: next })} />
              <SliderField label="Opacity" ariaLabel="Mask opacity" value={mask.opacity ?? 1} min={0} max={1} step={0.01}
                format={(v) => `${Math.round(v * 100)}%`} defaultValue={1} gesture={LIVE} onCommit={(next) => patch({ opacity: next })} />
              <Field label="Invert">
                <Switch label="Keep everything except the shape" checked={mask.invert === true} onChange={(invert) => patch({ invert })} />
              </Field>
              {mask.kind === 'path' && (
                <p className="text-[11px] text-ink-2">
                  {mask.points.length} points. On the viewer: drag a point, double-click the outline to add one, double-click a point to remove it.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}
