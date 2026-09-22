/**
 * The agent panel, driven as a user drives it.
 *
 * The question this answers and nothing else can: does a real `claude` process, spawned by bay,
 * restricted to bay's tools, actually reach the timeline — and does the refusal come back when
 * it tries to write without an approval. Everything below the panel is unit tested; this is the
 * only thing that proves the pieces are connected to each other.
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

await runProbe(async () => {
  const state = (expr) => evaluate(`(() => { const s = window.bayEngine.store.getState(); return ${expr} })()`)

  // The panel must be open for the conversation to render, but the subscription that feeds it
  // lives in App and outlives the panel — that split is the bug this probe found.
  console.log('\n── the panel is reachable')
  await evaluate(`(() => { window.bayEngine.store.getState().setPanel('agent'); return true })()`)
  await new Promise((r) => setTimeout(r, 400))
  check('the Agent page is selected', await state('s.panel'), 'agent')
  check('its rail button exists', await evaluate(
    `Boolean([...document.querySelectorAll('[aria-label]')].find((e) => e.getAttribute('aria-label') === 'Agent'))`
  ), true)
  check('the composer is on screen', await evaluate(
    `Boolean(document.querySelector('textarea[placeholder*="Trim"]'))`
  ), true)

  console.log('\n── a real claude process, restricted to bay')
  const started = await evaluate(`window.bay.agent.start()`, 60000)
  if (!started.ok) throw new PreconditionError('the agent could not start', started.error)
  check('it started', started.ok, true)
  await evaluate(`(() => { window.bayEngine.store.getState().startAgentSession(); return true })()`)

  // Ask it to read, which needs no approval, and to attempt a write, which does.
  await evaluate(`window.bay.agent.send(${JSON.stringify(
    'Call read_project once. Then call remove_range with fromFrame 0 and toFrame 5. ' +
    'Report exactly what each call returned, verbatim. Do not retry anything.'
  )})`, 30000)

  const deadline = Date.now() + 240000
  let log = []
  while (Date.now() < deadline) {
    log = await state('s.agentLog.map((e) => ({ kind: e.kind, tool: e.tool, state: e.state, result: e.result, text: e.text }))')
    if (!(await state('s.agentRunning')) && log.length > 1) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  for (const entry of log) {
    const detail = entry.tool ? `${entry.tool} ${entry.state}` : (entry.text ?? '').slice(0, 70).replace(/\s+/g, ' ')
    console.log(`     ${entry.kind.padEnd(9)} ${detail}`)
  }

  const tools = log.filter((e) => e.kind === 'tool')
  check('it called bay tools', tools.length, (n) => n >= 1)
  check('read_project ran and succeeded', tools.find((t) => t.tool === 'read_project')?.state, 'done')

  const write = tools.find((t) => t.tool === 'remove_range')
  check('the write was attempted', Boolean(write), true)
  check('and it was refused by the gate', write?.state, 'failed')
  check('with the refusal text intact, not a status', write?.result, (r) => /propose/i.test(r ?? ''))

  check('the run ended', await state('s.agentRunning'), false)
  await evaluate(`window.bay.agent.dispose()`)
  console.log(`\n${checks}/${checks} checks passed`)
  close()
  return true
}, { timeoutMs: 8 * 60 * 1000 })
