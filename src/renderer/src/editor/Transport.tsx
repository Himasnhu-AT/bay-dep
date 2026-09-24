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
import { formatTimecode } from '@shared/project'
import { IconButton, Slider } from '@/components'
import { selectDuration, selectFps, useEditor } from '@/store/editor'

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

export function Transport(): ReactNode {
  const playing = useEditor((state) => state.playing)
  const playhead = useEditor((state) => state.playhead)
  const duration = useEditor(selectDuration)
  const fps = useEditor(selectFps)
  const pixelsPerFrame = useEditor((state) => state.pixelsPerFrame)
  const togglePlay = useEditor((state) => state.togglePlay)
  const setPlayhead = useEditor((state) => state.setPlayhead)
  const nudgePlayhead = useEditor((state) => state.nudgePlayhead)
  const zoomBy = useEditor((state) => state.zoomBy)
  const setPixelsPerFrame = useEditor((state) => state.setPixelsPerFrame)
  const splitAt = useEditor((state) => state.splitAt)

  const empty = duration === 0

  return (
    <div className="@container flex h-9 shrink-0 items-center gap-2 border-y border-line bg-surface-1 px-2">
      <div className="flex items-center gap-0.5">
        <IconButton
          label="Go to start"
          shortcut="Home"
          tooltipSide="top"
          icon={<ChevronFirst className="size-4" />}
          onClick={() => setPlayhead(0)}
        />
        <IconButton
          label="Previous frame"
          shortcut="←"
          tooltipSide="top"
          icon={<SkipBack className="size-3.5" />}
          onClick={() => nudgePlayhead(-1)}
        />
        <IconButton
          label={playing ? 'Pause' : 'Play'}
          shortcut="Space"
          tooltipSide="top"
          variant={playing ? 'primary' : 'subtle'}
          size="md"
          disabled={empty}
          icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          onClick={togglePlay}
        />
        <IconButton
          label="Next frame"
          shortcut="→"
          tooltipSide="top"
          icon={<SkipForward className="size-3.5" />}
          onClick={() => nudgePlayhead(1)}
        />
        <IconButton
          label="Go to end"
          shortcut="End"
          tooltipSide="top"
          icon={<ChevronLast className="size-4" />}
          onClick={() => setPlayhead(duration)}
        />
      </div>

      <span aria-hidden="true" className="h-4 w-px bg-line" />

      <IconButton
        label="Split at playhead"
        shortcut="S"
        tooltipSide="top"
        icon={<Scissors className="size-3.5" />}
        disabled={empty}
        onClick={() => splitAt()}
      />

      {/*
        `tabular-nums` is not decoration here. Proportional digits change width as they
        change value, so a running timecode jitters sideways 30 times a second and drags
        everything beside it along.
      */}
      <div className="flex flex-1 items-baseline justify-center gap-1.5 tabular-nums">
        <span className="text-[13px] font-medium text-ink-0">
          {formatTimecode(playhead, fps, true)}
        </span>
        <span className="text-[11px] text-ink-2">/</span>
        <span className="text-[11px] text-ink-2">{formatTimecode(duration, fps, true)}</span>
      </div>

      {/* In a 1024px window the row runs out of room, and flex squeezed this group first,
          leaving the zoom slider as a bare thumb with no track — a control that looked broken.
          Below 28rem of row the slider goes and the two buttons (and −/+) remain; above it the
          group keeps its width. */}
      <div className="flex shrink-0 items-center gap-1 @md:w-[168px]">
        <IconButton
          label="Zoom out"
          shortcut="−"
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
          className="hidden flex-1 @md:flex"
        />
        <IconButton
          label="Zoom in"
          shortcut="+"
          tooltipSide="top"
          icon={<ZoomIn className="size-3.5" />}
          onClick={() => zoomBy(1.25)}
        />
      </div>
    </div>
  )
}
