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

test('the shipped feed is the latest release of the public GitHub repo, over https', () => {
  // The owner's decision: public GitHub Releases on Himasnhu-AT/Himasnhu-AT, release assets only.
  assert.equal(UPDATE_FEED, 'https://github.com/Himasnhu-AT/Himasnhu-AT/releases/latest/download/')
  assert.deepEqual(parseFeed(UPDATE_FEED!, 'The update feed'), { url: UPDATE_FEED })
  assert.deepEqual(updaterMode(true, {}, UPDATE_FEED), { kind: 'feed', url: UPDATE_FEED, canInstall: true, local: false })
  assert.ok('error' in parseFeed('http://updates.example.com/', 'The update feed'), 'plain http off the machine is refused')
  assert.deepEqual(parseFeed('https://updates.example.com/bay', 'The update feed'), { url: 'https://updates.example.com/bay/' })
})

const GH_FEED = 'https://github.com/Himasnhu-AT/Himasnhu-AT/releases/latest/download/'
// The hops measured with curl -sIL (policy.ts, GITHUB_ASSET_HOSTS): feed -> tagged URL on
// github.com -> a signed URL on the asset host.
const GH_TAGGED = 'https://github.com/Himasnhu-AT/Himasnhu-AT/releases/download/v0.1.0/bay-0.1.0-arm64-mac.zip'
const GH_ASSET = 'https://release-assets.githubusercontent.com/github-production-release-asset/1/abc?sp=r&sig=x'
const GH_ASSET_OLD = 'https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/abc?X-Amz-Signature=x'

test('a GitHub feed follows its redirect to the GitHub asset hosts, by GET over https', () => {
  // Positive controls: every hop the measured redirect chain makes.
  assert.deepEqual(allowUpdateRequest(`${GH_FEED}latest-mac.yml`, GH_FEED), { ok: true })
  assert.deepEqual(allowUpdateRequest(GH_TAGGED, GH_FEED), { ok: true })
  assert.deepEqual(allowUpdateRequest(GH_ASSET, GH_FEED, 'GET'), { ok: true })
  assert.deepEqual(allowUpdateRequest(GH_ASSET_OLD, GH_FEED, 'GET'), { ok: true })
  assert.deepEqual(allowUpdateRequest(GH_ASSET, GH_FEED), { ok: true }, 'GET is the default')
})

test('a GitHub feed refuses every other host, scheme, port and method', () => {
  const refused: Array<[string, string?]> = [
    // Plain http to the exact asset host.
    ['http://release-assets.githubusercontent.com/github-production-release-asset/1/abc'],
    // Another port on the exact asset host.
    ['https://release-assets.githubusercontent.com:8443/x'],
    // Look-alikes: a suffix match or a prefix match would pass these.
    ['https://release-assets.githubusercontent.com.evil.example/x'],
    ['https://evil-release-assets.githubusercontent.com/x'],
    ['https://raw.githubusercontent.com/Himasnhu-AT/Himasnhu-AT/main/x'],
    ['https://githubusercontent.com/x'],
    ['https://codeload.github.com/Himasnhu-AT/Himasnhu-AT/zip/main'],
    ['https://evil.example.com/bay-0.1.0-arm64-mac.zip'],
    // Not a GET.
    [GH_ASSET, 'POST'],
    [GH_ASSET, 'PUT']
  ]
  // The specimens defeat naive checks, or they would test nothing.
  assert.ok(refused[2]![0].startsWith('https://release-assets.githubusercontent.com'), 'specimen shares the asset host prefix')
  assert.ok(refused[3]![0].includes('release-assets.githubusercontent.com'), 'specimen contains the asset host')
  assert.ok(refused[4]![0].includes('.githubusercontent.com/'), 'specimen shares the asset domain suffix')
  for (const [url, method] of refused) {
    const verdict = allowUpdateRequest(url, GH_FEED, method)
    assert.equal(verdict.ok, false, `${method ?? 'GET'} ${url}`)
    if (!verdict.ok) assert.match(verdict.reason, /updates come only from github\.com/, url)
  }
})

