import { useCallback, useEffect, useRef, useState } from 'react'
import type { ResolveStatus } from '@shared/host'
import { bay } from '@/lib/bay'
import { resolvePollMs } from '@/lib/projectHost'

export interface ResolveConnection {
  /** The last answer; null until the first one arrives. */
  status: ResolveStatus | null
  /** A question is out. */
  checking: boolean
  /** Ask now. */
  check(): void
  /** Bring Resolve to the front (launching it), then ask again. */
  open(): void
}

/**
 * Whether the agent can reach DaVinci Resolve, asked when `active` turns on and on request.
 *
 * With `poll`, it is asked again `resolvePollMs` after each answer — every 5 s while something is
 * still to be fixed, every 30 s once connected — and only while the window is visible: a hidden
 * window schedules nothing and asks once when it is shown again. Each wait starts when the
 * previous answer lands, so a slow probe is never asked twice at once.
 */
export function useResolveStatus(active: boolean, poll: boolean): ResolveConnection {
  const [status, setStatus] = useState<ResolveStatus | null>(null)
  const [checking, setChecking] = useState(false)
  // The newest question's number: an answer to an older one is dropped.
  const asked = useRef(0)
  const live = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkRef = useRef<() => void>(() => {})

  const check = useCallback((): void => {
    const api = bay()
    if (!api || !live.current) return
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    const mine = ++asked.current
    setChecking(true)
    const done = (answer: ResolveStatus | null): void => {
      if (!live.current || mine !== asked.current) return
      setChecking(false)
      if (answer) setStatus(answer)
      if (poll && document.visibilityState === 'visible') {
        timer.current = setTimeout(() => checkRef.current(), resolvePollMs(answer?.state ?? null))
      }
    }
    // `status()` never throws by contract; a bridge that does anyway must not end the polling.
    api.resolve.status().then(done, () => done(null))
  }, [poll])
  checkRef.current = check

  useEffect(() => {
    if (!active) return
    live.current = true
    check()
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') check()
      else if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
    if (poll) document.addEventListener('visibilitychange', onVisible)
    return () => {
      live.current = false
      asked.current++
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
      document.removeEventListener('visibilitychange', onVisible)
      setChecking(false)
    }
  }, [active, poll, check])

  const open = useCallback((): void => {
    const api = bay()
    if (!api) return
    void api.resolve.open().then(check, check)
  }, [check])

  return { status, checking, check, open }
}
