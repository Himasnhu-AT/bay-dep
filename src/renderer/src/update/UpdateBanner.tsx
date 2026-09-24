import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Download, LoaderCircle, RefreshCw, RotateCw, X } from 'lucide-react'
import { isEntitled } from '@shared/access'
import { bannerVisible, describeUpdate, restartPlan, runRestart, type RestartPlan, type UpdateStatus } from '@shared/update'
import { Button, Modal, ProgressBar } from '@/components'
import { bay } from '@/lib/bridge'
import { useAccess } from '@/access/AccessGate'
import { useEditor } from '@/store/editor'

/**
 * In-app updates, in the renderer: a small banner when there is something to act on, and the
 * About section in Settings. Main checks and downloads (`src/main/update/updater.ts`). The
 * renderer decides when restarting is safe, because it holds the project.
 *
 * Mounted outside the access gate, so a locked bay can still update.
 */

/** The update status, pushed by main. Null until the first answer. */
export function useUpdate(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    const api = bay()
    if (!api) return
    let live = true
    const off = api.update.onChange((next) => {
      if (live) setStatus(next)
    })
    void api.update.status().then((next) => {
      if (live) setStatus(next)
    })
    return () => {
      live = false
      off()
    }
  }, [])
  return status
}

/**
 * Restarting into the update without losing work. `restartPlan` decides, `runRestart` keeps the
 * order: save or autosave first, install only if that worked.
 */
function useRestart(): {
  asking: Extract<RestartPlan, { kind: 'save-first' }> | null
  start: () => void
  confirmSave: () => void
  cancel: () => void
  error: string | null
} {
  const access = useAccess()
  const [asking, setAsking] = useState<Extract<RestartPlan, { kind: 'save-first' }> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const steps = useCallback(
    () => ({
      save: async (): Promise<boolean> => {
        const api = bay()
        if (!api) return false
        try {
          // Null when the user cancels a Save dialog (an untitled project): then bay stays.
          const saved = await api.project.save(useEditor.getState().project)
          if (!saved) return false
          useEditor.getState().markSaved()
          return true
        } catch (reason) {
          setError(`bay did not restart, because saving failed: ${reason instanceof Error ? reason.message : String(reason)}`)
          return false
        }
      },
      autosave: async (): Promise<boolean> => {
        const api = bay()
        if (!api) return false
        try {
          await api.project.autosave(useEditor.getState().project)
          return true
        } catch (reason) {
          setError(`bay did not restart, because the recovery copy could not be written: ${reason instanceof Error ? reason.message : String(reason)}`)
          return false
        }
      },
      install: async (): Promise<void> => {
        await bay()?.update.install()
      }
    }),
    []
  )

  const start = useCallback((): void => {
    setError(null)
    const state = useEditor.getState()
    const plan = restartPlan({
      screen: state.screen,
      dirty: state.dirty,
      locked: !(access && isEntitled(access)),
      projectName: state.project.name
    })
    if (plan.kind === 'save-first') {
      setAsking(plan)
      return
    }
    void runRestart(plan, steps())
  }, [access, steps])

  const confirmSave = useCallback((): void => {
    const plan = asking
    setAsking(null)
    if (plan) void runRestart(plan, steps())
  }, [asking, steps])

  return { asking, start, confirmSave, cancel: () => setAsking(null), error }
}

/** What each state offers: one action, named for what it does. */
function UpdateActions({ status, restart }: { status: UpdateStatus; restart: () => void }): ReactNode {
  const api = bay()
  switch (status.state) {
    case 'available':
      return (
        <Button variant="primary" icon={<Download className="size-3.5" />} onClick={() => void api?.update.download()}>
          Update
        </Button>
      )
    case 'ready':
      return (
        <Button variant="primary" icon={<RotateCw className="size-3.5" />} onClick={restart}>
          Restart to update
        </Button>
      )
    case 'error': {
      const retry = (): void => {
        if (status.during === 'download') void api?.update.download()
        else if (status.during === 'install') restart()
        else void api?.update.check()
      }
      return (
        <Button icon={<RefreshCw className="size-3.5" />} onClick={retry}>
          Retry
        </Button>
      )
    }
    case 'idle':
    case 'current':
      return (
        <Button icon={<RefreshCw className="size-3.5" />} onClick={() => void api?.update.check()}>
          Check now
        </Button>
      )
    default:
      return null
  }
}

