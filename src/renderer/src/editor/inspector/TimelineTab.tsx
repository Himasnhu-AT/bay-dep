import type { ReactNode } from 'react'
import { MousePointerClick, Settings2 } from 'lucide-react'
import { CANVAS_PRESETS, FRAME_RATES, formatFps, matchFrameRate } from '@shared/project'
import { Button, ColorField, Field, Section, Select } from '@/components'
import { selectTimeline, useEditor } from '@/store/editor'
import { useProjectSettingsDialog } from '@/store/project-settings-dialog'
import { Readout } from '../ClipSection'

/**
 * The inspector with nothing selected: the timeline's own settings — Resolve shows the
 * timeline's properties here too. Canvas and frame rate are the two a person changes mid-edit;
 * custom sizes and how clips refit are in Project Settings, one visible button away.
 */
export function TimelineTab(): ReactNode {
  const timeline = useEditor(selectTimeline)
  const setCanvasPreset = useEditor((state) => state.setCanvasPreset)
  const setFps = useEditor((state) => state.setFps)
  const setBackground = useEditor((state) => state.setBackground)
  const transact = useEditor((state) => state.transact)
  const notify = useEditor((state) => state.notify)
  if (!timeline) return null

  const matching = CANVAS_PRESETS.find(
    (preset) => preset.width === timeline.width && preset.height === timeline.height
  )
  const matchingRate = matchFrameRate(timeline.fps)

  return (
    <>
      <Section id="inspector.canvas" title="Timeline" collapsible>
        <div className="space-y-1.5">
          <Field label="Canvas">
            <Select
              label="Canvas preset"
              value={matching?.id ?? 'custom'}
              options={[
                ...CANVAS_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
                ...(matching ? [] : [{ value: 'custom', label: 'Custom', disabled: true }])
              ]}
              onChange={(id) => {
                // Refits clips the way set_canvas does (fit: auto); say so, since it moved them.
                const result = setCanvasPreset(id)
                if ('error' in result) notify(result.error, 'error')
                else if (result.refitted > 0) notify(`Canvas changed; ${result.refitted} clip${result.refitted === 1 ? '' : 's'} refitted. Undo to put them back.`)
              }}
            />
          </Field>
          {/* A rate, not a readout, because every clip's position is *expressed in* this number —
              so it is the one canvas property whose change has to move the timeline, and leaving
              it read-only meant a project could only ever be 30fps. Changing it keeps wall-clock
              time and reports any clip it had to nudge a frame, because a retime that moved
              something silently is found three exports later. */}
          <Field label="Frame rate">
            <Select
              label="Frame rate"
              value={matchingRate?.id ?? 'custom'}
              options={[
                ...FRAME_RATES.map((rate) => ({ value: rate.id, label: rate.label })),
                ...(matchingRate
                  ? []
                  : [{ value: 'custom', label: `${formatFps(timeline.fps)} · custom`, disabled: true }])
              ]}
              onChange={(id) => {
                const rate = FRAME_RATES.find((candidate) => candidate.id === id)
                if (!rate) return
                const { nudged } = setFps(rate.fps)
                if (nudged > 0) {
                  notify(
                    `Retimed to ${formatFps(rate.fps)} fps. ${nudged} clip${nudged === 1 ? '' : 's'} ` +
                      `moved a frame to stay in order.`
                  )
                }
              }}
            />
          </Field>
          <Field label="Background">
            <ColorField
              label="Timeline background colour"
              value={/^#[0-9a-f]{6}$/i.test(timeline.background) ? timeline.background : '#000000'}
              onCommit={(color) => {
                if (color.toLowerCase() === timeline.background.toLowerCase()) return
                transact(() => setBackground(color))
              }}
            />
          </Field>
        </div>
        <div className="mt-2">
          <Readout label="Resolution" value={`${timeline.width} × ${timeline.height}`} />
          <Readout label="Tracks" value={timeline.tracks.length} />
        </div>
        <Button
          variant="subtle"
          className="mt-2 w-full"
          icon={<Settings2 aria-hidden="true" className="size-3.5" />}
          onClick={() => useProjectSettingsDialog.getState().show()}
        >
          Project Settings…
        </Button>
      </Section>
      <Section id="inspector.selection" title="Selection">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-2">
          <MousePointerClick aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>Select a clip to edit it. Shift-click adds to the selection.</span>
        </p>
      </Section>
    </>
  )
}
