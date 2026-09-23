/**
 * The bytes of `<userData>/access.json`: the access record in the clear, the refresh token only
 * ever encrypted.
 *
 * Electron-free — the cipher is injected (`safeStorage` in the app, a stand-in in the tests), so
 * `token-store.test.ts` can inspect the exact bytes that would be written and prove the token is
 * not among them. When no cipher is available (`safeStorage.isEncryptionAvailable()` false — e.g. a
 * Linux session with no keyring), the token is **not written at all**: it stays in memory until bay
 * quits, and the status says so (`persisted: false`). Writing it in plaintext as a fallback is the
 * one thing this file exists to prevent.
 */

import { parseRecord, type AccessRecord } from './policy'

export interface Cipher {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(sealed: Buffer): string
}

/** The on-disk key names. Read back by later builds, so they are pinned by a literal in the test. */
interface FileShape {
  version: 1
  record: AccessRecord | null
  /** base64 of `safeStorage.encryptString(refreshToken)`, or null when it was not persisted. */
  sealedToken: string | null
}

export function encodeAccessFile(
  record: AccessRecord | null,
  refreshToken: string | null,
  cipher: Cipher
): { bytes: Buffer; persisted: boolean } {
  const sealed = refreshToken && cipher.available() ? cipher.encrypt(refreshToken).toString('base64') : null
  const file: FileShape = { version: 1, record, sealedToken: sealed }
  return { bytes: Buffer.from(JSON.stringify(file, null, 2)), persisted: refreshToken === null || sealed !== null }
}

export function decodeAccessFile(
  bytes: Buffer | null,
  cipher: Cipher
): { record: AccessRecord | null; refreshToken: string | null } {
  if (!bytes) return { record: null, refreshToken: null }
  let file: Partial<FileShape>
  try {
    file = JSON.parse(bytes.toString('utf8')) as Partial<FileShape>
  } catch {
    return { record: null, refreshToken: null }
  }
  const record = parseRecord(file.record)
  let refreshToken: string | null = null
  if (typeof file.sealedToken === 'string' && cipher.available()) {
    try {
      refreshToken = cipher.decrypt(Buffer.from(file.sealedToken, 'base64'))
    } catch {
      // Sealed by another keychain (a copied profile): unusable, so the user signs in again.
      refreshToken = null
    }
  }
  return { record, refreshToken }
}
