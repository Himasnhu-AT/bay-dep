import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { findAsset, type Item } from '@shared/project'
import { hasSourceTime, isVisualItem } from '@shared/inspector'
import { Panel, ScrollArea, Section } from '@/components'
import { cn } from '@/lib/cn'
import { useSelectedItems } from '@/lib/useSelectedItems'
import { selectTimeline, useEditor } from '@/store/editor'
import {
  activeFramePreset,
  fadePresetActive,
  fadePresetFrames,
  framePresetLayout,
  LOOK_PRESETS,
  lookAdjustments,
  lookPresetActive,
  speedPresetActive,
  type FramePreset,
  type LookPreset
} from './effectPresets'

/**
 * One-click presets over fields the engine draws: a look (adjustments), framing, fades and speed.
 * Each row names what it does in a line and shows a check when the whole selection already has
 * it, so the list answers "what is this clip doing?" as well as "what can I do to it?".
 *
 * **Every row must name a field that exists in `@shared/project` and is drawn.** This panel once
 * listed filters, crop, colour wheels and transitions as disabled "not yet" rows, and each one
 * outlived the day its field landed — a working feature advertised as absent. The numbers behind
 * a look (adjustments, grade, crop) are set in the inspector; a preset here is only ever a
 * shortcut to a value the inspector can also type.
 */

const FRAMES: { id: FramePreset; label: string; description: string }[] = [
  { id: 'fill', label: 'Fill', description: 'Cover the frame, cropping the overflow' },
  { id: 'fit', label: 'Fit', description: 'Show the whole picture, letterboxed' },
  { id: 'centre', label: 'Centre', description: 'Centre at its current size' },
  { id: 'reset', label: 'Full frame', description: 'The canvas’s own box, as placed' }
]

const FADES: { seconds: number; label: string; description: string }[] = [
  { seconds: 0, label: 'No fade', description: 'Hard in and out' },
  { seconds: 0.25, label: 'Quick fade', description: '¼ s in and out' },
  { seconds: 0.5, label: 'Fade', description: '½ s in and out' },
  { seconds: 1, label: 'Slow fade', description: '1 s in and out' }
]

const SPEEDS: { speed: number; label: string; description: string }[] = [
  { speed: 0.5, label: 'Half speed', description: '0.5× — slow motion' },
  { speed: 1, label: 'Normal speed', description: '1× — as recorded' },
  { speed: 1.5, label: 'Faster', description: '1.5×' },
  { speed: 2, label: 'Double speed', description: '2× — the clip keeps its length' }
]

export type PresetGroup = 'look' | 'frame' | 'fade' | 'speed'

function PresetRow({
  label,
  description,
  active,
  disabled,
  onApply
}: {
  label: string
  description: string
  active: boolean
  disabled?: boolean
  onApply(): void
}): ReactNode {
  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        disabled={disabled}
        onClick={onApply}
        className={cn(
          't-press grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-sm px-2 py-1.5 text-left active:scale-[0.98]',
          'disabled:pointer-events-none disabled:opacity-45',
          active ? 'bg-accent/14' : 'hover:bg-surface-3'
        )}
      >
        <span className="min-w-0">
          <span className={cn('block text-[12px]', active ? 'text-accent' : 'text-ink-0')}>{label}</span>
          <span className="block truncate text-[11px] text-ink-2">{description}</span>
        </span>
        {active && <Check aria-hidden="true" className="size-3.5 text-accent" />}
      </button>
    </li>
  )
}

/**
 * The preset groups, acting on the timeline's selection. With nothing selected the rows stay where
 * they are, dimmed, under one line saying what to do — Resolve dims rather than hides, so the list
 * does not jump when a clip is clicked.
 */
