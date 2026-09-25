/**
 * A tool call that arrives while the editor window is reloading.
 *
 * The state that separates "main waits for the executor to be listening" from "main sends at
 * once": during a reload the old page's listener is gone and the new one has not mounted, so a
 * call pushed then is dropped by IPC and main waits out its 30s call timeout. A cold launch on a
 * fast machine did NOT distinguish the two — the renderer mounted before the first call arrived,
 * with or without the wait — so this is the probe that proves the wait does anything.
 */
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { attach, runProbe, PreconditionError } from './cdp.mjs'

/**
 * The profile whose socket to call: the one the instance on PORT was launched with. It used to be
 * the default profile always, so pointed at an isolated instance (PORT=9372, its own
 * --user-data-dir) the calls went to whatever bay owned the default socket — reloading one app
 * while calling another, or someone else's. The default is kept for the default port only.
 */
const PORT = process.env.PORT ?? '9222'
if (!process.env.USER_DATA && PORT !== '9222') {
  throw new PreconditionError(`set USER_DATA to the --user-data-dir of the app on port ${PORT}`,
    'the default profile\'s socket belongs to a different instance')
}
const USER_DATA = process.env.USER_DATA ?? join(homedir(), 'Library', 'Application Support', 'bay')

const { send, evaluate, close } = await attach()

/** A call over the app's socket directly, connection opened *before* the reload so no spawn
 * latency decides where in the reload the call lands. */
async function preparedCall() {
  const socket = connect(join(USER_DATA, 'bay-mcp.sock'))
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
  return (tool) => new Promise((resolve) => {
    const t0 = Date.now()
    let buf = ''
    socket.setEncoding('utf8')
    socket.on('data', (d) => {
      buf += d
      const lines = buf.split('\n'); buf = lines.pop()
      for (const line of lines) {
        const m = JSON.parse(line)
        if (m.id === 7) { socket.end(); resolve({ seconds: (Date.now() - t0) / 1000, isError: m.result.isError, text: m.result.content[0].text }) }
      }
    })
    socket.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: tool, arguments: {} } }) + '\n')
  })
}

/**
 * A reload now lands on bay's projects screen, so the project is reopened after each one (the way
 * `attach()` opens it) — every offset then starts from the same state as the first.
 */
const filePath = await evaluate(`window.bayEngine.store.getState().project.filePath`)
const reopen = () => evaluate(`(async () => {
  for (let i = 0; i < 80 && !window.bayMcp && !window.bayEngine; i++) await new Promise((r) => setTimeout(r, 100))
  if (!window.bayEngine) {
    const o = await window.bayMcp.execute({ id: 'reopen', tool: 'open_project', args: { filePath: ${JSON.stringify(filePath)} } })
    if (!o.ok) throw new Error(o.error)
    for (let i = 0; i < 80 && !window.bayEngine; i++) await new Promise((r) => setTimeout(r, 100))
  }
  return !!window.bayEngine
})()`, 45_000)
/**
 * The refusal the projects screen gives a project tool is an answer, in time, and it is the right
 * one: the page that answered has no project open. What this probe guards is a call that is
 * *stranded* — answered by nothing until the timeout — or failed by the transport.
 */
const PROJECTS_SCREEN = /^No project is open in bay/

await runProbe(async () => {
  if (!filePath) throw new PreconditionError('the open project has no file', 'the probe reopens it after each reload')
  // Browser-initiated, the way Cmd+R and devtools reload, with the call fired at a spread of
  // offsets so some land in the gap between the old page's teardown and the new one mounting.
  // A single offset proved nothing: at 0ms the old page answered before the reload began.
  let lost = 0
  for (const offset of [0, 5, 10, 20, 40, 80, 160]) {
    const call = await preparedCall()
    void send('Page.reload', {})
    await new Promise((r) => setTimeout(r, offset))
    const answer = await call('read_project')
    const home = answer.isError && PROJECTS_SCREEN.test(answer.text)
    const bad = (answer.isError && !home) || answer.seconds >= 15
    if (bad) lost++
    console.log(`  reload +${String(offset).padStart(3)}ms  answered in ${answer.seconds.toFixed(1)}s  ${bad ? 'LOST: ' + answer.text.slice(0, 80) : home ? 'ok (answered by the reloaded page: no project open)' : 'ok'}`)
    await new Promise((r) => setTimeout(r, 500))
    await reopen()
    await new Promise((r) => setTimeout(r, 1000))
  }
  let ok = lost === 0
  console.log(ok ? 'PASS  every call during a reload was answered'
                 : `FAIL  ${lost} call(s) were lost in a reload`)

  // A navigation that starts and is cancelled must not leave the window marked not-ready. This
  // was the bug the first version of the wait had: every call after it waited 45s and failed.
  await evaluate(`(() => { setTimeout(() => location.reload(), 0); return true })()`)
  await new Promise((r) => setTimeout(r, 1500))
  await reopen()
  const after = await (await preparedCall())('read_project')
  console.log(`after a cancelled navigation: ${after.seconds.toFixed(1)}s, isError=${after.isError}`)
  const ok2 = !after.isError && after.seconds < 15
  console.log(ok2 ? 'PASS  a cancelled navigation leaves the executor usable'
                  : 'FAIL  a cancelled navigation stranded the executor')
  ok = ok && ok2
  close()
  return ok
}, { timeoutMs: 10 * 60_000 })
