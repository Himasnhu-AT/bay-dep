/**
 * Fetch one large file to disk, verified, or leave nothing behind.
 *
 * Written for whisper models on Hugging Face, whose `resolve` URL answers with a redirect that
 * carries the file's real size (`x-linked-size`) and SHA-256 (`x-linked-etag`) — measured against
 * a model already on disk: the etag is exactly `shasum -a 256` of the file. Those two headers are
 * only on the first hop, so the redirect is followed by hand rather than by `fetch`.
 *
 * The bytes go to `<dest>.part` and are renamed into place only once the size and hash match. A
 * half-written model at the real name would be picked by the model search and fail inside
 * whisper with an error about tensors, which is no help to anyone.
 *
 * No Electron import: the test drives it against a local HTTP server.
 */

import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface DownloadProgress {
  receivedBytes: number
  totalBytes: number
}

export interface DownloadOptions {
  signal?: AbortSignal
  onProgress?: (progress: DownloadProgress) => void
  /** Called once the body has arrived and is being checked. */
  onVerifying?: () => void
  fetchImpl?: typeof fetch
  /**
   * The size and hash the file must have, known in advance. When given, these are checked and
   * the server's headers are ignored — a server can only vouch for itself. Without them, the
   * headers are the check.
   */
  expected?: { bytes: number; sha256: string }
}

/** A download with no known size stops here rather than filling the disk. */
export const UNKNOWN_SIZE_CAP_BYTES = 4 * 1024 ** 3

const SHA256 = /^[0-9a-f]{64}$/

function linkedHeaders(response: Response): { size: number | null; sha256: string | null } {
  const size = Number(response.headers.get('x-linked-size'))
  const etag = (response.headers.get('x-linked-etag') ?? '').replace(/^W\//, '').replace(/"/g, '').toLowerCase()
  return { size: Number.isFinite(size) && size > 0 ? size : null, sha256: SHA256.test(etag) ? etag : null }
}

export async function downloadVerified(url: string, dest: string, options: DownloadOptions = {}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch
  const signal = options.signal

  const secure = url.startsWith('https:')
  let response = await fetchImpl(url, { redirect: 'manual', ...(signal ? { signal } : {}) })
  let expected = linkedHeaders(response)
  // Hops until a body: the first carries the checksum, the CDN hop carries the bytes.
  for (let hops = 0; response.status >= 300 && response.status < 400; hops++) {
    const location = response.headers.get('location')
    if (!location || hops >= 5) throw new Error(`The download of ${url} redirected ${location ? 'too many times' : 'nowhere'}.`)
    await response.body?.cancel()
    const next = new URL(location, response.url || url)
    // A redirect may move the download, never downgrade it: an https start stays https.
    if (secure && next.protocol !== 'https:') {
      throw new Error(`The download of ${url} redirected to an insecure address (${next.protocol}), so it was stopped.`)
    }
    response = await fetchImpl(next.toString(), {
      redirect: 'manual',
      ...(signal ? { signal } : {})
    })
    const hop = linkedHeaders(response)
    expected = { size: expected.size ?? hop.size, sha256: expected.sha256 ?? hop.sha256 }
  }
  if (!response.ok || !response.body) {
    throw new Error(`The server answered ${response.status} for ${url}.`)
  }

  if (options.expected) expected = { size: options.expected.bytes, sha256: options.expected.sha256 }
  const totalBytes = expected.size ?? (Number(response.headers.get('content-length')) || 0)
  const cap = expected.size ?? UNKNOWN_SIZE_CAP_BYTES
  const part = `${dest}.part`
  await mkdir(dirname(dest), { recursive: true })
  const file = await open(part, 'w')
  const hash = createHash('sha256')
  let receivedBytes = 0
  let lastReport = 0
  try {
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk)
        await file.write(chunk)
        receivedBytes += chunk.byteLength
        // More than the file can be is not the file: stop before it reaches the disk's end.
        if (receivedBytes > cap) {
          throw new Error(`The download sent more than ${cap} bytes, more than the file can be, so it was stopped.`)
        }
        const now = Date.now()
        // A report per chunk is thousands of IPC messages for one file; four a second reads as live.
        if (now - lastReport >= 250) {
          lastReport = now
          options.onProgress?.({ receivedBytes, totalBytes })
        }
      }
    } finally {
      await file.close()
    }
    options.onProgress?.({ receivedBytes, totalBytes })
    options.onVerifying?.()

    if (expected.size !== null && receivedBytes !== expected.size) {
      throw new Error(`The download stopped early: ${receivedBytes} of ${expected.size} bytes arrived. Try again.`)
    }
    const actual = hash.digest('hex')
    if (expected.sha256 !== null && actual !== expected.sha256) {
      throw new Error('The downloaded file does not match its published checksum, so it was discarded. Try again.')
    }
    await rename(part, dest)
  } catch (error) {
    await rm(part, { force: true })
    throw error
  }
}
