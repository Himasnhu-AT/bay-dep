/**
 * What `import_url` will hand to yt-dlp. Every refusal is paired with a legal address that must
 * still pass, and each asserts the message says what to do instead. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkDownloadUrl } from './url-import'

const refused = (raw: unknown): string => {
  const checked = checkDownloadUrl(raw)
  assert.equal(checked.ok, false, `expected ${JSON.stringify(raw)} to be refused`)
  return checked.ok ? '' : checked.error
}

test('a web page address passes, normalised, with its host named', () => {
  const checked = checkDownloadUrl('  https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10  ')
  assert.deepEqual(checked, { ok: true, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', host: 'www.youtube.com' })
  assert.ok(checkDownloadUrl('http://127.0.0.1:8080/clip.mp4').ok, 'plain http passes too')
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
