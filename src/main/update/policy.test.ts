/**
 * Where the updater may go, and when it runs. The guard is the one thing between a feed setting
 * and the network, so every refusal is paired with the nearest request that must still pass.
 *
 *   node --import ./src/test-hooks.mjs --test src/main/update/policy.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UPDATE_FEED } from '@shared/update-feed'
import { allowUpdateRequest, parseFeed, updaterConfigYaml, updaterMode } from './policy'

const FEED = 'https://updates.example.com/bay/mac/'

test('the updater reaches the feed origin, and nothing else', () => {
  // Positive controls: the files the feed names.
  assert.deepEqual(allowUpdateRequest(`${FEED}latest-mac.yml`, FEED), { ok: true })
  assert.deepEqual(allowUpdateRequest(`${FEED}bay-0.1.1-arm64-mac.zip`, FEED), { ok: true })

  const refused = [
    'https://evil.example.com/bay/mac/latest-mac.yml',
    // A prefix check on the string would pass these. Only the origin decides.
    'https://updates.example.com.evil.example/latest-mac.yml',
    'https://updates.example.com@evil.example/latest-mac.yml',
    // Same host, different scheme or port: a different origin.
    'http://updates.example.com/bay/mac/latest-mac.yml',
    'https://updates.example.com:8443/bay/mac/latest-mac.yml',
    // A redirect to a CDN is refused as well: the feed must serve its own files.
    'https://objects.githubusercontent.com/x.zip',
    'not a url'
  ]
  // The specimens defeat a naive check, or they would test nothing.
  assert.ok(refused[1]!.startsWith('https://updates.example.com'), 'specimen 1 must share the feed prefix')
  assert.ok(refused[2]!.startsWith('https://updates.example.com'), 'specimen 2 must share the feed prefix')
  for (const url of refused) {
    const verdict = allowUpdateRequest(url, FEED)
    assert.equal(verdict.ok, false, url)
    if (!verdict.ok) assert.match(verdict.reason, /updates come only from updates\.example\.com|malformed/, url)
  }
  const named = allowUpdateRequest('https://evil.example.com/x', FEED)
  assert.ok(!named.ok && named.reason.includes('evil.example.com'), 'the refusal names the host it refused')
})

test('a local feed reaches its own loopback origin, and not another port or host', () => {
  const local = 'http://127.0.0.1:8123/'
  assert.deepEqual(allowUpdateRequest('http://127.0.0.1:8123/latest-mac.yml', local), { ok: true })
  assert.equal(allowUpdateRequest('http://127.0.0.1:9222/json', local).ok, false, 'another local port is another service')
  assert.equal(allowUpdateRequest(`${FEED}latest-mac.yml`, local).ok, false, 'a local feed does not also open the shipped one')
})

test('packaged with no feed: off, saying "releasing soon", with no check and no error', () => {
  assert.deepEqual(updaterMode(true, {}, null), { kind: 'off', soon: true, reason: 'Updates: releasing soon.' })
  // Positive control: the same build with a feed runs.
  assert.deepEqual(updaterMode(true, {}, FEED), { kind: 'feed', url: FEED, canInstall: true, local: false })
})

test('the shipped feed is unset until there is somewhere to publish, and is https when set', () => {
  // The owner's decision. Setting it is the one-line change the README describes.
  assert.equal(UPDATE_FEED, null)
  assert.ok('error' in parseFeed('http://updates.example.com/', 'The update feed'), 'plain http off the machine is refused')
  assert.deepEqual(parseFeed('https://updates.example.com/bay', 'The update feed'), { url: 'https://updates.example.com/bay/' })
})

test('a checkout never updates itself unless pointed at a local feed, and then cannot install', () => {
  const dev = updaterMode(false, {}, FEED)
  assert.equal(dev.kind, 'off')
  assert.ok(dev.kind === 'off' && !dev.soon && /development build/.test(dev.reason) && /BAY_UPDATE_FEED/.test(dev.reason))
  assert.deepEqual(updaterMode(false, { BAY_UPDATE_FEED: 'http://127.0.0.1:8123' }, null), {
    kind: 'feed',
    url: 'http://127.0.0.1:8123/',
    canInstall: false,
    local: true
  })
  assert.deepEqual(updaterMode(true, { BAY_UPDATE_FEED: 'http://localhost:8123/feed/' }, null), {
    kind: 'feed',
    url: 'http://localhost:8123/feed/',
    canInstall: true,
    local: true
  })
})

test('BAY_UPDATE_FEED accepts only this Mac, in any build', () => {
  for (const value of ['https://updates.example.com/', 'http://10.0.0.5:8123/', 'http://127.0.0.1.evil.example/', 'ftp://127.0.0.1/', 'nonsense']) {
    for (const packaged of [true, false]) {
      const mode = updaterMode(packaged, { BAY_UPDATE_FEED: value }, FEED)
      assert.equal(mode.kind, 'invalid', `${value} packaged=${packaged}`)
      assert.ok(mode.kind === 'invalid' && /BAY_UPDATE_FEED/.test(mode.reason), 'the refusal names the setting')
    }
  }
})

test('the updater config names the provider, the feed and a cache folder', () => {
  assert.equal(updaterConfigYaml('http://127.0.0.1:8123/'), 'provider: generic\nurl: "http://127.0.0.1:8123/"\nupdaterCacheDirName: bay-updater\n')
})
