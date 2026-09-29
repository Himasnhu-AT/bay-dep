/**
 * The dev bypass must be impossible in a packaged build. Every decision in `build.ts` is held
 * over both values of `isPackaged`, each loosening paired with its packaged refusal.
 *
 * Mutation-tested (see the report of the change that added this): `!isPackaged &&` dropped from
 * `accessBypass`, from `siteOrigin` and from `browserSuppressed`, and the packaged branch of
 * `allowedOrigins` given the dev origin — each fails here.
 *
 *   node --import ./src/test-hooks.mjs --test src/main/auth/build.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accessBypass, allowedOrigins, browserSuppressed, siteOrigin } from './build'

test('BAY_ACCESS=dev skips the check only in an unpackaged build', () => {
  const table: [Record<string, string | undefined>, boolean, boolean][] = [
    // env, isPackaged, expected
    [{ BAY_ACCESS: 'dev' }, false, true], // positive control: the probes' launch line
    [{ BAY_ACCESS: 'dev' }, true, false], // the property: an installed app ignores it
    [{}, false, false],
    [{}, true, false],
    [{ BAY_ACCESS: 'DEV' }, false, false], // exact value only
    [{ BAY_ACCESS: '1' }, false, false],
    [{ BAY_ACCESS: 'true' }, true, false],
    [{ BAY_ACCESS: '' }, false, false]
  ]
  for (const [env, isPackaged, expected] of table) {
    assert.equal(accessBypass(env, isPackaged), expected, `${JSON.stringify(env)} packaged=${isPackaged}`)
  }
})

test('a packaged build accepts the handoff only from the real site', () => {
  assert.deepEqual(allowedOrigins(true), ['https://bay.himanshuat.com'])
  // Positive control: dev builds also take the site's dev server.
  assert.deepEqual(allowedOrigins(false), ['https://bay.himanshuat.com', 'http://localhost:3000'])
})

test('BAY_SITE=local points the browser at the dev server only when unpackaged', () => {
  assert.equal(siteOrigin({ BAY_SITE: 'local' }, false), 'http://localhost:3000')
  assert.equal(siteOrigin({ BAY_SITE: 'local' }, true), 'https://bay.himanshuat.com')
  assert.equal(siteOrigin({}, false), 'https://bay.himanshuat.com')
})

test('the no-browser test hook is unpackaged only', () => {
  assert.equal(browserSuppressed({ BAY_ACCESS_NO_BROWSER: '1' }, false), true)
  assert.equal(browserSuppressed({ BAY_ACCESS_NO_BROWSER: '1' }, true), false)
  assert.equal(browserSuppressed({}, false), false)
})
