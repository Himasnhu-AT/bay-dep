import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MOTION_BANNER,
  MOTION_FILE,
  motionFileMessage,
  referencesMotionFile,
  usesMotionGlobal,
  type MotionFileResult
} from '@shared/motion-file'
import { ensureMotionFile } from './motion-file'
import { MOTION_SCRIPT } from './motion-script.generated'

const WITH_TAG = '<div data-composition-id="c"></div><script src="bay-motion.js"></script><script>BM.wordLand(0, 0)</script>'

async function folder(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'bay-motion-file-'))
}

test('a document asks for the library with a script tag naming the file in its own folder', () => {
  for (const html of [
    '<script src="bay-motion.js"></script>',
    "<script src='./bay-motion.js'></script>",
    '<SCRIPT defer SRC=bay-motion.js></SCRIPT>',
    '<script\n  type="text/javascript"\n  src = "bay-motion.js"\n></script>'
  ]) {
    assert.equal(referencesMotionFile(html), true, html)
  }
  for (const html of [
    '<script>/* bay-motion.js */ var x = "bay-motion.js"</script>',
    '<script src="lib/bay-motion.js"></script>',
    '<script src="../bay-motion.js"></script>',
    '<script src="https://example.com/bay-motion.js"></script>',
    '<script src="not-bay-motion.js"></script>',
    '<link href="bay-motion.js">',
    '<script data-src="x" src="other.js"></script>'
  ]) {
    assert.equal(referencesMotionFile(html), false, html)
  }
})

test('a document that calls BM without defining it is noticed; one with its own BM is not accused', () => {
  assert.equal(usesMotionGlobal('<script>el.style.opacity = BM.wordLand(t, 0).op</script>'), true)
  assert.equal(usesMotionGlobal('<script>const m = BM\n  .iris(t, 0, 1, 5, 5)</script>'), true)
  assert.equal(usesMotionGlobal('<script>const BM = { go() {} }; BM.go()</script>'), false)
  assert.equal(usesMotionGlobal('<script>window.BM = makeIt(); BM.go()</script>'), false)
  assert.equal(usesMotionGlobal('<script>var IBM = 1; console.log(IBM.x, "BMW")</script>'), false)
  // A comparison is not a definition.
  assert.equal(usesMotionGlobal('<script>if (BM == null) {} BM.go()</script>'), true)
})

test('written beside a composition that asks for it, and nothing is written for one that does not', async () => {
  const dir = await folder()
  try {
    assert.equal(await ensureMotionFile(dir, '<div>no library here</div>'), null)
    assert.deepEqual(await readdir(dir), [])

    assert.deepEqual(await ensureMotionFile(dir, WITH_TAG), { state: 'written' })
    assert.deepEqual(await readdir(dir), [MOTION_FILE], 'something other than the library was left in the folder')
    assert.equal(await readFile(join(dir, MOTION_FILE), 'utf8'), MOTION_SCRIPT)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a document that uses BM without the tag gets no file, and is told the tag is missing', async () => {
  const dir = await folder()
  try {
    const result = await ensureMotionFile(dir, '<script>BM.wordLand(0, 0)</script>')
    assert.deepEqual(result, { state: 'unreferenced' })
    assert.deepEqual(await readdir(dir), [])
    assert.match(motionFileMessage(result!), /<script src="bay-motion\.js"><\/script>/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("bay's own older copy is replaced, and an identical one is left untouched", async () => {
  const dir = await folder()
  try {
    const target = join(dir, MOTION_FILE)
    await writeFile(target, `${MOTION_BANNER} — an older build */\nvar BM = { old: true }\n`)
    assert.deepEqual(await ensureMotionFile(dir, WITH_TAG), { state: 'written' })
    assert.equal(await readFile(target, 'utf8'), MOTION_SCRIPT)

    // Identical: no write at all, which the file's inode can tell (a rename replaces it).
    const { stat } = await import('node:fs/promises')
    const before = (await stat(target)).ino
    assert.deepEqual(await ensureMotionFile(dir, WITH_TAG), { state: 'written' })
    assert.equal((await stat(target)).ino, before, 'an identical file was rewritten')
    assert.deepEqual(await readdir(dir), [MOTION_FILE])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a bay-motion.js that bay did not write is never overwritten', async () => {
  const dir = await folder()
  try {
    const target = join(dir, MOTION_FILE)
    const theirs = '// my own helpers, which happen to share the name\nvar BM = { mine: true }\n'
    await writeFile(target, theirs)
    const result = await ensureMotionFile(dir, WITH_TAG)
    assert.deepEqual(result, { state: 'foreign' })
    assert.equal(await readFile(target, 'utf8'), theirs)
    assert.match(motionFileMessage(result!), /bay did not write/)
    assert.match(motionFileMessage(result!), /Rename that file/)

    // The nearest thing that IS bay's must still be replaced, or the refusal above proves nothing.
    await writeFile(target, `${MOTION_BANNER} */\n${theirs}`)
    assert.deepEqual(await ensureMotionFile(dir, WITH_TAG), { state: 'written' })
    assert.equal(await readFile(target, 'utf8'), MOTION_SCRIPT)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a link named bay-motion.js is not written through, even to a file that looks like bay wrote it', async () => {
  const dir = await folder()
  const outside = await folder()
  try {
    const elsewhere = join(outside, 'target.js')
    const stale = `${MOTION_BANNER} — an older build */\n`
    await writeFile(elsewhere, stale)
    await symlink(elsewhere, join(dir, MOTION_FILE))
    assert.deepEqual(await ensureMotionFile(dir, WITH_TAG), { state: 'foreign' })
    assert.equal(await readFile(elsewhere, 'utf8'), stale, 'the file outside the folder was written through the link')
    assert.equal(await readlink(join(dir, MOTION_FILE)), elsewhere, 'the link was replaced')

    const dirNamed = await folder()
    try {
      await mkdir(join(dirNamed, MOTION_FILE))
      assert.deepEqual(await ensureMotionFile(dirNamed, WITH_TAG), { state: 'foreign' })
    } finally {
      await rm(dirNamed, { recursive: true, force: true })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('a folder that cannot be written to is a failure with its reason, not a throw', async () => {
  const dir = await folder()
  try {
    const result = await ensureMotionFile(join(dir, 'no', 'such', 'folder'), WITH_TAG)
    assert.equal(result?.state, 'failed')
    assert.match(motionFileMessage(result!), /ENOENT/)
    assert.match(motionFileMessage(result!), /still frame/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('each outcome reads as its own sentence', () => {
  const results: MotionFileResult[] = [{ state: 'written' }, { state: 'foreign' }, { state: 'failed', error: 'EACCES' }, { state: 'unreferenced' }]
  const sentences = results.map(motionFileMessage)
  assert.equal(new Set(sentences).size, results.length)
  for (const sentence of sentences) assert.ok(sentence.includes('BM') && sentence.includes(MOTION_FILE))
})
