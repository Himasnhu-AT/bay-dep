import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bookmark,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  FastForward,
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  Rewind,
  SkipBack,
  SkipForward,
  Square
} from 'lucide-react'
import { IconButton, Menu, useFloatingTrigger, type MenuEntry } from '@/components'
import { cn } from '@/lib/cn'
import { runCommand, shortcutOf, type CommandId } from '@/lib/commands'
import { selectDuration, useEditor } from '@/store/editor'
import { AudioMeter } from './viewer/AudioMeter'
import { TimecodeField } from './viewer/TimecodeField'
import { ViewerControls } from './viewer/ViewerControls'

/** A transport button: one command, its key in the tooltip, and a row for the overflow menu. */
interface Control {
  id: CommandId
  label: string
  icon: ReactNode
  /** Kept on the row longest when lowest; see `SLOTS`. */
  slot: number
  disabled?: boolean
  active?: boolean
}

/**
 * What the row shows at its measured width, and in what order things leave it. The row sits under
 * the viewer, which at a 1280px window with the library, inspector and agent dock open is barely
 * 330px, and at 1440 with nothing docked over 800px — so it is measured (ResizeObserver) and each
 * slot needs this many pixels of row before it shows. What does not fit goes into the ⋯ menu,
 * never off the edge. The timecode and meter cannot be menu rows; the viewer's header shows the
 * playhead's timecode anyway.
 *
 *   always     play/pause, previous/next frame, the viewer options and ⋯
 *   1          go to start / end
 *   2          the timecode field (click to type a time)
 *   3          In and Out
 *   4          J and L: play backwards / forwards, faster each press
 *   5          Loop
 *   6          previous / next edit
 *   7          the master meter
 *   8          previous / next marker
 *   9          Stop (K)
 *   10         the timeline length after the timecode
 */
const SLOT_WIDTH: Record<number, number> = {
  1: 250,
  2: 360,
  3: 430,
  4: 490,
  5: 530,
  6: 590,
  7: 660,
  8: 730,
  9: 770,
  10: 860
}

function useRowWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

function Separator(): ReactNode {
  return <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-line-strong" />
}

/**
 * The transport under the viewer, in Resolve's groups: navigation and JKL play, Loop, In/Out,
 * markers; then the timecode, the meter and the viewer's options. Every button runs the registry
 * command its key runs. Timeline zoom is not here — it is the timeline toolbar's.
 */
