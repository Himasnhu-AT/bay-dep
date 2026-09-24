import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLocalRequest } from './offline'

test('remote requests are refused, however they are spelt', () => {
  for (const url of [
    'https://example.com/',
    'http://example.com/x.js',
    'wss://example.com/socket',
    'ws://10.0.0.2:8080/',
    'https://127.0.0.1.nip.io/',
    'ftp://example.com/file',
    'not a url'
  ]) {
    assert.equal(isLocalRequest(url), false, url)
  }
})

test('the positive control: what the editor loads itself is allowed', () => {
  for (const url of [
    'file:///Applications/bay.app/Contents/Resources/app.asar/out/renderer/index.html',
    'bay://media/abc123',
    'data:image/png;base64,iVBORw0KGgo=',
    'blob:file:///6f1c2a3b-0000-4000-8000-000000000000',
    'devtools://devtools/bundled/inspector.html'
  ]) {
    assert.equal(isLocalRequest(url), true, url)
  }
})

test('in development the dev server is reachable — its own origin only, and only on loopback', () => {
  const dev = 'http://localhost:5173/'
  assert.equal(isLocalRequest('http://localhost:5173/src/main.tsx', dev), true)
  assert.equal(isLocalRequest('ws://localhost:5173/', dev), true, 'the HMR socket')
  assert.equal(isLocalRequest('http://localhost:5174/', dev), false, 'another port on the same host')
  assert.equal(isLocalRequest('https://example.com/', dev), false)
  assert.equal(isLocalRequest('http://example.com:5173/', 'http://example.com:5173/'), false, 'a dev server that is not local is not trusted')
  assert.equal(isLocalRequest('http://localhost:5173/', undefined), false, 'no dev server: nothing on http')
})
