/**
 * Verified downloads, against a local server shaped like Hugging Face: a redirect carrying the
 * size and SHA-256, then the bytes from another path. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadVerified } from './download'

const BODY = Buffer.alloc(300_000, 7)
const SHA = createHash('sha256').update(BODY).digest('hex')

interface Advertised {
  size?: number
  sha?: string
  /** Send the body this slowly, in 10 KB pieces. */
  slowMs?: number
  /** Send this many bytes more than the body. */
  extra?: number
}

async function serve(advertised: Advertised): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    if (req.url === '/model.bin') {
      res.writeHead(302, {
        location: '/cdn/model.bin',
        'x-linked-size': String(advertised.size ?? BODY.length),
        'x-linked-etag': `"${advertised.sha ?? SHA}"`
      })
      res.end()
      return
    }
    if (req.url === '/loop.bin') {
      res.writeHead(302, { location: '/loop.bin' })
      res.end()
      return
    }
    if (req.url === '/nowhere.bin') {
      res.writeHead(302)
      res.end()
      return
    }
    if (req.url === '/cdn/model.bin') {
      const body = advertised.extra ? Buffer.concat([BODY, Buffer.alloc(advertised.extra, 1)]) : BODY
      res.writeHead(200, { 'content-length': String(body.length) })
      if (!advertised.slowMs) return void res.end(body)
      let offset = 0
      const timer = setInterval(() => {
        if (offset >= BODY.length || res.destroyed) {
          clearInterval(timer)
          res.end()
          return
        }
        res.write(BODY.subarray(offset, offset + 10_000))
        offset += 10_000
      }, advertised.slowMs)
      res.on('close', () => clearInterval(timer))
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return { url: `http://127.0.0.1:${address.port}`, server }
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'bay-download-'))
}

test('follows the redirect, reports progress, and puts a verified file at the real name', { timeout: 10_000 }, async () => {
  const { url, server } = await serve({})
  const dir = await tempDir()
  const dest = join(dir, 'ggml-x.bin')
  const reports: number[] = []
  let verifying = false
  try {
    await downloadVerified(`${url}/model.bin`, dest, {
      onProgress: (p) => {
        reports.push(p.receivedBytes)
        assert.equal(p.totalBytes, BODY.length, 'the total comes from the first hop’s x-linked-size')
      },
      onVerifying: () => (verifying = true)
    })
  } finally {
    server.close()
  }
  assert.deepEqual(await readFile(dest), BODY)
  assert.deepEqual(await readdir(dir), ['ggml-x.bin'], 'no .part left behind')
  assert.equal(reports.at(-1), BODY.length)
  assert.ok(verifying)
})

test('a body that does not match the published checksum is discarded, not installed', { timeout: 10_000 }, async () => {
  const { url, server } = await serve({ sha: 'a'.repeat(64) })
  const dir = await tempDir()
  try {
    await assert.rejects(downloadVerified(`${url}/model.bin`, join(dir, 'ggml-x.bin')), /does not match its published checksum/)
  } finally {
    server.close()
  }
  assert.deepEqual(await readdir(dir), [], 'neither the file nor its .part survives')
})

test('a body shorter than the advertised size is refused and says how much arrived', { timeout: 10_000 }, async () => {
  const { url, server } = await serve({ size: BODY.length + 1 })
  const dir = await tempDir()
  try {
    await assert.rejects(
      downloadVerified(`${url}/model.bin`, join(dir, 'ggml-x.bin')),
      new RegExp(`${BODY.length} of ${BODY.length + 1} bytes`)
    )
  } finally {
    server.close()
  }
  assert.deepEqual(await readdir(dir), [])
})

test('cancelling mid-download leaves nothing on disk', { timeout: 10_000 }, async () => {
  const { url, server } = await serve({ slowMs: 20 })
  const dir = await tempDir()
  const controller = new AbortController()
  let received = 0
  try {
    await assert.rejects(
      downloadVerified(`${url}/model.bin`, join(dir, 'ggml-x.bin'), {
        signal: controller.signal,
        onProgress: (p) => {
          received = p.receivedBytes
          if (p.receivedBytes > 0) controller.abort()
        }
      })
    )
  } finally {
    server.closeAllConnections()
    server.close()
  }
  assert.ok(received > 0 && received < BODY.length, 'the abort landed mid-body, so this tested a partial file')
  assert.deepEqual(await readdir(dir), [])
})

test('a missing file names the status and the URL', { timeout: 10_000 }, async () => {
  const { url, server } = await serve({})
  const dir = await tempDir()
  try {
    await assert.rejects(downloadVerified(`${url}/nope.bin`, join(dir, 'x.bin')), /answered 404 for .*nope\.bin/)
  } finally {
    server.close()
  }
})

test('a redirect loop stops, and says so', { timeout: 10_000 }, async () => {
  const { url, server } = await serve({})
  const dir = await tempDir()
  try {
    await assert.rejects(downloadVerified(`${url}/loop.bin`, join(dir, 'x.bin')), /redirected too many times/)
    await assert.rejects(downloadVerified(`${url}/nowhere.bin`, join(dir, 'x.bin')), /redirected nowhere/)
  } finally {
    server.close()
  }
  assert.deepEqual(await readdir(dir), [])
})

test('a pinned hash is what counts: a matching header cannot vouch for different bytes', { timeout: 10_000 }, async () => {
  const { url, server } = await serve({}) // the server's own headers match its body
  const dir = await tempDir()
  try {
    await assert.rejects(
      downloadVerified(`${url}/model.bin`, join(dir, 'x.bin'), { expected: { bytes: BODY.length, sha256: 'b'.repeat(64) } }),
      /does not match its published checksum/
    )
    assert.deepEqual(await readdir(dir), [])
    // Positive control: the right pin passes even when the server's header is wrong.
    server.close()
    const liar = await serve({ sha: 'c'.repeat(64) })
    try {
      await downloadVerified(`${liar.url}/model.bin`, join(dir, 'x.bin'), { expected: { bytes: BODY.length, sha256: SHA } })
    } finally {
      liar.server.close()
    }
    assert.deepEqual(await readdir(dir), ['x.bin'])
  } finally {
    server.close()
  }
})

test('a body larger than the file can be is stopped before it is all written', { timeout: 10_000 }, async () => {
  const { url, server } = await serve({ extra: 5_000_000 })
  const dir = await tempDir()
  try {
    await assert.rejects(downloadVerified(`${url}/model.bin`, join(dir, 'x.bin')), new RegExp(`more than ${BODY.length} bytes`))
  } finally {
    server.close()
  }
  assert.deepEqual(await readdir(dir), [])
})

test('an https download never follows a redirect to plain http', { timeout: 10_000 }, async () => {
  const dir = await tempDir()
  const seen: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    seen.push(String(input))
    return new Response(null, { status: 302, headers: { location: 'http://mirror.example/model.bin' } })
  }) as typeof fetch
  await assert.rejects(
    downloadVerified('https://huggingface.co/model.bin', join(dir, 'x.bin'), { fetchImpl }),
    /redirected to an insecure address \(http:\)/
  )
  assert.deepEqual(seen, ['https://huggingface.co/model.bin'], 'the http hop was never requested')
})
