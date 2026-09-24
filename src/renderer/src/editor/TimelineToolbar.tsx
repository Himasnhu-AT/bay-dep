import type { ReactNode } from 'react'
import { Link2, Magnet, MousePointer2, MoveHorizontal, Scissors, ZoomIn, ZoomOut } from 'lucide-react'
import { shortcutOf } from '@shared/commands'
import { IconButton, Slider } from '@/components'
import { runCommand } from '@/lib/commands'
import { useEditor } from '@/store/editor'
import { useTimelineTool } from '@/lib/timelineTool'
import { MarkerListButton } from './TimelineMarkers'

/** The store's zoom range (`setPixelsPerFrame` clamps to it); the slider is logarithmic across it. */
const MIN_PPF = 0.05
const MAX_PPF = 60
const LOG_MIN = Math.log(MIN_PPF)
const LOG_MAX = Math.log(MAX_PPF)

const SNAPPING = 'timeline.toggleSnapping'
const LINKED = 'timeline.toggleLinkedSelection'
const FIT = 'timeline.zoomToFit'

function Separator(): ReactNode {
  return <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
}

/**
 * The strip above the tracks: the timeline's modes on the left (snapping, linked selection),
 * markers, and zoom on the right. Compact — the lanes are what the panel is for.
 */
export function TimelineToolbar({ fps }: { fps: number }): ReactNode {
  const pixelsPerFrame = useEditor((state) => state.pixelsPerFrame)
  const snapping = useEditor((state) => state.snapping)
  const linked = useEditor((state) => state.linkedSelection)
  const tool = useTimelineTool((state) => state.tool)

  const zoomFromSlider = (value: number): void => useEditor.getState().setPixelsPerFrame(Math.exp(value))

  return (
    <div role="toolbar" aria-label="Timeline" className="flex h-[30px] shrink-0 items-center gap-0.5 border-b border-line bg-surface-1 px-2">
      {/* The pointer tools, a pair: exactly one is on. */}
      <div role="group" aria-label="Pointer tool" className="flex items-center gap-0.5">
        <IconButton
          size="xs"
          label="Select tool: click selects, drag moves"
          shortcut={shortcutOf('tool.select')}
          active={tool === 'select'}
          icon={<MousePointer2 className="size-3" />}
          onClick={() => runCommand('tool.select')}
        />
        <IconButton
          size="xs"
          label="Blade tool: click a clip to cut it, ⇧-click cuts every track"
          shortcut={shortcutOf('tool.blade')}
          active={tool === 'blade'}
          icon={<Scissors className="size-3" />}
          onClick={() => runCommand('tool.blade')}
        />
      </div>
      <Separator />
      <IconButton
        size="xs"
        label={snapping ? 'Snapping on' : 'Snapping off'}
        shortcut={shortcutOf(SNAPPING)}
        active={snapping}
        icon={<Magnet className="size-3" />}
        onClick={() => runCommand(SNAPPING)}
      />
      <IconButton
        size="xs"
        label={linked ? 'Linked selection on' : 'Linked selection off'}
        shortcut={shortcutOf(LINKED)}
        active={linked}
        icon={<Link2 className="size-3" />}
        onClick={() => runCommand(LINKED)}
      />
      <Separator />
      <MarkerListButton fps={fps} />

      <div className="ml-auto flex items-center gap-0.5">
        <IconButton
          size="xs"
          label="Zoom out"
          shortcut={shortcutOf('timeline.zoomOut')}
          icon={<ZoomOut className="size-3" />}
          disabled={pixelsPerFrame <= MIN_PPF}
          onClick={() => runCommand('timeline.zoomOut')}
        />
        <Slider
          label="Timeline zoom"
          className="w-24"
          min={LOG_MIN}
          max={LOG_MAX}
          step={0.01}
          value={Math.log(pixelsPerFrame)}
          onInput={zoomFromSlider}
          onCommit={zoomFromSlider}
        />
        <IconButton
          size="xs"
          label="Zoom in"
          shortcut={shortcutOf('timeline.zoomIn')}
          icon={<ZoomIn className="size-3" />}
          disabled={pixelsPerFrame >= MAX_PPF}
          onClick={() => runCommand('timeline.zoomIn')}
        />
        <IconButton
          size="xs"
          label="Zoom to fit"
          shortcut={shortcutOf(FIT)}
          icon={<MoveHorizontal className="size-3" />}
          onClick={() => runCommand(FIT)}
        />
      </div>
    </div>
  )
}