function SaveFirst(props: { plan: { project: string } | null; onSave: () => void; onCancel: () => void }): ReactNode {
  return (
    <Modal
      open={props.plan !== null}
      title="Save changes before updating?"
      onClose={props.onCancel}
      width={380}
      footer={
        <>
          <Button variant="subtle" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={props.onSave}>
            Save and restart
          </Button>
        </>
      }
    >
      <p className="px-4 py-3 text-[12px] leading-relaxed text-pretty text-ink-1">
        “{props.plan?.project}” has changes that are not saved. bay saves them, then restarts into the new
        version.
      </p>
    </Modal>
  )
}

function Progress({ status }: { status: UpdateStatus }): ReactNode {
  if (status.state !== 'downloading') return null
  return (
    <ProgressBar value={status.percent / 100} label="Downloading the update" />
  )
}

function Notes({ status }: { status: UpdateStatus }): ReactNode {
  const notes = 'notes' in status ? status.notes : ''
  if (!notes || !['available', 'ready'].includes(status.state)) return null
  // Plain text, never HTML: the notes come off the network.
  return <p className="max-h-32 overflow-y-auto text-[11px] leading-relaxed whitespace-pre-line text-pretty text-ink-2">{notes}</p>
}

/** The banner: bottom-right, only when there is something to act on (`bannerVisible`). */
export function UpdateBanner(): ReactNode {
  const status = useUpdate()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const restart = useRestart()
  if (!bay() || !status) return null
  const visible = bannerVisible(status, dismissed)
  const text = describeUpdate(status)
  return (
    <>
      {visible && (
        <section
          aria-live="polite"
          data-update-state={status.state}
          className="fixed right-4 bottom-4 z-(--z-banner) flex w-[320px] flex-col gap-2.5 rounded-lg border border-line bg-surface-1 p-3.5 shadow-pop"
        >
          <div className="flex items-start gap-2">
            {status.state === 'downloading' && <LoaderCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 animate-spin text-ink-2" />}
            <div className="min-w-0 flex-1">
              <h2 className="text-[12px] font-semibold text-balance text-ink-0">{text.title}</h2>
              {text.detail && <p className="mt-0.5 text-[11px] text-pretty text-ink-2">{text.detail}</p>}
            </div>
            {status.state === 'available' && (
              <button
                type="button"
                aria-label="Not now"
                title="Not now: Settings › About keeps it"
                className="no-drag -m-1 rounded-sm p-1 text-ink-2 hover:bg-surface-3 hover:text-ink-0"
                onClick={() => setDismissed(status.next)}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Notes status={status} />
          <Progress status={status} />
          {restart.error && <p className="text-[11px] text-pretty text-danger">{restart.error}</p>}
          <div className="flex justify-end">
            <UpdateActions status={status} restart={restart.start} />
          </div>
        </section>
      )}
      <SaveFirst plan={restart.asking} onSave={restart.confirmSave} onCancel={restart.cancel} />
    </>
  )
}

/** Settings › About: the version, and where updates stand. Always there, never nagging. */
export function AboutUpdates(): ReactNode {
  const status = useUpdate()
  const restart = useRestart()
  if (!status) return null
  const text = describeUpdate(status)
  return (
    <div className="flex flex-col gap-2" data-update-state={status.state}>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-ink-0">bay {status.current}</div>
          <div className="text-[11px] text-pretty text-ink-2">
            {text.title}
            {text.detail ? ` ${text.detail}` : ''}
          </div>
        </div>
        <UpdateActions status={status} restart={restart.start} />
      </div>
      <Notes status={status} />
      <Progress status={status} />
      {restart.error && <p className="text-[11px] text-pretty text-danger">{restart.error}</p>}
      <SaveFirst plan={restart.asking} onSave={restart.confirmSave} onCancel={restart.cancel} />
    </div>
  )
}
