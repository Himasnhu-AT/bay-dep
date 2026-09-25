import { useEffect, type ReactNode } from 'react'
import { AlertTriangle, Bot, Check, Loader2, X } from 'lucide-react'
import { Badge, Button, EmptyState, Panel, ProgressBar, ScrollArea } from '@/components'
import { cn } from '@/lib/cn'
import { DoneActions, StartButton, useExportForm } from '../ExportDialog'
import { useExportSession, watchExports } from '../export-session'
import { fileName, isRunning, recordStatus, type RecordTone, type RenderRecord } from './queue'

export interface RenderQueueProps {
  className?: string
}

const TONE_TEXT: Record<RecordTone, string> = {
  running: 'text-ink-1',
  complete: 'text-success',
  incomplete: 'text-warning',
  failed: 'text-danger',
  cancelled: 'text-ink-2'
}

function ToneIcon({ tone }: { tone: RecordTone }): ReactNode {
  const className = cn('size-3.5 shrink-0', TONE_TEXT[tone])
  if (tone === 'running') return <Loader2 aria-hidden="true" className={cn(className, 'animate-spin')} />
  if (tone === 'complete') return <Check aria-hidden="true" className={className} />
  if (tone === 'cancelled') return <X aria-hidden="true" className={className} />
  return <AlertTriangle aria-hidden="true" className={className} />
}

/**
 * The Deliver page's Render Queue: every export this window has run since it opened — from
 * here, from ⌘E, or the agent's `export_timeline` — newest first, each with its progress, whether
 * the file came out complete, and Show in Finder. The big Render button at the bottom starts the
 * export the Render Settings describe, the same job the dialog's Export starts.
 *
 * bay renders one job at a time, so Render is disabled while one is running rather than
 * queuing a second behind it.
 */
export function RenderQueue({ className }: RenderQueueProps): ReactNode {
  const history = useExportSession((state) => state.history)
  const form = useExportForm()
  useEffect(() => watchExports(), [])
  const running = history.filter(isRunning).length
  return (
    <Panel
      title="Render Queue"
      className={cn('h-full', className)}
      bodyClassName="flex flex-col"
      actions={
        history.length > 0 ? (
          <span className="text-[11px] text-ink-2 tabular-nums">
            {running > 0 ? `${running} rendering · ` : ''}
            {history.length} {history.length === 1 ? 'job' : 'jobs'}
          </span>
        ) : null
      }
    >
      <ScrollArea className="flex-1">
        {history.length === 0 ? (
          <EmptyState
            title="No renders yet"
            hint="Choose a preset in Render Settings, then press Render. Exports made with ⌘E or by the agent appear here too."
          />
        ) : (
          <ol aria-label="Render jobs" className="divide-y divide-line">
            {history.map((record, index) => (
              <JobRow key={record.jobId} record={record} number={history.length - index} />
            ))}
          </ol>
        )}
      </ScrollArea>
      <footer className="shrink-0 border-t border-line bg-chrome-raised px-3 py-3">
        {form ? (
          <>
            <RenderButton />
            <p className="mt-1.5 text-[11px] text-pretty text-ink-2">
              {form.blockedBy ??
                (form.running
                  ? 'Rendering. Cancel it from its row to change the settings.'
                  : form.session.outputPath
                    ? `Renders to ${fileName(form.session.outputPath)}.`
                    : 'Asks where to save when you render.')}
            </p>
          </>
        ) : (
          <p className="text-[11px] text-ink-2">Open a timeline to render it.</p>
        )}
      </footer>
    </Panel>
  )
}

/** The page's primary action, full width. The same button (and blocker) as the dialog's Export. */
function RenderButton(): ReactNode {
  const form = useExportForm()
  if (!form) return null
  return (
    <div className="[&_button]:h-9 [&_button]:w-full [&_button]:justify-center [&_button]:text-[13px]">
      <StartButton blockedBy={form.blockedBy} label="Render" />
    </div>
  )
}

function JobRow({ record, number }: { record: RenderRecord; number: number }): ReactNode {
  const status = recordStatus(record)
  const cancel = useExportSession((state) => state.cancel)
  const current = useExportSession((state) => state.progress?.jobId === record.jobId)
  const percent = record.progress.progress === null ? null : record.progress.progress
  const name = fileName(record.outputPath) ?? (record.origin === 'agent' ? 'Agent export' : 'Export')
  const done = record.progress.stage === 'done' && record.outputPath
  return (
    <li className="px-3 py-2.5" aria-label={`Job ${number}: ${name}, ${status.label}`}>
      <div className="flex items-center gap-2">
        <span className="w-5 shrink-0 text-[10px] text-ink-2 tabular-nums">{number}</span>
        <ToneIcon tone={status.tone} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-0" title={record.outputPath ?? undefined}>
          {name}
        </span>
        {record.origin === 'agent' && (
          <Badge tone="neutral" className="gap-1">
            <Bot aria-hidden="true" className="size-3" /> Agent
          </Badge>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 pl-7">
        <span className={cn('text-[11px] font-medium', TONE_TEXT[status.tone])}>{status.label}</span>
        {record.summary && <span className="min-w-0 truncate text-[11px] text-ink-2">· {record.summary}</span>}
        <span className="ml-auto shrink-0 text-[10px] text-ink-2 tabular-nums">
          {new Date(record.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {status.tone === 'running' && (
        <div className="mt-1.5 flex items-center gap-2 pl-7">
          <div className="min-w-0 flex-1">
            <ProgressBar value={percent} label={`Progress of ${name}`} />
          </div>
          {/* Only this form's job can be cancelled from here; the agent cancels its own. */}
          {record.origin === 'you' && current && (
            <Button variant="danger" onClick={cancel}>
              Cancel
            </Button>
          )}
        </div>
      )}
      {status.detail && (
        <p className={cn('mt-1 pl-7 text-[11px] text-pretty', status.tone === 'running' ? 'text-ink-2 tabular-nums' : 'text-ink-1')}>
          {status.detail}
        </p>
      )}
      {done && (
        <div className="pl-7">
          <DoneActions path={record.outputPath!} />
        </div>
      )}
    </li>
  )
}