export function Transport(): ReactNode {
  const row = useRef<HTMLDivElement>(null)
  const width = useRowWidth(row)
  // Before the first measure, show everything the default window has room for.
  const fits = (slot: number): boolean => width === 0 || width >= (SLOT_WIDTH[slot] ?? 0)
  const playing = useEditor((state) => state.playing)
  const loop = useEditor((state) => state.loop)
  const duration = useEditor(selectDuration)
  const togglePlay = useEditor((state) => state.togglePlay)
  const overflow = useFloatingTrigger('menu')
  const empty = duration === 0

  const control = (id: CommandId, label: string, icon: ReactNode, slot: number, extra: Partial<Control> = {}): Control => ({
    id,
    label,
    icon,
    slot,
    ...extra
  })
  const toStart = control('playback.toStart', 'Go to start', <ChevronFirst className="size-4" />, 1)
  const prevEdit = control('playback.prevEdit', 'Previous edit', <SkipBack className="size-3.5" />, 6)
  const reverse = control('playback.shuttleReverse', 'Play backwards (faster each press)', <Rewind className="size-3.5" />, 4, {
    disabled: empty
  })
  const stop = control('playback.shuttleStop', 'Stop', <Square className="size-3" />, 9, { disabled: empty })
  const forward = control('playback.shuttleForward', 'Play forwards (faster each press)', <FastForward className="size-3.5" />, 4, {
    disabled: empty
  })
  const nextEdit = control('playback.nextEdit', 'Next edit', <SkipForward className="size-3.5" />, 6)
  const toEnd = control('playback.toEnd', 'Go to end', <ChevronLast className="size-4" />, 1)
  const loopControl = control('playback.toggleLoop', loop ? 'Loop on' : 'Loop off', <Repeat className="size-3.5" />, 5, {
    active: loop
  })
  const markIn = control('mark.setIn', 'Mark In', <span className="font-mono text-[13px] leading-none font-semibold">[</span>, 3)
  const markOut = control('mark.setOut', 'Mark Out', <span className="font-mono text-[13px] leading-none font-semibold">]</span>, 3)
  const prevMarker = control(
    'playback.prevMarker',
    'Previous marker',
    <span className="flex items-center">
      <ChevronLeft className="-mr-0.5 size-2.5" />
      <Bookmark className="size-3" />
    </span>,
    8
  )
  const nextMarker = control(
    'playback.nextMarker',
    'Next marker',
    <span className="flex items-center">
      <Bookmark className="size-3" />
      <ChevronRight className="-ml-0.5 size-2.5" />
    </span>,
    8
  )

  const all = [toStart, prevEdit, reverse, stop, forward, nextEdit, toEnd, loopControl, markIn, markOut, prevMarker, nextMarker]
  const hidden = all.filter((c) => !fits(c.slot))

  const button = (c: Control): ReactNode =>
    fits(c.slot) ? (
      <IconButton
        key={c.id}
        label={c.label}
        shortcut={shortcutOf(c.id)}
        tooltipSide="top"
        active={c.active}
        disabled={c.disabled}
        icon={c.icon}
        onClick={() => runCommand(c.id, 'ui')}
      />
    ) : null

  const overflowItems: MenuEntry[] = hidden.map((c) => ({
    label: c.label,
    icon: c.icon,
    disabled: c.disabled,
    ...(c.active !== undefined ? { checked: c.active } : {}),
    ...(shortcutOf(c.id) ? { shortcut: shortcutOf(c.id) } : {}),
    onSelect: () => void runCommand(c.id, 'ui')
  }))

  return (
    <div
      ref={row}
      role="toolbar"
      aria-label="Transport"
      className="flex h-9 min-w-0 shrink-0 items-center gap-1 overflow-x-clip border-y border-line bg-chrome px-1.5"
    >
      <div role="group" aria-label="Play" className="flex shrink-0 items-center gap-0.5">
        {button(toStart)}
        {button(prevEdit)}
        <IconButton
          label="Previous frame"
          shortcut={shortcutOf('playback.stepBack')}
          tooltipSide="top"
          icon={<ChevronLeft className="size-4" />}
          onClick={() => runCommand('playback.stepBack', 'ui')}
        />
        {button(reverse)}
        {button(stop)}
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
        {button(forward)}
        <IconButton
          label="Next frame"
          shortcut={shortcutOf('playback.stepForward')}
          tooltipSide="top"
          icon={<ChevronRight className="size-4" />}
          onClick={() => runCommand('playback.stepForward', 'ui')}
        />
        {button(nextEdit)}
        {button(toEnd)}
      </div>

      {fits(5) && (
        <>
          <Separator />
          {button(loopControl)}
        </>
      )}

      {fits(3) && (
        <>
          <Separator />
          <div role="group" aria-label="Mark" className="flex shrink-0 items-center gap-0.5">
            {button(markIn)}
            {button(markOut)}
          </div>
        </>
      )}

      {fits(8) && (
        <>
          <Separator />
          <div role="group" aria-label="Markers" className="flex shrink-0 items-center gap-0.5">
            {button(prevMarker)}
            {button(nextMarker)}
          </div>
        </>
      )}

      {fits(2) ? <TimecodeField showDuration={fits(10)} /> : <span className="flex-1" />}

      {fits(7) && (
        <div className="flex shrink-0">
          <AudioMeter className={cn(fits(10) ? 'w-[88px]' : 'w-12')} />
        </div>
      )}

      <ViewerControls roomy={fits(10)} />

      {hidden.length > 0 && (
        <>
          <IconButton
            {...overflow.triggerProps}
            label="More transport controls"
            tooltipSide="top"
            active={overflow.open}
            icon={<MoreHorizontal className="size-3.5" />}
          />
          <Menu {...overflow.surfaceProps} label="More transport controls" side="top" align="end" items={overflowItems} />
        </>
      )}
    </div>
  )
}
