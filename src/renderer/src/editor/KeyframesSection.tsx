import { useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import {
  findAsset,
  findItem,
  formatTimecode,
  KEYFRAME_PROPERTIES,
  type Item,
  type KeyframeEase,
  type KeyframeProperty
} from '@shared/project'
import { KEYFRAME_REGISTRY, WRITABLE_KEYFRAME_PROPERTIES } from '@shared/keyframe-registry'
import { EASE_CHOICES, easeChoice, editKey, formatDb, gainToDb, keyTimeBounds } from '@shared/inspector'
import { Button, EaseEditor, Field, NumberField, Section, SectionReset, Select, TimecodeField } from '@/components'
import { KeyframeGraph } from './KeyframeGraph'
import { relativeFrame, staticValue } from './KeyframeControls'
import { LIVE } from './liveGesture'
import { cn } from '@/lib/cn'
import { selectTimeline, useEditor } from '@/store/editor'
import { editItems } from './inspectorEdit'

/** Names and value formats are the registry's rows, so a property added there is listed here. */
const NAMES = Object.fromEntries(KEYFRAME_PROPERTIES.map((property) => [property, KEYFRAME_REGISTRY[property].label])) as Record<
  KeyframeProperty,
  string
>

function formatValue(property: KeyframeProperty, value: number): string {
  // Volume alone reads in dB, as the fader beside it does.
  return property === 'volume' ? formatDb(gainToDb(value)) : KEYFRAME_REGISTRY[property].format(value)
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
  const [adding, setAdding] = useState<KeyframeProperty | null>(null)
  const [graphed, setGraphed] = useState<KeyframeProperty | null>(null)
  const notify = useEditor((state) => state.notify)
  // What the one selected clip is, for which properties it can animate at all. Narrow: these
  // change on an edit, not per frame.
  const only = items.length === 1 ? items[0]! : null
  const onlyTrackKind = useEditor((state) => {
    const timeline = selectTimeline(state)
    return only && timeline ? (findItem(timeline, only.id)?.track.kind ?? null) : null
  })
  const onlyAsset = useEditor((state) => (only ? findAsset(state.project, only.assetId) : undefined))
  // A speed ramp alone is not animation this section edits: its keys are the Speed section's.
  const animated = items.filter((item) => item.keyframes && Object.keys(item.keyframes).some((name) => name !== 'speed'))
  // One clip always gets the section: it is where a property with no diamond of its own — a crop
  // edge, an adjustment, a title's size — is given its first key.
  if (animated.length === 0 && !only) return null

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

  const item = only ?? animated[0]!
  const picture = onlyTrackKind === 'video'
  const can = (property: KeyframeProperty): boolean => {
    const needs = KEYFRAME_REGISTRY[property].needs
    if (needs === 'audio') return Boolean(onlyAsset?.hasAudio) || onlyAsset?.kind === 'html'
    if (needs === 'text') return picture && onlyAsset?.kind === 'text' && item.text !== undefined
    if (needs === 'source') return picture && onlyAsset?.kind !== 'text'
    return picture
  }
  // Only what a bare key may write (`WRITABLE_KEYFRAME_PROPERTIES`): speed keys are the Speed
  // section's, because changing one re-plans the clip's length — never offered, listed or graphed here.
  /** Properties this clip could animate and does not yet. */
  const addable = WRITABLE_KEYFRAME_PROPERTIES.filter((property) => can(property) && !item.keyframes?.[property]?.length)
  const toAdd = adding && addable.includes(adding) ? adding : (addable[0] ?? null)
  const keyedProperties = WRITABLE_KEYFRAME_PROPERTIES.filter((property) => item.keyframes?.[property]?.length)
  const graphProperty = selected?.property ?? (graphed && keyedProperties.includes(graphed) ? graphed : (keyedProperties[0] ?? null))

  const addKey = (): void => {
    if (!toAdd) return
    const at = relativeFrame(item, useEditor.getState().playhead)
    if (at === null) {
      notify('Move the playhead over this clip to key it: a key is a frame of the clip.')
      return
    }
    // The value the property has now, so starting to animate it changes nothing on screen.
    const applied = editItems([item.id], () => ({ keyframes: { [toAdd]: [{ frame: at, value: staticValue(item, toAdd) }] } }))
    if (applied) {
      setSelected({ property: toAdd, frame: at })
      setAdding(null)
    }
  }

  const rows = WRITABLE_KEYFRAME_PROPERTIES.flatMap((property) =>
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
      actions={<SectionReset show={rows.length > 0} label="Remove every key from this clip" onReset={clearAll} />}
    >
      {toAdd && (
        <div className="mb-2 flex items-end gap-1.5">
          <div className="min-w-0 flex-1">
            <Field label="Animate">
              <Select
                label="Property to animate"
                value={toAdd}
                options={addable.map((property) => ({ value: property, label: NAMES[property] }))}
                onChange={(property) => setAdding(property)}
              />
            </Field>
          </div>
          <Button onClick={addKey}>Add key</Button>
        </div>
      )}
      {rows.length === 0 && (
        <p className="text-[11px] leading-relaxed text-ink-2">
          No keys yet. Choose a property and add a key at the playhead, then move the playhead and change the value.
        </p>
      )}
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

      {graphProperty && (
        <>
          {keyedProperties.length > 1 && (
            <div className="mt-2">
              <Field label="Curve">
                <Select
                  label="Property shown in the graph"
                  value={graphProperty}
                  options={keyedProperties.map((property) => ({ value: property, label: NAMES[property] }))}
                  onChange={(property) => {
                    setSelected(null)
                    setGraphed(property)
                  }}
                />
              </Field>
            </div>
          )}
          <KeyframeGraph
            item={item}
            property={graphProperty}
            fps={fps}
            selectedFrame={current && current.property === graphProperty ? current.key.frame : null}
            onSelect={(frame) => setSelected({ property: graphProperty, frame })}
            onCommit={(keys) => editItems([item.id], () => ({ keyframes: { [graphProperty]: keys } })) > 0}
          />
        </>
      )}

      {current ? (
        <div className="mt-2 space-y-1.5 border-t border-line pt-2">
          <NumberField
            row
            label="Value"
            ariaLabel={`Value of the selected ${NAMES[current.property]} key`}
            value={current.key.value}
            onCommit={(value) => {
              const list = (item.keyframes?.[current.property] ?? []).map((key) => (key.frame === current.key.frame ? { ...key, value } : { ...key }))
              editItems([item.id], () => ({ keyframes: { [current.property]: list } }))
            }}
            min={Number.isFinite(KEYFRAME_REGISTRY[current.property].min) ? KEYFRAME_REGISTRY[current.property].min : undefined}
            max={Number.isFinite(KEYFRAME_REGISTRY[current.property].max) ? KEYFRAME_REGISTRY[current.property].max : undefined}
            step={KEYFRAME_REGISTRY[current.property].max <= 10 ? 0.01 : 1}
            precision={KEYFRAME_REGISTRY[current.property].max <= 10 ? 2 : 1}
          />
          <TimecodeField
            row
            label="Key at"
            ariaLabel={`Time of the selected ${NAMES[current.property]} key`}
            value={item.from + current.key.frame}
            min={keyTimeBounds(item).min}
            max={keyTimeBounds(item).max}
            fps={fps}
            onCommit={(next) => write(current.property, { to: Math.round(next) - item.from })}
          />
          <Field label="Ease">
            {/* Presets and a bezier box: a custom curve (the agent's, or one drawn here) is
                editable rather than a disabled "Custom curve" entry. */}
            <EaseEditor
              label="Ease from this key to the next"
              value={current.key.ease}
              onChange={(ease) => write(current.property, { ease })}
              gesture={LIVE}
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
        rows.length > 0 && <p className="mt-1.5 text-[10px] text-ink-2">Select a key to move it or change its value or ease. Drag one in the graph to do both at once.</p>
      )}
    </Section>
  )
}
