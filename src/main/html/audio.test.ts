/**
 * Tests for which declared sounds survive into the mix.
 *
 * The stake: one export input ffmpeg cannot open fails the whole `amix`, so a single missing
 * whoosh would cost every clip on the timeline its audio. Each refusal is paired with the
 * nearest sound that must still play, because a checker that refuses everything passes every
 * refusal test.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CompositionSound } from '@shared/composition'
import { checkSounds, fileChecks } from './audio'

function sound(id: string, path: string | null): CompositionSound {
  return {
    id,
    src: `${id}.wav`,
    path,
    startSeconds: 0,
    durationSeconds: null,
    mediaStartSeconds: 0,
    volume: 1,
    line: 7
  }
}

const dir = mkdtempSync(join(tmpdir(), 'bay-sounds-'))
const present = join(dir, 'present.wav')
const silent = join(dir, 'silent.mp4')
const garbage = join(dir, 'garbage.wav')
for (const file of [present, silent, garbage]) writeFileSync(file, 'x')

const checks = {
  ...fileChecks,
  async hasAudio(path: string): Promise<boolean> {
    if (path === garbage) throw new Error('Invalid data found when processing input')
    return path !== silent
  }
}

test('a missing file is a fault naming where bay looked, and the present one still plays', async () => {
  const missing = join(dir, 'nope.wav')
  const { playable, faults } = await checkSounds(
    [sound('gone', missing), sound('here', present)],
    checks
  )
  assert.deepEqual(playable.map((s) => s.id), ['here'])
  assert.equal(faults.length, 1)
  assert.equal(faults[0]?.code, 'bad-audio')
  assert.equal(faults[0]?.line, 7)
  assert.equal(faults[0]?.fatal, false)
  // A recovery instruction, not a diagnosis: the resolved path is what the author must fix.
  assert.ok(faults[0]?.message.includes(missing), faults[0]?.message)
})

test('a directory at the path is not a sound file', async () => {
  const { playable, faults } = await checkSounds([sound('dir', dir)], checks)
  assert.deepEqual(playable, [])
  assert.equal(faults.length, 1)
})

test('a file ffprobe cannot read, and one with no audio stream, are both refused', async () => {
  const { playable, faults } = await checkSounds(
    [sound('garbage', garbage), sound('silent', silent), sound('here', present)],
    checks
  )
  assert.deepEqual(playable.map((s) => s.id), ['here'])
  assert.match(faults[0]?.message ?? '', /could not read \(Invalid data/)
  assert.match(faults[1]?.message ?? '', /no audio stream/)
})

test('a sound the parser could not resolve is passed over, not reported twice', async () => {
  const { playable, faults } = await checkSounds([sound('remote', null)], checks)
  assert.deepEqual(playable, [])
  assert.deepEqual(faults, [])
})
