import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePlaybackWarning, resolveSetupSteps, type ResolveState } from './host'

const progress = (state: ResolveState): string =>
  resolveSetupSteps({ state })
    .map((step) => `${step.id}:${step.progress}`)
    .join(' ')

test('each state marks exactly its own step as the one to do now, earlier ones done', () => {
  assert.equal(progress('not-installed'), 'install:now connector:later open:later bridge:later ask:later')
  assert.equal(progress('not-set-up'), 'install:done connector:now open:later bridge:later ask:later')
  assert.equal(progress('not-running'), 'install:done connector:done open:now bridge:later ask:later')
  assert.equal(progress('bridge-needed'), 'install:done connector:done open:done bridge:now ask:later')
  assert.equal(progress('ready'), 'install:done connector:done open:done bridge:done ask:now')
})

test('the connector step names the command main reported, and a missing bridge script says to run it', () => {
  const steps = resolveSetupSteps({ state: 'bridge-needed', bridgeInstalled: false, setup: 'SETUP --dir "/x"' })
  assert.match(steps[1]!.detail, /SETUP --dir "\/x"/)
  assert.match(steps[3]!.detail, /not in Resolve’s Scripts menu yet/)
  // The nearest state that must not say it: the script is installed.
  const installed = resolveSetupSteps({ state: 'bridge-needed', bridgeInstalled: true })
  assert.doesNotMatch(installed[3]!.detail, /not in Resolve’s Scripts menu yet/)
  assert.match(installed[3]!.detail, /Workspace › Scripts › resolve_bridge/)
})

test('a playback rate that disagrees with the timeline is named with the rate to set; agreement says nothing', () => {
  const warning = resolvePlaybackWarning({ state: 'ready', playback: { timelineFps: 30, playbackFps: 24 } })
  assert.match(warning ?? '', /timeline is 30 fps but its playback frame rate is 24/)
  assert.match(warning ?? '', /set Playback frame rate to 30/)
  // The nearest states that must stay quiet: connected with matching rates, and not connected.
  assert.equal(resolvePlaybackWarning({ state: 'ready' }), null)
  assert.equal(resolvePlaybackWarning({ state: 'bridge-needed', playback: { timelineFps: 30, playbackFps: 24 } }), null)
})
