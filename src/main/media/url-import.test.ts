/**
 * Downloading with the user's yt-dlp: the exact arguments, finding it or saying how to install it,
 * and what happens to a download that fails, lies about where it wrote, or hangs. Run with
 * `pnpm test`.
 *
 * Nothing here reaches the network. Most cases run a stand-in `yt-dlp` (a Node script) through
 * the injected spawn, so every outcome can be forced. One case runs the real yt-dlp, when this Mac
 * has it and bay's ffmpeg, against a server on 127.0.0.1 — the only way to know the argument list
 * is one yt-dlp accepts (an option it does not know fails the whole run), and it skips loudly
 * without either.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findYtDlp, importFromUrl, ytDlpArgs, ytDlpMissingMessage } from './url-import'
import { vendoredTools } from '../ffmpeg/vendor'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'bay-url-import-'))

test('the argument list shuts every door and ends with the address after --', () => {
  const args = ytDlpArgs({ url: 'https://video.example/watch?v=1', outDir: '/data/downloads/x', ffmpeg: '/app/ffmpeg' })
  for (const flag of ['--ignore-config', '--no-config-locations', '--no-plugin-dirs', '--no-exec', '--no-batch-file', '--no-cookies', '--no-cookies-from-browser', '--no-playlist']) {
    assert.ok(args.includes(flag), `missing ${flag}`)
  }
  assert.deepEqual(args.slice(-2), ['--', 'https://video.example/watch?v=1'])
  const after = (flag: string): string | undefined => args[args.indexOf(flag) + 1]
  assert.equal(after('--playlist-items'), '1')
  assert.equal(after('--paths'), '/data/downloads/x')
  assert.equal(after('--ffmpeg-location'), '/app/ffmpeg')
  assert.equal(after('--merge-output-format'), 'mp4')
  assert.match(after('--format') ?? '', /height<=\?1080/)
  assert.equal(after('--max-filesize'), String(2 * 1024 ** 3))
  assert.ok(!args.some((a) => a.startsWith('--exec') && a !== '--no-exec'), 'no exec hook, ever')
  // Without bay's ffmpeg yt-dlp is left to find its own rather than handed an empty path.
  assert.ok(!ytDlpArgs({ url: 'https://a.example/', outDir: '/d', ffmpeg: null }).includes('--ffmpeg-location'))
})

test('yt-dlp is found where a GUI app cannot see it, and its absence says how to install it', async () => {
  const found = await findYtDlp({
    env: { PATH: '/usr/bin:/bin' },
    homeDir: '/Users/me',
    platform: 'darwin',
    isExecutable: async (path) => path === '/opt/homebrew/bin/yt-dlp',
    children: async () => []
  })
  assert.deepEqual(found, { path: '/opt/homebrew/bin/yt-dlp', from: '/opt/homebrew/bin' })
  const none = await findYtDlp({ env: { PATH: '' }, homeDir: '/Users/me', platform: 'darwin', isExecutable: async () => false, children: async () => [] })
  assert.equal(none, null)

  const downloadsDir = scratch()
  const result = await importFromUrl('https://video.example/a', { downloadsDir, ffmpeg: null, locate: async () => null, searched: async () => 14 })
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error, /yt-dlp is not installed.*14 places.*brew install yt-dlp/)
  assert.equal(result.ok ? '' : result.error, ytDlpMissingMessage(14))
})

// ---------------------------------------------------------------------------
// A stand-in yt-dlp, one behaviour per FAKE_MODE
// ---------------------------------------------------------------------------

const FAKE = join(scratch(), 'fake-yt-dlp.mjs')
writeFileSync(
  FAKE,
  `
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const args = process.argv.slice(2)
const dir = args[args.indexOf('--paths') + 1]
const mode = process.env.FAKE_MODE
if (mode === 'ok') { mkdirSync(dir, { recursive: true }); const p = join(dir, 'A talk [abc].mp4'); writeFileSync(p, 'video bytes'); console.log(p) }
else if (mode === 'outside') { const p = join(tmpdir(), 'bay-fake-outside-' + process.pid + '.mp4'); writeFileSync(p, 'x'); console.log(p) }
else if (mode === 'old') { console.error('Usage: yt-dlp [OPTIONS] URL\\n\\nyt-dlp: error: no such option: --no-plugin-dirs'); process.exit(2) }
else if (mode === 'error') { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'half.mp4.part'), 'x'); console.error('WARNING: something\\nERROR: [generic] Unable to download webpage: HTTP Error 404'); process.exit(1) }
else if (mode === 'hang') { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'half.mp4.part'), 'x'); setInterval(() => {}, 1000) }
else if (mode === 'nothing') { process.exit(0) }
`
)

const spawned: string[][] = []
function deps(mode: string, downloadsDir: string, extra: Partial<Parameters<typeof importFromUrl>[1]> = {}) {
  return {
    downloadsDir,
    ffmpeg: '/app/ffmpeg',
    locate: async () => ({ path: '/opt/homebrew/bin/yt-dlp' }),
    spawnProcess: (_bin: string, args: string[]) => {
      spawned.push(args)
      return spawn(process.execPath, [FAKE, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FAKE_MODE: mode } })
    },
    ...extra
  }
}

test('a download lands inside a fresh folder of bay’s, and that path is what comes back', async () => {
  const downloadsDir = scratch()
  const result = await importFromUrl('https://video.example/watch?v=abc', deps('ok', downloadsDir))
  assert.ok(result.ok && 'path' in result, JSON.stringify(result))
  // Real paths on both sides: the temp folder is a symlink on macOS (/var → /private/var).
  assert.ok(result.path.startsWith(realpathSync(downloadsDir) + '/'), result.path)
  assert.equal(readFileSync(result.path, 'utf8'), 'video bytes')
  assert.equal(readdirSync(downloadsDir).length, 1, 'one folder for this download')
  assert.equal(spawned.at(-1)?.at(-1), 'https://video.example/watch?v=abc')
})

test('an address that is really an option never reaches yt-dlp', async () => {
  const downloadsDir = scratch()
  const count = spawned.length
  for (const bad of ['--exec', '-o /etc/x', 'file:///etc/passwd', 'https://a.example/ --exec id']) {
    const result = await importFromUrl(bad, deps('ok', downloadsDir))
    assert.equal(result.ok, false, bad)
  }
  assert.equal(spawned.length, count, 'nothing was run')
  assert.deepEqual(readdirSync(downloadsDir), [], 'and nothing was created')
  // Positive control: the nearest legal address does run.
  assert.ok((await importFromUrl('https://a.example/v', deps('ok', downloadsDir))).ok)
  assert.equal(spawned.length, count + 1)
})

test('a dry run finds yt-dlp and shows the arguments, running nothing', async () => {
  const downloadsDir = scratch()
  const count = spawned.length
  const result = await importFromUrl('https://video.example/a', deps('ok', downloadsDir), { dryRun: true })
  assert.ok(result.ok && 'dryRun' in result)
  assert.equal(result.args.at(-1), 'https://video.example/a')
  assert.equal(spawned.length, count)
  assert.deepEqual(readdirSync(downloadsDir), [])
})

test('every failure removes its folder and says why, in yt-dlp’s words where it has them', async () => {
  const cases: [string, RegExp][] = [
    ['error', /could not download https:\/\/video\.example\/a: ERROR: \[generic\] Unable to download webpage: HTTP Error 404/],
    ['old', /too old.*brew upgrade yt-dlp/],
    ['outside', /outside bay's download folder/],
    ['nothing', /finished without a file/]
  ]
  for (const [mode, message] of cases) {
    const downloadsDir = scratch()
    const result = await importFromUrl('https://video.example/a', deps(mode, downloadsDir))
    assert.equal(result.ok, false, mode)
    assert.match(result.ok ? '' : result.error, message, mode)
    assert.deepEqual(readdirSync(downloadsDir), [], `${mode}: the folder and any half-file are gone`)
  }
})

test('a download that runs past the limit is killed and leaves nothing', { timeout: 10_000 }, async () => {
  const downloadsDir = scratch()
  const started = Date.now()
  const result = await importFromUrl('https://video.example/a', deps('hang', downloadsDir, { timeoutMs: 400 }))
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error, /still running after .* so it was stopped and nothing was kept/)
  assert.ok(Date.now() - started < 5_000, 'it did not wait for the stand-in to finish on its own')
  assert.deepEqual(readdirSync(downloadsDir), [])
})

// ---------------------------------------------------------------------------
// The real yt-dlp, against 127.0.0.1
// ---------------------------------------------------------------------------

const FFMPEG = vendoredTools()?.ffmpeg ?? ''
const realYtDlp = await findYtDlp()
const REAL_SKIP = !realYtDlp
  ? 'yt-dlp is not installed on this Mac (brew install yt-dlp) — the real-binary check did not run'
  : !FFMPEG
    ? "bay's ffmpeg is not built (script/build-ffmpeg.sh) — the real-binary check did not run"
    : false

test('the real yt-dlp accepts every argument and downloads from a local server into bay’s folder', { skip: REAL_SKIP, timeout: 60_000 }, async () => {
  const dir = scratch()
  const source = join(dir, 'clip.mp4')
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:r=30:d=1', '-f', 'lavfi', '-i', 'sine=d=1', '-c:v', 'h264_videotoolbox', '-b:v', '500k', '-c:a', 'aac', '-shortest', source])
  const bytes = readFileSync(source)
  let requests = 0
  const server = createServer((request, response) => {
    requests++
    response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(bytes.length) })
    response.end(request.method === 'HEAD' ? undefined : bytes)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  try {
    const downloadsDir = join(dir, 'downloads')
    const result = await importFromUrl(`http://127.0.0.1:${port}/clip.mp4`, {
      downloadsDir,
      ffmpeg: FFMPEG,
      locate: async () => realYtDlp
    })
    assert.ok(result.ok && 'path' in result, JSON.stringify(result))
    assert.ok(requests > 0, 'the request reached the local server')
    assert.ok(result.path.endsWith('.mp4'), result.path)
    assert.deepEqual(readFileSync(result.path), bytes, 'the file is the one served')
  } finally {
    server.close()
  }
})
