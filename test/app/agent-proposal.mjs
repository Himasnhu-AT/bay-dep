/**
 * Propose → approve → edit, with a real `claude` and the real panel.
 *
 * `agent-panel.mjs` proves the gate refuses. This proves the other half, which had never once
 * happened: that a model can get an edit *approved* and then make it. Before `propose_edit`
 * existed the in-app agent could not change a frame, and nothing reported that, because every
 * probe of the approval card built its proposal by hand.
 *
 * Driven through the DOM, not the store: the composer's Send, the card's Approve. The approval
 * reaching the model as a turn is exactly the part a store-level probe would skip.
 *
 * The edit asked for is `add_track`, chosen because its effect is a count — observable without
 * judging a picture — and because it takes no ids, so the model cannot get it wrong by copying.
 * The track count is read before and compared after, never assumed (CLAUDE.md: derive, do not
 * write literals about shared state).
 */
import { attach, runProbe, PreconditionError } from './cdp.mjs'

const { evaluate, close } = await attach()
let checks = 0
const check = (label, actual, expected) => {
  checks++
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  if (!ok) throw new Error(`${label}\n  got:      ${JSON.stringify(actual)}\n  expected: ${expected}`)
  console.log(`  ok  ${label}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await runProbe(async () => {
  const state = (expr) =>
    evaluate(`(() => { const s = window.bayEngine.store.getState(); return ${expr} })()`)
  const trackCount = () =>
    state(`s.project.timelines.find((t) => t.id === s.project.activeTimelineId).tracks.filter((t) => t.kind === 'video').length`)

  const waitIdle = async (label, ms = 240000) => {
    const deadline = Date.now() + ms
    // Give the turn a moment to start before reading "not running" as "finished".
    await sleep(1500)
    while (Date.now() < deadline) {
      if (!(await state('s.agentRunning'))) return
      await sleep(1000)
    }
    throw new Error(`${label}: the turn did not finish within ${ms / 1000}s`)
  }
  const dump = async () => {
    const log = await state(
      's.agentLog.map((e) => ({ kind: e.kind, tool: e.tool, state: e.state, result: e.result, text: e.text }))'
    )
    for (const entry of log) {
      const detail = entry.tool
        ? `${entry.tool} ${entry.state}${entry.state === 'failed' ? ` — ${(entry.result ?? '').slice(0, 140)}` : ''}`
        : (entry.text ?? '').slice(0, 90).replace(/\s+/g, ' ')
      console.log(`     ${entry.kind.padEnd(9)} ${detail}`)
    }
    return log
  }

  // A clean conversation, whatever an earlier probe left behind.
  await evaluate(`(async () => { await window.bay.agent.dispose(); const s = window.bayEngine.store.getState(); s.endAgentSession(); s.clearAgentLog(); s.setPanel('agent'); return true })()`)
  await sleep(400)

  const before = await trackCount()
  console.log(`\n── video tracks before: ${before}`)

  console.log('\n── ask, through the composer')
  const typed = await evaluate(`(() => {
    const box = document.querySelector('textarea[placeholder*="Trim"]')
    if (!box) return false
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    set.call(box, ${JSON.stringify(
      'Add one new video track to the timeline. Nothing else. Propose it, then wait for my approval.'
    )})
    box.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  if (!typed) throw new PreconditionError('the composer is not on screen')
  await sleep(200)
  const clicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Send')
    if (!b || b.disabled) return false
    b.click(); return true
  })()`)
  check('Send was clickable', clicked, true)

  await waitIdle('the proposing turn')
  await dump()
  check('a session is running, so writes are gated', await state('s.agentGate !== null'), true)
  check('nothing changed before approval', await trackCount(), before)

  const proposal = await state('s.agentProposal && { id: s.agentProposal.id, options: s.agentProposal.options.map((o) => ({ label: o.label, ops: o.operations.map((op) => op.tool + " " + JSON.stringify(op.args)) })) }')
  console.log(`     proposal: ${JSON.stringify(proposal)}`)
  check('the model made a proposal', Boolean(proposal), true)
  check('the proposal adds a track', JSON.stringify(proposal?.options ?? []), (s) => s.includes('add_track'))

  console.log('\n── approve, on the card')
  const approved = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Approve')
    if (!b || b.disabled) return false
    b.click(); return true
  })()`)
  check('the card had an Approve button', approved, true)
  await sleep(300)
  check('the gate now holds the approval', await state('s.agentGate?.approved?.proposalId'), proposal.id)

  await waitIdle('the executing turn')
  const log = await dump()

  const after = await trackCount()
  console.log(`\n── video tracks after: ${after}`)
  check('the approved edit happened: exactly one more video track', after, before + 1)
  check('the approval was spent', await state('s.agentGate?.approved?.consumed?.length'), (n) => n >= 1)
  const addCalls = log.filter((e) => e.kind === 'tool' && e.tool === 'add_track')
  check('add_track ran and succeeded', addCalls.some((e) => e.state === 'done'), true)

  // Negative control beside the positive one: a second write, now that the plan is spent, must
  // be refused rather than riding on the old approval.
  const again = await evaluate(`window.bayMcp.execute({ id: 'probe', tool: 'add_track', args: { kind: 'video' } })`)
  check('a further write after the plan is spent is refused', again.ok, false)
  check('…and the refusal says why', again.error ?? '', (e) => /already been carried out|does not match/.test(e))

  // Leave the fixture as found: one undo for the one edit.
  await evaluate(`window.bayEngine.store.getState().undo()`)
  check('undo restores the track count', await trackCount(), before)

  await evaluate(`(async () => { await window.bay.agent.dispose(); window.bayEngine.store.getState().endAgentSession(); return true })()`)
  console.log(`\n${checks}/${checks} checks passed`)
  close()
  return true
}, { timeoutMs: 10 * 60 * 1000 })
