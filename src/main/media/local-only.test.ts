/**
 * A media file cannot make ffmpeg reach the network. Run with `pnpm test`; uses the ffmpeg bay
 * ships.
 *
 * bay passes no `-protocol_whitelist`, and that is deliberate: the audit that asked for one was
 * answered by measurement. ffmpeg gives a playlist opened from a file the whitelist
 * `file,crypto,data`, so its http segments fail; HLS and DASH under a video's name are not
 * detected at all; the concat demuxer calls a URL an unsafe file name; SDP's rtp is off the
 * inherited list. Adding the flag changed nothing any specimen could observe — so instead of an
 * unfalsifiable flag, this pins the property, against the ffmpeg that ships. An ffmpeg upgrade
 * that loosened those defaults fails here rather than quietly opening a network path.
 *
 * The positive control is ffmpeg fetching the same server when asked directly, without which
 * "no request arrived" would prove nothing.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require_ = createRequire(import.meta.url)
const PKG = require_('ffmpeg-ffprobe-static') as { ffmpegPath?: string | null; ffprobePath?: string | null }
const FFMPEG = PKG.ffmpegPath ?? ''
const FFPROBE = PKG.ffprobePath ?? ''

function run(bin: string, args: string[]): Promise<void> {
  // Not spawnSync: that would block the event loop the test server answers on.
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: 'ignore' })
    const timer = setTimeout(() => child.kill('SIGKILL'), 8_000)
    child.on('close', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

test('a playlist, however it is named, cannot make ffmpeg or ffprobe fetch a URL', { timeout: 60_000 }, async (t) => {
  if (!existsSync(FFMPEG) || !existsSync(FFPROBE)) {
    t.skip(`no bundled ffmpeg/ffprobe at "${FFMPEG}" — this check did not run`)
    return
  }
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.url ?? '')
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`
  const dir = mkdtempSync(join(tmpdir(), 'bay-local-only-'))
  const hls = `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${base}/hls.ts\n#EXT-X-ENDLIST\n`
  const specimens = {
    'playlist.m3u8': hls,
    'holiday.mp4': hls,
    'concat.mp4': `ffconcat version 1.0\nfile '${base}/concat.mp4'\n`
  }
  try {
    await run(FFMPEG, ['-nostdin', '-v', 'error', '-i', `${base}/direct.mp4`, '-f', 'null', '-'])
    assert.ok(requests.includes('/direct.mp4'), 'positive control: this ffmpeg can reach the server')
    requests.length = 0
    for (const [name, body] of Object.entries(specimens)) {
      const path = join(dir, name)
      writeFileSync(path, body)
      await run(FFMPEG, ['-nostdin', '-v', 'error', '-i', path, '-f', 'null', '-'])
      await run(FFPROBE, ['-v', 'error', '-show_format', path])
    }
    assert.deepEqual(requests, [], 'no local file led ffmpeg or ffprobe to the network')
  } finally {
    server.close()
  }
})
