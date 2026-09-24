/**
 * The caption-file gate and the batch `stat` behind missing-media detection.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { captionFileProblem, MAX_CAPTION_BYTES, sizesOf } from './caption-file'

test('only .srt and .vtt files of caption size are read', () => {
  // Positive controls first: both extensions, in either case, pass.
  assert.equal(captionFileProblem('/a/b.srt', 1200), null)
  assert.equal(captionFileProblem('/a/b.VTT', 1200), null)
  assert.match(captionFileProblem('/Users/me/.ssh/id_rsa', 1200) ?? '', /not a caption file.*\.srt or \.vtt/)
  assert.match(captionFileProblem('/a/b.srt.mov', 1200) ?? '', /not a caption file/)
  assert.match(captionFileProblem('/a/b.srt', MAX_CAPTION_BYTES + 1) ?? '', /too large/)
})

test('sizes: a file answers its size, anything else answers null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bay-stat-'))
  try {
    const file = join(dir, 'clip.mov')
    await writeFile(file, 'twelve bytes')
    const sizes = await sizesOf([file, join(dir, 'gone.mov'), dir, 'clip.mov', 42])
    assert.deepEqual(sizes, [12, null, null, null, null])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
