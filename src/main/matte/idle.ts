/**
 * When the Apple Vision process may be stopped for idleness: `idleMs` after the *last* running job
 * ends, never while one is running. Counting matters — re-arming the timer whenever any job
 * finished meant job A finishing killed job B's process two minutes later, mid-matte.
 *
 * No Electron import; `host.ts` owns the one instance, the tests their own.
 */

export class IdleGate {
  readonly #idleMs: number
  readonly #onIdle: () => void
  #active = 0
  #timer: ReturnType<typeof setTimeout> | null = null

  constructor(idleMs: number, onIdle: () => void) {
    this.#idleMs = idleMs
    this.#onIdle = onIdle
  }

  get active(): number {
    return this.#active
  }

  /** A job starts: no idle stop until it (and every other) has ended. */
  begin(): void {
    this.#active += 1
    this.#clear()
  }

  /** A job ends; the timer starts only when none is left running. */
  end(): void {
    this.#active = Math.max(0, this.#active - 1)
    if (this.#active > 0) return
    this.#clear()
    this.#timer = setTimeout(() => {
      this.#timer = null
      // No second check of `#active` here: `begin` clears this timer, so it can only fire at zero.
      this.#onIdle()
    }, this.#idleMs)
  }

  /** Quit: no timer outlives the app. */
  cancel(): void {
    this.#clear()
  }

  #clear(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }
}
