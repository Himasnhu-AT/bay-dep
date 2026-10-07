/**
 * Redaction: each rule proven on a specimen that would leak without it. Every test first asserts
 * the specimen really contains what must not leave (the path, the name, the email) — a specimen
 * that did not contain it would pass whatever `redact` did.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact, redactLine, redactTo } from './redact'

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
  const plain = 'TypeError: Cannot read properties of undefined (reading width) ratio 1/2 at https://example.com/a/b and ./rel/x'
  assert.equal(redact(plain, HOME), plain)
  // A quoted span is text as far as redaction can tell, even a property name (by design: a
  // project name quoted the same way cannot be told from it).
  assert.equal(redact("Cannot read properties of undefined (reading 'width')", HOME), 'Cannot read properties of undefined (reading <text>)')
  assert.equal(redact('at Object.<anonymous> (node:internal/modules/cjs/loader:1)', HOME), 'at Object.<anonymous> (node:internal/modules/cjs/loader:1)')
})

test('redactTo redacts before it cuts, so a cut cannot leave half a path', () => {
  const specimen = `${'x'.repeat(10)} /Users/alice/Clients/Acme/cut.mov`
  const out = redactTo(specimen, HOME, 18)
  assert.ok(out.length <= 18)
  assert.ok(!out.includes('Clien') && !out.includes('alice'), out)
})

// -- audit of 9775a5a: each specimen below leaked, or took most of a second, before the fix -----

/** Fails when any of `secrets` survives in `out`; asserts first that the specimen holds them. */
function assertGone(specimen: string, out: string, secrets: readonly string[]): void {
  for (const secret of secrets) {
    assert.ok(specimen.includes(secret), `the specimen must contain ${secret}`)
    assert.ok(!out.includes(secret), `${secret} survived: ${out}`)
  }
}

test('a path after a colon, backtick, brace, pipe or semicolon loses its directories', () => {
  for (const before of ['path:', '`', '{', '|', ';', 'x=', '[']) {
    const specimen = `${before}/Users/alice/Clients/Acme/cut.bay`
    const out = redact(specimen, HOME)
    assertGone(specimen, out, ['alice', 'Clients', 'Acme', 'cut'])
    assert.ok(out.includes('<file>.bay'), out)
  }
  // And a `~/` path written as such, not produced from home.
  const tilde = 'path:~/Clients/Acme/cut.bay'
  assertGone(tilde, redact(tilde, HOME), ['Clients', 'Acme'])
})

test('a folder name holding ": " or spaces does not leak any part of itself', () => {
  const specimen = '    at run (/Users/alice/My Projects/Acme: Merger/index.js:4:5)'
  const out = redact(specimen, HOME)
  assertGone(specimen, out, ['alice', 'My Projects', 'Projects', 'Acme', 'Merger'])
  assert.equal(out, '    at run (~/…/index.js:4:5)')
  const outside = 'at x (/Volumes/Work Drive/Client: Beta (2024)/raw/cut.mov)'
  assertGone(outside, redact(outside, HOME), ['Work Drive', 'Client', 'Beta', '2024', 'raw'])
})

test('percent-encoded emails and paths are decoded once and redacted', () => {
  const email = 'signed in as alice%40example.com'
  assertGone(email, redact(email, HOME), ['alice', 'example.com'])
  const path = 'GET %2FUsers%2Fbob%2FClients%2FSecret%20Cut%2Fa.mov failed'
  assertGone(path, redact(path, HOME), ['bob', 'Clients', 'Secret'])
  // Malformed sequences are left as they are, and never throw.
  assert.equal(redact('100% sure, %E0%A4%A and %ZZ', HOME), '100% sure, %E0%A4%A and %ZZ')
})

test("a URL's query string and fragment are removed, its host kept", () => {
  const specimen = 'fetch failed: https://api.example.com/v1/files?name=Acme%20Pitch&user=alice#frag-Secret'
  const out = redact(specimen, HOME)
  assertGone(specimen, out, ['Acme', 'alice', 'Secret'])
  assert.ok(out.includes('https://api.example.com/v1/files?<query>'), out)
  const fragment = 'at https://example.com/page#Acme-Merger'
  assertGone(fragment, redact(fragment, HOME), ['Acme'])
})

