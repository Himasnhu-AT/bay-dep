import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { isEntitled } from '@shared/access'
import type { TelemetrySwitch } from '@shared/telemetry'
import { Button, Switch } from '@/components'
import { bay } from '@/lib/bay'
import { useAccess } from '@/access/AccessGate'
import { useEditor } from '@/store/editor'
import { openPreferences } from './SettingsDialog'
import { WHAT_IS_SENT, useTelemetryStatus } from './PrivacySection'

/**
 * The one-time notice, on the first launch after install, that bay sends usage counts and crash
 * reports — non-modal, in the corner opposite the update banner, until dismissed. Main remembers
 * the dismissal in its database (`telemetryNoticePending`), so it is once per install, not per
 * window or per session.
 *
 * Mounted outside the access gate (`main.tsx`, like the update banner), because bay starts sending
 * at launch — before sign-in — and the notice must be seen and acted on from the sign-in screen
 * too. Preferences live inside the gate, so while bay is locked the notice carries the two
 * switches itself; main keeps the telemetry channels open while locked (`OPEN_WHILE_LOCKED`).
 */
export function TelemetryNotice(): ReactNode {
  const { status, set } = useTelemetryStatus()
  const access = useAccess()
  const [dismissed, setDismissed] = useState(false)
  const [switching, setSwitching] = useState(false)
  if (!status || !status.noticePending || dismissed) return null
  // Preferences can open only in an entitled bay; locked (or not yet known), the switches are here.
  const locked = !(access && isEntitled(access))
  const dismiss = (): void => {
    setDismissed(true)
    void bay()?.telemetry.dismissNotice().catch(() => undefined)
  }
  const turn = (which: TelemetrySwitch, on: boolean): void => {
    const api = bay()
    if (!api) return
    setSwitching(true)
    void api.telemetry
      .set(which, on)
      .then(set)
      .catch(() => undefined)
      .finally(() => setSwitching(false))
  }
  return (
    <section
      aria-live="polite"
      aria-label="What bay sends"
      data-telemetry-notice
      className="fixed bottom-4 left-4 z-(--z-banner) flex w-[340px] flex-col gap-2.5 rounded-lg border border-line bg-surface-1 p-3.5 shadow-pop"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[12px] font-semibold text-balance text-ink-0">bay sends usage counts and crash reports</h2>
          <p className="mt-0.5 text-[11px] text-pretty text-ink-2">{WHAT_IS_SENT}</p>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          className="no-drag -m-1 rounded-sm p-1 text-ink-2 hover:bg-surface-3 hover:text-ink-0"
          onClick={dismiss}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {locked && (
        <div className="flex flex-col gap-1.5" data-telemetry-notice-switches>
          <label className="flex items-center justify-between gap-3 text-[11px] text-ink-1">
            Usage telemetry
            <Switch label="Usage telemetry" checked={status.telemetry} disabled={switching} onChange={(on) => turn('telemetry', on)} />
          </label>
          <label className="flex items-center justify-between gap-3 text-[11px] text-ink-1">
            Crash reports
            <Switch label="Crash reports" checked={status.crash} disabled={switching} onChange={(on) => turn('crash', on)} />
          </label>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={dismiss}>
          OK
        </Button>
        {!locked && (
          <Button
            variant="subtle"
            onClick={() => {
              dismiss()
              openPreferences('privacy')
            }}
          >
            Preferences › Privacy
          </Button>
        )}
      </div>
    </section>
  )
}

/**
 * `page_view` each time the workspace page changes (Media, Edit, Color, Audio, Deliver) — the
 * page's name and nothing else. Main drops it when usage telemetry is off.
 */
export function usePageViews(active: boolean): void {
  const page = useEditor((state) => state.page)
  useEffect(() => {
    if (active) bay()?.telemetry.track('page_view', { page })
  }, [page, active])
}
