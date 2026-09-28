/**
 * Waiting for a job inside a status call — the one implementation `track_export`,
 * `export_timeline { wait }`, `track_generation` and `track_dub` share.
 *
 * A model cannot sleep between calls, so a description that said "poll on a sensible interval"
 * produced back-to-back calls: 176 `track_export` results in one turn for a 62 s export. The
 * status tools take `waitSeconds` instead and hold their answer until the job settles or the wait
 * is up, whichever comes first.
 *
 * The wait never holds anything else up: it is a sleep between checks, run as idle time
 * (`CallContext.idle`), and every other call — another wait included — runs beside it. It stops
 * the moment the caller is gone (`CallContext.signal`), so a stopped turn does not leave a call
 * sleeping in the editor.
 */

import { WAIT_DEFAULT_SECONDS, WAIT_MAX_SECONDS } from '@shared/tools/fields'
import { DIRECT_CALL, fail, type CallContext } from './helpers'

/** The wait a call asked for, in seconds: the default when absent, refused when out of range. */
export function waitSecondsOf(args: Record<string, unknown>): number {
  if (args.waitSeconds === undefined) return WAIT_DEFAULT_SECONDS
  const seconds = Number(args.waitSeconds)
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > WAIT_MAX_SECONDS) {
    fail(`waitSeconds must be a number from 0 to ${WAIT_MAX_SECONDS}; got ${String(args.waitSeconds)}. Pass ${WAIT_MAX_SECONDS} for the longest wait, or 0 to answer at once.`)
  }
  return seconds
}

export interface WaitOutcome {
  /** Seconds actually spent waiting, to a tenth. */
  waited: number
  /** Why it stopped: the job settled, the wait ran out, or the caller went away. */
  endedBy: 'settled' | 'elapsed' | 'aborted'
}

/**
 * Checks `settled` until it says yes, `seconds` pass, or the call is aborted. Checks once at
 * the start, so `seconds: 0` is one look and an already-finished job costs no wait at all.
 * `pollMs` is how stale "settled" may be when it happens: a check that is a map read can be
 * frequent; one that asks main over IPC is spaced out.
 */
export async function waitUntil(
  settled: () => boolean | Promise<boolean>,
  options: { seconds: number; pollMs: number; context?: CallContext }
): Promise<WaitOutcome> {
  const { signal, idle } = options.context ?? DIRECT_CALL
  const started = Date.now()
  const deadline = started + options.seconds * 1000
  const outcome = (endedBy: WaitOutcome['endedBy']): WaitOutcome => ({
    waited: Math.round((Date.now() - started) / 100) / 10,
    endedBy
  })
  return idle(async () => {
    for (;;) {
      if (signal.aborted) return outcome('aborted')
      if (await settled()) return outcome('settled')
      const left = deadline - Date.now()
      if (left <= 0) return outcome('elapsed')
      await sleep(Math.min(options.pollMs, left), signal)
    }
  })
}

/** A timer that an abort ends early. Resolves either way; the loop reads the signal itself. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * What a result says after a wait that ended without the job finishing — the one sentence every
 * waiting tool uses, so the advice cannot drift between them.
 */
export function stillWorking(tool: string, id: string, outcome: WaitOutcome): string {
  if (outcome.endedBy === 'aborted') return `The wait was stopped after ${outcome.waited}s because the call was cancelled; the job itself is still running.`
  return (
    `Still working after waiting ${outcome.waited}s. Call ${tool} again with ${id} and waitSeconds ` +
    `(up to ${WAIT_MAX_SECONDS}) — it returns as soon as the job finishes. Do not call it in a tight loop.`
  )
}