test('tokens and keys become <secret>', () => {
  const cases = [
    'Authorization: Bearer abc.DEF-123_xyz',
    'key sk-proj-ABCDEFGHIJKLMNOPQRSTUV rejected',
    'key AIzaSyA1234567890abcdefghijklmnopqrstuv rejected',
    'token ya29.a0AfH6SMBx-secret-part rejected',
    'refresh AMf-vBxSecretRefreshToken rejected',
    'blob QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2 rejected'
  ]
  const secrets = ['abc.DEF-123_xyz', 'ABCDEFGHIJKLMNOPQRSTUV', 'SyA1234567890abcdefghij', 'a0AfH6SMBx', 'vBxSecretRefreshToken', 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2']
  cases.forEach((specimen, index) => {
    const out = redact(specimen, HOME)
    assertGone(specimen, out, [secrets[index]!])
    assert.ok(out.includes('<secret>'), out)
  })
  // Positive control: a short ordinary word with a dash is not a secret.
  assert.equal(redact('a sk-ip and a long-ish-word', HOME), 'a sk-ip and a long-ish-word')
})

test('quoted text in a message becomes <text>; a stack frame line keeps its function name', () => {
  for (const specimen of ['“Acme Q3 Pitch” is missing from disk', '"Acme Q3 Pitch" is missing from disk', "'Acme Q3 Pitch' is missing from disk", "‘Acme Q3 Pitch’ is missing"]) {
    const out = redact(specimen, HOME)
    assertGone(specimen, out, ['Acme', 'Pitch'])
    assert.ok(out.includes('<text>'), out)
  }
  // An apostrophe inside the quoted name does not end it early.
  const apostrophe = "'Alice's cut' could not load"
  assertGone(apostrophe, redact(apostrophe, HOME), ['Alice', 'cut'])
  // An apostrophe in prose is not a quote (positive control).
  assert.equal(redact("can't open it, don't retry", HOME), "can't open it, don't retry")
  // A stack: the message line is redacted, the frames are kept whole.
  const stack = 'Error: “Acme Q3 Pitch” is missing\n    at loadAsset (/Users/alice/app/out/main/index.js:10:2)'
  const out = redact(stack, HOME)
  assertGone(stack, out, ['Acme'])
  assert.ok(out.endsWith('    at loadAsset (~/…/index.js:10:2)'), out)
  // A cut that left a quote unclosed still hides what followed it.
  const unclosed = 'Error: “Acme Q3 Pi'
  assertGone(unclosed, redact(unclosed, HOME), ['Acme'])
})

test('pathological inputs redact in linear time (< 50 ms each)', () => {
  const inputs = ['/' + 'a.'.repeat(16000) + '!', 'a'.repeat(32000) + '@', 'a@' + 'b.'.repeat(16000), '~/' + 'a/'.repeat(16000), ' /x'.repeat(10000), "'".repeat(32000), 'x://'.repeat(8000), '%'.repeat(32000)]
  for (const input of inputs) {
    for (const [label, run] of [
      ['redact', () => redact(input, HOME)],
      ['redactLine (uncapped)', () => redactLine(input, HOME)],
      ['redactTo', () => redactTo(input, HOME, 16000)]
    ] as const) {
      const started = performance.now()
      run()
      const took = performance.now() - started
      assert.ok(took < 50, `${label} took ${took.toFixed(1)} ms on ${JSON.stringify(input.slice(0, 12))}…`)
    }
  }
})

test('redactTo cuts on a code point, never inside a surrogate pair', () => {
  const out = redactTo(`${'x'.repeat(9)}😀tail`, HOME, 10)
  assert.equal(out, 'x'.repeat(9))
  assert.ok(!/[\uD800-\uDBFF]$/.test(out))
})

test('redactTo cuts before it redacts, and a cut cannot leave half an email', () => {
  const specimen = `${'word '.repeat(3)}alice.smith@example.com rest`
  const out = redactTo(specimen, HOME, 26)
  assert.ok(out.length <= 26, out)
  assert.ok(!out.includes('alice'), out)
})
