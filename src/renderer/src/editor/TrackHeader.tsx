import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Eye, EyeOff, Headphones, Lock, LockOpen, MoreHorizontal, Volume2, VolumeX } from 'lucide-react'
import type { Track } from '@shared/project'
import { ContextMenu, IconButton, Menu, useFloatingTrigger, type MenuEntry } from '@/components'
import { cn } from '@/lib/cn'
import { insertIndexFor, type TrackSize } from '@/lib/timelineLayout'
import { useTimelineView } from '@/lib/timelineView'
import { selectTimeline, useEditor } from '@/store/editor'

export interface TrackHeaderProps {
  track: Track
  height: number
  size: TrackSize
  /** False for the last track of its kind — removing it would leave nowhere to place a clip. */
  removable: boolean
}

export function TrackHeader({ track, height, size, removable }: TrackHeaderProps): ReactNode {
  const patchTrack = useEditor((state) => state.patchTrack)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(track.name)
  const [pointMenu, setPointMenu] = useState<{ x: number; y: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLButtonElement>(null)
  const more = useFloatingTrigger('menu')

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
    { label: 'Lock', checked: track.locked, onSelect: () => patchTrack(track.id, { locked: !track.locked }) },
    // Hide governs picture only, so an audio track has nothing to hide (see the buttons below).
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
    <div className="flex items-center gap-0.5">
      <IconButton
        size="xs"
        tooltipSide="right"
        label={track.locked ? `Unlock ${track.name}` : `Lock ${track.name}`}
        active={track.locked}
        icon={track.locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
        onClick={() => patchTrack(track.id, { locked: !track.locked })}
      />
      {/*
        `hidden` governs picture, `muted` and `solo` govern sound, and they are independent — so
        a video track carrying audio gets all of them (solo in its menu). Hiding a layer to see
        what is under it must not silently change the mix you are judging.

        Audio tracks get no eye because they have no picture: `itemsAtFrame` only honours
        `hidden` for `kind === 'video'`, so an eye there would be a dead control. Their slot
        holds solo instead, which is the control an audio track is reached for.
      */}
      {video ? (
        <IconButton
          size="xs"
          tooltipSide="right"
          label={track.hidden ? `Show ${track.name}` : `Hide ${track.name}`}
          active={track.hidden}
          icon={track.hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          onClick={() => patchTrack(track.id, { hidden: !track.hidden })}
        />
      ) : (
        <IconButton
          size="xs"
          tooltipSide="right"
          label={track.solo ? `Unsolo ${track.name}` : `Solo ${track.name} — hear only soloed tracks`}
          active={track.solo === true}
          icon={<Headphones className="size-3" />}
          onClick={() => patchTrack(track.id, { solo: !track.solo })}
        />
      )}
      <IconButton
        size="xs"
        tooltipSide="right"
        label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
        active={track.muted}
        icon={track.muted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
        onClick={() => patchTrack(track.id, { muted: !track.muted })}
      />
      <IconButton
        {...more.triggerProps}
        size="xs"
        tooltipSide="right"
        label={`${track.name} options`}
        icon={<MoreHorizontal className="size-3" />}
      />
    </div>
  )

  return (
    <div
      style={{ height }}
      onContextMenu={(event) => {
        if (renaming) return
        event.preventDefault()
        setPointMenu({ x: event.clientX, y: event.clientY })
      }}
      // The kind's colour runs the full height of the header, and the name sits on a chip of the
      // same colour — the track reads as V1 or A1 at a glance, before any of its text.
      className={cn(
        'flex w-full border-b border-l-2 border-b-line px-2 py-1',
        compact ? 'flex-row items-center gap-1' : 'flex-col justify-center gap-1',
        video ? 'border-l-clip-video-edge' : 'border-l-clip-audio-edge'
      )}
    >
      <div className={cn('flex min-w-0 items-center gap-1.5', compact && 'flex-1')}>
        {renaming ? (
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
              // Enter or F2 on the focused name renames — the keyboard path to what a
              // double-click does.
              if (event.key === 'Enter' || event.key === 'F2') {
                event.preventDefault()
                startRename()
              }
            }}
            title="Double-click or press Enter to rename"
            aria-label={`${track.name}, ${kindWord} track. Press Enter to rename`}
            className={cn(
              't-fast max-w-full min-w-0 truncate rounded-sm px-1.5 py-px text-left text-[11px] font-semibold text-on-media hover:brightness-125',
              video ? 'bg-clip-video-edge' : 'bg-clip-audio-edge'
            )}
          >
            {track.name}
          </button>
        )}
      </div>

      {toggles}

      <Menu {...more.surfaceProps} items={items} label={`${track.name} track`} side="right" align="start" />
      <ContextMenu at={pointMenu} onClose={() => setPointMenu(null)} items={items} label={`${track.name} track`} />
    </div>
  )
}
