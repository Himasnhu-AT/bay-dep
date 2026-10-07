/**
 * Reverse and the speed ramp, in the inspector's Speed section, under the constant Speed field.
 *
 * Everything here goes through the store's `retimeClip`, the plan `edit_item({ reverse, speedRamp })`
 * runs (`planRetime`): the clip keeps its footage, so a ramp changes its length — stopping at the
 * next clip, or pushing later clips when the switch says so — and what the plan did that was not
 * the obvious is said in a toast, as a typed Speed says it.
 *
 * The curve editor is a list, not a canvas: a key is a frame, a rate and how it eases to the next,
 * which three fields say exactly. The picture above it is the curve those keys make, drawn from
 * the same sampler the compositor integrates (`speedAtFrame`), so it cannot show a shape the clip
 * does not play.
 */

import { useState, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, IconButton, NumberField, Select, Switch } from '@/components'
import { formatTimecode } from '@shared/timecode'
import { findAsset, type Item, type Keyframe, type KeyframeEase } from '@shared/project'
import { retimeSound } from '@shared/retime-sound'
import { speedNote, type RetimeChange, type SpeedPlan } from '@shared/speed'
import {
  SPEED_KEY_RANGE,
  SPEED_RAMP_LABELS,
  SPEED_RAMP_PRESETS,
  speedAtFrame,
  speedKeysOf,
  speedRampKeys,
  speedRampOf,
  type SpeedRampPreset
} from '@shared/speed-curve'
import { footageFramesOf, readSpeedRamp } from '@shared/speed-ramp'
import { selectTimeline, useEditor } from '@/store/editor'

const EASES: { value: string; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'inOut', label: 'Smooth' },
  { value: 'in', label: 'Ease in' },
  { value: 'out', label: 'Ease out' },
  { value: 'hold', label: 'Hold, then jump' }
]