test('on github.com, a GitHub feed reaches only its own repo releases', () => {
  // Positive control: the measured chain, feed -> tagged release -> asset host.
  for (const url of [`${GH_FEED}latest-mac.yml`, `${GH_FEED}bay-0.1.1-arm64-mac.zip`, GH_TAGGED, GH_ASSET]) {
    assert.deepEqual(allowUpdateRequest(url, GH_FEED), { ok: true }, url)
  }
  const refused = [
    // Another owner's repo of the same name, and another repo of this owner.
    'https://github.com/someone-else/Himasnhu-AT/releases/download/v9.9.9/bay-9.9.9-arm64-mac.zip',
    'https://github.com/Himasnhu-AT/other-repo/releases/download/v9.9.9/bay-9.9.9-arm64-mac.zip',
    // A repo whose name merely starts with this one's.
    'https://github.com/Himasnhu-AT/Himasnhu-AT-evil/releases/download/v9.9.9/x.zip',
    // This repo, but not its releases.
    'https://github.com/Himasnhu-AT/Himasnhu-AT/archive/refs/heads/main.zip',
    'https://github.com/Himasnhu-AT/Himasnhu-AT/raw/main/latest-mac.yml',
    // Climbing out of the prefix: `URL` resolves these before the check.
    'https://github.com/Himasnhu-AT/Himasnhu-AT/releases/../../../someone-else/r/releases/download/v1/x.zip',
    'https://github.com/Himasnhu-AT/Himasnhu-AT/releases/%2e%2e/%2e%2e/%2e%2e/someone-else/r/releases/x.zip',
    'https://github.com/login'
  ]
  // The specimens defeat naive checks, or they would test nothing.
  assert.ok(refused[2]!.startsWith('https://github.com/Himasnhu-AT/Himasnhu-AT'), 'specimen shares the repo prefix without its slash')
  assert.ok(refused[5]!.startsWith('https://github.com/Himasnhu-AT/Himasnhu-AT/releases/'), 'specimen shares the whole prefix as a string')
  assert.ok(refused[6]!.startsWith('https://github.com/Himasnhu-AT/Himasnhu-AT/releases/'), 'specimen shares the whole prefix as a string')
  for (const url of refused) {
    const verdict = allowUpdateRequest(url, GH_FEED)
    assert.equal(verdict.ok, false, url)
    if (!verdict.ok) assert.match(verdict.reason, /updates come only from \/Himasnhu-AT\/Himasnhu-AT\/releases\//, url)
  }
  // The prefix is the feed's, not a constant: another repo's feed reaches its own releases only.
  const other = 'https://github.com/o/r/releases/latest/download/'
  assert.deepEqual(allowUpdateRequest('https://github.com/o/r/releases/download/v1/x.zip', other), { ok: true })
  assert.equal(allowUpdateRequest(GH_TAGGED, other).ok, false)
})

test('a feed that is not on GitHub does not open the GitHub asset hosts', () => {
  // Negative: the same hops, from the example feed and from a local feed.
  for (const feed of [FEED, 'http://127.0.0.1:8123/']) {
    for (const url of [GH_ASSET, GH_ASSET_OLD, GH_TAGGED]) {
      assert.equal(allowUpdateRequest(url, feed).ok, false, `${url} from ${feed}`)
    }
  }
  // A host that merely looks like GitHub is not GitHub.
  assert.equal(allowUpdateRequest(GH_ASSET, 'https://github.com.evil.example/r/').ok, false)
  assert.equal(allowUpdateRequest(GH_ASSET, 'http://github.com/o/r/releases/latest/download/').ok, false)
  // Positive control: that feed's own files still pass.
  assert.deepEqual(allowUpdateRequest(`${FEED}latest-mac.yml`, FEED), { ok: true })
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
