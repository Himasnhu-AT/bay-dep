/**
 * Whether a window's renderer is listening for tool calls yet.
 *
 * The cold-start fault this exists for: the proxy launches bay, bay opens its socket almost at
 * once, the proxy connects and forwards the first call — and main pushes it into a page whose
 * React tree has not mounted, so nothing has registered the executor. IPC does not queue for a
 * listener that does not exist yet; the message is simply gone. Main then waited its full thirty
 * seconds and reported a timeout, on every cold start, while every component was working.
 *
 * So the renderer says when it is listening, and main waits for that before sending. The wait is
 * separate from the call timeout on purpose: a window still loading is not a tool taking too long,
 * and conflating them gave the agent "bay did not answer" about a call bay never received.
 *
 * No Electron here, so the waiting logic is testable under `pnpm test`; the ids are
 * `webContents.id`s, supplied by the caller.
 */

export class ExecutorReadiness {
  #ready = new Set<number>()
  #waiters = new Map<number, Set<() => void>>()

  set(id: number, ready: boolean): void {
    if (!ready) {
      this.#ready.delete(id)
      return
    }
    this.#ready.add(id)
    const waiting = this.#waiters.get(id)
    this.#waiters.delete(id)
    for (const wake of waiting ?? []) wake()
  }

  isReady(id: number): boolean {
    return this.#ready.has(id)
  }

  /** Forget a window entirely — it was destroyed. Anyone waiting on it is released as not ready. */
  forget(id: number): void {
    this.#ready.delete(id)
    const waiting = this.#waiters.get(id)
    this.#waiters.delete(id)
    for (const wake of waiting ?? []) wake()
  }

  /**
   * Resolves true once `id` is ready, or false after `timeoutMs` (or if it is forgotten first).
   * Never rejects: the caller turns `false` into a message, and a rejection would skip that.
   */
  whenReady(id: number, timeoutMs: number): Promise<boolean> {
    if (this.#ready.has(id)) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      const waiting = this.#waiters.get(id) ?? new Set<() => void>()
      this.#waiters.set(id, waiting)
      const wake = (): void => {
        clearTimeout(timer)
        waiting.delete(wake)
        resolve(this.#ready.has(id))
      }
      const timer = setTimeout(wake, timeoutMs)
      waiting.add(wake)
    })
  }
}

/** How long a call waits for a loading window before giving up. A cold launch is several seconds. */
export const EXECUTOR_READY_TIMEOUT_MS = 45_000

/**
 * What to do with a call that was sent to a page which then navigated away before answering.
 *
 * Distinct from the readiness wait, and not covered by it: the call went to a page that *was*
 * listening, and the reload began after it was sent. Reproduced by `mcp-during-reload.mjs` at a
 * 0ms offset — the call reached the old document, the document was torn down mid-call, and the
 * agent waited out the full 30s for an answer that could not come.
 *
 * A read changes nothing, so it is simply sent again to the new page. A write cannot be: the old
 * page may have applied it before it was torn down, and resending would apply it twice. So a
 * write fails at once — not after thirty seconds — and says what the agent must check.
 */
export function strandedCall(
  toolName: string,
  isReadOnly: (name: string) => boolean
): { action: 'resend' } | { action: 'fail'; error: string } {
  if (isReadOnly(toolName)) return { action: 'resend' }
  return {
    action: 'fail',
    error:
      `bay's window reloaded while "${toolName}" was running, so its answer was lost. The edit ` +
      `may or may not have been applied — call read_project to see which before trying again, ` +
      `rather than repeating the call.`
  }
}
