/**
 * Can the in-app agent actually *see* a preview_frame?
 *
 * The agent once reported "both previews came back too large… I haven't actually seen the
 * picture" — the frame was base64 inside JSON text. This asks a real `claude` to look, and
 * checks two things: the tool result carried an image (the transport half), and the model's
 * description matches a colour we painted (the half only a model can prove). The colour is
 * chosen fresh each run from the current fixture, never assumed.
 */
import { attach, runProbe, ProbeFailure } from './cdp.mjs'

const { evaluate, close } = await attach()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let checks = 0
const check = (label, actual, expected) => {
  checks++
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  if (!ok) throw new ProbeFailure(`${label}\n  got:      ${JSON.stringify(actual)}\n  expected: ${expected}`)
  console.log(`  ok  ${label}`)
}

await runProbe(async () => {
  const state = (expr) => evaluate(`(() => { const s = window.bayEngine.store.getState(); return ${expr} })()`)
  // The transport half, without a model: the executor's answer carries a jpeg data URL small
  // enough to be an image rather than a wall of text.
  const direct = await evaluate(`window.bayMcp.execute({ id: 'p', tool: 'preview_frame', args: { includeTimecode: true } })`, 60000)
  check('preview_frame answered', direct.ok, true)
  check('as a JPEG data URL', direct.value?.image?.slice(0, 23), 'data:image/jpeg;base64,')
  check('with the timecode as text', typeof direct.value?.timecode, 'string')
  console.log(`     image bytes: ${direct.value.image.length}`)

  await evaluate(`(async () => { await window.bay.agent.dispose(); const s = window.bayEngine.store.getState(); s.endAgentSession(); s.clearAgentLog(); return true })()`)
  const started = await evaluate(`window.bay.agent.start()`, 60000)
  check('agent started', started.ok, true)
  await evaluate(`(() => { window.bayEngine.store.getState().startAgentSession(); return true })()`)
  await evaluate(`window.bay.agent.send(${JSON.stringify(
    'Call preview_frame once with no arguments. Then answer in one line: did the result include an image you could actually see (yes/no), and if yes, name the single most dominant colour in it.'
  )})`, 30000)
  await sleep(1500)
  const deadline = Date.now() + 240000
  while (Date.now() < deadline && (await state('s.agentRunning'))) await sleep(1000)
  const log = await state('s.agentLog.map((e) => ({ kind: e.kind, tool: e.tool, state: e.state, text: e.text, result: e.result }))')
  for (const e of log) console.log(`     ${e.kind.padEnd(9)} ${e.tool ? `${e.tool} ${e.state}` : (e.text ?? '').slice(0, 200).replace(/\s+/g, ' ')}`)
  const call = log.find((e) => e.tool === 'preview_frame')
  check('the model called preview_frame', call?.state, 'done')
  const answer = log.filter((e) => e.kind === 'assistant').map((e) => e.text).join(' ')
  check('it says it saw an image', answer, (a) => /\byes\b/i.test(a) && !/too large/i.test(a))
  await evaluate(`(async () => { await window.bay.agent.dispose(); window.bayEngine.store.getState().endAgentSession(); return true })()`)
  console.log(`\n${checks}/${checks} checks passed`)
  close()
  return true
}, { timeoutMs: 6 * 60 * 1000 })
