/**
 * What each kind of caller may touch on disk. Run with `pnpm test`.
 *
 * Every refusal is paired with the nearest call that must still go through (CLAUDE.md: a
 * surface that refuses everything passes every negative test), and asserts on what the message
 * tells the caller to do instead.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCallPolicy, type PolicyEnv } from './policy'

const files: Record<string, string> = {
  '/Users/me/Projects/launch/title.html': '<div data-composition-id="title"></div>',
  '/Users/me/Sites/index.html': '<html><body>my website</body></html>',
  '/Users/me/Documents/thesis.docx': 'PK…',
  '/Users/me/Movies/cut.mp4': '\u0000\u0000ftyp'
}
const env: PolicyEnv = {
  home: '/Users/me',
  roots: ['/tmp', '/private/tmp'],
  head: async (path) => files[path] ?? null
}
const inApp = (tool: string, args: Record<string, unknown>) => checkCallPolicy(tool, args, 'in-app', env)
const terminal = (tool: string, args: Record<string, unknown>) => checkCallPolicy(tool, args, 'socket', env)

test('the panel may not read files by @reference; a terminal client may, and plain text is not a reference', async () => {
  const refused = await inApp('write_composition', { path: '/Users/me/Projects/x.html', html: '@/Users/me/.aws/credentials' })
  assert.match(refused ?? '', /"@\/Users\/me\/\.aws\/credentials" is a file reference.*Pass the value itself/)
  const nested = await inApp('apply_script', { script: { ops: [{ text: '@./edits.json' }] } })
  assert.match(nested ?? '', /@\.\/edits\.json/, 'found however deep it sits')
  assert.equal(await terminal('apply_script', { script: '@./edits.json' }), null)
  assert.equal(await inApp('add_captions', { cues: [{ text: '@someone said hi' }] }), null, 'a handle is text')
})

test('the panel writes compositions under home or temp, never hidden, never over a non-composition', async () => {
  // Positive controls: a new file, and rewriting its own composition.
  assert.equal(await inApp('write_composition', { path: '/Users/me/Projects/launch/new.html' }), null)
  assert.equal(await inApp('write_composition', { path: '/Users/me/Projects/launch/title.html' }), null)
  assert.equal(await inApp('write_composition', { path: '/tmp/scratch/a.html' }), null)

  assert.match(
    (await inApp('write_composition', { path: '/Users/me/Sites/index.html' })) ?? '',
    /already exists and is not a composition.*new file name/
  )
  assert.match((await inApp('write_composition', { path: '/Users/me/.config/x.html' })) ?? '', /hidden file or folder/)
  const climb = '/Users/me/Projects/' + '..' + '/.ssh/x.html'
  assert.ok(climb.includes('/../'), 'specimen keeps its ..')
  assert.match((await inApp('write_composition', { path: climb })) ?? '', /hidden file or folder/)
  assert.match((await inApp('write_composition', { path: '/etc/x.html' })) ?? '', /outside your home folder.*\/Users\/me/)
  assert.equal(await terminal('write_composition', { path: '/Users/me/Sites/index.html' }), null, 'a terminal client already has the filesystem')
})

test('read_composition from the panel reads only compositions in ordinary folders', async () => {
  assert.equal(await inApp('read_composition', { path: '/Users/me/Projects/launch/title.html', includeHtml: true }), null)
  assert.match((await inApp('read_composition', { path: '/Users/me/Documents/notes.txt' })) ?? '', /not an \.html composition/)
  assert.match((await inApp('read_composition', { path: '/Users/me/.ssh/id_rsa' })) ?? '', /hidden/)
})

test('an export never overwrites a file that is not media, from anyone; the panel also stays under home', async () => {
  assert.equal(await terminal('export_timeline', { outputPath: '/Users/me/Movies/cut.mp4' }), null, 'exporting over the last export')
  assert.equal(await inApp('export_timeline', { outputPath: '/Users/me/Movies/new.mp4' }), null)
  assert.match(
    (await terminal('export_timeline', { outputPath: '/Users/me/Documents/thesis.docx' })) ?? '',
    /already exists and is not a video or audio file.*new file name/
  )
  assert.match((await inApp('export_timeline', { outputPath: '/Volumes/Other/cut.mp4' })) ?? '', /outside your home folder/)
  assert.equal(await terminal('export_timeline', { outputPath: '/Volumes/Other/cut.mp4' }), null)
})

test('tools that touch no path are untouched by the policy', async () => {
  assert.equal(await inApp('edit_item', { itemId: 'itm_1', volume: 0.5 }), null)
  assert.equal(await inApp('read_project', {}), null)
})
