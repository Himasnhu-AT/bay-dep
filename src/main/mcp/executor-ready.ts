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
