import type { ReactNode } from 'react'
import { Check, ExternalLink, RefreshCw } from 'lucide-react'
import { resolveSetupSteps, resolveStatusMessage, type ResolveStatus } from '@shared/host'
import { Button } from '@/components'
import { cn } from '@/lib/cn'
import { canOpenResolve, resolveTone, type ResolveTone } from '@/lib/projectHost'
import type { ResolveConnection } from './useResolveStatus'

const DOT: Record<ResolveTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  neutral: 'bg-ink-2'
}

/**
 * The Resolve connection in one place: a state dot, the sentence for the state
 * (`resolveStatusMessage` — the wording is the contract's), Check again, and Open Resolve when
 * being closed is the whole problem. Shared by the New Project dialog and the Resolve workspace.
 */
export function ResolveStatusLine({ connection, className }: { connection: ResolveConnection; className?: string }): ReactNode {
  const { status, checking, check, open } = connection
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          data-resolve-dot={resolveTone(status)}
          className={cn('mt-[5px] size-2 shrink-0 rounded-full', DOT[resolveTone(status)])}
        />
        <p
          role="status"
          data-resolve-status={status?.state ?? 'unknown'}
          className="min-w-0 flex-1 text-[12px] leading-relaxed text-pretty text-ink-1 select-text"
        >
          {status ? resolveStatusMessage(status) : 'Checking for DaVinci Resolve…'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-4">
        <Button
          data-resolve-check=""
          disabled={checking}
          icon={<RefreshCw aria-hidden="true" className={cn('size-3.5', checking && 'animate-spin')} />}
          onClick={check}
        >
          {checking ? 'Checking…' : 'Check again'}
        </Button>
        {canOpenResolve(status) && (
          <Button data-resolve-open="" icon={<ExternalLink aria-hidden="true" className="size-3.5" />} onClick={open}>
            Open Resolve
          </Button>
        )}
      </div>
      {status && <ResolveSteps status={status} />}
    </div>
  )
}

/**
 * Every step from nothing to a connected Resolve, with this Mac's place on it
 * (`resolveSetupSteps`): done steps ticked, the one to do now spelled out, the rest named so the
 * bridge step is not a surprise.
 */
function ResolveSteps({ status }: { status: ResolveStatus }): ReactNode {
  return (
    <ol data-resolve-steps="" aria-label="Connecting DaVinci Resolve" className="flex flex-col gap-1.5 pl-4">
      {resolveSetupSteps(status).map((step, index) => (
        <li key={step.id} data-resolve-step={step.id} data-progress={step.progress} className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className={cn(
              'mt-px flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] tabular-nums',
              step.progress === 'done' && 'border-success text-success',
              step.progress === 'now' && 'border-accent bg-accent text-surface-0',
              step.progress === 'later' && 'border-line text-ink-2'
            )}
          >
            {step.progress === 'done' ? <Check className="size-2.5" /> : index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn('text-[12px]', step.progress === 'now' ? 'font-medium text-ink-0' : 'text-ink-2')}>
              {step.title}
              {step.progress === 'done' && <span className="sr-only"> (done)</span>}
            </p>
            {step.progress === 'now' && (
              <p className="text-[11px] leading-relaxed text-pretty text-ink-1 select-text">{step.detail}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
