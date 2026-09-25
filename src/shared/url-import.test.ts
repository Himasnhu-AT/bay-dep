/**
 * What `import_url` will hand to yt-dlp. Every refusal is paired with a legal address that must
 * still pass, and each asserts the message says what to do instead. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkDownloadUrl, downloadConfirmation } from './url-import'

const refused = (raw: unknown): string => {
  const checked = checkDownloadUrl(raw)
  assert.equal(checked.ok, false, `expected ${JSON.stringify(raw)} to be refused`)
  return checked.ok ? '' : checked.error
}

test('a web page address passes, normalised, with its host named', () => {
  const checked = checkDownloadUrl('  https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10  ')
  assert.deepEqual(checked, { ok: true, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', host: 'www.youtube.com', query: '?v=dQw4w9WgXcQ&t=10' })
  assert.ok(checkDownloadUrl('http://video.example:8080/clip.mp4').ok, 'plain http passes too')
})

test('loopback, private, link-local and CGNAT addresses and localhost names are refused, with what to use instead', () => {
  const local = [
    'http://127.0.0.1:8080/clip.mp4',
    'http://127.1.2.3/',
    'http://2130706433/', // 127.0.0.1 as one number: the URL parser makes it dotted before the check
    'http://0x7f.1/',
    'http://0.0.0.0/',
    'http://10.0.0.5/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://100.127.255.255/',
    'http://[::1]/',
    'http://[::]/',
    'http://[0:0:0:0:0:0:0:1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:c0a8:101]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[fe80::1]/',
    'http://[febf::1]/',
    'http://localhost:3000/',
    'http://LOCALHOST/',
    'http://localhost./',
    'http://printer.localhost/'
  ]
  for (const url of local) assert.match(refused(url), /not a public website\..*public web pages only.*import_media/, url)
  assert.match(refused('http://169.254.169.254/'), /link-local/)
  assert.match(refused('http://[::1]/'), /loopback/)
  // Positive controls: the nearest public addresses on either side of every range still pass.
  const nearby = [
    'http://172.15.255.255/',
    'http://172.32.0.1/',
    'http://100.63.255.255/',
    'http://100.128.0.1/',
    'http://11.0.0.1/',
    'http://169.253.1.1/',
    'http://192.169.0.1/',
    'http://[2606:4700::1111]/',
    'http://[fec0::1]/',
    'https://localhost.example.com/',
    'https://mylocalhost.com/'
  ]
  for (const url of nearby) assert.ok(checkDownloadUrl(url).ok, url)
  // The test-only allowance admits loopback, for the downloader's real-binary test and nothing else.
  assert.ok(checkDownloadUrl('http://127.0.0.1:8080/clip.mp4', { allowPrivateHosts: true }).ok)
})

test('the confirmation shows the query on its own line and warns about an embedded address or a long query', () => {
  const confirm = (url: string): string => {
    const checked = checkDownloadUrl(url)
    assert.ok(checked.ok)
    return downloadConfirmation(checked).detail
  }
  assert.equal(downloadConfirmation({ url: 'https://a.example/v', host: 'a.example', query: '' }).message, 'Download a video from a.example?')
  assert.match(confirm('https://a.example/watch?v=1'), /\nQuery string \(sent to a\.example\):\n\?v=1$/)
  assert.match(confirm('https://a.example/watch?u=http://b.example'), /contains another web address/)
  assert.match(confirm('https://a.example/watch?u=%2F%2Fb.example'), /contains another web address/)
  assert.match(confirm(`https://a.example/watch?t=${'x'.repeat(101)}`), /is 104 characters long/)
  // Positive control: exactly 100 characters, no address, is shown without a warning.
  assert.doesNotMatch(confirm(`https://a.example/watch?t=${'x'.repeat(97)}`), /Warning/)
})

test('yt-dlp options passed as the address are refused, not run', () => {
  assert.match(refused('--exec'), /not a web address.*https:\/\//)
  assert.match(refused('--exec=touch /tmp/pwned'), /spaces or control characters/)
  assert.match(refused('-o /etc/x'), /spaces or control characters/)
  assert.match(refused('--config-locations=/tmp/evil.conf'), /not a web address/)
  // Smuggled after a real address: still one argument, but refused before it could be split.
  assert.match(refused('https://video.example/a --exec rm'), /spaces or control characters/)
  assert.match(refused('https://video.example/a\n--exec'), /spaces or control characters/)
})

test('local files and other schemes are refused with the tool to use instead', () => {
  assert.match(refused('file:///etc/passwd'), /web pages only.*not file: addresses.*import_media/)
  assert.match(refused('/Users/me/Movies/clip.mp4'), /not a web address/)
  assert.match(refused('ftp://files.example/clip.mp4'), /not ftp: addresses/)
  assert.match(refused('javascript:alert(1)'), /not javascript: addresses/)
})

test('empty, credentialed or absurd addresses are refused', () => {
  assert.match(refused(''), /url is empty/)
  assert.match(refused(undefined), /url is empty/)
  assert.match(refused('https://me:secret@video.example/a'), /user name or password/)
  assert.match(refused(`https://video.example/${'a'.repeat(2100)}`), /over 2048 characters/)
})
