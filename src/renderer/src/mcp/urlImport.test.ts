/**
 * `import_url` through the real dispatcher, with main's downloader stubbed. The downloader itself
 * is `src/main/media/url-import.test.ts`. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset } from '@shared/project'
import type { UrlImportResult } from '@shared/url-import'
import { useEditor, emptyProject } from '@/store/editor'
import { executeToolCall } from './index'

const asked: { url: string; dryRun: boolean }[] = []
let answer: UrlImportResult = { ok: true, path: '/data/downloads/1/A talk [abc].mp4', ytDlp: '/opt/homebrew/bin/yt-dlp' }

const landed: Asset = {
  id: 'ast_talk',
  kind: 'video',
  name: 'A talk [abc].mp4',
  path: '/data/downloads/1/A talk [abc].mp4',
  durationUs: 10_000_000,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
  hasVideo: true,
  posterPath: null,
  waveformPath: null,
  createdAt: 0
}

;(globalThis as { window?: unknown }).window = {
  bay: {
    media: {
      importUrl: async (url: string, options?: { dryRun?: boolean }) => {
        asked.push({ url, dryRun: options?.dryRun === true })
        return options?.dryRun ? { ok: true, dryRun: true, ytDlp: '/opt/homebrew/bin/yt-dlp', args: ['--ignore-config', '--', url] } : answer
      },
      importPaths: async (paths: string[]) => paths.map((path) => ({ reused: false, asset: { ...landed, path } }))
    }
  }
}

const call = (args: Record<string, unknown>) => executeToolCall({ id: 't', tool: 'import_url', args })
const assets = (): Asset[] => useEditor.getState().project.assets

test('a download is imported as an asset, in one undo step', async () => {
  useEditor.getState().enterProject(emptyProject())
  const before = useEditor.getState().past.length
  const result = await call({ url: 'https://video.example/watch?v=abc' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { asset: { id: string; path: string }; next: string }
  assert.equal(value.asset.path, '/data/downloads/1/A talk [abc].mp4')
  assert.deepEqual(assets().map((a) => a.id), ['ast_talk'])
  assert.match(value.next, /place_asset/)
  assert.equal(useEditor.getState().past.length - before, 1)
  assert.deepEqual(asked.at(-1), { url: 'https://video.example/watch?v=abc', dryRun: false })
})

test('validateOnly asks main for a dry run and imports nothing', async () => {
  useEditor.getState().enterProject(emptyProject())
  const result = await call({ url: 'https://video.example/watch?v=abc', validateOnly: true })
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.deepEqual(asked.at(-1), { url: 'https://video.example/watch?v=abc', dryRun: true })
  assert.equal((result.value as { valid: boolean }).valid, true)
  assert.equal(assets().length, 0)
})

test('a bad address is refused before main is asked; main’s refusal is passed on word for word', async () => {
  useEditor.getState().enterProject(emptyProject())
  const count = asked.length
  const bad = await call({ url: 'file:///etc/passwd' })
  assert.equal(bad.ok, false)
  assert.match(bad.ok ? '' : bad.error, /not file: addresses.*import_media/)
  assert.equal(asked.length, count, 'main was never asked')

  answer = { ok: false, error: 'yt-dlp is not installed, or bay cannot see it. … `brew install yt-dlp` …' }
  const missing = await call({ url: 'https://video.example/a' })
  assert.equal(missing.ok, false)
  assert.match(missing.ok ? '' : missing.error, /brew install yt-dlp/)
  assert.equal(assets().length, 0)
})