export function ClipPresets({ groups = ['look', 'frame', 'fade', 'speed'] }: { groups?: readonly PresetGroup[] }): ReactNode {
  const selected = useSelectedItems()
  const timeline = useEditor(selectTimeline)
  const project = useEditor((state) => state.project)
  const patchLayout = useEditor((state) => state.patchLayout)
  const patchItem = useEditor((state) => state.patchItem)
  const transact = useEditor((state) => state.transact)

  const none = selected.length === 0 || !timeline
  const kindOf = (item: Item) => findAsset(project, item.assetId)?.kind
  const trackKindOf = (item: Item) => timeline?.tracks.find((track) => track.id === item.trackId)?.kind
  const visual = selected.filter((item) => isVisualItem(kindOf(item), trackKindOf(item)))
  const timed = selected.filter((item) => hasSourceTime(kindOf(item)))
  const sourceOf = (item: Item) => findAsset(project, item.assetId) ?? undefined
  const fps = timeline?.fps ?? 30
  const frameActive = timeline ? activeFramePreset(visual, timeline, sourceOf) : null

  /**
   * Every row acts on the whole selection as one `transact`: four clips, one click, one undo
   * step — the same promise the inspector and the MCP tools make.
   */
  const frame = (preset: FramePreset): void => {
    if (!timeline) return
    transact(() => {
      for (const item of visual) patchLayout(item.id, framePresetLayout(preset, item, timeline, sourceOf(item)))
    })
  }
  const fade = (frames: number): void => {
    transact(() => {
      for (const item of selected) {
        const capped = fadePresetFrames(frames, item)
        patchItem(item.id, { fadeInFrames: capped, fadeOutFrames: capped })
      }
    })
  }
  const setSpeed = (speed: number): void => {
    transact(() => {
      for (const item of timed) patchItem(item.id, { speed })
    })
  }
  const look = (preset: LookPreset): void => {
    transact(() => {
      for (const item of visual) patchItem(item.id, { adjustments: lookAdjustments(preset) })
    })
  }

  return (
    <div>
      <p className="px-3 pt-3 text-[11px] text-ink-2 tabular-nums">
        {none
          ? 'Select clips on the timeline to apply these.'
          : `${selected.length === 1 ? '1 clip' : `${selected.length} clips`} selected. A check marks what every one already has.`}
      </p>
      {groups.includes('look') && (
        <Section id="effects.look" title="Look" collapsible>
          <ul className="-mx-2 flex flex-col">
            {LOOK_PRESETS.map((preset) => (
              <PresetRow
                key={preset.id}
                label={preset.label}
                description={preset.description}
                disabled={none || visual.length === 0}
                active={lookPresetActive(preset.id, visual)}
                onApply={() => look(preset.id)}
              />
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-ink-2">Replaces the clip’s adjustments; fine-tune them in the inspector.</p>
        </Section>
      )}
      {groups.includes('frame') && (
        <Section id="effects.frame" title="Frame" collapsible>
          <ul className="-mx-2 flex flex-col">
            {FRAMES.map((preset) => (
              <PresetRow
                key={preset.id}
                label={preset.label}
                description={preset.description}
                disabled={none || visual.length === 0}
                active={frameActive === preset.id}
                onApply={() => frame(preset.id)}
              />
            ))}
          </ul>
        </Section>
      )}
      {groups.includes('fade') && (
        <Section id="effects.fade" title="Fade" collapsible>
          <ul className="-mx-2 flex flex-col">
            {FADES.map((preset) => {
              const frames = Math.round(preset.seconds * fps)
              return (
                <PresetRow
                  key={preset.seconds}
                  label={preset.label}
                  description={preset.description}
                  disabled={none}
                  active={fadePresetActive(frames, selected)}
                  onApply={() => fade(frames)}
                />
              )
            })}
          </ul>
          <p className="mt-1 text-[10px] text-ink-2">Both ends, capped at half the clip.</p>
        </Section>
      )}
      {groups.includes('speed') && (
        <Section id="effects.speed" title="Speed" collapsible>
          <ul className="-mx-2 flex flex-col">
            {SPEEDS.map((preset) => (
              <PresetRow
                key={preset.speed}
                label={preset.label}
                description={preset.description}
                disabled={none || timed.length === 0}
                active={speedPresetActive(preset.speed, timed)}
                onApply={() => setSpeed(preset.speed)}
              />
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-ink-2">Changes how fast the source is read. The clip keeps its length on the timeline.</p>
        </Section>
      )}
    </div>
  )
}

/** The old left rail's Effects page: the presets alone. The Effects Library holds them now too. */
export function EffectsPanel(): ReactNode {
  return (
    <Panel title="Effects" className="h-full" bodyClassName="flex flex-col">
      <ScrollArea className="flex-1">
        <ClipPresets />
      </ScrollArea>
    </Panel>
  )
}
