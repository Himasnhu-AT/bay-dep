/**
 * Is any item in the File menu dead?
 *
 * The menu is the one channel that runs main -> renderer, and it has to: the renderer owns
 * the project, so `project.save(project)` needs a project a menu item in main does not
 * have. The failure mode that justified the channel is silent — every item draws, every
 * item is enabled, and clicking does nothing, because nobody subscribed to
 * `app.onMenuCommand`. No unit test can see that; it needs the real menu bar.
 *
 * Two kinds of evidence, because the items divide in two:
 *
 * - **Export** is entirely renderer-side, so the proof is the modal appearing in the DOM.
 * - **Open / Save / Save As / Import** end in a native dialog. A sheet on the window proves
 *   the command crossed into the renderer *and* the renderer called the bridge. Reading the
 *   DOM cannot see a native sheet, and AppleScript cannot see the React tree, so each item
 *   is checked with whichever instrument can observe it.
 *
 * Needs the menu bar, so it drives the GUI process by AppleScript. `$!` from a shell is the
 * `npx` wrapper, not the app — the process that owns a menu bar is the one to talk to, and
 * this finds it by asking which one has one.
 */

import { execFileSync } from 'node:child_process'
import { PreconditionError, runProbe } from './cdp.mjs'

const PORT = Number(process.env.PORT ?? 9222)

const osa = (script) => {
  try {
    return execFileSync('osascript', ['-e', script], { encoding: 'utf8' }).trim() || 'ok'
  } catch (error) {
    return 'ERR ' + String(error.message).split('\n').slice(1, 2).join('').slice(0, 80)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * The pid that owns a menu bar — of THE app on PORT.
 *
 * Not `$!` from the shell — that is the `npx` wrapper — and not "the first process named
 * Electron with a menu bar": with more than one bay running (an isolated probe instance beside
 * the user's), that walked to whichever came first, and once clicked File › Save As in another
 * agent's window. The process listening on the debugging port is the app's main process, which
 * is the one that owns the menu bar, so it is found by the port and then checked for a menu bar.
 */
const findGuiPid = () => {
  let pid = ''
  try {
    pid = execFileSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')[0] ?? ''
  } catch {
    return 'none'
  }
  if (!/^\d+$/.test(pid)) return 'none'
  const owns = osa(`tell application "System Events"
  try
    get name of menu bar item 1 of menu bar 1 of (first process whose unix id is ${pid})
    return "yes"
  end try
  return "no"
end tell`)
  return owns === 'yes' ? pid : 'none'
}

let guiPid = 'none'
const clickFile = (item) =>
  osa(`tell application "System Events" to tell (first process whose unix id is ${guiPid})
    set frontmost to true
    delay 0.4
    click menu item "${item}" of menu 1 of menu bar item "File" of menu bar 1
  end tell`)
const sheetCount = () =>
  osa(`tell application "System Events" to tell (first process whose unix id is ${guiPid}) to get count of sheets of every window`)
const escape = () => osa('tell application "System Events" to key code 53')

const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { const { res } = pending.get(m.id); pending.delete(m.id); res(m) }
}
await new Promise((r) => (ws.onopen = r))
const evaluate = async (expression) => {
  const n = ++id
  const p = new Promise((res) => pending.set(n, { res }))
  ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  return (await p).result?.result?.value
}

await runProbe(async () => {

// A harness that cannot reach the menu must say so rather than report every item dead.
guiPid = findGuiPid()
if (guiPid === 'none' || guiPid.startsWith('ERR')) {
  throw new PreconditionError(`no app with a menu bar is listening on port ${PORT}`,
    'is the app running on that port, and does this terminal have Accessibility permission?')
}
console.log('gui pid', guiPid)

// Front the app and let it settle before the first measurement. Without this the first
// menu click is swallowed establishing focus, and whichever item happens to be checked
// first reports dead — a harness artefact that looks exactly like the bug being hunted.
osa(`tell application "System Events" to set frontmost of (first process whose unix id is ${guiPid}) to true`)
await sleep(1500)

const results = []

// Renderer-side item: the modal is the evidence.
await evaluate(`(() => { const b = [...document.querySelectorAll('[role=dialog] button')]
  .find((x) => x.textContent.trim() === 'Close'); if (b) b.click(); return true })()`)
await sleep(500)
const dialogBefore = await evaluate(`!!document.querySelector('[role=dialog]')`)
clickFile('Export…')
await sleep(1500)
const dialogAfter = await evaluate(`!!document.querySelector('[role=dialog]')`)
results.push({ item: 'Export…', evidence: 'export modal in DOM', before: dialogBefore, after: dialogAfter, live: !dialogBefore && dialogAfter })
await evaluate(`(() => { const b = [...document.querySelectorAll('[role=dialog] button')]
  .find((x) => x.textContent.trim() === 'Close'); if (b) b.click(); return true })()`)
await sleep(800)

// Bridge-side items: a native sheet is the evidence.
for (const item of ['Import Media…', 'Open…', 'Save', 'Save As…']) {
  clickFile(item)
  await sleep(2500)
  const sheets = sheetCount()
  results.push({ item, evidence: 'native sheet', after: sheets, live: sheets !== '0' && !sheets.startsWith('ERR') })
  // Two escapes: the first dismisses the sheet, the second is harmless if it already went.
  escape(); await sleep(1000); escape(); await sleep(700)
}

for (const r of results) {
  console.log(`${r.live ? 'PASS' : 'FAIL'}  ${r.item.padEnd(14)} ${r.evidence.padEnd(20)} ${JSON.stringify(r.after)}`)
}
const ok = results.every((r) => r.live)
console.log(ok ? '\nPASS: every File item reached the renderer' : '\nFAIL: at least one File item is dead')
ws.close()

if (process.env.VERIFY_PROBE === '1') {
  // Self-check: run against a build whose renderer does not subscribe to onMenuCommand.
  // Everything except Export should then report no sheet, and a pass here is the failure.
  console.log(ok ? 'SELF-CHECK FAILED: the probe cannot see an unsubscribed renderer'
                 : 'SELF-CHECK PASSED: the probe notices a dead menu')
  return !ok
}
return ok

})
