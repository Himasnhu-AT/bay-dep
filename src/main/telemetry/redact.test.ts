/**
 * Redaction: each rule proven on a specimen that would leak without it. Every test first asserts
 * the specimen really contains what must not leave (the path, the name, the email) — a specimen
 * that did not contain it would pass whatever `redact` did.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact, redactTo } from './redact'

const HOME = '/Users/alice'

test('the home folder becomes ~', () => {
  const specimen = 'cannot write /Users/alice/Library/Application Support/bay/x.json'
  assert.ok(specimen.includes(HOME))
  const out = redact(specimen, HOME)
  assert.ok(!out.includes('alice'), out)
  assert.ok(out.includes('~/'), out)
})

test('a home that is only a prefix of another folder is not mistaken for it', () => {
  // /Users/alice2 is not under /Users/alice; the directories still go, but not as "~".
  const out = redact('open /Users/alice2/notes/a.txt', HOME)
  assert.ok(!out.startsWith('open ~'), out)
  assert.ok(!out.includes('alice2'), out)
})

test('directories under home are stripped and a media file name becomes <file> with its extension', () => {
  const specimen = "ENOENT: no such file or directory, open '/Users/alice/Clients/Acme Corp/Wedding Final.mov'"
  assert.ok(specimen.includes('Acme Corp') && specimen.includes('Wedding Final'))
  const out = redact(specimen, HOME)
  assert.equal(out, "ENOENT: no such file or directory, open '~/…/<file>.mov'")
})

test('a path outside home keeps only its last part, and a code file keeps its name for the stack', () => {
  const specimen = '    at render (/Applications/bay.app/Contents/Resources/app.asar/out/renderer/assets/index-abc.js:12:34)'
  assert.ok(specimen.includes('/Applications/bay.app/Contents'))
  assert.equal(redact(specimen, HOME), '    at render (/…/index-abc.js:12:34)')
})

test('a path on another volume, with spaces in its folders and name, is stripped', () => {
  const specimen = 'failed on /Volumes/Drive/ClientX/raw footage/take 3.mov because it ended'
  assert.ok(specimen.includes('ClientX') && specimen.includes('take 3'))
  const out = redact(specimen, HOME)
  assert.ok(!out.includes('ClientX') && !out.includes('take 3') && !out.includes('raw footage'), out)
  assert.ok(out.includes('<file>.mov'), out)
})

test('a file:// URL is redacted like the path it names', () => {
  const specimen = '    at file:///Users/alice/secret-project/out/main/index.js:5:9'
  assert.ok(specimen.includes('secret-project'))
  const out = redact(specimen, HOME)
  assert.ok(!out.includes('secret-project') && !out.includes('alice'), out)
  assert.ok(out.includes('index.js:5:9'), out)
})

test("a bay:// URL's percent-encoded path is removed whole", () => {
  const specimen = 'load failed: bay://media/%2FUsers%2Falice%2FSecret%2Fclip.mp4'
  assert.ok(specimen.includes('Secret'))
  const out = redact(specimen, HOME)
  assert.ok(!out.includes('Secret') && !out.includes('alice') && !out.includes('clip'), out)
})

test('a percent-encoded home path elsewhere is removed too', () => {
  const specimen = 'request for %2FUsers%2Falice%2FClients%2Fcut.bay'
  assert.ok(specimen.includes('alice') && specimen.includes('Clients'))
  const out = redact(specimen, HOME)
  assert.ok(!out.includes('alice') && !out.includes('Clients') && !out.includes('cut'), out)
})

test('emails become <email>', () => {
  const specimen = 'signed in as alice.smith+bay@example.co.uk; retry'
  assert.ok(specimen.includes('@example.co.uk'))
  assert.equal(redact(specimen, HOME), 'signed in as <email>; retry')
})

test('a project file name (not code) is not kept, even when it looks like a sentence ending .js', () => {
  const specimen = 'could not open /Users/alice/Work/Acme launch.bay'
  assert.ok(specimen.includes('Acme launch'))
  assert.ok(!redact(specimen, HOME).includes('Acme'))
  // A "name" with spaces ending in .js is prose that ran into a path, never a code file to keep.
  const prose = 'failed at /tmp/x because the file is gone.js'
  assert.ok(!redact(prose, HOME).includes('because the file'))
})

test('text that is not a path is left alone (positive control)', () => {
  const plain = 'TypeError: Cannot read properties of undefined (reading \'width\') ratio 1/2 at https://example.com/a/b'
  assert.equal(redact(plain, HOME), plain)
  assert.equal(redact('at Object.<anonymous> (node:internal/modules/cjs/loader:1)', HOME), 'at Object.<anonymous> (node:internal/modules/cjs/loader:1)')
})

test('redactTo redacts before it cuts, so a cut cannot leave half a path', () => {
  const specimen = `${'x'.repeat(10)} /Users/alice/Clients/Acme/cut.mov`
  const out = redactTo(specimen, HOME, 18)
  assert.ok(out.length <= 18)
  assert.ok(!out.includes('Clien') && !out.includes('alice'), out)
})
