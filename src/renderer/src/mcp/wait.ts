/**
 * Waiting for a job inside a status call — the one implementation `export_timeline`,
 * `track_export`, `track_generation` and `track_dub` share.
 *
 * A model cannot sleep between calls, so any answer that arrives while a job is still running is
 * an invitation to call again: 176 `track_export` results in one turn for a 62 s export. So these
 * tools wait until the job settles (`WAIT_CEILING_SECONDS` at most); `waitSeconds` only shortens
 * that, and 0 is a plain status read.
 *
 * The wait never holds anything else up: it is a sleep between checks, run as idle time
 * (`CallContext.idle`), and every other call — another wait included — runs beside it. It stops
 * the moment the caller is gone (`CallContext.signal`), so a stopped turn does not leave a call
 * sleeping in the editor.
 */

import { WAIT_CEILING_SECONDS } from '@shared/tools/fields'
import { DIRECT_CALL, fail, type CallContext } from './helpers'

let ceiling = WAIT_CEILING_SECONDS

/** Test seam: a ceiling short enough to reach. Returns the setter's undo. */
export function setCeilingForTest(seconds: number): () => void {
  ceiling = seconds
  return () => {
    ceiling = WAIT_CEILING_SECONDS
  }
}

/** The wait a call asked for, in seconds: until the job finishes (the ceiling) when absent. */
export function waitSecondsOf(args: Record<string, unknown>): number {
  if (args.waitSeconds === undefined) return ceiling
  const seconds = Number(args.waitSeconds)
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > WAIT_CEILING_SECONDS) {
    fail(`waitSeconds must be a number from 0 to ${WAIT_CEILING_SECONDS}; got ${String(args.waitSeconds)}. Leave it out to wait until the job finishes, or pass 0 to read the status at once.`)
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
 * `everyMs` is how stale "settled" may be when it happens: a check that is a map read can be
 * frequent; one that asks main over IPC is spaced out.
 */
export async function waitUntil(
  settled: () => boolean | Promise<boolean>,
  options: { seconds: number; everyMs: number; context?: CallContext }
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
      await sleep(Math.min(options.everyMs, left), signal)
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
 * waiting tool uses, so the advice cannot drift between them. `call` is the call that keeps
 * waiting, written out (`track_export { jobId: "…" }`); `state` is how far along it is.
 */
export function stillWorking(call: string, state: string, outcome: WaitOutcome): string {
  if (outcome.endedBy === 'aborted') return `The wait was stopped after ${outcome.waited}s because the call was cancelled; the job itself is ${state} and was not touched.`
  return `Still ${state} after ${outcome.waited}s. Call ${call} to keep waiting — it returns when the job finishes.`
}
