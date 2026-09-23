/**
 * The `.brf` sandbox, adversarially (test.md §2.7): the indirect doors, each tried from inside the
 * real worker, then the outer wall from the editor window.
 *
 * `brf.mjs` covers the direct doors. Every module here throws `OPEN: …` when its door opens, so
 * the verdict comes back as `write_brf`'s refusal text. Two kinds of door need two shapes:
 *
 * - **Synchronous** (a constructor, a global): the module tests it at load and throws at frame 0.
 *   Accepted means shut — *provided* a throw reaches the caller, which the sentinel proves first.
 * - **Deferred** (a timer string, a dispatched message): what it does happens in a later task, so
 *   the module schedules a *function* control after the door and only judges once the control
 *   has run: `OPEN` if the door fired, `CLOSED-AFTER-CONTROL` if the control fired and the door did
 *   not. Accepted is then a non-result (nothing ran between load and render). And the instrument
 *   is proven able to see a deferred door open: the same shape with a legal function "door" must
 *   come back `OPEN`, or every `CLOSED` below means nothing.
 *
 * Measured before the fix (2026-09-23): string `setTimeout`/`setInterval` ran (global and via
 * the prototype), a dispatched MessageEvent replaced the probed module with an unprobed one, and
 * `new FontFace('x', 'url(https://…)')` issued a request only main's filter stopped.
 */

import { attach, check, PreconditionError, runProbe } from './cdp.mjs'

const { evaluate, send } = await attach()

