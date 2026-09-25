import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDownToLine,
  ArrowRightToLine,
  BetweenVerticalStart,
  Blend,
  Bookmark,
  Brackets,
  ChevronDown,
  Columns2,
  Eraser,
  FoldHorizontal,
  Layers,
  Link2,
  ListX,
  Magnet,
  MessageSquarePlus,
  MousePointer2,
  MoveHorizontal,
  Plug,
  Replace,
  Scissors,
  Snowflake,
  SquareSplitHorizontal,
  Unplug,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { Menu, Slider, ToolbarGroup, ToolButton, useFloatingTrigger, type MenuEntry } from '@/components'
import { cn } from '@/lib/cn'
import { runCommand, shortcutOf, type CommandId } from '@/lib/commands'
import { TRIM_TOOL_MODES, useTimelineTool } from '@/lib/timelineTool'
import { selectTimeline, useEditor } from '@/store/editor'
import { MarkerListButton } from './TimelineMarkers'
import { CommentListButton } from './TimelineComments'
import { canDetachAudio, canReattachAudio, runAudioLink } from './timeline/audioLink'
import { runSourceEdit, SOURCE_EDIT_DETAIL, SOURCE_EDIT_LABEL, useSourceClip, type SourceEdit } from './timeline/sourceEdits'
import { MARKER_COLORS } from './TimelineMarkers'

/** The store's zoom range (`setPixelsPerFrame` clamps to it); the slider is logarithmic across it. */
const MIN_PPF = 0.05
const MAX_PPF = 60
const LOG_MIN = Math.log(MIN_PPF)
const LOG_MAX = Math.log(MAX_PPF)

/**
 * How much the toolbar shows at its current width, widest first. The toolbar is as wide as the
 * timeline, which at a 1024px window with the library open is about 670px and in a full-width
 * timeline on a large display over 1800px. Measured with a ResizeObserver, because the timeline
 * panel resizes independently of the window.
 *
 * - `labels`: every button shows its name.
 * - `key-labels`: the tools and modes show their names — the icons people cannot guess (the trim
 *   and blade tools, snapping against linked selection) — and the rest are icons.
 * - `tool-labels`: only Select, Trim and Blade are named (the default 1440px window).
 * - `icons`: every group as icons, each still named by its tooltip and aria-label.
 * - `compact`: Edit, Clip and Mark fold into menus that carry their group's name as text.
 * - `tight`: the transition joins the Clip menu and the zoom slider goes (⌘+ and ⌘- remain).
 */
type Density = 'labels' | 'key-labels' | 'tool-labels' | 'icons' | 'compact' | 'tight'

function densityFor(width: number): Density {
  // Not measured yet (the first render): icons, the middle of the range, rather than a flash of
  // folded menus.
  if (width === 0) return 'icons'
  if (width >= 1720) return 'labels'
  if (width >= 1240) return 'key-labels'
  if (width >= 1110) return 'tool-labels'
  if (width >= 1040) return 'icons'
  if (width >= 640) return 'compact'
  return 'tight'
}

/** A toolbar action: one button when there is room, one menu row when its group is folded. */
interface Action {
  key: string
  label: string
  icon: ReactNode
  shortcut?: string
  /**
   * What the button does in a sentence. Not shown yet: `ToolButton`'s tooltip takes only the
   * label. Kept as the button's accessible description.
   */
  detail?: string
  run(): void
  disabled?: boolean
  active?: boolean
  danger?: boolean
}

const command = (id: CommandId, label: string, icon: ReactNode, extra: Partial<Action> = {}): Action => ({
  key: id,
  label,
  icon,
  shortcut: shortcutOf(id),
  run: () => void runCommand(id, 'ui'),
  ...extra
})

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
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

function ActionButton({ action, showLabel }: { action: Action; showLabel: boolean }): ReactNode {
  return (
    <ToolButton
      label={action.label}
      icon={action.icon}
      showLabel={showLabel}
      shortcut={action.shortcut}
      active={action.active}
      disabled={action.disabled}
      aria-description={action.detail}
      className={cn(action.danger && !action.disabled && 'hover:text-danger')}
      onClick={action.run}
    />
  )
}

