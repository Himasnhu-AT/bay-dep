/**
 * What each kind of caller may touch on disk. Run with `pnpm test`.
 *
 * Every refusal is paired with the nearest call that must still go through (CLAUDE.md: a
 * surface that refuses everything passes every negative test), and asserts on what the message
 * tells the caller to do instead.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkCallPolicy, realpathNearest, type PolicyEnv } from './policy'

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

test('a visible path that really leads into a hidden folder is refused as the hidden folder', async () => {
  // `~/cut` is a link to bay's own Codex home; `~/Movies` is an ordinary folder.
  const links: Record<string, string> = {
    '/Users/me/cut': '/Users/me/Library/Application Support/bay/.agent-codex',
    '/Users/me/away': '/Volumes/Other'
  }
  const resolving: PolicyEnv = {
    ...env,
    realpath: async (path) => {
      for (const [link, target] of Object.entries(links)) {
        if (path === link || path.startsWith(`${link}/`)) return target + path.slice(link.length)
      }
      return path
    }
  }
  const panel = (tool: string, args: Record<string, unknown>) => checkCallPolicy(tool, args, 'in-app', resolving)
  assert.match((await panel('write_composition', { path: '/Users/me/cut/config.html' })) ?? '', /hidden file or folder/)
  assert.match((await panel('export_timeline', { outputPath: '/Users/me/cut/x.mp4' })) ?? '', /hidden file or folder/)
  assert.match((await panel('export_timeline', { outputPath: '/Users/me/away/x.mp4' })) ?? '', /outside your home folder/)
  // Positive controls: an ordinary path still passes, and without a resolver the spelling decides.
  assert.equal(await panel('export_timeline', { outputPath: '/Users/me/Movies/new.mp4' }), null)
  assert.equal(await inApp('write_composition', { path: '/Users/me/cut/config.html' }), null)
})

test('realpathNearest follows a real link, including to a file that does not exist yet', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bay-policy-')))
  mkdirSync(join(root, '.agent-codex'))
  symlinkSync(join(root, '.agent-codex'), join(root, 'visible'))
  const unwritten = join(root, 'visible', 'sub', 'new.html')
  assert.ok(!unwritten.includes('/.'), 'specimen: the spelling alone looks ordinary')
  assert.equal(await realpathNearest(unwritten), join(root, '.agent-codex', 'sub', 'new.html'))
  // Positive control: a path with no link in it comes back as it went in.
  assert.equal(await realpathNearest(join(root, 'plain', 'x.html')), join(root, 'plain', 'x.html'))
})

test('a download from the panel asks the person first, naming the host; a terminal client is not asked', async () => {
  const asked: { message: string; detail: string }[] = []
  const answering = (answer: boolean): PolicyEnv => ({
    ...env,
    confirm: async (message, detail) => {
      asked.push({ message, detail })
      return answer
    }
  })
  const url = 'https://video.example/watch?v=1&q=what-the-agent-read'

  assert.equal(await checkCallPolicy('import_url', { url }, 'in-app', answering(true)), null, 'agreed: it goes ahead')
  assert.equal(asked.at(-1)?.message, 'Download a video from video.example?')
  assert.match(asked.at(-1)?.detail ?? '', /what-the-agent-read/, 'the whole address is shown, query and all')

  const declined = await checkCallPolicy('import_url', { url }, 'in-app', answering(false))
  assert.match(declined ?? '', /The user declined the download from video\.example\. Nothing was downloaded/)

  const count = asked.length
  assert.equal(await checkCallPolicy('import_url', { url }, 'socket', answering(false)), null, 'a terminal client already has the network')
  assert.equal(await checkCallPolicy('import_url', { url, validateOnly: true }, 'in-app', answering(false)), null, 'a dry run downloads nothing')
  assert.equal(await checkCallPolicy('import_url', { url: '--exec' }, 'in-app', answering(false)), null, 'the tool refuses a non-address itself')
  assert.equal(asked.length, count, 'none of those asked anyone')

  // Nobody to ask is a refusal, never a silent yes.
  assert.match((await inApp('import_url', { url })) ?? '', /needs the user's go-ahead.*could not ask/)
})

test('the download dialog puts the query on its own line, and warns when it carries an address or runs long', async () => {
  const asked: string[] = []
  const recording: PolicyEnv = {
    ...env,
    confirm: async (_message, detail) => {
      asked.push(detail)
      return false
    }
  }
  const ask = async (url: string): Promise<string> => {
    await checkCallPolicy('import_url', { url }, 'in-app', recording)
    return asked.at(-1) ?? ''
  }
  const plain = await ask('https://video.example/watch?v=abc')
  assert.match(plain, /Query string \(sent to video\.example\):\n\?v=abc/)
  assert.doesNotMatch(plain, /Warning/, 'an ordinary query is shown, not flagged')
  assert.doesNotMatch(await ask('https://video.example/clip'), /Query string|Warning/, 'no query, no query line')

  for (const url of [
    'https://video.example/watch?v=1&next=https://collector.example/x',
    'https://video.example/watch?v=1&next=https%3A%2F%2Fcollector.example%2Fx',
    'https://video.example/watch?v=1&n=%2F%2Fcollector.example'
  ]) {
    assert.match(await ask(url), /Warning: this query string contains another web address.*carry text the agent read out to video\.example/, url)
  }
  const long = `https://video.example/watch?v=1&t=${'the transcript said '.repeat(6)}`.replace(/ /g, '+')
  assert.match(await ask(long), /Warning: this query string is \d+ characters long/)
})

test('tools that touch no path are untouched by the policy', async () => {
  assert.equal(await inApp('edit_item', { itemId: 'itm_1', volume: 0.5 }), null)
  assert.equal(await inApp('read_project', {}), null)
})
