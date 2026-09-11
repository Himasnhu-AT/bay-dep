/**
 * Tests for `@./file.json` substitution.
 *
 * Almost all of this is about the strings that must **not** trigger. Substitution replaces an
 * argument's value with a file's contents, so a false positive either destroys the user's
 * visible text — a caption reading `@everyone` becoming a JSON blob — or fails the call over
 * a string that was never a reference. The rule is `@` followed by `./`, `../` or `/`, and
 * everything else is text.
 *
 * A test written only against `@./edits.json` would pass with a rule as loose as
 * `startsWith('@')`, which is why the negative cases outnumber the positive ones here.
 *
 * Mutation-tested: the rule loosened to `startsWith('@')`, `../` dropped, absolute paths
 * dropped, recursion removed from arrays and from objects, and a failed read swallowed. All
 * fail here.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/mcp/file-args.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isFileReference, referencePath, substituteFileArgs } from './file-args'

const reader = (files: Record<string, string>) => async (path: string) => {
  const contents = files[path]
  if (contents === undefined) throw new Error(`ENOENT: no such file, open '${path}'`)
  return contents
}

// ---------------------------------------------------------------------------
// What counts as a reference
// ---------------------------------------------------------------------------

test('an explicit relative or absolute path is a reference', () => {
  assert.equal(isFileReference('@./edits.json'), true)
  assert.equal(isFileReference('@../shared/edits.json'), true)
  assert.equal(isFileReference('@/Users/x/edits.json'), true)
})

test('text that merely starts with @ is not a reference', () => {
  // Every one of these is a plausible caption, handle or mention. Substituting any of them
  // would replace what the user sees with the contents of a file.
  for (const value of [
    '@everyone',
    '@someone',
    '@bay',
    '@2x',
    '@media print',
    '@user@example.com',
    '@',
    '@@',
    '@.hidden',
    '@.',
    '@..',
    '@~/edits.json',
    '@C:/edits.json',
    '@edits.json',
    '@file/../edits.json'
  ]) {
    assert.equal(isFileReference(value), false, `"${value}" must pass through as text`)
  }
})

test('a string with @ anywhere but the start is not a reference', () => {
  assert.equal(isFileReference('caption @./file.json here'), false)
  assert.equal(isFileReference('mail to a@./b.json'), false)
  assert.equal(isFileReference(''), false)
})

test('the path is the reference without its @', () => {
  assert.equal(referencePath('@./edits.json'), './edits.json')
  assert.equal(referencePath('@/abs/edits.json'), '/abs/edits.json')
})

// ---------------------------------------------------------------------------
// Substitution
// ---------------------------------------------------------------------------

test('a reference is replaced by the parsed contents, not by the text', () => {
  // Handing a tool the string "[1,2,3]" where it expects an array fails schema validation
  // with an error that says nothing about the file.
  const read = reader({ './paths.json': '["/a.mp4", "/b.mp4"]' })
  return substituteFileArgs({ paths: '@./paths.json' }, read).then((args) => {
    assert.deepEqual(args, { paths: ['/a.mp4', '/b.mp4'] })
  })
})

test('a file that is not JSON is substituted as text', async () => {
  // A transcript or a caption is a legitimate thing to pass by reference, and failing on it
  // would make the feature useless for the case it most helps.
  const read = reader({ './caption.txt': 'Hello, world.\nSecond line.' })
  const args = await substituteFileArgs({ text: '@./caption.txt' }, read)
  assert.equal(args['text'], 'Hello, world.\nSecond line.')
})

test('text arguments are left exactly as they are', async () => {
  const read = reader({ './edits.json': '[]' })
  const args = await substituteFileArgs(
    { caption: '@everyone see this', name: 'clip @ 2x', empty: '' },
    read
  )
  assert.deepEqual(args, { caption: '@everyone see this', name: 'clip @ 2x', empty: '' })
})

test('references nested in arrays and objects are substituted', async () => {
  const read = reader({ './a.json': '{"n":1}', './b.json': '[2]' })
  const args = await substituteFileArgs(
    { list: ['@./a.json', 'plain'], nested: { deep: '@./b.json' } },
    read
  )
  assert.deepEqual(args, { list: [{ n: 1 }, 'plain'], nested: { deep: [2] } })
})

test('non-string values are untouched', async () => {
  const read = reader({})
  const args = await substituteFileArgs(
    { frame: 120, ripple: true, nothing: null, missing: undefined },
    read
  )
  assert.deepEqual(args, { frame: 120, ripple: true, nothing: null, missing: undefined })
})

test('a reference to a file that is not there fails with the path it looked for', async () => {
  // The agent wrote this file a moment ago; the one thing it needs is which path was tried.
  const read = reader({})
  await assert.rejects(
    () => substituteFileArgs({ paths: '@./gone.json' }, read),
    (error: Error) => {
      assert.match(error.message, /\.\/gone\.json/)
      assert.match(error.message, /@\.\/gone\.json/)
      assert.match(error.message, /absolute path/)
      return true
    }
  )
})

test('a deeply nested bad reference still fails rather than passing the raw string on', async () => {
  const read = reader({})
  await assert.rejects(() => substituteFileArgs({ a: { b: ['@./gone.json'] } }, read), /gone\.json/)
})

test('no arguments substitutes to no arguments', async () => {
  assert.deepEqual(await substituteFileArgs({}, reader({})), {})
})
