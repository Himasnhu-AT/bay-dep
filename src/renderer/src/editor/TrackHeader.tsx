import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Eye, EyeOff, Lock, LockOpen, MoreHorizontal } from 'lucide-react'
import type { Track } from '@shared/project'
import { ContextMenu, IconButton, Menu, Tooltip, useFloatingTrigger, type MenuEntry } from '@/components'
import { cn } from '@/lib/cn'
import { insertIndexFor, type TrackSize } from '@/lib/timelineLayout'
import { useTimelineView } from '@/lib/timelineView'
import { moveTrackBeside, placeBeside, trackDragHandlers, useTrackDrag } from '@/lib/timelineStructure'
import { selectTimeline, useEditor } from '@/store/editor'

export interface TrackHeaderProps {
  track: Track
  /** Resolve's track number: V1 is the bottom video track, A1 the first audio track. */
  badge: string
  height: number
  size: TrackSize
  /** False for the last track of its kind — removing it would leave nowhere to place a clip. */
  removable: boolean
}

/**
 * One of the header's on/off controls, in Resolve's form: a small square with a letter (M, S) or
 * a glyph (lock, eye), solid orange when on and a dim outline when off. The 12px glyph buttons it
 * replaced looked nearly the same in both states, so a muted or locked track did not read as one.
 */