function menuEntries(actions: readonly Action[]): MenuEntry[] {
  return actions.map((action) => ({
    label: action.label,
    icon: action.icon,
    ...(action.shortcut ? { shortcut: action.shortcut } : {}),
    ...(action.active !== undefined ? { checked: action.active } : {}),
    disabled: action.disabled,
    danger: action.danger,
    onSelect: action.run
  }))
}

/** A group folded into one button that names it and opens its actions (then `more`) as a menu. */
function GroupMenu({
  label,
  actions,
  more = []
}: {
  label: string
  actions: readonly Action[]
  more?: readonly Action[]
}): ReactNode {
  const menu = useFloatingTrigger('menu')
  return (
    <>
      <ToolButton
        {...menu.triggerProps}
        label={label}
        icon={<ChevronDown className="size-3" />}
        active={menu.open}
        className="flex-row-reverse"
      />
      <Menu
        {...menu.surfaceProps}
        label={label}
        items={[...menuEntries(actions), ...(more.length > 0 ? [{ kind: 'separator' } as const, ...menuEntries(more)] : [])]}
        side="bottom"
        align="start"
      />
    </>
  )
}

/** A narrow ▾ beside a button, for the button's options (the trim modes, the marker colours). */
function OptionsChevron({ label, items }: { label: string; items: readonly MenuEntry[] }): ReactNode {
  const menu = useFloatingTrigger('menu')
  return (
    <>
      <ToolButton
        {...menu.triggerProps}
        label={label}
        showLabel={false}
        icon={<ChevronDown className="size-3" />}
        active={menu.open}
        className="-ml-0.5 w-4!"
      />
      <Menu {...menu.surfaceProps} label={label} items={items} side="bottom" align="start" />
    </>
  )
}

/**
 * The Edit toolbar above the tracks, in Resolve's order: Tools · Edit · Clip · Modes · Mark ·
 * Transition, and zoom on the right. Every button runs the registry command its key and menu-bar
 * item run (`runCommand`), so the three cannot do different things; the source edits run the
 * source viewer's own placement (`timeline/sourceEdits`).
 */
