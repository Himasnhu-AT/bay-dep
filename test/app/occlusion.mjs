/**
 * Does an occluded window *drop* a `requestAnimationFrame` callback, or only defer it?
 *
 * This decides whether a staleness re-arm in the engine's `redraw()` coalescer is
 * load-bearing or unfalsifiable. If a callback queued while hidden is always eventually
 * delivered, the latch self-clears, nothing can distinguish the guard's presence from its
 * absence, and it should be deleted rather than tested.
 *
 * **Run this WITHOUT the throttling flags.** They are exactly what suppresses the behaviour
 * under test; with them the window never reports `hidden` and the probe measures nothing.
 *
 * The hard part is step 4, and it defeated two people before this. Once macOS has occluded
 * a window, `Page.bringToFront`, System Events `set frontmost` and `AXRaise` **all** leave
 * `visibilityState` at `hidden`. Clicking the Dock icon is the only lever that restores real
 * visibility, and its title is "Electron" for an unpackaged run but "bay" once the app names
 * itself, so both are tried. It is also flaky right after launch, hence the retry.
 *
 * The verdict is only meaningful because of the cancelled-callback control: a second
 * callback armed while hidden *and* cancelled must read false at the same moment the first
 * reads true. Without it, "it fired" cannot be told from "the probe always reports fired".
 */

import { execFileSync } from 'node:child_process'
import { PreconditionError, runProbe } from './cdp.mjs'

const PORT = Number(process.env.PORT ?? 9222)
const HOLD_MS = Number(process.env.HOLD_MS ?? 6000)

const osa = (s) => { try { return execFileSync('osascript', ['-e', s], { encoding: 'utf8' }).trim() } catch { return 'ERR' } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json()
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
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
const visibility = () => evaluate('document.visibilityState')

async function makeVisible(tries = 6) {
  for (let attempt = 0; attempt < tries; attempt++) {
    for (const title of ['bay', 'Electron']) {
      osa(`tell application "System Events" to tell process "Dock" to click UI element 1 of list 1 whose title contains "${title}"`)
      await sleep(1200)
      if ((await visibility()) === 'visible') return true
    }
  }
  return false
}

async function occlude() {
  osa('tell application "Terminal" to activate')
  await sleep(2500)
  return (await visibility()) === 'hidden'
}

await runProbe(async () => {

if (!(await makeVisible())) {
  throw new PreconditionError('the window could not be made visible', 'Dock click did not restore visibility')
}
await evaluate(`window.__r1 = { fired: false }; requestAnimationFrame(() => { window.__r1.fired = true }); true`)
await sleep(600)
const firstWhileVisible = await evaluate('window.__r1.fired')
if (!firstWhileVisible) {
  throw new PreconditionError('rAF does not run even when visible', 'the control callback never fired')
}

if (!(await occlude())) {
  throw new PreconditionError('the window could not be occluded',
    'needs a fullscreen window in front, and the throttling flags must be OFF')
}

await evaluate(`window.__r2 = { fired: false }; requestAnimationFrame(() => { window.__r2.fired = true }); true`)
// The control: armed under identical conditions, then cancelled. It must stay false.
await evaluate(`window.__r3 = { fired: false }
  const h = requestAnimationFrame(() => { window.__r3.fired = true }); cancelAnimationFrame(h); true`)
await sleep(HOLD_MS)
const firedWhileHidden = await evaluate('window.__r2.fired')
const stillHidden = await visibility()

if (!(await makeVisible())) {
  throw new PreconditionError('the window could not be restored', 'nothing brought it back to visible')
}
const visibilityAtRead = await visibility()
await sleep(1500)
const deferredFired = await evaluate('window.__r2.fired')
const cancelledFired = await evaluate('window.__r3.fired')

console.log('hold while hidden      ', HOLD_MS + 'ms')
console.log('control armed visible  ', firstWhileVisible)
console.log('fired while hidden     ', firedWhileHidden, `(page was ${stillHidden})`)
console.log('visibility at read     ', visibilityAtRead)
console.log('CONTROL cancelled fired', cancelledFired, '<- must be false, or the probe proves nothing')
console.log('deferred callback fired', deferredFired)

const controlSound = firstWhileVisible && !firedWhileHidden && stillHidden === 'hidden' &&
                     visibilityAtRead === 'visible' && cancelledFired === false
if (!controlSound) {
  console.log('\nCANNOT CONCLUDE: the controls did not hold')
  ws.close()
  return false
}
console.log(deferredFired
  ? '\nDEFERRED, NOT DROPPED: the queue drains on restore, so a staleness re-arm guards nothing'
  : '\nDROPPED: the callback never arrived, so a latch can be permanent and the guard is load-bearing')
ws.close()
return true

})
