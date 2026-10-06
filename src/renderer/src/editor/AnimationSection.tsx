import type { ReactNode } from 'react'
import type { Item, Timeline } from '@shared/project'
import {
  ANIMATION_KINDS,
  ANIMATION_PRESETS,
  ANIMATION_SIDES,
  LOOP_KINDS,
  LOOP_PRESETS,
  animationWindows,
  transitionEnds,
  type AnimationKind,
  type AnimationSide,
  type AnimationSpec,
  type AnimationUnit,
  type LoopKind,
  type LoopSpec
} from '@shared/animation'
import { Field, NumberField, Section, SectionReset, SegmentedControl, Select } from '@/components'
import { editItems } from './inspectorEdit'

const SIDE_LABEL: Record<AnimationSide, string> = { left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' }
const UNIT_LABEL: Record<AnimationUnit, string> = { clip: 'Whole title', line: 'Line by line', word: 'Word by word', letter: 'Letter by letter' }

export interface AnimationSectionProps {
  /** The selected clips that draw a picture. Every edit applies to all of them. */
  items: Item[]
  /** How many of them are titles: only a title animates by line, word or letter, or can be typed. */
  titles: number
  timeline: Timeline
}

/**
 * How the selected clips arrive, leave and idle: an In, an Out and a Loop preset each.
 *
 * Every write goes through `edit_item`'s `animation` — the agent's own call — so a preset set
 * here is validated by the same rules, stored in the same shape, and refused with the same
 * sentence (as a toast). Values are read from the first selected clip.
 *
 * The two things a preset can be doing that the picture does not explain are said under the
 * controls: sharing a clip too short for both, and standing aside for a transition.
 */
export function AnimationSection({ items, titles, timeline }: AnimationSectionProps): ReactNode {
  const first = items[0]
  if (!first) return null
  const fps = timeline.fps
  const animation = first.animation
  const allTitles = titles === items.length
  const ids = items.map((item) => item.id)

  const write = (change: Record<string, unknown> | null): void => {
    editItems(ids, () => ({ animation: change }))
  }

  const end = (name: 'in' | 'out'): ReactNode => {
    const spec = animation?.[name]
    const info = spec ? ANIMATION_PRESETS[spec.kind] : undefined
    const kinds = ANIMATION_KINDS.filter((kind) => allTitles || !ANIMATION_PRESETS[kind].textOnly)
    const put = (next: Partial<AnimationSpec> & { kind: AnimationKind }): void => {
      const target = ANIMATION_PRESETS[next.kind]
      // Carry only what the new kind understands: a side onto a fade would be refused.
      const out: Record<string, unknown> = { kind: next.kind, frames: next.frames ?? Math.max(1, Math.round(target.seconds * fps)) }
      if (target.sided && next.from) out.from = next.from
      if (next.by && next.by !== 'clip' && target.units.includes(next.by) && allTitles) out.by = next.by
      if (target.amount && next.amount !== undefined) out.amount = next.amount
      write({ [name]: out })
    }
    const label = name === 'in' ? 'In' : 'Out'
    return (
      <div className="space-y-1.5">
        <Field label={label}>
          <Select
            label={`${label} animation`}
            value={spec?.kind ?? 'none'}
            options={[{ value: 'none', label: 'None' }, ...kinds.map((kind) => ({ value: kind, label: ANIMATION_PRESETS[kind].label }))]}
            onChange={(value) => {
              if (value === 'none') write({ [name]: null })
              // A new kind takes its own length; the side and unit carry over where they apply.
              else put({ kind: value as AnimationKind, from: spec?.from, by: spec?.by })
            }}
          />
        </Field>
        {spec && info && (
          <>
            <NumberField
              row
              label="Length"
              ariaLabel={`${label} animation length`}
              value={spec.frames / fps}
              onCommit={(seconds) => put({ ...spec, frames: Math.max(1, Math.round(seconds * fps)) })}
              defaultValue={info.seconds}
              min={1 / fps}
              max={60}
              step={0.05}
              precision={2}
              suffix="s"
            />
            {info.sided && (
              <Field label={name === 'in' ? 'From' : 'Toward'}>
                <SegmentedControl
                  label={name === 'in' ? `Side the ${info.label.toLowerCase()} comes in from` : `Side the ${info.label.toLowerCase()} leaves toward`}
                  value={spec.from ?? 'left'}
                  onChange={(from) => put({ ...spec, from })}
                  options={ANIMATION_SIDES.map((side) => ({ value: side, label: SIDE_LABEL[side] }))}
                />
              </Field>
            )}
            {allTitles && info.units.length > 1 && (
              <Field label="By">
                <Select
                  label={`${label} animation runs by`}
                  value={spec.by ?? 'clip'}
                  options={info.units.map((unit) => ({ value: unit, label: UNIT_LABEL[unit] }))}
                  onChange={(by) => put({ ...spec, by })}
                />
              </Field>
            )}
            {info.amount && (
              <NumberField
                row
                label="Amount"
                ariaLabel={`${label} animation amount: ${info.amount.meaning}`}
                value={spec.amount ?? info.amount.default}
                onCommit={(amount) => put({ ...spec, amount })}
                defaultValue={info.amount.default}
                min={info.amount.min}
                max={info.amount.max}
                step={info.amount.max > 10 ? 1 : 0.05}
                precision={info.amount.max > 10 ? 0 : 2}
              />
            )}
            <p className="text-[10px] leading-relaxed text-ink-2">{info.description}</p>
          </>
        )}
      </div>
    )
  }

  const loop = animation?.loop
  const loopInfo = loop ? LOOP_PRESETS[loop.kind] : undefined
  const putLoop = (next: Partial<LoopSpec> & { kind: LoopKind }): void => {
    const target = LOOP_PRESETS[next.kind]
    const out: Record<string, unknown> = { kind: next.kind, frames: next.frames ?? Math.max(2, Math.round(target.seconds * fps)) }
    if (next.amount !== undefined) out.amount = next.amount
    if (next.by && next.by !== 'clip' && allTitles) out.by = next.by
    write({ loop: out })
  }

  // What the picture alone does not explain. For one clip: a key is a frame of one clip.
  const notes: string[] = []
  if (items.length === 1 && animation) {
    const windows = animationWindows(animation, first.durationInFrames)
    if (windows.shortened) {
      const seconds = (frames: number): string => `${Number((frames / fps).toFixed(2))}s`
      notes.push(
        `This clip is ${seconds(first.durationInFrames)} long, shorter than its presets, so they play shortened` +
          `${animation.in ? ` — in ${seconds(windows.inFrames)}` : ''}${animation.out ? `${animation.in ? ',' : ' —'} out ${seconds(windows.outFrames)}` : ''}.`
      )
    }
    const ends = transitionEnds(timeline, first.id)
    if (ends.head && animation.in) notes.push('The In is not playing: a transition crosses this clip’s start and decides how it arrives.')
    if (ends.tail && animation.out) notes.push('The Out is not playing: a transition crosses this clip’s end and decides how it leaves.')
  }

  return (
    <Section
      id="inspector.animation"
      title={items.length > 1 ? `Animation · ${items.length} selected` : 'Animation'}
      collapsible
      hint="Presets stay on the clip’s first and last frames however it is trimmed, and play on top of any keyframes."
      actions={<SectionReset show={items.some((item) => item.animation)} label="Remove every animation preset" onReset={() => write(null)} />}
    >
      <div className="space-y-3">
        {end('in')}
        {end('out')}
        <div className="space-y-1.5">
          <Field label="Loop">
            <Select
              label="Loop animation"
              value={loop?.kind ?? 'none'}
              options={[{ value: 'none', label: 'None' }, ...LOOP_KINDS.map((kind) => ({ value: kind, label: LOOP_PRESETS[kind].label }))]}
              onChange={(value) => (value === 'none' ? write({ loop: null }) : putLoop({ kind: value as LoopKind, by: loop?.by }))}
            />
          </Field>
          {loop && loopInfo && (
            <>
              <NumberField
                row
                label="Cycle"
                ariaLabel="Loop cycle length"
                value={loop.frames / fps}
                onCommit={(seconds) => putLoop({ ...loop, frames: Math.max(2, Math.round(seconds * fps)) })}
                defaultValue={loopInfo.seconds}
                min={2 / fps}
                max={60}
                step={0.1}
                precision={2}
                suffix="s"
              />
              <NumberField
                row
                label="Amount"
                ariaLabel={`Loop amount: ${loopInfo.amount.meaning}`}
                value={loop.amount ?? loopInfo.amount.default}
                onCommit={(amount) => putLoop({ ...loop, amount })}
                defaultValue={loopInfo.amount.default}
                min={loopInfo.amount.min}
                max={loopInfo.amount.max}
                step={loopInfo.amount.max > 10 ? 0.5 : 0.01}
                precision={2}
              />
              {allTitles && (
                <Field label="By">
                  <Select
                    label="Loop runs by"
                    value={loop.by ?? 'clip'}
                    options={(['clip', 'line', 'word', 'letter'] as const).map((unit) => ({ value: unit, label: UNIT_LABEL[unit] }))}
                    onChange={(by) => putLoop({ ...loop, by })}
                  />
                </Field>
              )}
              <p className="text-[10px] leading-relaxed text-ink-2">{loopInfo.description}</p>
            </>
          )}
        </div>
      </div>
      {notes.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-sm border border-line bg-surface-2 p-1.5">
          {notes.map((note) => (
            <li key={note} className="text-[10px] leading-relaxed text-ink-1">
              {note}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
