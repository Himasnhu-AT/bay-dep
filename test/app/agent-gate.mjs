/**
 * The approval gate, in the running app.
 *
 * `src/shared/agent.test.ts` proves the decision function. It cannot prove the executor asks
 * it, reads the right state, or spends an approval only on success — and a gate nothing
 * consults is the most dangerous shape this codebase keeps producing: correct, tested, and
 * never reached.
 *
 * The first version of this feature refused every write whenever nothing was approved,
 * regardless of who was calling, which locked out the socket surface bay already ships. So the
 * no-session case is checked first and checked hardest: it is the one that must not regress.
 *
 * **The gate is opt-in now.** Since 40cf2a5 the in-app agent edits directly and every turn
 * leaves a diff with a Revert; the gate only exists when the user turns on *Ask before editing*
 * (`setAgentApproval(true)`, remembered in `localStorage['bay.agentApproval']`). This probe
 * asserted a gate after `startAgentSession()` for as long as that was the default, and went red
 * the day it stopped being — on a change made on purpose. So it checks both: the default
 * session is ungated and writes land, and with approval on, the whole gate as before.
 *
 * It turns the setting on itself and never assumes it: the user's own choice is whatever it
 * was, and `runProbe` puts that choice (store and localStorage both) back afterwards.
 */

import { attach, runProbe, PreconditionError, ProbeFailure } from './cdp.mjs'

const { evaluate, close } = await attach()

let checks = 0
const check = (label, actual, expected) => {
  checks++
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  if (!ok) throw new ProbeFailure(`${label}\n  got:      ${JSON.stringify(actual)}\n  expected: ${expected}`)
  console.log(`  ok  ${label}`)
}

