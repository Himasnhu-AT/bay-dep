import type { ReactNode } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { resolveStatusMessage } from '@shared/host'
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
    </div>
  )
}
