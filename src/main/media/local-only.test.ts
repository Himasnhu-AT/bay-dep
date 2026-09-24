/**
 * A media file cannot make ffmpeg reach the network. Run with `pnpm test`; uses the ffmpeg bay
 * ships (vendor/ffmpeg, built by script/build-ffmpeg.sh).
 *
 * bay passes no `-protocol_whitelist`, and that is deliberate. With the npm 6.1.1 build it was
 * answered by measurement — a playlist opened from a file inherited `file,crypto,data`, HLS and
 * DASH under a video's name were not detected, the concat demuxer called a URL unsafe — so the
 * flag changed nothing any specimen could observe. bay's own build goes further and is configured
 * `--disable-network --disable-protocols --enable-protocol=file,pipe`: there is no http, tcp, udp,
 * rtmp or tls code in the binary at all, so no whitelist, default or demuxer quirk can open one.
 *
 * Two checks, because they fail differently:
 * - the protocol list is exactly `file` and `pipe` — a rebuild that lets the network back in
 *   fails here by name, before anything has to be tried;
 * - nothing ffmpeg or ffprobe is asked to open, a URL given directly included, sends a request to
 *   a server that is listening. The positive control is Node reaching the same server, without
 *   which "no request arrived" would prove nothing about the server's ability to see one.
 *
 * Proven against the old build: pointed at npm ffmpeg-ffprobe-static 6.1.1, both checks fail
 * (its list has http/https/tcp/tls/…, and the direct URL arrives as `/direct.mp4`).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'

const FFMPEG = vendoredTools()?.ffmpeg ?? ''
const FFPROBE = vendoredTools()?.ffprobe ?? ''
const SKIP = FFMPEG && FFPROBE ? false : NO_VENDORED_FFMPEG

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

/** `ffmpeg -protocols` as two sorted lists. */
function protocols(bin: string): { input: string[]; output: string[] } {
  const text = execFileSync(bin, ['-hide_banner', '-protocols'], { encoding: 'utf8' })
  const at = text.indexOf('Output:')
  const words = (s: string): string[] => s.split(/\s+/).filter((w) => w && !w.endsWith(':')).sort()
  return { input: words(text.slice(text.indexOf('Input:') + 6, at)), output: words(text.slice(at + 7)) }
}

test('the ffmpeg bay ships knows no protocol but file and pipe', { skip: SKIP }, () => {
  for (const bin of [FFMPEG, FFPROBE]) {
    const list = protocols(bin)
    assert.ok(list.input.includes('file'), `${bin}: the listing must parse (it has no "file")`)
    assert.deepEqual(list, { input: ['file', 'pipe'], output: ['file', 'pipe'] }, `${bin} can open more than local files`)
  }
})

test('no URL and no local file can make ffmpeg or ffprobe fetch anything', { skip: SKIP, timeout: 60_000 }, async () => {
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
    await fetch(`${base}/control`)
    assert.deepEqual(requests, ['/control'], 'positive control: the server sees a request that is made')
    requests.length = 0
    await run(FFMPEG, ['-nostdin', '-v', 'error', '-i', `${base}/direct.mp4`, '-f', 'null', '-'])
    await run(FFPROBE, ['-v', 'error', '-show_format', `${base}/direct.mp4`])
    for (const [name, body] of Object.entries(specimens)) {
      const path = join(dir, name)
      writeFileSync(path, body)
      await run(FFMPEG, ['-nostdin', '-v', 'error', '-i', path, '-f', 'null', '-'])
      await run(FFPROBE, ['-v', 'error', '-show_format', path])
    }
    assert.deepEqual(requests, [], 'ffmpeg or ffprobe reached the network')
  } finally {
    server.close()
  }
})
