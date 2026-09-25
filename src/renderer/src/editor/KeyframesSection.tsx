import { useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import {
  formatTimecode,
  KEYFRAME_PROPERTIES,
  type Item,
  type KeyframeEase,
  type KeyframeProperty
} from '@shared/project'
import { EASE_CHOICES, easeChoice, editKey, formatDb, gainToDb, keyTimeBounds } from '@shared/inspector'
import { Button, Field, NumberField, Section, SectionReset, Select } from '@/components'
import { cn } from '@/lib/cn'
import { selectTimeline, useEditor } from '@/store/editor'
import { editItems } from './inspectorEdit'
import { timecodeField } from './timecodeField'

const NAMES: Record<KeyframeProperty, string> = {
  opacity: 'Opacity',
  left: 'X',
  top: 'Y',
  width: 'Width',
  height: 'Height',
  rotation: 'Rotation',
  scale: 'Scale',
  volume: 'Volume'
}

function formatValue(property: KeyframeProperty, value: number): string {
  switch (property) {
    case 'opacity':
    case 'scale':
      return `${Math.round(value * 100)}%`
    case 'rotation':
      return `${Number(value.toFixed(1))}°`
    case 'volume':
      return formatDb(gainToDb(value))
    default:
      return `${Math.round(value)}px`
  }
}

/**
 * Every key on the selected clip, by property: jump to one, change how it eases into the next,
 * move it in time, remove it. Values are edited where they always were — in the field, with the
 * playhead on the key — so this list is about *when* and *how*, not *what*.
 *
 * Writes go through `edit_item`'s `keyframes` (`mergeKeyframes`), so a move onto a frame another
 * key holds is refused with the tool's own sentence rather than silently merged.
 */
export function KeyframesSection({ items }: { items: Item[] }): ReactNode {
  const setPlayhead = useEditor((state) => state.setPlayhead)
  const fps = useEditor((state) => selectTimeline(state)?.fps ?? 30)
  const [selected, setSelected] = useState<{ property: KeyframeProperty; frame: number } | null>(null)
  const animated = items.filter((item) => item.keyframes)
  if (animated.length === 0) return null

  const clearAll = (): void => {
    setSelected(null)
    editItems(
      animated.map((item) => item.id),
      () => ({ keyframes: null })
    )
  }

  if (items.length > 1) {
    return (
      <Section
        id="inspector.keyframes"
        title="Keyframes"
        collapsible
        actions={<SectionReset show label={`Remove every key from ${animated.length} clips`} onReset={clearAll} />}
      >
        <p className="text-[11px] leading-relaxed text-ink-2">
          {animated.length} of {items.length} selected clips are animated. Select one clip to edit
          its keys.
        </p>
      </Section>
    )
  }

  const item = animated[0]!
  const tc = timecodeField(fps)
  const rows = KEYFRAME_PROPERTIES.flatMap((property) =>
    (item.keyframes?.[property] ?? []).map((key) => ({ property, key }))
  )
  const current = selected
    ? rows.find((row) => row.property === selected.property && row.key.frame === selected.frame)
    : undefined

  const write = (property: KeyframeProperty, change: { to?: number; ease?: KeyframeEase | 'linear' }): void => {
    if (!current) return
    const list = editKey(item.keyframes?.[property] ?? [], current.key.frame, change)
    const applied = editItems([item.id], () => ({ keyframes: { [property]: list } }))
    if (applied && change.to !== undefined) setSelected({ property, frame: Math.round(change.to) })
  }

  return (
    <Section
      id="inspector.keyframes"
      title="Keyframes"
      collapsible
      hint="Select a key to move it or change how it eases into the next. The ease shapes the stretch from a key to the one after it."
      actions={<SectionReset show label="Remove every key from this clip" onReset={clearAll} />}
    >
      <ul className="-mx-1 flex flex-col" aria-label="Keys on this clip">
        {rows.map(({ property, key }, index) => {
          const isSelected = current?.property === property && current.key.frame === key.frame
          const newGroup = index === 0 || rows[index - 1]!.property !== property
          const outside = key.frame < 0 || key.frame > item.durationInFrames
          return (
            <li key={`${property}:${key.frame}`} className={cn(newGroup && index > 0 && 'mt-1')}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => {
                  setSelected({ property, frame: key.frame })
                  if (!outside) setPlayhead(item.from + key.frame)
                }}
                className={cn(
                  't-fast grid h-6 w-full grid-cols-[56px_1fr_auto] items-center gap-2 rounded-sm px-1 text-left text-[11px]',
                  isSelected ? 'bg-accent/14 text-ink-0' : 'text-ink-1 hover:bg-surface-3'
                )}
              >
                <span className="truncate">{newGroup ? NAMES[property] : ''}</span>
                <span className={cn('tabular-nums', outside && 'text-ink-2')}>
                  {formatTimecode(item.from + Math.max(0, key.frame), fps, true)}
                  <span className="ml-2 text-ink-2">{formatValue(property, key.value)}</span>
                </span>
                <span className="text-[10px] text-ink-2">
                  {EASE_CHOICES.find((choice) => choice.value === easeChoice(key.ease))?.label ??
                    'Custom'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {current ? (
        <div className="mt-2 space-y-1.5 border-t border-line pt-2">
          <NumberField
            row
            label="Key at"
            ariaLabel={`Time of the selected ${NAMES[current.property]} key`}
            value={item.from + current.key.frame}
            min={keyTimeBounds(item).min}
            max={keyTimeBounds(item).max}
            {...tc}
            onCommit={(next) => write(current.property, { to: Math.round(next) - item.from })}
          />
          <Field label="Ease">
            <Select<string>
              label="Ease from this key to the next"
              value={easeChoice(current.key.ease)}
              options={[
                ...EASE_CHOICES,
                ...(easeChoice(current.key.ease) === 'custom'
                  ? [{ value: 'custom', label: 'Custom curve', disabled: true }]
                  : [])
              ]}
              onChange={(value) => value !== 'custom' && write(current.property, { ease: value as KeyframeEase })}
            />
          </Field>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              icon={<Trash2 aria-hidden="true" className="size-3" />}
              onClick={() => {
                const list = (item.keyframes?.[current.property] ?? []).filter(
                  (key) => key.frame !== current.key.frame
                )
                setSelected(null)
                editItems([item.id], () => ({ keyframes: { [current.property]: list.length ? list : null } }))
              }}
            >
              Remove key
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-[10px] text-ink-2">Select a key to move it or change its ease.</p>
      )}
    </Section>
  )
}
