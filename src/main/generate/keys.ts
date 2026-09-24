/**
 * Provider keys for generation, kept the way `auth/token-store.ts` keeps the refresh token.
 *
 * `<userData>/generation-keys.json` holds each provider's fields sealed by the injected cipher
 * (`safeStorage` in the app). When no cipher is available — no keychain — a key is **not written
 * at all**: it is held in memory until bay quits, and the status says `persisted: false`. There is
 * no plaintext fallback. The renderer only ever sees `ProviderKeyStatus` (set or not, persisted or
 * not); the fields themselves never cross IPC after they are set.
 *
 * Electron-free: the cipher and the file are injected, so `keys.test.ts` can inspect the exact
 * bytes that would land on disk.
 */

import {
  GENERATION_PROVIDERS,
  PROVIDERS,
  type GenerationProvider,
  type ProviderKeyStatus
} from '@shared/generation'
import type { Cipher } from '../auth/token-store'
import type { Credentials } from './adapter'

/** The on-disk shape. Read back by later builds, so pinned by a literal in the test. */
interface KeyFile {
  version: 1
  /** base64 of `cipher.encrypt(JSON.stringify(fields))`, per provider. */
  sealed: Partial<Record<GenerationProvider, string>>
}

export interface KeyStorage {
  read(): Promise<Buffer | null>
  write(bytes: Buffer): Promise<void>
}

export class KeyRing {
  readonly #cipher: Cipher
  readonly #storage: KeyStorage
  readonly #keys = new Map<GenerationProvider, Credentials>()
  /** Providers whose key is held in memory only. */
  readonly #volatile = new Set<GenerationProvider>()
  /** Why a saved key could not be read back, per provider, until it is set again. */
  readonly #problems = new Map<GenerationProvider, string>()
  #loading: Promise<void> | null = null
  /** Writes are chained: two saves at once must not share (and race over) one temp file. */
  #saving: Promise<void> = Promise.resolve()

  constructor(cipher: Cipher, storage: KeyStorage) {
    this.#cipher = cipher
    this.#storage = storage
  }

  /**
   * Reads the saved keys. Idempotent, and `set`/`clear` await it first: a save made before the
   * file was read would write a file holding only the new key, dropping every other one.
   */
  load(): Promise<void> {
    this.#loading ??= this.#load()
    return this.#loading
  }

  async #load(): Promise<void> {
    const bytes = await this.#storage.read().catch(() => null)
    if (!bytes || !this.#cipher.available()) return
    let file: Partial<KeyFile>
    try {
      file = JSON.parse(bytes.toString('utf8')) as Partial<KeyFile>
    } catch (error) {
      const why = `The saved provider keys could not be read (${error instanceof Error ? error.message : String(error)}). Set the key again.`
      console.error(`[bay] generation: ${why}`)
      for (const provider of GENERATION_PROVIDERS) this.#problems.set(provider, why)
      return
    }
    for (const provider of GENERATION_PROVIDERS) {
      const sealed = file.sealed?.[provider]
      if (typeof sealed !== 'string') continue
      try {
        const fields = JSON.parse(this.#cipher.decrypt(Buffer.from(sealed, 'base64'))) as Credentials
        if (complete(provider, fields)) this.#keys.set(provider, fields)
        else throw new Error('a field is missing')
      } catch (error) {
        // Sealed by another keychain (a copied profile), or damaged: the user sets the key again.
        const why = `The saved ${PROVIDERS[provider].label} key could not be unsealed (${error instanceof Error ? error.message : String(error)}). Set it again.`
        console.error(`[bay] generation: ${why}`)
        this.#problems.set(provider, why)
      }
    }
  }

  status(): ProviderKeyStatus[] {
    return GENERATION_PROVIDERS.map((provider) => {
      const problem = this.#problems.get(provider)
      return {
        provider,
        set: this.#keys.has(provider),
        persisted: !this.#volatile.has(provider),
        ...(problem ? { problem } : {})
      }
    })
  }

  get(provider: GenerationProvider): Credentials | null {
    return this.#keys.get(provider) ?? null
  }

  async set(provider: GenerationProvider, given: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
    await this.load()
    const spec = PROVIDERS[provider]
    if (!spec) return { ok: false, error: `There is no provider "${String(provider)}". Providers: ${GENERATION_PROVIDERS.join(', ')}.` }
    const fields: Credentials = {}
    for (const field of spec.keyFields) {
      const value = typeof given[field.id] === 'string' ? (given[field.id] as string).trim() : ''
      if (!value) return { ok: false, error: `${spec.label} needs its ${field.label.toLowerCase()}.` }
      if (/\s/.test(value)) return { ok: false, error: `The ${spec.label} ${field.label.toLowerCase()} has a space in it — paste it again without one.` }
      fields[field.id] = value
    }
    this.#keys.set(provider, fields)
    this.#problems.delete(provider)
    await this.#save()
    return { ok: true }
  }

  async clear(provider: GenerationProvider): Promise<void> {
    await this.load()
    this.#keys.delete(provider)
    this.#volatile.delete(provider)
    this.#problems.delete(provider)
    await this.#save()
  }

  /**
   * Snapshots the ring now and queues the write behind any in flight, so writes land in the order
   * they were made and never overlap. A failed write rejects its own caller only.
   */
  #save(): Promise<void> {
    const bytes = this.#bytes()
    const next = this.#saving.then(() => this.#storage.write(bytes))
    this.#saving = next.catch(() => undefined)
    return next
  }

  #bytes(): Buffer {
    const sealed: KeyFile['sealed'] = {}
    const canSeal = this.#cipher.available()
    for (const [provider, fields] of this.#keys) {
      if (canSeal) {
        sealed[provider] = this.#cipher.encrypt(JSON.stringify(fields)).toString('base64')
        this.#volatile.delete(provider)
      } else {
        this.#volatile.add(provider)
      }
    }
    const file: KeyFile = { version: 1, sealed }
    return Buffer.from(JSON.stringify(file, null, 2))
  }
}

function complete(provider: GenerationProvider, fields: unknown): fields is Credentials {
  if (!fields || typeof fields !== 'object') return false
  return PROVIDERS[provider].keyFields.every((f) => typeof (fields as Record<string, unknown>)[f.id] === 'string')
}
