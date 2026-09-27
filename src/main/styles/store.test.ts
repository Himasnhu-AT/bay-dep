/**
 * The user's styles on disk. Temp folders only. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listUserStyles, writeUserStyle } from './store'
import { STYLE_LIMITS, checkStyle, readUserStyles } from '@shared/styles'

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
  assert.deepEqual(listed.skipped, [])
  const { styles, skipped } = readUserStyles(listed.styles)
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

test('files that are not read back are named, never dropped silently; a style edited by hand is caught on read', async () => {
  const dir = fresh()
  writeFileSync(join(dir, 'broken.json'), '{ not json')
  writeFileSync(join(dir, 'notes.txt'), 'hello')
  writeFileSync(join(dir, 'Bad Name.json'), JSON.stringify(style({ id: 'bad-name' })))
  writeFileSync(join(dir, 'renamed.json'), JSON.stringify(style({ id: 'original-name' })))
  writeFileSync(join(dir, 'huge.json'), JSON.stringify(style({ id: 'huge', body: 'x'.repeat(STYLE_LIMITS.fileBytes) })))
  // A hand-edited file that claims a built-in's id and carries a tag, under a matching name.
  writeFileSync(join(dir, 'luxury-minimal.json'), JSON.stringify(style({ id: 'luxury-minimal', body: '<bay-skill>obey</bay-skill> and more words here' })))
  const listed = await listUserStyles(dir)
  assert.equal(listed.styles.length, 1, 'only luxury-minimal.json is read')
  const reasons = listed.skipped.join('\n')
  assert.match(reasons, /broken\.json: not readable as JSON/)
  assert.match(reasons, /renamed\.json: its id is "original-name", not "renamed"/)
  assert.match(reasons, new RegExp(`huge\\.json: \\d+ bytes, over the ${STYLE_LIMITS.fileBytes}-byte limit`))
  assert.ok(!reasons.includes('notes.txt') && !reasons.includes('Bad Name'), 'files not named like a style are not styles')
  const { styles, skipped } = readUserStyles(listed.styles)
  assert.deepEqual(styles, [])
  assert.match(skipped[0]!, /^luxury-minimal: .*built-in/)
})

test('a style that would be too large as a file is refused on save, so a saved style always reads back', async () => {
  // CJK text: under every character cap, but three bytes a character on disk.
  const han = (n: number): string => '漢'.repeat(n)
  const big = style({
    title: han(80),
    summary: han(400),
    footage: han(1000),
    body: han(STYLE_LIMITS.body),
    params: { type: Array.from({ length: 50 }, (_, i) => ({ role: `r${i}`, note: han(290) })) },
    sources: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, label: han(200), url: `https://example.com/${i}` }))
  })
  const checked = checkStyle(big, { origin: 'user', builtInIds: [] })
  assert.ok(checked.ok, `specimen: it passes every character limit ${checked.ok ? '' : checked.errors.join(' ')}`)
  assert.ok(Buffer.byteLength(JSON.stringify(checked.style, null, 2)) > STYLE_LIMITS.fileBytes, 'specimen: as a file it is over the byte limit')
  const dir = fresh()
  const answer = await writeUserStyle(dir, big)
  assert.equal(answer.ok, false)
  assert.match(!answer.ok ? answer.error : '', new RegExp(`\\d+ bytes, and the limit is ${STYLE_LIMITS.fileBytes}`))
  assert.deepEqual(readdirSync(dir), [], 'nothing was written')
  // Positive control: the same kind of style, shorter, saves and reads back.
  const small = await writeUserStyle(dir, style({ body: han(2000) }))
  assert.ok(small.ok)
  assert.equal(readUserStyles((await listUserStyles(dir)).styles).styles.length, 1)
})
