import { useMemo, type ReactNode } from 'react'
import { History } from 'lucide-react'
import type { Project } from '@shared/project'
import { actorLabel, describeStep, historyView } from '@shared/history'
import { Badge, IconButton, Popover, useFloatingTrigger } from '@/components'
import { cn } from '@/lib/cn'
import { stepNote } from '@/store/history-notes'
import { useEditor } from '@/store/editor'
import { HISTORY_LIMIT } from '@/store/kit'

/**
 * A step's description, remembered per pair of snapshots. Describing a step compares two whole
 * projects; the snapshots never change once made, so each pair is described once however often
 * the list is opened. Weak, so a snapshot that leaves the history takes its descriptions along.
 */
const described = new WeakMap<Project, WeakMap<Project, string>>()
function describeOnce(before: Project, after: Project): string {
  let row = described.get(before)
  if (!row) described.set(before, (row = new WeakMap()))
  let label = row.get(after)
  if (label === undefined) row.set(after, (label = describeStep(before, after)))
  return label
}

/**
 * The undo history as a list, beside Undo and Redo: newest at the top, the step the project is
 * at marked, the undone steps dimmed above it. Clicking a row steps the project there — a
 * run of undos or redos (`jumpToHistory`), so it is itself undoable the same way. The bottom row
 * is the project as it was opened.
 *
 * The history is this session's: it is not saved with the project, and holds the last 100 steps.
 */
export function HistoryMenu(): ReactNode {
  const menu = useFloatingTrigger('dialog')
  const past = useEditor((state) => state.past)
  const future = useEditor((state) => state.future)
  const project = useEditor((state) => state.project)
  const jump = useEditor((state) => state.jumpToHistory)
  // Only while it is open: with it closed nothing reads the list, and every edit changes `past`.
  const view = useMemo(
    () => (menu.open ? historyView(past, project, future, stepNote, describeOnce) : null),
    [menu.open, past, project, future]
  )
  const count = past.length + future.length

  const row = (position: number, label: string, tag: string | null, applied: boolean): ReactNode => {
    const current = view?.position === position
    return (
      <li key={position}>
        <button
          type="button"
          aria-current={current ? 'step' : undefined}
          onClick={() => {
            const result = jump(position)
            if ('error' in result) useEditor.getState().notify(result.error, 'error')
          }}
          className={cn(
            't-fast flex min-h-7 w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-[12px] hover:bg-surface-4',
            current ? 'bg-surface-3 font-medium text-ink-0' : applied ? 'text-ink-0' : 'text-ink-2'
          )}
        >
          <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', current ? 'bg-accent' : 'bg-transparent')} />
          <span className="min-w-0 flex-1 truncate" title={label}>
            {label}
          </span>
          {tag && <Badge>{tag}</Badge>}
          {current && <span className="sr-only">(current)</span>}
          {!applied && !current && <span className="sr-only">(undone)</span>}
        </button>
      </li>
    )
  }

  return (
    <>
      <IconButton
        {...menu.triggerProps}
        label={count === 0 ? 'History — no changes yet' : `History (${past.length} of ${count} steps applied)`}
        icon={<History className="size-4" />}
        active={menu.open}
      />
      <Popover {...menu.surfaceProps} label="Undo history" side="bottom" align="end" width={300}>
        {view && view.steps.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-ink-2">
            No changes yet. Every change you or the agent make to this project is listed here, and you can step back to any of them.
          </p>
        ) : (
          <ol reversed className="-mx-1 flex max-h-80 flex-col overflow-y-auto">
            {[...(view?.steps ?? [])].reverse().map((step) => row(step.position, step.label, actorLabel(step.actor), step.applied))}
            {row(0, past.length + future.length >= HISTORY_LIMIT ? 'Earliest step kept' : 'Project opened', null, true)}
          </ol>
        )}
      </Popover>
    </>
  )
}
