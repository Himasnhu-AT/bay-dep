/**
 * The update decisions: which version is newer, what the notes say as text, and above all that
 * restarting into an update never runs ahead of saving the user's work.
 *
 *   node --import ./src/test-hooks.mjs --test src/shared/update.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bannerVisible,
  compareVersions,
  describeUpdate,
  isNewer,
  releaseNotesText,
  restartPlan,
  runRestart,
  updateErrorMessage,
  type UpdateStatus
} from './update'

test('semver precedence, including the cases a string compare gets wrong', () => {
  // Each pair is [older, newer]. The first three are ones lexical order inverts.
  const ordered: [string, string][] = [
    ['0.1.9', '0.1.10'],
    ['0.9.0', '0.10.0'],
    ['1.0.0-beta.2', '1.0.0-beta.10'],
    ['0.1.0', '0.1.1'],
    ['0.1.1', '0.2.0'],
    ['0.9.9', '1.0.0'],
    ['1.0.0-alpha', '1.0.0'],
    ['1.0.0-alpha', '1.0.0-alpha.1'],
    ['1.0.0-alpha.1', '1.0.0-alpha.beta'],
    ['1.0.0-beta', '1.0.0-rc.1'],
    ['v0.1.0', '0.1.1']
  ]
  for (const [older, newer] of ordered) {
    assert.equal(compareVersions(older, newer), -1, `${older} < ${newer}`)
    assert.equal(compareVersions(newer, older), 1, `${newer} > ${older}`)
    assert.equal(isNewer(newer, older), true, `${newer} is newer than ${older}`)
    assert.equal(isNewer(older, newer), false, `${older} is not newer than ${newer}`)
  }
  assert.equal(compareVersions('1.2.3', '1.2.3+build.7'), 0, 'build metadata does not count')
  assert.equal(isNewer('1.2.3', '1.2.3'), false, 'the same version is not an update')
})

test('a malformed version is never an upgrade', () => {
  for (const bad of ['', 'latest', '1.2', '1.2.3.4', 'x.y.z', '01.2.3-', '1.0.0-']) {
    assert.equal(compareVersions(bad, '0.1.0'), null, bad)
    assert.equal(isNewer(bad, '0.1.0'), false, bad)
  }
  // Positive control: the parser is not simply refusing everything.
  assert.equal(isNewer('0.1.1', '0.1.0'), true)
})

test('release notes arrive as HTML or as a list, and leave as plain text', () => {
  const html = '<h2>What&#39;s new</h2><ul><li>Faster <b>export</b></li><li>Fixes &amp; polish</li></ul><p>Thanks!</p><script>alert(1)</script>'
  const text = releaseNotesText(html)
  assert.equal(text, "What's new\n• Faster export\n• Fixes & polish\nThanks!\nalert(1)")
  assert.doesNotMatch(text, /[<>]/, 'no markup survives')

  const several = releaseNotesText([
    { version: '0.1.2', note: '<p>Second</p>' },
    { version: '0.1.1', note: 'First' },
    { version: '0.1.0', note: null }
  ])
  assert.equal(several, '0.1.2\nSecond\n\n0.1.1\nFirst')

  assert.equal(releaseNotesText(null), '')
  assert.equal(releaseNotesText(undefined), '')
  assert.equal(releaseNotesText(42), '')

  const long = releaseNotesText('x'.repeat(5000))
  assert.ok(long.length <= 1200 && long.endsWith('…'), 'long notes are cut, and say so')
})

test('restarting: unsaved work is saved (or autosaved while locked) first, and only then installed', async () => {
  // Every combination, spelled out: the plan follows the requirement "never lose unsaved work".
  assert.deepEqual(restartPlan({ screen: 'editor', dirty: true, locked: false, projectName: 'Cut' }), { kind: 'save-first', project: 'Cut' })
  assert.deepEqual(restartPlan({ screen: 'editor', dirty: true, locked: true, projectName: 'Cut' }), { kind: 'autosave-first' })
  // Positive controls: nothing unsaved restarts at once.
  assert.deepEqual(restartPlan({ screen: 'editor', dirty: false, locked: false, projectName: 'Cut' }), { kind: 'install' })
  assert.deepEqual(restartPlan({ screen: 'editor', dirty: false, locked: true, projectName: 'Cut' }), { kind: 'install' })
  assert.deepEqual(restartPlan({ screen: 'home', dirty: false, locked: false, projectName: 'Cut' }), { kind: 'install' })

  const run = async (plan: Parameters<typeof runRestart>[0], saves: boolean): Promise<{ order: string[]; result: string }> => {
    const order: string[] = []
    const result = await runRestart(plan, {
      save: async () => {
        order.push('save')
        return saves
      },
      autosave: async () => {
        order.push('autosave')
        return saves
      },
      install: async () => {
        order.push('install')
      }
    })
    return { order, result }
  }

  assert.deepEqual(await run({ kind: 'save-first', project: 'Cut' }, true), { order: ['save', 'install'], result: 'installing' })
  assert.deepEqual(await run({ kind: 'autosave-first' }, true), { order: ['autosave', 'install'], result: 'installing' })
  // The case the whole sequence exists for: the save was cancelled or failed, so bay stays.
  assert.deepEqual(await run({ kind: 'save-first', project: 'Cut' }, false), { order: ['save'], result: 'not-saved' })
  assert.deepEqual(await run({ kind: 'autosave-first' }, false), { order: ['autosave'], result: 'not-saved' })
  assert.deepEqual(await run({ kind: 'install' }, false), { order: ['install'], result: 'installing' })
})

const base = { current: '0.1.0', feed: '127.0.0.1:8123' }

test('the banner speaks only when there is something to act on', () => {
  const available: UpdateStatus = { ...base, state: 'available', next: '0.1.1', notes: '', releaseDate: null }
  assert.equal(bannerVisible(available, null), true)
  assert.equal(bannerVisible(available, '0.1.1'), false, 'Not now hides this version')
  assert.equal(bannerVisible(available, '0.1.0'), true, 'a dismissal is for one version, not every later one')
  assert.equal(bannerVisible({ ...base, state: 'ready', next: '0.1.1', notes: '' }, '0.1.1'), true, 'a finished download is never hidden')
  assert.equal(bannerVisible({ ...base, state: 'error', during: 'download', message: 'x', next: '0.1.1', notes: '' }, null), true)
  // No nagging: nothing to do, or a background check that failed.
  assert.equal(bannerVisible({ ...base, state: 'error', during: 'check', message: 'x', next: null, notes: '' }, null), false)
  assert.equal(bannerVisible({ state: 'disabled', current: '0.1.0', reason: 'Updates: releasing soon.', soon: true }, null), false)
  assert.equal(bannerVisible({ ...base, state: 'current', checkedAt: 0 }, null), false)
  assert.equal(bannerVisible(null, null), false)
})

test('a refused update is shown, says why, and is not offered as a retry', () => {
  const message = 'bay did not install the update the feed called 9.0.0: the download contains bay 0.0.9, which is not newer than this bay (0.1.0). Nothing was installed.'
  const refused: UpdateStatus = { ...base, state: 'refused', next: '9.0.0', message }
  assert.deepEqual(describeUpdate(refused), { title: 'bay did not install the downloaded update.', detail: message })
  assert.equal(bannerVisible(refused, null), true, 'the user pressed Update; silence would read as success')
  assert.equal(bannerVisible(refused, '9.0.0'), true, 'Not now is for an available update, not a refusal')
})

test('no feed yet reads as the owner wrote it, and is not an error', () => {
  const text = describeUpdate({ state: 'disabled', current: '0.1.0', reason: 'Updates: releasing soon.', soon: true })
  assert.equal(text.title, 'Updates: releasing soon')
  assert.equal(text.detail, '')
  const dev = describeUpdate({ state: 'disabled', current: '0.1.0', reason: 'This is a development build.', soon: false })
  assert.equal(dev.title, 'Updates are off in this build.')
  assert.equal(dev.detail, 'This is a development build.')
})

test('every status has a sentence, and progress reads as one', () => {
  const downloading = describeUpdate({ ...base, state: 'downloading', next: '0.1.1', notes: '', percent: 42.7, transferred: 61_000_000, total: 146_000_000 })
  assert.equal(downloading.title, 'Downloading bay 0.1.1: 42% (61 MB of 146 MB).')
  // Downloaded but not yet installable: no Restart button, and the sentence says why it waits.
  const preparing = describeUpdate({ ...base, state: 'downloading', next: '0.1.1', notes: '', percent: 100, transferred: 1, total: 1 })
  assert.equal(preparing.title, 'Preparing bay 0.1.1…')
  assert.equal(describeUpdate({ ...base, state: 'available', next: '0.1.1', notes: '', releaseDate: null }).title, 'bay 0.1.1 is available.')
  assert.equal(describeUpdate({ ...base, state: 'ready', next: '0.1.1', notes: '' }).title, 'bay 0.1.1 is downloaded.')
  assert.equal(describeUpdate({ ...base, state: 'error', during: 'install', message: 'm', next: '0.1.1', notes: '' }).title, 'bay could not install the update.')
})

test('errors are recovery instructions, not stack traces', () => {
  const feed = 'updates.example.com'
  const offline = updateErrorMessage('Error: net::ERR_INTERNET_DISCONNECTED', 'check', feed)
  assert.equal(offline, 'bay could not reach updates.example.com. Check the connection and retry.')
  const missing = updateErrorMessage('HttpError: 404 Not Found "method: GET url: https://updates.example.com/latest-mac.yml" Headers: {…}', 'check', feed)
  assert.match(missing, /has no release for this Mac yet/)
  assert.doesNotMatch(missing, /Headers|HttpError/)
  const checksum = updateErrorMessage('sha512 checksum mismatch, expected abc, got def', 'download', feed)
  assert.match(checksum, /discarded it\. Retry/)
  const signature = updateErrorMessage('Code signature at URL file:///… did not pass validation: code failed to satisfy specified code requirement(s)', 'install', feed)
  assert.match(signature, /not signed by the same developer/)
  const refused = updateErrorMessage('Error: bay refused to contact evil.example for an update: updates come only from updates.example.com.', 'check', feed)
  assert.equal(refused, 'bay refused to contact evil.example for an update: updates come only from updates.example.com.')
  // The host guard cancels in Chromium, which reports only ERR_BLOCKED_BY_CLIENT; the guard's own
  // sentence (naming the host) is what the user reads. Paired: without a recorded refusal the
  // same code falls through to the generic sentence rather than inventing a host.
  const guard = 'bay refused to contact 127.0.0.1:8125 for an update: updates come only from 127.0.0.1:8124.'
  assert.equal(updateErrorMessage('Error: net::ERR_BLOCKED_BY_CLIENT', 'download', feed, guard), guard)
  assert.equal(updateErrorMessage('Error: net::ERR_BLOCKED_BY_CLIENT', 'download', feed, null), 'net::ERR_BLOCKED_BY_CLIENT Retry to download the update again.')
  const other = updateErrorMessage('Error: something odd happened. More detail here.', 'download', feed)
  assert.equal(other, 'something odd happened. Retry to download the update again.')
})
