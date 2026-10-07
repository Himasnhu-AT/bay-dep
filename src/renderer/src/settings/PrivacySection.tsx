import { useEffect, useState, type ReactNode } from 'react'
import { Badge } from '@/components'
import { bay } from '@/lib/bay'
import type { TelemetryStatus, TelemetrySwitch } from '@shared/telemetry'
import { Group, Note, Row, Section, SwitchRow } from './parts'

/**
 * Preferences › Privacy: the two switches for what bay sends to its website — usage telemetry and
 * crash reports — both on unless turned off. Main keeps the switches (its database) and does the
 * sending (`src/main/telemetry/`); this page only asks and turns.
 */

/** The sentence the first-launch notice and this page share, so they never describe two things. */
export const WHAT_IS_SENT =
  'bay sends its website anonymous usage counts (which features are used, export sizes and times, how many tool calls a turn made) and crash reports with file paths and emails removed. Never your email, projects, file or asset names, prompts, transcripts or media.'

/** Main's telemetry status, asked once on mount; the switches answer with the new one. */
export function useTelemetryStatus(): { status: TelemetryStatus | null; asked: boolean; set: (next: TelemetryStatus) => void } {
  const [status, setStatus] = useState<TelemetryStatus | null>(null)
  const [asked, setAsked] = useState(false)
  useEffect(() => {
    let live = true
    const pending = bay()?.telemetry.status()
    if (!pending) {
      setAsked(true)
      return
    }
    pending
      .then((next) => {
        if (live) setStatus(next)
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setAsked(true)
      })
    return () => {
      live = false
    }
  }, [])
  return { status, asked, set: setStatus }
}

/** Where reports go, in words — including the case where this build sends nothing at all. */
function destinationHint(status: TelemetryStatus): string {
  if (!status.destination) return 'This is a development build: nothing is sent, whatever the switches say.'
  const host = new URL(status.destination).host
  const waiting = status.queued.events + status.queued.crashes
  const queued = waiting > 0 ? ` ${waiting} waiting to send.` : ''
  return `Sent to ${host}.${queued}`
}

export function PrivacySection(): ReactNode {
  const { status, asked, set } = useTelemetryStatus()
  const [switching, setSwitching] = useState(false)
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
    <Section title="Privacy" description={WHAT_IS_SENT}>
      <Group title="Sent to bay">
        <SwitchRow
          label="Usage telemetry"
          description="Counts and sizes: the app opening, a project's number of tracks and clips, an export's length, size and time, which Resolve page you are on, tool names and whether they worked, how many files of each kind you import. Off: nothing is sent, and anything waiting is deleted."
          checked={status?.telemetry ?? false}
          disabled={!asked || status === null || switching}
          onChange={(on) => turn('telemetry', on)}
        />
        <SwitchRow
          label="Crash reports"
          description="When bay or one of its processes crashes: which process, the error message and stack, with your home folder, folder names, file names and emails removed first. Off: nothing is sent, and anything waiting is deleted."
          checked={status?.crash ?? false}
          disabled={!asked || status === null || switching}
          onChange={(on) => turn('crash', on)}
        />
        <Row label="Destination" hint={status ? destinationHint(status) : undefined}>
          {!asked ? (
            <span className="text-[11px] text-ink-2">Checking…</span>
          ) : status === null ? (
            <Badge tone="neutral">Unknown</Badge>
          ) : !status.destination || (!status.telemetry && !status.crash) ? (
            <Badge tone="neutral">Nothing sent</Badge>
          ) : (
            <Badge tone="success">On</Badge>
          )}
        </Row>
      </Group>
      {status?.lastProblem && <Note tone="danger">{status.lastProblem}</Note>}
      <Group title="Kept on this Mac">
        <Row
          label="Crash dumps"
          hint={
            status
              ? `Electron writes a minidump when a process crashes. They stay in ${status.minidumpDir} and are never uploaded.`
              : 'Electron writes a minidump when a process crashes. They stay on this Mac and are never uploaded.'
          }
        >
          <Badge tone="neutral">Local only</Badge>
        </Row>
      </Group>
    </Section>
  )
}
