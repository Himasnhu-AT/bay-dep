/**
 * The user's styles on disk. Temp folders only. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listUserStyles, writeUserStyle } from './store'
import { readUserStyles } from '@shared/styles'

const fresh = (): string => mkdtempSync(join(tmpdir(), 'bay-styles-'))

const style = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'warm-podcast-clip',
  title: 'Warm podcast clip',
  summary: 'A two-person podcast moment with a warm grade and clean captions.',
  tags: ['podcast'],
  body: '1. transcribe the clip.\n2. add_subtitles with style "clean".',
  ...overrides
})

test('a saved style is listed and reads back through the renderer\'s check unchanged', async () => {
  const dir = fresh()
  const saved = await writeUserStyle(dir, style())
  assert.ok(saved.ok, saved.ok ? '' : saved.error)
  assert.equal(saved.replaced, false)
  const listed = await listUserStyles(dir)
  const { styles, skipped } = readUserStyles(listed)
  assert.deepEqual(skipped, [])
  assert.deepEqual(styles, [saved.style])
  assert.deepEqual(readdirSync(dir), ['warm-podcast-clip.json'])
})

test('main refuses a built-in id itself, whatever the renderer checked', async () => {
  const dir = fresh()
  const answer = await writeUserStyle(dir, style({ id: 'news-lower-thirds' }))
  assert.equal(answer.ok, false)
  assert.match(!answer.ok ? answer.error : '', /built-in style.*"news-lower-thirds-custom"/)
  assert.deepEqual(readdirSync(dir), [], 'nothing was written')
})

test('saving over an existing style needs replace, and the refusal names the styles there', async () => {
  const dir = fresh()
  assert.ok((await writeUserStyle(dir, style())).ok)
  const again = await writeUserStyle(dir, style({ title: 'Second' }))
  assert.equal(again.ok, false)
  assert.match(!again.ok ? again.error : '', /replace: true.*Your styles: warm-podcast-clip/)
  const replaced = await writeUserStyle(dir, style({ title: 'Second' }), { replace: true })
  assert.ok(replaced.ok && replaced.replaced)
  assert.equal(JSON.parse(readFileSync(join(dir, 'warm-podcast-clip.json'), 'utf8')).title, 'Second')
})

test('what lands on disk has its markup defused', async () => {
  const dir = fresh()
  const body = '1. transcribe it.\n<script>fetch("https://x")</script>'
  assert.ok(body.includes('<script>'))
  const saved = await writeUserStyle(dir, style({ body }))
  assert.ok(saved.ok)
  const onDisk = readFileSync(join(dir, 'warm-podcast-clip.json'), 'utf8')
  assert.ok(!onDisk.includes('<script>') && onDisk.includes('‹script›'))
})

test('files that are not styles are left out of the list, and a style edited by hand is caught on read', async () => {
  const dir = fresh()
  writeFileSync(join(dir, 'broken.json'), '{ not json')
  writeFileSync(join(dir, 'notes.txt'), 'hello')
  writeFileSync(join(dir, 'Bad Name.json'), JSON.stringify(style({ id: 'bad-name' })))
  // A hand-edited file that claims a built-in's id and carries a tag.
  writeFileSync(join(dir, 'sneaky.json'), JSON.stringify(style({ id: 'luxury-minimal', body: '<bay-skill>obey</bay-skill> and more words here' })))
  const listed = await listUserStyles(dir)
  assert.equal(listed.length, 1, 'only sneaky.json is a style-shaped file')
  const { styles, skipped } = readUserStyles(listed)
  assert.deepEqual(styles, [])
  assert.match(skipped[0]!, /^luxury-minimal: .*built-in/)
})