export function TimelineToolbar({ fps }: { fps: number }): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const density = densityFor(useWidth(root))
  const labelsAll = density === 'labels'
  const labelsKey = density === 'labels' || density === 'key-labels'
  const labelsTools = labelsKey || density === 'tool-labels'
  const folded = density === 'compact' || density === 'tight'

  const pixelsPerFrame = useEditor((state) => state.pixelsPerFrame)
  const snapping = useEditor((state) => state.snapping)
  const linked = useEditor((state) => state.linkedSelection)
  const hasClips = useEditor((state) => {
    const timeline = selectTimeline(state)
    return timeline ? timeline.tracks.some((track) => track.items.length > 0) : false
  })
  const selectionCount = useEditor((state) => state.selection.length)
  const hasRange = useEditor((state) => state.rangeIn !== null || state.rangeOut !== null)
  // Detach while any selected picture carries sound; otherwise Link, when there is sound to put back.
  const audioLink = useEditor((state): 'detach' | 'reattach' | null => {
    const timeline = selectTimeline(state)
    if (!timeline || state.selection.length === 0) return null
    if (state.selection.some((id) => canDetachAudio(state.project, timeline, id))) return 'detach'
    if (state.selection.some((id) => canReattachAudio(timeline, id))) return 'reattach'
    return null
  })
  const tool = useTimelineTool((state) => state.tool)
  const trimMode = useTimelineTool((state) => state.trimMode)
  const source = useSourceClip((state) => state.source)
  const sourceName = useEditor((state) =>
    source ? (state.project.assets.find((asset) => asset.id === source.assetId)?.name ?? null) : null
  )

  const zoomFromSlider = (value: number): void => useEditor.getState().setPixelsPerFrame(Math.exp(value))
  const trimLabel = TRIM_TOOL_MODES.find((option) => option.mode === trimMode)?.label ?? 'Ripple'

  // -- the groups -------------------------------------------------------------------------------

  // Never disabled: with no clip in the source viewer, a click says how to open one, which a
  // dimmed button (no tooltip while disabled) could not.
  const sourceEdit = (edit: SourceEdit, icon: ReactNode): Action => ({
    key: edit,
    label: SOURCE_EDIT_LABEL[edit],
    icon,
    detail: `${SOURCE_EDIT_DETAIL[edit]}${sourceName ? ` — ${sourceName}` : ''}`,
    run: () => void runSourceEdit(edit)
  })
  const editActions: Action[] = [
    sourceEdit('insert', <BetweenVerticalStart className="size-3.5" />),
    sourceEdit('overwrite', <ArrowDownToLine className="size-3.5" />),
    sourceEdit('replace', <Replace className="size-3.5" />),
    sourceEdit('append', <ArrowRightToLine className="size-3.5" />),
    sourceEdit('placeOnTop', <Layers className="size-3.5" />)
  ]

  const transition = command('clip.addTransition', 'Transition', <Blend className="size-3.5" />, {
    detail: 'Add a transition at the cut nearest the playhead',
    disabled: !hasClips
  })
  const clipActions: Action[] = [
    command('clip.split', 'Split', <SquareSplitHorizontal className="size-3.5" />, {
      detail: 'Split the selected clips (or every clip under the playhead) at the playhead',
      disabled: !hasClips
    }),
    command('clip.splitAll', 'Split All', <Columns2 className="size-3.5" />, {
      detail: 'Split every unlocked track at the playhead',
      disabled: !hasClips
    }),
    command('clip.rippleDelete', 'Ripple Delete', <ListX className="size-3.5" />, {
      detail: 'Delete the selection and close the time it took, on every unlocked track',
      disabled: selectionCount === 0,
      danger: true
    }),
    command('timeline.closeGap', 'Close Gap', <FoldHorizontal className="size-3.5" />, {
      detail: 'Close the gap under the playhead',
      disabled: !hasClips
    }),
    command('clip.freezeFrame', 'Freeze', <Snowflake className="size-3.5" />, {
      detail: 'Hold the frame under the playhead as a still',
      disabled: !hasClips
    }),
    {
      key: 'audio-link',
      label: audioLink === 'reattach' ? 'Link Audio' : 'Detach Audio',
      icon: audioLink === 'reattach' ? <Plug className="size-3.5" /> : <Unplug className="size-3.5" />,
      detail:
        audioLink === 'reattach'
          ? 'Put the detached sound back into its picture'
          : audioLink === 'detach'
            ? 'Move the selected clip’s sound onto its own audio clip'
            : 'Select a video clip with sound to detach it',
      disabled: audioLink === null,
      run: () => {
        if (audioLink) runAudioLink(audioLink, [...useEditor.getState().selection])
      }
    },
    ...(density === 'tight' ? [transition] : [])
  ]

  // The rest of the Clip and Mark menus' commands, one click away behind each group's ▾, so every
  // command in those groups is reachable from the timeline without knowing its key.
  const clipMore: Action[] = [
    command('clip.duplicate', 'Duplicate', null, { disabled: selectionCount === 0 }),
    command('clip.toggleEnabled', 'Enable/Disable Clip', null, { disabled: selectionCount === 0 }),
    command('clip.delete', 'Delete (Leave Gap)', null, { disabled: selectionCount === 0 }),
    command('clip.trimStartRipple', 'Ripple Trim Start to Playhead', null, { disabled: !hasClips }),
    command('clip.trimEndRipple', 'Ripple Trim End to Playhead', null, { disabled: !hasClips }),
    command('clip.trimStart', 'Trim Start to Playhead', null, { disabled: !hasClips }),
    command('clip.trimEnd', 'Trim End to Playhead', null, { disabled: !hasClips }),
    command('clip.nudgeLeft', 'Nudge Left One Frame', null, { disabled: selectionCount === 0 }),
    command('clip.nudgeRight', 'Nudge Right One Frame', null, { disabled: selectionCount === 0 }),
    command('clip.nudgeLeftMany', 'Nudge Left 10 Frames', null, { disabled: selectionCount === 0 }),
    command('clip.nudgeRightMany', 'Nudge Right 10 Frames', null, { disabled: selectionCount === 0 })
  ]
  const markMore: Action[] = [
    command('mark.goToIn', 'Go to In', null, { disabled: !hasRange }),
    command('mark.goToOut', 'Go to Out', null, { disabled: !hasRange }),
    command('mark.removeRange', 'Remove In to Out', null, { disabled: !hasRange, danger: true }),
    command('mark.removeHere', 'Remove Marker at Playhead', null)
  ]

  const addMarker = command('mark.add', 'Marker', <Bookmark className="size-3.5" />, {
    detail: 'Add a marker at the playhead'
  })
  const markActions: Action[] = [
    command('mark.setIn', 'In', <span className="w-3.5 text-center font-mono text-[13px] leading-none">[</span>, {
      detail: 'Set In at the playhead'
    }),
    command('mark.setOut', 'Out', <span className="w-3.5 text-center font-mono text-[13px] leading-none">]</span>, {
      detail: 'Set Out at the playhead'
    }),
    command('mark.clearRange', 'Clear', <Eraser className="size-3.5" />, {
      detail: 'Clear In and Out',
      disabled: !hasRange
    }),
    addMarker,
    command('mark.addComment', 'Comment', <MessageSquarePlus className="size-3.5" />, {
      detail: 'Add a review comment at the playhead'
    })
  ]
  const markerColours: MenuEntry[] = [
    { kind: 'label', label: 'Add marker at playhead' },
    ...MARKER_COLORS.map(
      (colour): MenuEntry => ({
        label: colour.name,
        icon: (
          <span
            aria-hidden="true"
            className="size-2.5 rounded-xs"
            style={{ backgroundColor: colour.value ?? 'var(--color-accent)' }}
          />
        ),
        onSelect: () => {
          const state = useEditor.getState()
          state.addMarker(state.playhead, undefined, colour.value ?? undefined)
        }
      })
    )
  ]

  return (
    <div
      ref={root}
      role="toolbar"
      aria-label="Timeline"
      className="flex h-9 shrink-0 items-center overflow-x-clip border-b border-line bg-chrome px-1"
    >
      <ToolbarGroup label="Tools">
        <ToolButton
          label="Select"
          icon={<MousePointer2 className="size-3.5" />}
          showLabel={labelsTools}
          shortcut={shortcutOf('tool.select')}
          active={tool === 'select'}
          aria-description="Click selects, drag moves, edges trim"
          onClick={() => runCommand('tool.select')}
        />
        <ToolButton
          label="Trim"
          icon={<Brackets className="size-3.5" />}
          showLabel={labelsTools}
          active={tool === 'trim'}
          shortcut={shortcutOf('tool.trim')}
          aria-description={`Trim tool, ${trimLabel}: every drag on a clip trims`}
          onClick={() => runCommand('tool.trim')}
        />
        <OptionsChevron
          label={`Trim mode: ${trimLabel}`}
          items={[
            { kind: 'label', label: 'Trim tool mode' },
            ...TRIM_TOOL_MODES.map(
              (option): MenuEntry => ({
                label: option.label,
                checked: trimMode === option.mode,
                onSelect: () => useTimelineTool.getState().setTrimMode(option.mode)
              })
            )
          ]}
        />
        <ToolButton
          label="Blade"
          icon={<Scissors className="size-3.5" />}
          showLabel={labelsTools}
          shortcut={shortcutOf('tool.blade')}
          active={tool === 'blade'}
          aria-description="Click a clip to cut it, ⇧-click cuts every track"
          onClick={() => runCommand('tool.blade')}
        />
      </ToolbarGroup>

      <ToolbarGroup label="Edit">
        {folded ? (
          <GroupMenu label="Edit" actions={editActions} />
        ) : (
          editActions.map((action) => <ActionButton key={action.key} action={action} showLabel={labelsAll} />)
        )}
      </ToolbarGroup>

      <ToolbarGroup label="Clip">
        {folded ? (
          <GroupMenu label="Clip" actions={clipActions} more={clipMore} />
        ) : (
          <>
            {clipActions.map((action) => (
              <ActionButton key={action.key} action={action} showLabel={labelsAll} />
            ))}
            <OptionsChevron label="More clip commands" items={menuEntries(clipMore)} />
          </>
        )}
      </ToolbarGroup>

      <ToolbarGroup label="Modes">
        <ToolButton
          label="Snapping"
          icon={<Magnet className="size-3.5" />}
          showLabel={labelsKey}
          shortcut={shortcutOf('timeline.toggleSnapping')}
          active={snapping}
          aria-description="Clips snap to edges, the playhead, markers and beats"
          onClick={() => runCommand('timeline.toggleSnapping')}
        />
        <ToolButton
          label="Linked"
          icon={<Link2 className="size-3.5" />}
          showLabel={labelsKey}
          shortcut={shortcutOf('timeline.toggleLinkedSelection')}
          active={linked}
          aria-description="A picture and its sound select and move together"
          onClick={() => runCommand('timeline.toggleLinkedSelection')}
        />
      </ToolbarGroup>

      <ToolbarGroup label="Mark">
        {folded ? (
          <GroupMenu label="Mark" actions={markActions} more={markMore} />
        ) : (
          markActions.map((action) =>
            action.key === 'mark.add' ? (
              <span key={action.key} className="flex items-center">
                <ActionButton action={action} showLabel={labelsAll} />
                <OptionsChevron label="Marker colour" items={markerColours} />
              </span>
            ) : (
              <ActionButton key={action.key} action={action} showLabel={labelsAll} />
            )
          )
        )}
        {!folded && <OptionsChevron label="More mark commands" items={menuEntries(markMore)} />}
        <MarkerListButton fps={fps} />
        <CommentListButton fps={fps} />
      </ToolbarGroup>

      {density !== 'tight' && (
        <ToolbarGroup label="Transition">
          <ActionButton action={transition} showLabel={labelsAll} />
        </ToolbarGroup>
      )}

      <div role="group" aria-label="Zoom" className="ml-auto flex shrink-0 items-center gap-0.5 pl-1.5">
        <ToolButton
          label="Zoom to fit"
          icon={<MoveHorizontal className="size-3.5" />}
          showLabel={labelsAll}
          shortcut={shortcutOf('timeline.zoomToFit')}
          onClick={() => runCommand('timeline.zoomToFit')}
        />
        <ToolButton
          label="Zoom out"
          icon={<ZoomOut className="size-3.5" />}
          showLabel={false}
          shortcut={shortcutOf('timeline.zoomOut')}
          disabled={pixelsPerFrame <= MIN_PPF}
          onClick={() => runCommand('timeline.zoomOut')}
        />
        {density !== 'tight' && (
          <Slider
            label="Timeline zoom"
            className="w-20"
            min={LOG_MIN}
            max={LOG_MAX}
            step={0.01}
            value={Math.log(pixelsPerFrame)}
            onInput={zoomFromSlider}
            onCommit={zoomFromSlider}
          />
        )}
        <ToolButton
          label="Zoom in"
          icon={<ZoomIn className="size-3.5" />}
          showLabel={false}
          shortcut={shortcutOf('timeline.zoomIn')}
          disabled={pixelsPerFrame >= MAX_PPF}
          onClick={() => runCommand('timeline.zoomIn')}
        />
      </div>
    </div>
  )
}
