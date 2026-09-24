import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, MessageSquare, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { formatTimecode, type ReviewComment } from '@shared/project'
import { shortcutOf } from '@shared/commands'
import { Button, IconButton, Kbd, Popover, useFloatingTrigger } from '@/components'
import { cn } from '@/lib/cn'
import { onCommentComposerRequest } from '@/lib/commentComposer'
import { selectTimeline, useEditor } from '@/store/editor'

/**
 * Review comments on the timeline: round pins on the ruler's top strip (markers are flags there,
 * so the two read apart at a glance), a popover per pin to read, edit, resolve or delete, and the
 * toolbar's Comments button, which lists them and holds the composer ⌥M opens.
 *
 * Open comments are the warning colour — something is asked; resolved ones are dimmed and kept,
 * as the record of what was asked and what was done.
 */

const NO_COMMENTS: readonly ReviewComment[] = []

const TEXTAREA =
  'w-full resize-y rounded-sm border border-line bg-surface-2 p-2 text-[12px] leading-snug text-ink-0 outline-none placeholder:text-ink-2 focus:border-accent/70'

function when(comment: ReviewComment, fps: number): string {
  return (
    formatTimecode(comment.frame, fps, true) +
    (comment.endFrame !== undefined ? `–${formatTimecode(comment.endFrame, fps, true)}` : '')
  )
}

/** Read, edit, resolve or reopen, jump to, delete — the body of a pin's popover. */
function CommentEditor({ comment, fps, onDone }: { comment: ReviewComment; fps: number; onDone(): void }): ReactNode {
  const [draft, setDraft] = useState(comment.text)
  useEffect(() => setDraft(comment.text), [comment.text])

  const commit = (): void => {
    const next = draft.trim()
    if (!next) setDraft(comment.text)
    else if (next !== comment.text) useEditor.getState().editComment(comment.id, { text: next })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11px] text-ink-2">
        <span className="tabular-nums">{when(comment, fps)}</span>
        <span aria-hidden="true">·</span>
        <span>{comment.author === 'agent' ? 'From the agent' : 'You'}</span>
        {comment.resolved && (
          <span className="ml-auto inline-flex items-center gap-1 text-success">
            <Check className="size-3" aria-hidden="true" /> Resolved
          </span>
        )}
      </div>
      <textarea
        aria-label="Comment"
        value={draft}
        rows={3}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            commit()
            onDone()
          }
        }}
        className={TEXTAREA}
      />
      {comment.resolved && comment.resolvedNote && (
        <p className="rounded-sm bg-surface-3 px-2 py-1.5 text-[11px] leading-snug text-ink-1">{comment.resolvedNote}</p>
      )}
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="mr-auto"
          onClick={() => {
            useEditor.getState().setPlayhead(comment.frame)
            onDone()
          }}
        >
          Go to
        </Button>
        {comment.resolved ? (
          <Button
            size="sm"
            icon={<RotateCcw className="size-3" />}
            onClick={() => useEditor.getState().editComment(comment.id, { resolved: false })}
          >
            Reopen
          </Button>
        ) : (
          <Button
            size="sm"
            icon={<Check className="size-3" />}
            onClick={() => {
              commit()
              useEditor.getState().resolveComment(comment.id)
              onDone()
            }}
          >
            Resolve
          </Button>
        )}
        <IconButton
          size="sm"
          label="Delete comment"
          icon={<Trash2 className="size-3" />}
          onClick={() => {
            onDone()
            useEditor.getState().removeComment(comment.id)
          }}
        />
      </div>
    </div>
  )
}

/** One pin on the ruler, and the span it covers when it has one. Click or Enter opens it. */
function CommentPin({ comment, fps, pixelsPerFrame }: { comment: ReviewComment; fps: number; pixelsPerFrame: number }): ReactNode {
  const popover = useFloatingTrigger('dialog')
  const label = `${comment.resolved ? 'Resolved comment' : 'Comment'} at ${when(comment, fps)}: ${comment.text}`
  return (
    <>
      {comment.endFrame !== undefined && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-[4px] h-0.5 rounded-full',
            comment.resolved ? 'bg-ink-3' : 'bg-warning/70'
          )}
          style={{ left: comment.frame * pixelsPerFrame, width: Math.max(1, (comment.endFrame - comment.frame) * pixelsPerFrame) }}
        />
      )}
      <button
        {...popover.triggerProps}
        type="button"
        aria-label={label}
        title={label}
        // A press on a pin must not reach the ruler, which would scrub the playhead to it.
        onPointerDown={(event) => event.stopPropagation()}
        className={cn(
          'absolute top-0 z-[2] -ml-[5px] size-[10px] rounded-full border',
          comment.resolved ? 'border-ink-3 bg-surface-3 opacity-60' : 'border-surface-1 bg-warning',
          comment.author === 'agent' && !comment.resolved && 'bg-surface-1 border-warning border-2',
          popover.open && 'z-[3] ring-1 ring-ink-0'
        )}
        style={{ left: comment.frame * pixelsPerFrame }}
      />
      <Popover {...popover.surfaceProps} label="Comment" side="bottom" align="start" width={260}>
        <CommentEditor comment={comment} fps={fps} onDone={() => popover.setOpen(false)} />
      </Popover>
    </>
  )
}

