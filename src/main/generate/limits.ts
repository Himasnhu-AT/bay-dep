/**
 * The spend guard's limits, as the user set them in Settings › Providers, kept in
 * `<userData>/generation-limits.json`.
 *
 * Main holds them, not the renderer: the guard is enforced by `GenerationJobs.start`, and a limit
 * the renderer could hand main with each call would be one a prompt-injected agent could raise.
 * The file is read back by later builds, so its shape is pinned by a literal in the test.
 *
 * Electron-free: the file is injected, like `keys.ts`.
 */

import { DEFAULT_GENERATION_LIMITS, checkLimits, type GenerationLimits } from '@shared/generation'
import type { KeyStorage } from './keys'

/** The on-disk shape. */
interface LimitsFile extends GenerationLimits {
  version: 1
}

export class GenerationLimitsStore {
  readonly #storage: KeyStorage
  #limits: GenerationLimits = { ...DEFAULT_GENERATION_LIMITS }
  #loading: Promise<void> | null = null
  #saving: Promise<void> = Promise.resolve()

  constructor(storage: KeyStorage) {
    this.#storage = storage
  }

  /** Idempotent; `set` awaits it, so a change made while the file is read is not overwritten by it. */
  load(): Promise<void> {
    this.#loading ??= this.#load()
    return this.#loading
  }

  async #load(): Promise<void> {
    const bytes = await this.#storage.read().catch(() => null)
    if (!bytes) return
    let parsed: unknown
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch (error) {
      console.error(`[bay] generation: the spending limits could not be read (${error instanceof Error ? error.message : String(error)}); using the defaults.`)
      return
    }
    const checked = checkLimits(parsed)
    if (checked.ok) this.#limits = checked.limits
    else console.error(`[bay] generation: the saved spending limits are not valid (${checked.error}); using the defaults.`)
  }

  get(): GenerationLimits {
    return { ...this.#limits }
  }

  async set(input: unknown): Promise<{ ok: true; limits: GenerationLimits } | { ok: false; error: string }> {
    await this.load()
    const checked = checkLimits(input)
    if (!checked.ok) return checked
    this.#limits = checked.limits
    const file: LimitsFile = { version: 1, ...checked.limits }
    const bytes = Buffer.from(JSON.stringify(file, null, 2))
    const next = this.#saving.then(() => this.#storage.write(bytes))
    this.#saving = next.catch(() => undefined)
    try {
      await next
    } catch (error) {
      // In force for this session either way; only keeping it failed.
      return { ok: false, error: `The limits apply until bay quits, but could not be saved: ${error instanceof Error ? error.message : String(error)}` }
    }
    return { ok: true, limits: this.get() }
  }
}