/** The curve as a small picture: speed up the side, the clip's frames along the bottom. */
function CurvePicture({ item }: { item: Item }): ReactNode {
  const width = 200
  const height = 44
  const frames = Math.max(1, item.durationInFrames)
  let top = 1
  for (let frame = 0; frame < frames; frame += 1) top = Math.max(top, speedAtFrame(item, frame))
  const points: string[] = []
  const steps = Math.min(frames, width)
  for (let i = 0; i <= steps; i += 1) {
    const frame = Math.min(frames - 1, Math.round((i / steps) * (frames - 1)))
    const x = (i / steps) * width
    const y = height - 2 - (speedAtFrame(item, frame) / top) * (height - 4)
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  const unity = height - 2 - (1 / top) * (height - 4)
  return (
    <svg
      role="img"
      aria-label={`Speed over the clip, from 0 to ${Math.round(top * 100)}%`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-11 w-full rounded-sm border border-line bg-surface-2"
    >
      <line x1="0" x2={width} y1={unity} y2={unity} className="stroke-line-strong" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <polyline points={points.join(' ')} fill="none" className="stroke-accent" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function RetimeControls({ items }: { items: Item[] }): ReactNode {
  const [ripple, setRipple] = useState(false)
  const first = items[0]
  if (!first) return null
  const fps = selectTimeline(useEditor.getState())?.fps ?? 30

  /** One plan per clip, in one undo step, and whatever the plans did that was not the obvious. */
  const retime = (change: (item: Item) => RetimeChange | string): void => {
    const store = useEditor.getState()
    const plans: (SpeedPlan | null)[] = []
    const refusals: string[] = []
    store.transact(() => {
      for (const item of items) {
        const next = change(item)
        if (typeof next === 'string') refusals.push(next)
        else plans.push(useEditor.getState().retimeClip(item.id, next, { ripple }))
      }
    })
    const after = useEditor.getState()
    const tl = selectTimeline(after)
    if (!tl) return
    if (refusals[0]) return after.notify(refusals[0], 'error')
    const notes = plans
      .map((plan) => (plan ? speedNote(after.project, tl, plan, (frame) => formatTimecode(frame, tl.fps)) : null))
      .filter((note): note is string => Boolean(note))
    if (notes.length > 0) after.notify(notes.join(' '))
  }

  const reversed = items.filter((item) => item.reverse).length
  const keys = speedKeysOf(first)
  const single = items.length === 1
  const preset = keys ? speedRampOf(keys, footageFramesOf(first), fps) : null
  const ramped = items.some((item) => speedKeysOf(item))
  // What the ramp select shows: a preset's name, "custom" for hand-set keys, none otherwise.
  const rampValue = !ramped ? 'none' : single && preset ? preset : 'custom'
  const notice = items.map((item) => retimeSound(item).notice).find(Boolean) ?? null

  const writeKeys = (next: Keyframe[]): void => {
    const read = readSpeedRamp(next.map((key) => ({ frame: key.frame, speed: key.value, ...(key.ease ? { ease: key.ease } : {}) })), 0, fps)
    retime(() => {
      if (read.ok) return { ramp: read.keys }
      // The refusal is written for the agent's `speedRamp`; the two a person can reach read plainly.
      if (read.error.includes('ends at speed 0')) {
        return 'The last speed key cannot be 0%: the clip would hold there for ever. Add a key after it first, then set this one to 0%.'
      }
      if (read.error.includes('two keys on frame')) return 'There is already a speed key on that frame.'
      return read.error
    })
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={`reverse-${first.id}`}
          className="text-[11px] text-ink-1"
          title="Plays the same footage backwards. The clip keeps its place and its length."
        >
          Reverse
        </label>
        <Switch
          id={`reverse-${first.id}`}
          checked={reversed > 0}
          onChange={(on) => retime(() => ({ reverse: on }))}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-ink-1" title="A speed that changes over the clip. The clip keeps its footage, so its length changes.">
          Speed ramp
        </span>
        <Select<string>
          label="Speed ramp"
          className="w-36"
          value={rampValue}
          options={[
            { value: 'none', label: 'None' },
            ...SPEED_RAMP_PRESETS.map((name) => ({ value: name as string, label: SPEED_RAMP_LABELS[name].name })),
            ...(rampValue === 'custom' ? [{ value: 'custom', label: 'Custom', disabled: true }] : [])
          ]}
          onChange={(value) => {
            if (value === 'custom') return
            retime((item) => {
              if (value === 'none') return { ramp: null }
              const asset = findAsset(useEditor.getState().project, item.assetId)
              if (!asset || !(asset.durationUs > 0)) return `“${asset?.name ?? 'This clip'}” has no footage to ramp — a still reads the same picture at any speed.`
              return { ramp: speedRampKeys(value as SpeedRampPreset, footageFramesOf(item), fps) }
            })
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`ramp-ripple-${first.id}`} className="text-[11px] text-ink-1" title="When a ramp or a reverse changes the clip's length, move the clips after it instead of stopping at the next one.">
          Push later clips
        </label>
        <Switch id={`ramp-ripple-${first.id}`} checked={ripple} onChange={setRipple} />
      </div>

      {single && keys && (
        <div className="space-y-1.5 pt-1">
          <CurvePicture item={first} />
          <ul className="space-y-1" aria-label="Speed keys">
            {keys.map((key, index) => (
              <li key={key.frame} className="flex items-center gap-1">
                <NumberField
                  label={`Frame of speed key ${index + 1}`}
                  ariaLabel={`Speed key ${index + 1}: frame within the clip`}
                  value={key.frame}
                  min={0}
                  step={1}
                  precision={0}
                  suffix="f"
                  className="w-16"
                  onCommit={(frame) => writeKeys(keys.map((k, i) => (i === index ? { ...k, frame: Math.max(0, Math.round(frame)) } : { ...k })))}
                />
                <NumberField
                  label={`Speed of key ${index + 1}`}
                  ariaLabel={`Speed key ${index + 1}: speed in percent, 0 holds the frame`}
                  value={Math.round(key.value * 100)}
                  min={SPEED_KEY_RANGE.min * 100}
                  max={SPEED_KEY_RANGE.max * 100}
                  step={5}
                  precision={0}
                  suffix="%"
                  className="w-16"
                  onCommit={(percent) => writeKeys(keys.map((k, i) => (i === index ? { ...k, value: percent / 100 } : { ...k })))}
                />
                <Select<string>
                  label={`Speed key ${index + 1}: how it changes to the next key`}
                  className="min-w-0 flex-1"
                  value={typeof key.ease === 'string' ? key.ease : key.ease ? 'custom' : 'linear'}
                  options={[...EASES, ...(Array.isArray(key.ease) ? [{ value: 'custom', label: 'Curve', disabled: true }] : [])]}
                  onChange={(ease) =>
                    writeKeys(
                      keys.map((k, i) => {
                        if (i !== index) return { ...k }
                        const { ease: _old, ...rest } = k
                        return ease === 'linear' ? rest : { ...rest, ease: ease as KeyframeEase }
                      })
                    )
                  }
                />
                <IconButton
                  label={`Remove speed key ${index + 1}`}
                  size="xs"
                  icon={<X className="size-3" />}
                  onClick={() => (keys.length <= 1 ? retime(() => ({ ramp: null })) : writeKeys(keys.filter((_, i) => i !== index).map((k) => ({ ...k }))))}
                />
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            icon={<Plus className="size-3.5" />}
            onClick={() => {
              const at = Math.max(0, Math.min(first.durationInFrames, Math.round(useEditor.getState().playhead - first.from)))
              if (keys.some((key) => key.frame === at)) {
                return useEditor.getState().notify('There is already a speed key on that frame. Move the playhead, or change that key.', 'error')
              }
              writeKeys([...keys.map((k) => ({ ...k })), { frame: at, value: speedAtFrame(first, at) }])
            }}
          >
            Key at playhead
          </Button>
        </div>
      )}

      {single && !keys && (
        <Button
          size="sm"
          icon={<Plus className="size-3.5" />}
          onClick={() => {
            const asset = findAsset(useEditor.getState().project, first.assetId)
            if (!asset || !(asset.durationUs > 0)) {
              return useEditor.getState().notify('This clip has no footage to ramp — a still reads the same picture at any speed.', 'error')
            }
            const at = Math.max(0, Math.min(first.durationInFrames, Math.round(useEditor.getState().playhead - first.from)))
            const speed = speedAtFrame(first, 0)
            writeKeys(at > 0 ? [{ frame: 0, value: speed }, { frame: at, value: speed }] : [{ frame: 0, value: speed }])
          }}
        >
          Start a custom ramp
        </Button>
      )}

      {notice && <p className="text-[10px] leading-relaxed text-warning">{notice}</p>}
    </div>
  )
}
