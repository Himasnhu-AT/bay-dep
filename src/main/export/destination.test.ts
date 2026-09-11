/**
 * Tests for the export destination check.
 *
 * The point of the check is cost, not correctness — the export already failed safely on a bad
 * path, just after paying for the whole render. So the assertions are about *which* cases are
 * refused and what the refusal says, and the positive controls matter more than usual: a check
 * that refused everything would satisfy every negative case here and break exporting entirely.
 *
 * Per the standing rule, each refusal is asserted on its **content**, not its existence. "The
 * folder X does not exist — create it or choose another destination" lets the user fix it;
 * "invalid path" ends the attempt. Both are correct refusals and only one is usable.
 *
 * Mutation-tested: the directory check pointed at the file instead of its parent, the
 * writability check dropped, the isDirectory check dropped, the empty-path guard removed, and
 * every message replaced with a generic one. All fail here.
 *
 * The check runs in `start()` before anything is spawned or composited, which is the whole
 * point — validating downstream would still charge the user for the render, and the fix would
 * *look* like it worked because the error message improved. `encode.ts` also keeps a failed
 * job in its map rather than deleting it, so `pushFrame` and `finish` refuse with the reason:
 * a deleted job is indistinguishable from a cancelled one, both return silently, and a
 * renderer that ignored the failed event would composite a whole timeline into nothing and
 * report success — the same failure one layer down.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/export/destination.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkExportDestination } from './destination'

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'bay-dest-'))
}

// ---------------------------------------------------------------------------
// The positive controls — every refusal below is meaningless without these
// ---------------------------------------------------------------------------

test('an ordinary destination in an existing folder is accepted', async () => {
  // The case that must never break: the output file does not exist yet, which is what an
  // export *is*. A check that required the file would refuse every first export.
  const dir = scratch()
  assert.equal(await checkExportDestination(join(dir, 'render.mp4')), null)
})

test('overwriting an existing file is accepted', async () => {
  // Re-exporting over a previous render is normal and must not be refused.
  const dir = scratch()
  const target = join(dir, 'render.mp4')
  writeFileSync(target, 'an earlier render')
  assert.equal(await checkExportDestination(target), null)
})

test('a deep path inside an existing folder is accepted', async () => {
  const dir = scratch()
  mkdirSync(join(dir, 'a', 'b'), { recursive: true })
  assert.equal(await checkExportDestination(join(dir, 'a', 'b', 'out.mov')), null)
})

// ---------------------------------------------------------------------------
// What is refused, and what it says
// ---------------------------------------------------------------------------

test('a missing folder is refused, naming it and saying what to do', async () => {
  const dir = scratch()
  const missing = join(dir, 'renders')
  const problem = await checkExportDestination(join(missing, 'out.mp4'))

  assert.notEqual(problem, null)
  assert.ok(problem!.message.includes(missing), 'the folder is not named')
  assert.match(problem!.message, /does not exist/)
  // The recovery instruction, not just the diagnosis.
  assert.match(problem!.message, /create it|choose another/i)
})

test('the refusal names the folder, not the file', async () => {
  // The user has to go and make a directory; telling them the filename does not help, and
  // naming the file is the mistake a check written against the wrong path would make.
  const dir = scratch()
  const problem = await checkExportDestination(join(dir, 'nope', 'my-film.mp4'))
  assert.ok(problem!.message.includes(join(dir, 'nope')))
  assert.equal(problem!.message.includes('my-film.mp4'), false)
})

test('a parent that is a file is refused with that distinction', async () => {
  // Usually a path assembled from the wrong pieces. ffmpeg's ENOTDIR does not say which.
  const dir = scratch()
  const notAFolder = join(dir, 'notes.txt')
  writeFileSync(notAFolder, 'x')

  const problem = await checkExportDestination(join(notAFolder, 'out.mp4'))
  assert.notEqual(problem, null)
  assert.match(problem!.message, /is a file, not a folder/)
})

test('an unwritable folder is refused before the render, not after', async () => {
  // Exists, but cannot be written: fails just as late and just as expensively as a missing
  // one, and costs the same single syscall to catch here.
  const dir = scratch()
  const locked = join(dir, 'locked')
  mkdirSync(locked)
  chmodSync(locked, 0o500)

  const problem = await checkExportDestination(join(locked, 'out.mp4'))
  assert.notEqual(problem, null, 'an unwritable folder was accepted')
  assert.ok(problem!.message.includes(locked))
  assert.match(problem!.message, /cannot be written to/)
  assert.match(problem!.message, /different destination|permissions/i)

  chmodSync(locked, 0o700)
})

test('an empty path is refused rather than resolving to somewhere', async () => {
  // `dirname('')` is '.', so without this the check would silently approve the working
  // directory and the export would land somewhere nobody chose.
  const problem = await checkExportDestination('')
  assert.notEqual(problem, null)
  assert.match(problem!.message, /No output path/)

  const blank = await checkExportDestination('   ')
  assert.notEqual(blank, null)
})

test('every refusal says what to do, not only what is wrong', async () => {
  // The standing rule, asserted over all of them at once: a message that only diagnoses ends
  // the attempt, and both kinds are "correct".
  const dir = scratch()
  const locked = join(dir, 'locked')
  mkdirSync(locked)
  chmodSync(locked, 0o500)
  const aFile = join(dir, 'file.txt')
  writeFileSync(aFile, 'x')

  const problems = await Promise.all([
    checkExportDestination(join(dir, 'missing', 'out.mp4')),
    checkExportDestination(join(aFile, 'out.mp4')),
    checkExportDestination(join(locked, 'out.mp4'))
  ])

  for (const problem of problems) {
    assert.notEqual(problem, null)
    assert.match(
      problem!.message,
      /create it|choose another|Check the destination|different destination|permissions/i,
      `a refusal with no recovery instruction: "${problem!.message}"`
    )
  }
  chmodSync(locked, 0o700)
})
