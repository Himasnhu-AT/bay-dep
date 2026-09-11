import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Eye, EyeOff, Lock, LockOpen, Trash2, Volume2, VolumeX } from 'lucide-react'
import type { Track } from '@shared/project'
import { IconButton } from '@/components'
import { cn } from '@/lib/cn'
import { useEditor } from '@/store/editor'

export interface TrackHeaderProps {
  track: Track
  height: number
  /** False for the last track of its kind — removing it would leave nowhere to place a clip. */
  removable: boolean
}

export function TrackHeader({ track, height, removable }: TrackHeaderProps): ReactNode {
  const patchTrack = useEditor((state) => state.patchTrack)
  const removeTrack = useEditor((state) => state.removeTrack)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(track.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!renaming) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [renaming])

  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== track.name) patchTrack(track.id, { name: trimmed })
    else setDraft(track.name)
    setRenaming(false)
  }

  const video = track.kind === 'video'

  return (
    <div
      style={{ height }}
      className="flex w-full flex-col justify-center gap-1 border-b border-line px-2 py-1"
    >
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            'h-3 w-[3px] shrink-0 rounded-full',
            video ? 'bg-clip-video-edge' : 'bg-clip-audio-edge'
          )}
        />
        {renaming ? (
          <input
            ref={inputRef}
            value={draft}
            aria-label={`Rename ${track.name}`}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') {
                setDraft(track.name)
                setRenaming(false)
              }
            }}
            className="h-5 w-full min-w-0 rounded-xs border border-accent/70 bg-surface-2 px-1 text-[11px] text-ink-0 outline-none"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => {
              setDraft(track.name)
              setRenaming(true)
            }}
            title="Double-click to rename"
            className="t-fast min-w-0 flex-1 truncate rounded-xs px-0.5 text-left text-[11px] font-medium text-ink-0 hover:bg-surface-3"
          >
            {track.name}
          </button>
        )}
      </div>

      <div className="flex items-center gap-0.5 pl-[9px]">
        <IconButton
          size="xs"
          tooltipSide="right"
          label={track.locked ? `Unlock ${track.name}` : `Lock ${track.name}`}
          active={track.locked}
          icon={track.locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
          onClick={() => patchTrack(track.id, { locked: !track.locked })}
        />
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
            label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
            active={track.muted}
            icon={track.muted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
            onClick={() => patchTrack(track.id, { muted: !track.muted })}
          />
        )}
        <IconButton
          size="xs"
          variant="danger"
          tooltipSide="right"
          label={`Delete ${track.name}`}
          icon={<Trash2 className="size-3" />}
          disabled={!removable}
          onClick={() => removeTrack(track.id)}
        />
      </div>
    </div>
  )
}
