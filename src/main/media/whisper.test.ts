/**
 * Choosing a whisper.cpp model. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cancelWhisperDownload,
  pickWhisperModel,
  deleteWhisperModel,
  downloadWhisperModel,
  onWhisperDownload,
  ownModelDir
} from './whisper'
import { isCancelledDownloadError, type WhisperDownload } from '@shared/whisper'

const models = [
  '/m/ggml-tiny.en.bin',
  '/m/ggml-base.en.bin',
  '/m/ggml-base.bin',
  '/m/ggml-large-v3.bin',
  '/m/for-tests-ggml-tiny.bin',
  '/m/notes.txt'
]

test('English prefers the English-only model of the preferred size', () => {
  assert.equal(pickWhisperModel(models, 'en'), '/m/ggml-base.en.bin')
})

test('another language, or auto-detect, never gets an English-only model', () => {
  // A .en model given French transcribes it as English nonsense, with no error.
  assert.equal(pickWhisperModel(models, 'fr'), '/m/ggml-base.bin')
  assert.equal(pickWhisperModel(models, 'auto'), '/m/ggml-base.bin')
  assert.equal(pickWhisperModel(['/m/ggml-base.en.bin'], 'fr'), null)
})

test('test fixtures and non-models are never chosen', () => {
  assert.equal(pickWhisperModel(['/m/for-tests-ggml-tiny.bin', '/m/notes.txt'], 'en'), null)
  // Positive control: a real model beside them is.
  assert.equal(pickWhisperModel(['/m/for-tests-ggml-tiny.bin', '/m/ggml-tiny.bin'], 'en'), '/m/ggml-tiny.bin')
})

test('with only a large model, it is used rather than nothing', () => {
  assert.equal(pickWhisperModel(['/m/ggml-large-v3.bin'], 'en'), '/m/ggml-large-v3.bin')
})

test('the model chosen in Settings wins, unless it cannot do the language', () => {
  assert.equal(pickWhisperModel(models, 'en', 'ggml-large-v3.bin'), '/m/ggml-large-v3.bin')
  // An English-only choice meeting French falls back to the ranking rather than failing.
  assert.equal(pickWhisperModel(models, 'fr', 'ggml-tiny.en.bin'), '/m/ggml-base.bin')
  // A choice that is no longer on disk (deleted since) is ignored.
  assert.equal(pickWhisperModel(models, 'en', 'ggml-small.en.bin'), '/m/ggml-base.en.bin')
})

// -- managing models ------------------------------------------------------------------

async function userData(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bay-whisper-'))
  await mkdir(ownModelDir(dir), { recursive: true })
  return dir
}

test('delete removes only bay’s own model file, whatever the name tries', async () => {
  const dir = await userData()
  await writeFile(join(ownModelDir(dir), 'ggml-tiny.en.bin'), 'model')
  await writeFile(join(dir, 'ggml-keep.bin'), 'outside bay’s model folder')
  const climb = '..' + '/ggml-keep.bin'
  assert.ok(climb.startsWith('../'), 'specimen keeps its ..')
  assert.deepEqual(await deleteWhisperModel(dir, climb), { ok: true })
  assert.deepEqual(await readdir(dir).then((names) => names.sort()), ['ggml-keep.bin', 'whisper-models'], 'the climb deleted nothing outside')
  const refused = await deleteWhisperModel(dir, 'notes.txt')
  assert.equal(refused.ok, false)
  assert.match(refused.error ?? '', /"notes\.txt" is not a whisper model file/)
  // Positive control: the real one goes.
  assert.deepEqual(await deleteWhisperModel(dir, 'ggml-tiny.en.bin'), { ok: true })
  assert.deepEqual(await readdir(ownModelDir(dir)), [])
})

test('one download at a time: the same model joins, another is refused by name, cancel is not failure', async () => {
  const dir = await userData()
  const events: WhisperDownload[] = []
  const off = onWhisperDownload((event) => events.push(event))
  let release!: () => void
  // Stands in for the network: holds until released, or rejects when aborted.
  const slow = ((_url: string, _dest: string, options?: { signal?: AbortSignal }) =>
    new Promise<void>((resolve, reject) => {
      release = resolve
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })) as Parameters<typeof downloadWhisperModel>[3]
  try {
    const first = downloadWhisperModel('base.en', dir, 'user', slow)
    const again = downloadWhisperModel('base.en', dir, 'transcribe', slow)
    assert.equal(again, first, 'a transcription waiting on the same model joins the download')
    await assert.rejects(downloadWhisperModel('small.en', dir, 'user', slow), /Base \(English\) is downloading\. Wait for it, or cancel it/)
    release()
    assert.equal(await first, join(ownModelDir(dir), 'ggml-base.en.bin'))
    assert.equal(events.at(-1)?.state, 'done')

    const cancelled = downloadWhisperModel('tiny.en', dir, 'user', slow)
    cancelWhisperDownload()
    await assert.rejects(cancelled, /was cancelled/)
    assert.equal(events.at(-1)?.state, 'cancelled', 'cancelled, not failed')
    assert.equal(events.at(-1)?.error, undefined)
    // The panels tell a cancel from a failure by this message, wrapped or not, so the real
    // error main throws must read as cancelled — and a real failure must not.
    const message = await cancelled.catch((error: Error) => error.message)
    assert.equal(isCancelledDownloadError(message), true)
    assert.equal(isCancelledDownloadError(`Transcription could not start: ${message}`), true)
    const broken = (async () => {
      throw new Error('socket hang up')
    }) as Parameters<typeof downloadWhisperModel>[3]
    const failed = await downloadWhisperModel('tiny.en', dir, 'user', broken).catch((error: Error) => error.message)
    assert.match(failed, /socket hang up/)
    assert.equal(isCancelledDownloadError(failed), false)
  } finally {
    off()
  }
})

test('an unknown model id is refused by name', async () => {
  await assert.rejects(downloadWhisperModel('huge', await userData(), 'user'), /no whisper model called "huge"/)
})