function TrackToggle({
  label,
  detail,
  on,
  onToggle,
  children
}: {
  label: string
  detail: string
  on: boolean
  onToggle(): void
  children: ReactNode
}): ReactNode {
  return (
    <Tooltip label={label} detail={detail} side="right">
      <button
        type="button"
        aria-label={label}
        aria-pressed={on}
        onClick={onToggle}
        className={cn(
          't-press inline-flex size-[18px] shrink-0 items-center justify-center rounded-xs border text-[10px] leading-none font-bold',
          on
            ? 'border-accent bg-accent text-accent-ink hover:bg-accent-hover'
            : 'border-line-strong bg-surface-2 text-ink-2 hover:border-line-hover hover:text-ink-0'
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export function TrackHeader({ track, badge, height, size, removable }: TrackHeaderProps): ReactNode {
  const patchTrack = useEditor((state) => state.patchTrack)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(track.name)
  const [pointMenu, setPointMenu] = useState<{ x: number; y: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLButtonElement>(null)
  const more = useFloatingTrigger('menu')
  // Reordering by drag: this header is the one being dragged, or the one it would land on.
  const dragged = useTrackDrag((state) => state.draggingId === track.id)
  const dropTarget = useTrackDrag((state) => state.overId === track.id && state.draggingId !== null && state.draggingId !== track.id)
  // Whether there is a row above or below among tracks of this kind, for the menu's Move rows.
  const canMoveUp = useEditor((state) => placeBeside(selectTimeline(state)?.tracks ?? [], track.id, 'up') !== null)
  const canMoveDown = useEditor((state) => placeBeside(selectTimeline(state)?.tracks ?? [], track.id, 'down') !== null)

  useEffect(() => {
    if (!renaming) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [renaming])

  const startRename = (): void => {
    setDraft(track.name)
    setRenaming(true)
  }

  const finishRename = (save: boolean): void => {
    const trimmed = draft.trim()
    if (save && trimmed && trimmed !== track.name) patchTrack(track.id, { name: trimmed })
    else setDraft(track.name)
    setRenaming(false)
    // Back to the name, so a keyboard rename ends where it began rather than on <body>.
    requestAnimationFrame(() => nameRef.current?.focus({ preventScroll: true }))
  }

  const video = track.kind === 'video'
  const compact = height < 44
  const kindWord = video ? 'video' : 'audio'
  // A track still called by its number shows the kind in the name slot, as Resolve's
  // "Video 1" does, rather than the badge's text twice.
  const shownName = track.name === badge ? `${video ? 'Video' : 'Audio'} ${badge.slice(1)}` : track.name

  const addBeside = (where: 'above' | 'below'): void => {
    const state = useEditor.getState()
    const timeline = selectTimeline(state)
    if (!timeline) return
    state.addTrack(track.kind, insertIndexFor(timeline.tracks, track.id, where))
  }

  const setSize = (next: TrackSize): void => useTimelineView.getState().setTrackSize(track.id, next)

  const items: MenuEntry[] = [
    { label: 'Rename…', onSelect: startRename },
    { kind: 'separator' },
    { label: `Add ${kindWord} track above`, onSelect: () => addBeside('above') },
    { label: `Add ${kindWord} track below`, onSelect: () => addBeside('below') },
    { kind: 'separator' },
    // The keyboard's way to what dragging the track number does. Video rows are layers: up is in front.
    { label: video ? 'Move up (in front)' : 'Move up', disabled: !canMoveUp, onSelect: () => moveTrackBeside(track.id, 'up') },
    { label: video ? 'Move down (behind)' : 'Move down', disabled: !canMoveDown, onSelect: () => moveTrackBeside(track.id, 'down') },
    { kind: 'separator' },
    { label: 'Lock', checked: track.locked, onSelect: () => patchTrack(track.id, { locked: !track.locked }) },
    // Hide governs picture only, so an audio track has nothing to hide (see the toggles below).
    ...(video
      ? [{ label: 'Hide', checked: track.hidden, onSelect: () => patchTrack(track.id, { hidden: !track.hidden }) }]
      : []),
    { label: 'Mute', checked: track.muted, onSelect: () => patchTrack(track.id, { muted: !track.muted }) },
    { label: 'Solo', checked: track.solo === true, onSelect: () => patchTrack(track.id, { solo: !track.solo }) },
    { kind: 'separator' },
    { kind: 'label', label: 'Track height' },
    { label: 'Small', checked: size === 'small', onSelect: () => setSize('small') },
    { label: 'Medium', checked: size === 'medium', onSelect: () => setSize('medium') },
    { label: 'Large', checked: size === 'large', onSelect: () => setSize('large') },
    { kind: 'separator' },
    {
      // The reason rides in the label: a disabled menu row has no tooltip to carry it.
      label: removable ? `Delete ${track.name}` : `Delete ${track.name} — last ${kindWord} track`,
      danger: true,
      disabled: !removable,
      onSelect: () => useEditor.getState().removeTrack(track.id)
    }
  ]

  const toggles = (
    <div className="flex items-center gap-[3px]">
      <TrackToggle
        label={track.locked ? `Unlock ${track.name}` : `Lock ${track.name}`}
        detail="A locked track cannot be edited, moved or trimmed."
        on={track.locked}
        onToggle={() => patchTrack(track.id, { locked: !track.locked })}
      >
        {track.locked ? <Lock className="size-2.5" /> : <LockOpen className="size-2.5" />}
      </TrackToggle>
      {/*
        `hidden` governs picture, `muted` and `solo` govern sound, and they are independent — so a
        video track carrying audio gets all of them. Hiding a layer to see what is under it must
        not silently change the mix you are judging.

        Audio tracks get no eye because they have no picture: `itemsAtFrame` only honours
        `hidden` for `kind === 'video'`, so an eye there would be a dead control.
      */}
      {video && (
        <TrackToggle
          label={track.hidden ? `Show ${track.name}` : `Hide ${track.name}`}
          detail="A hidden track draws nothing in the picture. Its sound still plays."
          on={track.hidden}
          onToggle={() => patchTrack(track.id, { hidden: !track.hidden })}
        >
          {track.hidden ? <EyeOff className="size-2.5" /> : <Eye className="size-2.5" />}
        </TrackToggle>
      )}
      <TrackToggle
        label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
        detail="A muted track plays no sound."
        on={track.muted}
        onToggle={() => patchTrack(track.id, { muted: !track.muted })}
      >
        M
      </TrackToggle>
      <TrackToggle
        label={track.solo ? `Unsolo ${track.name}` : `Solo ${track.name} — hear only soloed tracks`}
        detail="While any track is soloed, only soloed tracks sound."
        on={track.solo === true}
        onToggle={() => patchTrack(track.id, { solo: !track.solo })}
      >
        S
      </TrackToggle>
    </div>
  )

  const options = (
    <IconButton
      {...more.triggerProps}
      size="xs"
      tooltipSide="right"
      label={`${track.name} options`}
      icon={<MoreHorizontal className="size-3" />}
      className="ml-auto shrink-0"
    />
  )

  // The track number on a chip of the kind's colour: the track reads as V1 or A1 at a glance.
  // It is also the grip: drag it onto another track of the same kind to take that track's place.
  // Not a button — the menu's Move up / Move down are the keyboard's way to the same thing.
  const badgeChip = (
    <span
      aria-hidden="true"
      title="Drag to reorder"
      {...trackDragHandlers(track)}
      className={cn(
        'inline-flex h-[18px] min-w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-xs px-1 text-[10px] font-bold text-on-media tabular-nums active:cursor-grabbing',
        video ? 'bg-clip-video-edge' : 'bg-clip-audio-edge'
      )}
    >
      {badge}
    </span>
  )

  const name = renaming ? (
    <input
      ref={inputRef}
      value={draft}
      aria-label={`Rename ${track.name}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finishRename(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finishRename(true)
        if (event.key === 'Escape') finishRename(false)
      }}
      className="h-5 w-full min-w-0 rounded-xs border border-accent/70 bg-surface-2 px-1 text-[11px] text-ink-0 outline-none"
    />
  ) : (
    <button
      ref={nameRef}
      type="button"
      onDoubleClick={startRename}
      onKeyDown={(event) => {
        // Enter or F2 on the focused name renames — the keyboard path to what a double-click does.
        if (event.key === 'Enter' || event.key === 'F2') {
          event.preventDefault()
          startRename()
        }
      }}
      title="Double-click or press Enter to rename"
      aria-label={`${track.name}, ${kindWord} track. Press Enter to rename`}
      className={cn(
        't-fast min-w-0 flex-1 truncate rounded-xs px-1 py-px text-left text-[11px] font-medium hover:bg-surface-3',
        track.name === badge ? 'text-ink-2' : 'text-ink-0'
      )}
    >
      {shownName}
    </button>
  )

  return (
    <div
      style={{ height }}
      data-track-header={track.id}
      data-track-kind={track.kind}
      onContextMenu={(event) => {
        if (renaming) return
        event.preventDefault()
        setPointMenu({ x: event.clientX, y: event.clientY })
      }}
      // The kind's colour runs the full height of the header's left edge, as on the badge.
      className={cn(
        'flex w-full border-b border-l-2 border-b-line px-1.5',
        compact ? 'flex-row items-center gap-1' : 'flex-col justify-center gap-1',
        video ? 'border-l-clip-video-edge' : 'border-l-clip-audio-edge',
        dragged && 'opacity-50',
        dropTarget && 'bg-accent/10 outline-1 -outline-offset-1 outline-accent'
      )}
    >
      {compact ? (
        <>
          {badgeChip}
          {/* No room for the name on a small track: the badge says which track it is, and the
              options menu's Rename… edits the name (shown here while renaming). */}
          {renaming ? name : null}
          {!renaming && toggles}
          {options}
        </>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-1">
            {badgeChip}
            {name}
            {options}
          </div>
          {toggles}
        </>
      )}

      <Menu {...more.surfaceProps} items={items} label={`${track.name} track`} side="right" align="start" />
      <ContextMenu at={pointMenu} onClose={() => setPointMenu(null)} items={items} label={`${track.name} track`} />
    </div>
  )
}