/** The pins inside the visible window. Resolved first, so an open pin on the same frame draws on top. */
export function RulerComments({
  fps,
  pixelsPerFrame,
  viewStart,
  viewEnd
}: {
  fps: number
  pixelsPerFrame: number
  viewStart: number
  viewEnd: number
}): ReactNode {
  const comments = useEditor((state) => selectTimeline(state)?.comments ?? NO_COMMENTS)
  const visible = comments
    .filter((c) => (c.endFrame ?? c.frame) >= viewStart && c.frame <= viewEnd)
    .sort((a, b) => Number(b.resolved) - Number(a.resolved))
  return (
    <>
      {visible.map((comment) => (
        <CommentPin key={comment.id} comment={comment} fps={fps} pixelsPerFrame={pixelsPerFrame} />
      ))}
    </>
  )
}

/** A new comment at the playhead: the words, then Add (or ⌘Enter). */
function Composer({ fps, onAdded }: { fps: number; onAdded(): void }): ReactNode {
  const playhead = useEditor((state) => state.playhead)
  const [draft, setDraft] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  // A frame later, so the popover's own initial focus (its surface) lands first and this wins.
  useEffect(() => {
    const frame = requestAnimationFrame(() => field.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  const add = (): void => {
    const state = useEditor.getState()
    if (state.addComment(state.playhead, draft)) {
      setDraft('')
      onAdded()
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="comment-draft" className="text-[11px] text-ink-1">
        Comment at <span className="tabular-nums">{formatTimecode(playhead, fps, true)}</span>
      </label>
      <textarea
        id="comment-draft"
        ref={field}
        value={draft}
        rows={2}
        placeholder="What should change here?"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            add()
          }
        }}
        className={TEXTAREA}
      />
      <Button size="sm" icon={<Plus className="size-3" />} disabled={!draft.trim()} onClick={add}>
        Add comment
      </Button>
    </div>
  )
}

/**
 * Every comment in time order with jump-to, and the composer — the toolbar's Comments button.
 * ⌥M opens it with the composer focused.
 */
export function CommentListButton({ fps }: { fps: number }): ReactNode {
  const comments = useEditor((state) => selectTimeline(state)?.comments ?? NO_COMMENTS)
  const list = useFloatingTrigger('dialog')
  const { setOpen } = list
  const [composing, setComposing] = useState(false)

  useEffect(
    () =>
      onCommentComposerRequest(() => {
        setComposing(true)
        setOpen(true)
      }),
    [setOpen]
  )
  useEffect(() => {
    if (!list.open) setComposing(false)
  }, [list.open])

  const sorted = [...comments].sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.frame - b.frame)
  const open = comments.filter((c) => !c.resolved).length
  const shortcut = shortcutOf('mark.addComment') ?? 'Alt+M'

  return (
    <>
      <IconButton
        {...list.triggerProps}
        size="xs"
        label={comments.length === 0 ? 'Comments — none yet' : `Comments (${open} open)`}
        icon={<MessageSquare className="size-3" />}
        active={list.open}
      />
      <Popover {...list.surfaceProps} label="Comments" side="bottom" align="start" width={280}>
        <div className="flex flex-col gap-2">
          {composing ? (
            <Composer fps={fps} onAdded={() => setComposing(false)} />
          ) : (
            <>
              {sorted.length === 0 ? (
                <p className="text-[11px] leading-relaxed text-ink-2">
                  No comments yet. Leave notes where something should change, then ask the agent to address them.
                  Press <Kbd shortcut={shortcut} /> to comment at the playhead.
                </p>
              ) : (
                <ul className="-mx-1 flex max-h-64 flex-col overflow-y-auto">
                  {sorted.map((comment) => (
                    <li key={comment.id}>
                      <button
                        type="button"
                        onClick={() => {
                          useEditor.getState().setPlayhead(comment.frame)
                          list.setOpen(false)
                        }}
                        className={cn(
                          't-fast flex min-h-7 w-full items-start gap-2 rounded-sm px-1 py-1 text-left text-[12px] hover:bg-surface-4',
                          comment.resolved ? 'text-ink-2' : 'text-ink-0'
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn('mt-1 size-2 shrink-0 rounded-full', comment.resolved ? 'bg-ink-3' : 'bg-warning')}
                        />
                        <span className={cn('min-w-0 flex-1 line-clamp-2', comment.resolved && 'line-through')}>
                          {comment.text}
                        </span>
                        <span className="text-[11px] text-ink-2 tabular-nums">{formatTimecode(comment.frame, fps, true)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Button size="sm" icon={<Plus className="size-3" />} onClick={() => setComposing(true)}>
                Add comment at playhead
              </Button>
            </>
          )}
        </div>
      </Popover>
    </>
  )
}
