import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, LoaderCircle, LogIn, UserPlus } from 'lucide-react'
import { describeAccess, isEntitled, type AccessStatus } from '@shared/access'
import { Button } from '@/components'
import { bay } from '@/lib/bridge'
import { useEditor } from '@/store/editor'

/**
 * The access screen: what bay shows instead of everything else until main says this Mac is
 * entitled (`src/shared/access.ts`).
 *
 * This is UI, not the lock. Main refuses the editor's IPC and every MCP tool call on its own
 * (`src/main/auth/gate.ts`); a renderer that skipped this screen would find nothing working
 * behind it. The editor is not mounted while locked, so nothing in it can even ask.
 */

/** The current access status, pushed by main. Null until the first answer. */
export function useAccess(): AccessStatus | null {
  const [status, setStatus] = useState<AccessStatus | null>(null)
  useEffect(() => {
    const api = bay()
    if (!api) return
    let live = true
    const off = api.access.onChange((next) => {
      if (live) setStatus(next)
    })
    void api.access.status().then((next) => {
      if (live) setStatus(next)
    })
    return () => {
      live = false
      off()
    }
  }, [])
  return status
}

export function AccessGate({ children }: { children: ReactNode }): ReactNode {
  const status = useAccess()
  const entitled = status !== null && isEntitled(status)
  // Access can be lost while the editor is open — a revoked grant found by the six-hourly check,
  // or fourteen days without one. Unmounting the editor then threw away every unsaved edit. So a
  // session that was working keeps its editor mounted under the access screen (main refuses its
  // calls either way), and the open project is written to its autosave sidecar at the moment it
  // locks — the one call main allows while locked for this reason.
  const wasEntitled = useRef(false)
  useEffect(() => {
    if (entitled) {
      wasEntitled.current = true
      return
    }
    if (!wasEntitled.current || status === null) return
    const api = bay()
    const { project, dirty } = useEditor.getState()
    if (api && dirty) void api.project.autosave(project).catch(() => undefined)
  }, [entitled, status])

  // No bridge means no main process: there is nothing to gate and nothing behind it.
  if (!bay()) return children
  if (entitled) return children
  if (wasEntitled.current) {
    return (
      <>
        {children}
        <div className="fixed inset-0 z-(--z-gate)" data-access-overlay>
          <AccessScreen status={status} />
        </div>
      </>
    )
  }
  return <AccessScreen status={status} />
}

function AccessScreen({ status }: { status: AccessStatus | null }): ReactNode {
  const [busy, setBusy] = useState(false)
  const api = bay()

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }
  const signIn = (): Promise<void> => run(() => api?.access.signIn() ?? Promise.resolve())

  const text = status ? describeAccess(status) : { title: 'Starting bay…', detail: '' }
  const pending = !status || status.state === 'waiting' || status.state === 'checking'

  return (
    <div className="flex h-full w-full flex-col bg-surface-0 text-ink-0">
      <div className="drag-region h-11 shrink-0" />
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-16">
        <section
          aria-live="polite"
          data-access-state={status?.state ?? 'loading'}
          className="flex w-full max-w-[420px] flex-col gap-5 rounded-xl border border-line bg-surface-1 p-6"
        >
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-accent text-[12px] font-semibold text-accent-ink">b</span>
            <span className="text-[13px] font-semibold tracking-tight">bay</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <h1 className="flex items-center gap-2 text-[15px] font-semibold text-balance">
              {pending && <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-ink-2" />}
              {text.title}
            </h1>
            {text.detail && <p className="text-[12px] text-pretty text-ink-1">{text.detail}</p>}
          </div>

          <Actions status={status} busy={busy} signIn={signIn} run={run} />

          <p className="border-t border-line pt-4 text-[11px] text-pretty text-ink-2">
            Access is checked with Google when you are online, and bay keeps working offline for up to 14 days. Your
            projects and media never leave this Mac.
          </p>
        </section>
      </div>
    </div>
  )
}

function Actions(props: {
  status: AccessStatus | null
  busy: boolean
  signIn: () => Promise<void>
  run: (work: () => Promise<unknown>) => Promise<void>
}): ReactNode {
  const { status, busy, signIn, run } = props
  const api = bay()
  if (!status || status.state === 'checking' || status.state === 'entitled') return null

  if (status.state === 'waiting') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          icon={<ExternalLink className="size-3.5" />}
          onClick={() => {
            // An https page leaves through the window-open handler to the browser; the loopback
            // server is still waiting, so this is the same sign-in, not a new one.
            window.open(status.url)
          }}
        >
          Open the browser again
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void run(() => api?.access.cancelSignIn() ?? Promise.resolve())}>
          Cancel
        </Button>
      </div>
    )
  }

  if (status.state === 'no-access') {
    // Two ways in: a referral from someone who has access — who must type this exact address, so
    // the screen hands it over with a Copy button — or the website's waitlist.
    return (
      <div className="flex flex-col gap-3">
        {status.reason === 'no-grant' && <CopyEmail email={status.email} />}
        <div className="flex flex-wrap items-center gap-2">
          {status.reason === 'no-grant' && (
            <Button variant="primary" size="md" icon={<UserPlus className="size-3.5" />} onClick={() => void api?.access.requestAccess()}>
              Join the waitlist
            </Button>
          )}
          <Button size="md" disabled={busy} icon={<LogIn className="size-3.5" />} onClick={() => void signIn()}>
            Use a different account
          </Button>
        </div>
        <Button variant="ghost" className="-ml-2.5 self-start" disabled={busy} onClick={() => void run(() => api?.access.recheck() ?? Promise.resolve())}>
          Check again
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" size="md" disabled={busy} icon={<LogIn className="size-3.5" />} onClick={() => void signIn()}>
        {status.state === 'error' ? 'Try again' : 'Sign in with your browser'}
      </Button>
    </div>
  )
}

/** The address a referrer must enter, with a Copy button. The copy is confirmed, not assumed. */
function CopyEmail({ email }: { email: string }): ReactNode {
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no')
  useEffect(() => {
    if (copied === 'no') return
    const t = setTimeout(() => setCopied('no'), 2000)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-surface-0 py-1 pr-1 pl-2.5" data-access-email>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-0 select-text" title={email}>
        {email}
      </span>
      <Button
        size="sm"
        icon={copied === 'yes' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        onClick={() => {
          navigator.clipboard.writeText(email).then(
            () => setCopied('yes'),
            () => setCopied('failed')
          )
        }}
      >
        {copied === 'yes' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
      </Button>
    </div>
  )
}
