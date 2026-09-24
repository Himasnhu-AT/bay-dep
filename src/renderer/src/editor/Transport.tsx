import type { ReactNode } from 'react'
import {
  ChevronFirst,
  ChevronLast,
  Pause,
  Play,
  Scissors,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { IconButton, Slider } from '@/components'
import { shortcutOf } from '@/lib/commands'
import { selectDuration, useEditor } from '@/store/editor'
import { AudioMeter } from './viewer/AudioMeter'
import { TimecodeField } from './viewer/TimecodeField'
import { ViewerControls } from './viewer/ViewerControls'

const MIN_PPF = 0.05
const MAX_PPF = 60

/** Zoom is geometric, so the slider works in log space — otherwise the useful range
 * (0.05–4 px per frame) is crushed into the first 6% of the track. */
function ppfToSlider(ppf: number): number {
  return (Math.log(ppf) - Math.log(MIN_PPF)) / (Math.log(MAX_PPF) - Math.log(MIN_PPF))
}

function sliderToPpf(value: number): number {
  return Math.exp(Math.log(MIN_PPF) + value * (Math.log(MAX_PPF) - Math.log(MIN_PPF)))
}

/*
 * The row is a container, and it gives up controls from the least needed as it narrows, so it
 * never overflows (it did at 826 px, the preview column of a 1440 px window: the column scrolled
 * sideways and Zoom In was cut off). Measured against the row's content width, in the order
 * they go:
 *
 *   1. < 56rem  the master meter: it only reports.
 *   2. < 48rem  the timeline zoom slider: the timeline's own toolbar has the same slider.
 *   3. < 42rem  the timeline length after the timecode: the status bar shows it.
 *   4. < 36rem  Crop and Full-screen as buttons: both stay in the Viewer options menu (and the
 *               View menu, and their shortcuts).
 *   5. < 32rem  timeline Zoom out / Zoom in: the timeline toolbar and their shortcuts keep them.
 *
 * What never goes: go to start/end, frame step, play, split, the timecode, viewer zoom and the
 * Viewer options menu, which are how you drive the transport. They fit in about 26rem. Below
 * that the row clips rather than scrolls (`overflow-x-clip`); nothing in bay makes the column
 * that narrow. Each breakpoint has slack over the widths it was set from, because a timecode
 * gets wider at 100 fps and above.
 */
export function Transport(): ReactNode {
  const playing = useEditor((state) => state.playing)
  const duration = useEditor(selectDuration)
  const pixelsPerFrame = useEditor((state) => state.pixelsPerFrame)
  const togglePlay = useEditor((state) => state.togglePlay)
  const setPlayhead = useEditor((state) => state.setPlayhead)
  const nudgePlayhead = useEditor((state) => state.nudgePlayhead)
  const zoomBy = useEditor((state) => state.zoomBy)
  const setPixelsPerFrame = useEditor((state) => state.setPixelsPerFrame)
  const splitAt = useEditor((state) => state.splitAt)

  const empty = duration === 0

  return (
    <div className="@container flex h-9 min-w-0 shrink-0 items-center gap-2 overflow-x-clip border-y border-line bg-surface-1 px-2">
      <div className="flex items-center gap-0.5">
        <IconButton
          label="Go to start"
          shortcut={shortcutOf('playback.toStart')}
          tooltipSide="top"
          icon={<ChevronFirst className="size-4" />}
          onClick={() => setPlayhead(0)}
        />
        <IconButton
          label="Previous frame"
          shortcut={shortcutOf('playback.stepBack')}
          tooltipSide="top"
          icon={<SkipBack className="size-3.5" />}
          onClick={() => nudgePlayhead(-1)}
        />
        <IconButton
          label={playing ? 'Pause' : 'Play'}
          shortcut={shortcutOf('playback.toggle')}
          tooltipSide="top"
          variant={playing ? 'primary' : 'subtle'}
          size="md"
          disabled={empty}
          icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          onClick={togglePlay}
        />
        <IconButton
          label="Next frame"
          shortcut={shortcutOf('playback.stepForward')}
          tooltipSide="top"
          icon={<SkipForward className="size-3.5" />}
          onClick={() => nudgePlayhead(1)}
        />
        <IconButton
          label="Go to end"
          shortcut={shortcutOf('playback.toEnd')}
          tooltipSide="top"
          icon={<ChevronLast className="size-4" />}
          onClick={() => setPlayhead(duration)}
        />
      </div>

      <span aria-hidden="true" className="h-4 w-px bg-line" />

      <IconButton
        label="Split at playhead"
        shortcut={shortcutOf('clip.split')}
        tooltipSide="top"
        icon={<Scissors className="size-3.5" />}
        disabled={empty}
        onClick={() => splitAt()}
      />

      <TimecodeField />

      {/* The meter is the first thing to go when the row is short: the timecode and the
          buttons are how you drive the transport, the meter only reports. */}
      <div className="hidden @4xl:flex">
        <AudioMeter />
      </div>

      <ViewerControls />

      <span aria-hidden="true" className="hidden h-4 w-px bg-line @lg:block" />

      {/* In a 1024px window the row runs out of room, and flex squeezed this group first,
          leaving the zoom slider as a bare thumb with no track — a control that looked broken.
          Now the slider goes below 48rem of row and the buttons below 32rem (see the list above
          Transport); while the slider shows, the group keeps its width. */}
      <div className="hidden shrink-0 items-center gap-1 @lg:flex @3xl:w-[168px]">
        <IconButton
          label="Zoom out"
          shortcut={shortcutOf('timeline.zoomOut')}
          tooltipSide="top"
          icon={<ZoomOut className="size-3.5" />}
          onClick={() => zoomBy(1 / 1.25)}
        />
        <Slider
          label="Timeline zoom"
          min={0}
          max={1}
          step={0.001}
          value={ppfToSlider(pixelsPerFrame)}
          onInput={(value) => setPixelsPerFrame(sliderToPpf(value))}
          onCommit={(value) => setPixelsPerFrame(sliderToPpf(value))}
          className="hidden flex-1 @3xl:flex"
        />
        <IconButton
          label="Zoom in"
          shortcut={shortcutOf('timeline.zoomIn')}
          tooltipSide="top"
          icon={<ZoomIn className="size-3.5" />}
          onClick={() => zoomBy(1.25)}
        />
      </div>
    </div>
  )
}
