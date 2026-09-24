import { useState, type ReactNode } from 'react'
import { formatTimecode, parseTimecode, resolveTimecode } from '@shared/timecode'
import { TextField, Tooltip } from '@/components'
import { selectDuration, selectFps, useEditor } from '@/store/editor'

/**
 * The transport's timecode: the playhead and the duration, and — clicked — a field that takes a
 * time to jump to. `01:23:10` or `1:23` (fields right-aligned to frames), `45` (frames), `2s`,
 * or a signed distance from the playhead (`+2s`, `-15`). Enter jumps, Escape or leaving cancels;
 * something that is not a time says so and keeps what was typed.
 */
export function TimecodeField(): ReactNode {
  const playhead = useEditor((state) => state.playhead)
  const duration = useEditor(selectDuration)
  const fps = useEditor(selectFps)
  const setPlayhead = useEditor((state) => state.setPlayhead)
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)

  const cancel = (): void => {
    setDraft(null)
    setInvalid(false)
  }

  const commit = (): void => {
    if (draft === null) return
    const parsed = parseTimecode(draft, fps)
    if (!parsed) {
      setInvalid(true)
      return
    }
    setPlayhead(resolveTimecode(parsed, useEditor.getState().playhead, duration))
    cancel()
  }

  return (
    <div className="flex flex-1 items-center justify-center gap-1.5 tabular-nums">
      {draft === null ? (
        <Tooltip side="top" label="Go to a time" detail="Type 00:01:10:00, 1:10, 45 (frames), 2s or +2s">
          {/*
            `tabular-nums` is not decoration here. Proportional digits change width as they
            change value, so a running timecode jitters sideways 30 times a second and drags
            everything beside it along.
          */}
          <button
            type="button"
            aria-label={`Playhead ${formatTimecode(playhead, fps)}. Go to a time`}
            onClick={() => setDraft(formatTimecode(playhead, fps))}
            className="t-press rounded-sm px-1.5 py-0.5 text-[13px] font-medium text-ink-0 hover:bg-surface-3 active:scale-[0.96]"
          >
            {formatTimecode(playhead, fps)}
          </button>
        </Tooltip>
      ) : (
        <TextField
          label="Go to time"
          autoFocus
          invalid={invalid}
          value={draft}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            setDraft(event.target.value)
            setInvalid(false)
          }}
          onBlur={cancel}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              // Ours: without this the app-level Escape would also close whatever is open.
              event.stopPropagation()
              event.nativeEvent.stopImmediatePropagation()
              cancel()
            }
          }}
          title={invalid ? 'Not a time. Try 00:00:05:00, 1:10, 45, 2s or +2s' : undefined}
          className="w-[128px]"
          inputClassName="text-center text-[13px] font-medium tabular-nums"
        />
      )}
      <span className="text-[11px] text-ink-2">/</span>
      <span className="text-[11px] text-ink-2">{formatTimecode(duration, fps)}</span>
    </div>
  )
}