await runProbe(async () => {

if ((await evaluate(`Boolean(window.bayMcp && window.bayEngine)`)) !== true) {
  throw new PreconditionError('window.bayMcp / window.bayEngine absent', 'bay.debug needs a reload')
}

let n = 0
const call = (tool, args = {}) =>
  evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `g${++n}`, tool, args })})`, 60_000)
const act = (expr) => evaluate(`(() => { window.bayEngine.store.getState().${expr}; return true })()`)
const gate = () => evaluate(`window.bayEngine.store.getState().agentGate`)

// A clip to act on, placed before any session exists.
await act('endAgentSession()')
const existing = await evaluate(`(() => {
  const s = window.bayEngine.store.getState()
  const t = s.project.timelines.find((x) => x.id === s.project.activeTimelineId)
  return t.tracks.flatMap((k) => k.items).map((i) => i.id)
})()`)
if (existing.length) await call('delete_items', { itemIds: existing })

const asset = (await call('import_media', {
  paths: [`${process.cwd()}/assets/podcast-cut/output/goodall-transcript-cut.mp4`]
})).value.assets[0]
const item = (await call('place_asset', { assetId: asset.id, atFrame: 0 })).value.itemId

console.log('\n── no session: nothing is gated')
check('the gate is absent', await gate(), null)
const ungated = await call('edit_item', { itemId: item, volume: 0.4 })
check('a write runs with no approval anywhere', ungated.ok, true)
check('and it actually changed the item', (await call('inspect_item', { itemId: item })).value.audio.volume, 0.4)

console.log('\n── a session, by default: the agent edits directly')
await act('setAgentApproval(false)')
await act('startAgentSession()')
check('the session is active', await evaluate(`window.bayEngine.store.getState().agentSessionActive`), true)
check('and no gate exists — the diff is the review, not an approval', await gate(), null)
const direct = await call('edit_item', { itemId: item, volume: 0.5 })
check('a write runs with nothing approved', direct.ok, true)
check('and it landed', (await call('inspect_item', { itemId: item })).value.audio.volume, 0.5)
await call('edit_item', { itemId: item, volume: 0.4 })
await act('endAgentSession()')

console.log('\n── "Ask before editing" on: a session with nothing approved')
await act('setAgentApproval(true)')
await act('startAgentSession()')
check('the gate is present and permits nothing', await gate(), (g) => g !== null && g.approved === null)

const readInSession = await call('inspect_item', { itemId: item })
check('reads still run — an agent that cannot look cannot check its work', readInSession.ok, true)

const refused = await call('edit_item', { itemId: item, volume: 0.9 })
check('a write is refused', refused.ok, false)
check('and the refusal says to propose first', refused.error, (e) => /propose/i.test(e))
check(
  'nothing changed',
  (await call('inspect_item', { itemId: item })).value.audio.volume,
  0.4
)

console.log('\n── an approved plan')
const proposal = {
  id: 'prp_probe',
  question: 'Quieten the clip?',
  options: [
    {
      id: 'opt_a',
      label: 'Halve the volume',
      summary: 'x',
      operations: [{ index: 0, tool: 'edit_item', args: { itemId: item, volume: 0.2 } }]
    }
  ]
}
await evaluate(
  `(() => { window.bayEngine.store.getState().approveProposal(${JSON.stringify(proposal)}, 'opt_a'); return true })()`
)

const wrongArgs = await call('edit_item', { itemId: item, volume: 0.25 })
check('a near-miss on arguments is refused', wrongArgs.ok, false)
check('and the refusal shows both numbers', wrongArgs.error, (e) => /0\.25/.test(e) && /0\.2/.test(e))

const wrongTool = await call('delete_items', { itemIds: [item] })
check('a different tool is refused', wrongTool.ok, false)
check('and is told what is still approved', wrongTool.error, (e) => /edit_item/.test(e))
check('the clip is still there', (await call('inspect_item', { itemId: item })).ok, true)

const approved = await call('edit_item', { itemId: item, volume: 0.2 })
check('the approved call runs', approved.ok, true)
check('and it landed', (await call('inspect_item', { itemId: item })).value.audio.volume, 0.2)

const replay = await call('edit_item', { itemId: item, volume: 0.2 })
check('the same approval cannot be spent twice', replay.ok, false)
check('and says so rather than repeating the plan', replay.error, (e) => /already been carried out/.test(e))

console.log('\n── a failed call does not spend its approval')
// The approval is consumed after the handler succeeds, never before: a call that threw changed
// nothing, and spending it would block the retry the error message asks for.
const badProposal = {
  id: 'prp_probe2',
  question: 'Trim it?',
  options: [
    {
      id: 'opt_b',
      label: 'Trim to nothing',
      summary: 'x',
      operations: [
        { index: 0, tool: 'edit_item', args: { itemId: 'itm_does_not_exist', volume: 0.1 } },
        { index: 1, tool: 'edit_item', args: { itemId: item, volume: 0.7 } }
      ]
    }
  ]
}
await evaluate(
  `(() => { window.bayEngine.store.getState().approveProposal(${JSON.stringify(badProposal)}, 'opt_b'); return true })()`
)
const failed = await call('edit_item', { itemId: 'itm_does_not_exist', volume: 0.1 })
check('an approved call that fails reports its own error, not a refusal', failed.ok, false)
check('and the error is about the id, not about approval', failed.error, (e) => !/approved/i.test(e))
const retry = await call('edit_item', { itemId: 'itm_does_not_exist', volume: 0.1 })
check('its approval was not spent — the retry reaches the tool again', retry.error, (e) => !/approved/i.test(e))

console.log('\n── ending the session lifts the gate')
await act('endAgentSession()')
check('the gate is gone', await gate(), null)
const after = await call('edit_item', { itemId: item, volume: 0.6 })
check('writes run freely again', after.ok, true)

console.log('\n── turning approval off mid-session lifts the gate at once')
await act('startAgentSession()')
check('POSITIVE CONTROL: gated while the setting is on', await gate(), (g) => g !== null)
await act('setAgentApproval(false)')
check('the gate is gone the moment the setting goes off', await gate(), null)
check('writes land in the still-active session', (await call('edit_item', { itemId: item, volume: 0.3 })).ok, true)
await act('endAgentSession()')

await call('delete_items', { itemIds: [item] })
console.log(`\n${checks}/${checks} checks passed`)
close()
return true

}, { timeoutMs: 5 * 60 * 1000 })
