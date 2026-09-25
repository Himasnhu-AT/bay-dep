/**
 * Does the status bar actually say so when the project database fails to open?
 *
 * The degradation is invisible from the outside — recents and reopen-last-project just do
 * nothing, and an empty recents list looks the same whether storage is broken or you have
 * no projects yet. That is the whole reason `app.storageReady()` exists, and it means the
 * warning is the app's only voice for a dead subsystem. A warning nobody has ever seen
 * render is a warning that is probably wrong.
 *
 * Run this against an app launched with a **deliberately broken** profile: a
 * `--user-data-dir` whose `app.db` is a directory rather than a file, which `node:sqlite`
 * cannot open.
 *
 *     mkdir -p /tmp/bay-broken/app.db
 *     BAY_ACCESS=dev ./node_modules/.bin/electron . --remote-debugging-port=9222 \
 *       --user-data-dir=/tmp/bay-broken --disable-backgrounding-occluded-windows &
 *     PORT=9222 node test/app/storage-warning.mjs
 *
 * The probe checks both halves, because either alone is a probe that cannot fail: that the
 * bridge really reports `ready: false` (otherwise the app is healthy and a missing warning
 * is correct), and that the warning is in the DOM. Run it against a *healthy* profile with
 * `EXPECT=healthy` for the negative control — the same probe must then report no warning.
 */

import { findRenderer, PreconditionError, runProbe } from './cdp.mjs'

const PORT = Number(process.env.PORT ?? 9222)
const EXPECT = process.env.EXPECT === 'healthy' ? 'healthy' : 'broken'

// bay's own window, not "the first page": once a composition has been opened its offscreen
// window is a page target too, has no `window.bay`, and every read below would come back
// undefined — which this probe would have reported as storage being broken.
// Its own socket rather than `attach()`, because it reads the status bar and must not open a
// project or touch the store; so there is nothing here for `runProbe` to restore.
const ws = new WebSocket(await findRenderer(PORT))
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
  ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  return (await p).result?.result?.value
}

await runProbe(async () => {

// The status bar asks once on mount; give it a moment if we attached early.
for (let i = 0; i < 20 && !(await evaluate(`!!document.querySelector('footer')`)); i++) {
  await new Promise((r) => setTimeout(r, 250))
}
// The status bar belongs to the editor. bay launches on its projects screen, which has none, so
// "no warning in the bar" there is a bar that does not exist — not a verdict either way.
if (!(await evaluate(`!!document.querySelector('footer')`))) {
  ws.close()
  throw new PreconditionError('the editor\'s status bar is not on screen',
    'bay is on its projects screen; open or create a project in this instance (New Project), then run again')
}

const status = await evaluate('window.bay.app.storageReady()')
const warnings = await evaluate(`JSON.stringify([...document.querySelectorAll('footer span')]
  .map((s) => s.innerText).filter((t) => /unavailable|missing/i.test(t)))`)
const shown = JSON.parse(warnings ?? '[]')
const hasStorageWarning = shown.some((t) => /storage/i.test(t))

console.log('storageReady()   ', JSON.stringify(status))
console.log('warnings in bar  ', warnings)

if (EXPECT === 'healthy') {
  const ok = status?.ready === true && !hasStorageWarning
  console.log(ok
    ? '\nPASS (control): storage is healthy and the bar stays quiet'
    : '\nFAIL (control): a healthy app must not show the warning')
  ws.close()
  return ok
}

// Both halves. A broken profile that still reports ready means the break did not take, and
// then "no warning" is correct rather than a fault — a setup failure, not a verdict.
if (status?.ready !== false) {
  ws.close()
  // Exit 2, not 1: this returned `false` and so reported a healthy app as a fault in the code.
  throw new PreconditionError('the profile is not actually broken, so nothing should warn',
    'make app.db a directory inside the --user-data-dir you launch with, or pass EXPECT=healthy')
}
const ok = hasStorageWarning
console.log(ok
  ? '\nPASS: the bar reports storage unavailable'
  : '\nFAIL: storage is down and the status bar says nothing')
ws.close()
return ok

})
