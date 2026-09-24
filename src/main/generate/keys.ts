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

  constructor(cipher: Cipher, storage: KeyStorage) {
    this.#cipher = cipher
    this.#storage = storage
  }

  async load(): Promise<void> {
    const bytes = await this.#storage.read().catch(() => null)
    if (!bytes || !this.#cipher.available()) return
    let file: Partial<KeyFile>
    try {
      file = JSON.parse(bytes.toString('utf8')) as Partial<KeyFile>
    } catch {
      return
    }
    for (const provider of GENERATION_PROVIDERS) {
      const sealed = file.sealed?.[provider]
      if (typeof sealed !== 'string') continue
      try {
        const fields = JSON.parse(this.#cipher.decrypt(Buffer.from(sealed, 'base64'))) as Credentials
        if (complete(provider, fields)) this.#keys.set(provider, fields)
      } catch {
        // Sealed by another keychain (a copied profile): the user sets the key again.
      }
    }
  }

  status(): ProviderKeyStatus[] {
    return GENERATION_PROVIDERS.map((provider) => ({
      provider,
      set: this.#keys.has(provider),
      persisted: !this.#volatile.has(provider)
    }))
  }

  get(provider: GenerationProvider): Credentials | null {
    return this.#keys.get(provider) ?? null
  }

  async set(provider: GenerationProvider, given: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
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
    await this.#save()
    return { ok: true }
  }

  async clear(provider: GenerationProvider): Promise<void> {
    this.#keys.delete(provider)
    this.#volatile.delete(provider)
    await this.#save()
  }

  async #save(): Promise<void> {
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
    await this.#storage.write(Buffer.from(JSON.stringify(file, null, 2)))
  }
}

function complete(provider: GenerationProvider, fields: unknown): fields is Credentials {
  if (!fields || typeof fields !== 'object') return false
  return PROVIDERS[provider].keyFields.every((f) => typeof (fields as Record<string, unknown>)[f.id] === 'string')
}