await runProbe(async () => {
  const present = await evaluate(`typeof window.bayMcp?.execute === 'function'`)
  if (!present) throw new PreconditionError('window.bayMcp missing', 'is bay.debug set and the build current?')
  let seq = 0
  const call = (tool, args = {}) => evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `s${++seq}`, tool, args })})`, 90_000)
  const catalog = await evaluate(`window.bayMcp.tools.map((t) => t.name)`)
  if (!catalog.includes('write_brf')) throw new PreconditionError('write_brf is not in this build', 'run pnpm build and restart')
  const assetsBefore = await evaluate(`window.bayEngine.store.getState().project.assets.length`)

  const sentinel = await call('write_brf', { code: `export default () => { throw new Error('sentinel-7') }` })
  check('the control: a throw inside the worker reaches the caller', !sentinel.ok && /sentinel-7/.test(sentinel.error), true)

  // -- deferred doors ---------------------------------------------------------------------------
  const deferred = (name, schedule) => `
    let threw = ''
    try { ${schedule} } catch (e) { threw = e.message }
    setTimeout(() => { globalThis.__control = 1 }, 0)
    export default () => {
      if (globalThis.__opened) throw new Error('OPEN: ${name}')
      if (globalThis.__control) throw new Error('CLOSED-AFTER-CONTROL (${name}) ' + threw)
      return <scene duration={2}><rect w={1} h={1} fill="#000" /></scene>
    }`
  const verdict = async (code) => {
    const r = await call('write_brf', { code })
    if (r.ok) return 'no result (accepted: the control never ran)'
    const open = /OPEN: [^\n]*/.exec(r.error)
    if (open) return open[0]
    const shut = /CLOSED-AFTER-CONTROL[^\n]*/.exec(r.error)
    return shut ? shut[0] : `unexpected: ${r.error.slice(0, 200)}`
  }

  const instrument = await verdict(deferred('a function timer', `setTimeout(() => { globalThis.__opened = 1 }, 0)`))
  check('the instrument sees a deferred door open (a legal function timer reads OPEN)', instrument, 'OPEN: a function timer')

  const deferredDoors = {
    'setTimeout with a string': `setTimeout('globalThis.__opened = 1', 0)`,
    'setInterval with a string': `setInterval('globalThis.__opened = 1', 0)`,
    'setTimeout with a string, through the prototype': `
      let p = globalThis, fn
      while (p && !fn) { const d = Object.getOwnPropertyDescriptor(p, 'setTimeout'); if (d) fn = d.value; p = Object.getPrototypeOf(p) }
      fn.call(globalThis, 'globalThis.__opened = 1', 0)`,
    'a generated dynamic import in a timer string': `setTimeout('imp' + 'ort("data:text/javascript,globalThis.__opened=1")', 0)`,
    'setTimeout with an object that stringifies to code': `setTimeout({ toString() { return 'globalThis.__opened = 1' } }, 0)`,
    'scheduler.postTask with a string': `scheduler.postTask('globalThis.__opened = 1')`,
    'queueMicrotask with a string': `queueMicrotask('globalThis.__opened = 1')`,
    'a dispatched MessageEvent shaped like a host load': `
      setTimeout(() => dispatchEvent(new MessageEvent('message', { data: { id: 999999, type: 'load', fps: 30, width: 8, height: 8,
        source: "globalThis.__opened = 1; export default () => { throw new Error('OPEN: a forged host message replaced the module') }" } })), 0)`
  }
  for (const [name, schedule] of Object.entries(deferredDoors)) {
    const v = await verdict(deferred(name, schedule))
    check(`shut: ${name}`, v, (s) => s.startsWith('CLOSED-AFTER-CONTROL'))
    console.log(`    ${v}`)
  }

  // -- synchronous doors ------------------------------------------------------------------------
  const doors = {
    'fetch through the prototype descriptor': `(() => { for (let p = globalThis; p; p = Object.getPrototypeOf(p)) { const d = Object.getOwnPropertyDescriptor(p, 'fetch'); if (d && (d.value || d.get)) return true } })()`,
    'Reflect.construct(Function)': `typeof Reflect.construct(Function, ['return 1']) === 'function'`,
    'Reflect.construct on the real Function': `typeof Reflect.construct(Object.getPrototypeOf(() => 0).constructor, ['return 1']) === 'function'`,
    'the async arrow constructor': `typeof Object.getPrototypeOf(async () => {}).constructor('return 1') === 'function'`,
    'a class method constructor': `(() => { class A { m() {} } return A.prototype.m.constructor('return 1')() === 1 })()`,
    'an async class method constructor': `(() => { class A { async m() {} } return typeof A.prototype.m.constructor('return 1') === 'function' })()`,
    'a getter constructor': `(() => { class A { get x() { return 1 } } return Object.getOwnPropertyDescriptor(A.prototype, 'x').get.constructor('return 1')() === 1 })()`,
    'the generator constructor with new': `typeof new (Object.getPrototypeOf(function* () {}).constructor)('') === 'function'`,
    'the async generator constructor with new': `typeof new (Object.getPrototypeOf(async function* () {}).constructor)('') === 'function'`,
    'a bound function constructor': `(() => 0).bind(null).constructor('return 1')() === 1`,
    'indirect eval': `(0, globalThis['ev' + 'al'])('1') === 1`,
    'Worker from a Blob URL': `new Worker(URL.createObjectURL(new Blob(['1'], { type: 'text/javascript' }))) !== undefined`,
    'SharedWorker': `typeof SharedWorker !== 'undefined'`,
    'importScripts': `typeof importScripts !== 'undefined'`,
    'navigator.sendBeacon': `typeof self.navigator?.sendBeacon === 'function'`,
    'WebSocket': `typeof WebSocket !== 'undefined'`,
    'EventSource': `typeof EventSource !== 'undefined'`,
    'XMLHttpRequest': `typeof XMLHttpRequest !== 'undefined'`,
    'WebTransport': `typeof WebTransport !== 'undefined'`,
    'FontFace (a font URL is a request)': `typeof FontFace !== 'undefined' || typeof self.fonts !== 'undefined'`,
    'the sandboxed filesystem': `typeof webkitRequestFileSystem !== 'undefined' || typeof webkitRequestFileSystemSync !== 'undefined'`,
    'indexedDB / caches': `typeof indexedDB !== 'undefined' || typeof caches !== 'undefined'`,
    'postMessage (a forged reply)': `typeof postMessage !== 'undefined' || typeof Object.getPrototypeOf(globalThis).postMessage !== 'undefined'`,
    'a second message listener': `typeof addEventListener !== 'undefined'`
  }
  const syncModule = Object.entries(doors)
    .map(([name, test]) => `door(${JSON.stringify(name)}, () => ${test})`)
    .join('\n')
  const syncResult = await call('write_brf', {
    code: `
      const open = []
      const door = (name, test) => { try { if (test()) open.push(name) } catch (e) {} }
      ${syncModule}
      export default () => {
        if (open.length) throw new Error('OPEN: ' + open.join(', '))
        return <scene duration={1}><rect w={1} h={1} fill="#000" /></scene>
      }`
  })
  check(`shut, all ${Object.keys(doors).length} synchronous doors`, syncResult.ok ? 'all shut' : syncResult.error, 'all shut')

  // The synchronous module's own positive control: the same harness with a door that is open
  // by design (a function timer exists) must report it — or "all shut" could be a harness that
  // swallows every result.
  const syncControl = await call('write_brf', {
    code: `
      const open = []
      const door = (name, test) => { try { if (test()) open.push(name) } catch (e) {} }
      door('setTimeout exists', () => typeof setTimeout === 'function')
      door('structuredClone of data', () => structuredClone({ a: [1] }).a[0] === 1)
      export default () => { if (open.length) throw new Error('OPEN: ' + open.join(', ')); return <scene duration={1} /> }`
  })
  check('the synchronous harness reports a door it can see', !syncControl.ok && /OPEN: setTimeout exists, structuredClone of data/.test(syncControl.error), true)

  // WebAssembly is not a door: an instance calls only the functions the module hands it. Measured
  // that it runs, so the claim is about what it can reach, not that it is missing.
  const wasm = await call('write_brf', {
    code: `
      const bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,2,7,1,1,109,1,102,0,0,3,2,1,0,7,5,1,1,114,0,1,10,6,1,4,0,16,0,11])
      let hits = 0
      new WebAssembly.Instance(new WebAssembly.Module(bytes), { m: { f: () => { hits++ } } }).exports.r()
      export default () => { throw new Error('WASM host import called ' + hits + ' time(s)') }`
  })
  check('WebAssembly runs and reaches only what the module passed it', /WASM host import called 1 time/.test(wasm.error ?? ''), true)

  // Everything above was refused or asserted shut; the one accepted module is the sync checker.
  const assetsAfter = await evaluate(`window.bayEngine.store.getState().project.assets.length`)
  check('only the accepted synchronous checker added an asset', assetsAfter - assetsBefore, 1)

  // -- the outer wall ---------------------------------------------------------------------------
  // Not a fetch from the editor document: its CSP (`connect-src 'self' bay:`) refuses a remote
  // URL — and a data: one — before main ever sees it, so that would test the CSP, not main's
  // session filter. Measured: no "[bay] refused" line appears for it. The filter's job is the
  // contexts the CSP does not bind (the worker), so the check needs one of those: with CDP's
  // CSP bypass on, a fresh iframe's document is unbound — shown by its data: fetch succeeding —
  // and its remote fetch can only be stopped by main.
  const cspBound = await evaluate(`fetch('https://example.com/?bay-csp').then(() => 'answered', (e) => 'rejected: ' + e.message)`)
  check('the editor document itself refuses a remote fetch (its CSP)', cspBound, (s) => s.startsWith('rejected'))
  await send('Page.setBypassCSP', { enabled: true })
  let wall
  try {
    wall = await evaluate(`(async () => {
      const f = document.createElement('iframe'); f.style.display = 'none'; document.body.appendChild(f)
      await new Promise((r) => setTimeout(r, 300))
      const one = (u) => f.contentWindow.fetch(u).then((r) => 'answered ' + r.status, (e) => 'rejected: ' + e.message)
      const out = { local: await one('data:text/plain,here'), remote: await one('https://example.com/?bay-outer-wall') }
      f.remove()
      return out
    })()`)
  } finally {
    await send('Page.setBypassCSP', { enabled: false })
  }
  check('the control: the unbound context is not held by the CSP (its data: fetch answers)', wall.local, 'answered 200')
  check('the outer wall: its remote fetch is refused all the same', wall.remote, (s) => s.startsWith('rejected'))
  console.log('    and main must have logged: [bay] refused a network request from the editor: https://example.com/?bay-outer-wall')
  console.log('    (this probe cannot read main\'s log; a machine with no network also rejects — check the line)')

  return true
})
