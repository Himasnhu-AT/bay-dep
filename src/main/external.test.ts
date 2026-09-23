/**
 * Which links leave for the browser. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOpenableExternally } from './external'

test('web pages open; local files, app handlers and junk do not', () => {
  assert.equal(isOpenableExternally('https://docs.anthropic.com/en/docs/claude-code'), true)
  assert.equal(isOpenableExternally('HTTPS://example.com/'), true, 'scheme case does not matter')
  for (const url of [
    'file:///Users/me/.ssh/id_rsa',
    'x-apple.systempreferences:com.apple.preference.security',
    'vscode://file/etc/hosts',
    'javascript:alert(1)',
    'http://example.com/',
    'not a url'
  ]) {
    assert.equal(isOpenableExternally(url), false, url)
  }
})
