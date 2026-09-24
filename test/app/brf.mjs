/**
 * Does a `.brf` module run in its locked-down worker, draw, move, refuse what it should — and how
 * fast, against the HTML composition it replaces?
 *
 * Drives the real dispatcher through `window.bayMcp` (not the socket, which is a separate fault)
 * and reads pictures back through `renderFrame`, the path `preview_frame` and export use.
 *
 * The sandbox is tested from inside it: a module that throws if any door is open. `write_brf`
 * runs a module across its duration before accepting it, so an accepted escape-checker is a
 * worker with every door shut — *provided* a throw from a module does reach the caller, which the
 * sentinel module proves first. Without that control, "accepted" would also be what a runtime
 * that swallowed every error said.
 *
 * What else would fool it, and what stops that:
 * - A frame that draws nothing looks the same as a module with nothing to draw. The module covers
 *   a large area at rest, and "lit pixels" must beat a floor an empty frame is shown not to reach.
 * - "It moves" as "two frames differ" passes for noise; the first frame and the frame at rest must
 *   differ by far more than antialiasing can.
 * - Timing compares only what it says: both sides through `renderFrame`, which is what
 *   `preview_frame` pays. That path builds a composition pool per call, so the HTML side includes
 *   opening a capture window each time; export keeps its windows and pays 40-80ms a frame instead.
 */

import { attach, check, PreconditionError, runProbe } from './cdp.mjs'

const { evaluate } = await attach()

await runProbe(async () => {
  await evaluate(`localStorage.setItem('bay.debug', '1')`)
  const present = await evaluate(`typeof window.bayMcp?.execute === 'function' && typeof window.bayEngine?.renderFrame === 'function'`)
  if (!present) throw new PreconditionError('window.bayMcp / bayEngine missing', 'is bay.debug set and the build current?')

  let seq = 0
  const call = (tool, args = {}) =>
    evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `b${++seq}`, tool, args })})`, 90_000)

  const catalog = await evaluate(`window.bayMcp.tools.map((t) => t.name)`)
  if (!catalog.includes('write_brf')) throw new PreconditionError('write_brf is not in this build', 'run pnpm build and restart')

  const stale = await evaluate(`(() => {
    const s = window.bayEngine.store.getState()
    const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId)
    return tl.tracks.flatMap((t) => t.items.map((i) => i.id))
  })()`)
  if (stale.length > 0) {
    const cleared = await call('delete_items', { itemIds: stale })
    if (!cleared.ok) throw new PreconditionError('could not clear the timeline', cleared.error)
  }
  const brfCount = () => evaluate(`window.bayEngine.store.getState().project.assets.filter((a) => a.kind === 'brf').length`)

  // -- the sandbox, from inside -----------------------------------------------------------------
  const sentinel = await call('write_brf', { code: `export default () => { throw new Error('sentinel-7') }` })
  // The refusal itself is what gets printed on a failure: a worker that never loaded (a packaged
  // build missing its worker file) answers "crashed: …" here, and that sentence is the diagnosis.
  check('the control: a throw inside the worker reaches the caller', sentinel.ok ? 'accepted' : sentinel.error, (e) => /sentinel-7/.test(e))

  const escapes = `
    const open = []
    const door = (name, test) => { try { if (test()) open.push(name) } catch (e) {} }
    door('fetch', () => typeof fetch !== 'undefined')
    door('fetch on the prototype', () => typeof Object.getPrototypeOf(globalThis).fetch !== 'undefined')
    door('XMLHttpRequest', () => typeof XMLHttpRequest !== 'undefined')
    door('WebSocket', () => typeof WebSocket !== 'undefined')
    door('importScripts', () => typeof importScripts !== 'undefined')
    door('postMessage', () => typeof postMessage !== 'undefined')
    door('addEventListener', () => typeof addEventListener !== 'undefined')
    door('indexedDB', () => typeof indexedDB !== 'undefined')
    door('Function constructor', () => (function () {}).constructor('return 1')() === 1)
    door('async Function constructor', () => typeof (async function () {}).constructor('return 1') === 'function')
    door('eval', () => eval('1') === 1)
    door('the bridge', () => typeof globalThis.bay !== 'undefined')
    door('require', () => typeof globalThis.require !== 'undefined')
    export default () => {
      if (open.length) throw new Error('OPEN: ' + open.join(', '))
      return <scene duration={1}><rect w={1} h={1} fill="#000" /></scene>
    }`
  const locked = await call('write_brf', { code: escapes })
  check('inside the worker every door is shut (network, storage, messaging, code generation, bridge)', locked.ok ? 'all shut' : locked.error, 'all shut')

  const importing = await call('write_brf', { code: `import x from 'https://example.com/x.js'\nexport default () => <scene duration={x} />` })
  check('importing anything but bay/remotion is refused', !importing.ok && /can import only from 'bay' or 'remotion'/.test(importing.error), true)

  const looping = await call('write_brf', { code: `export default ({ frame }) => { if (frame > 3) for (;;) {} return <scene duration={2} /> }` })
  check('a module that never returns is stopped and reported, not hung', !looping.ok && /took longer than 3s/.test(looping.error), true)

  // The escape-checker was accepted without atFrame, so it is the one asset expected so far.
  const assetsBefore = await brfCount()

  // -- drawing ----------------------------------------------------------------------------------
  /** Renders `frame` through renderFrame; lit = pixels brighter than near-black. */
  const render = (frame) =>
    evaluate(`(async () => {
      const st = window.bayEngine.store.getState()
      const t0 = performance.now()
      const r = await window.bayEngine.renderFrame({ project: st.project, timelineId: st.project.activeTimelineId, frame: ${frame} })
      const ms = performance.now() - t0
      const img = new Image(); img.src = r.dataUrl; await img.decode()
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0)
      const d = x.getImageData(0, 0, c.width, c.height).data
      let lit = 0
      let hash = 5381
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) lit++
        hash = ((hash * 33) ^ (d[i] + d[i + 1] * 3 + d[i + 2] * 7)) >>> 0
      }
      return { ms, lit, hash, drawn: r.drawn, pending: r.pending, placeholders: r.placeholders, unresolved: r.unresolved }
    })()`, 90_000)

  const empty = await render(10)
  check('the empty frame is dark (the lit counter can see "nothing")', empty.lit < 50, true)

  const module = `
    import { interpolate, spring } from 'bay'
    export const vars = { title: 'Drawn natively', accent: '#11D1A0' }
    export default ({ t, vars }) => (
      <scene duration={3} background="#101018">
        <rect x="50%" y="50%" w="70%" h="40%" radius="3%" fill={\`linear(90, \${vars.accent}, #3B82F6)\`}
          scale={spring(t, { damping: 14 })} opacity={interpolate(t, [0, 0.3], [0, 1])} />
        <text x="50%" y="50%" size="9%" weight={900} split="word" stagger={0.1} in={['up', 0.4, 0.3]}>{vars.title}</text>
        <path d="M-200 0 L200 0" x="50%" y="80%" stroke="#ffffff" strokeWidth={8} draw={interpolate(t, [0.5, 1.5], [0, 1])} />
      </scene>
    )`
  const written = await call('write_brf', { code: module, atFrame: 0, name: 'Probe motion' })
  if (!written.ok) throw new PreconditionError('write_brf refused a valid module', written.error)
  check('the refused modules left no asset behind (only the accepted escape-checker exists)', assetsBefore, 1)
  check('write_brf created and placed it', written.value.placed === true && typeof written.value.itemId === 'string', true)
  check('it read the module: duration and vars', written.value.durationSeconds === 3 && written.value.vars.title === 'Drawn natively', true)

  const fps = await evaluate(`window.bayEngine.store.getState().project.timelines[0].fps`)
  const start = await render(0)
  const rest = await render(Math.round(fps * 2))
  console.log('first frame     ', JSON.stringify(start))
  console.log('at rest (2s)    ', JSON.stringify(rest))
  check('it draws: no placeholder, nothing pending', rest.drawn >= 1 && rest.placeholders === 0 && rest.pending === 0, true)
  check('at rest it lights a large part of the frame', rest.lit, (n) => n > 20_000)
  check('it moves: the first frame lights far less than the frame at rest', rest.lit - start.lit, (n) => n > 10_000)
  const again = await render(Math.round(fps * 2))
  check('drawing the same moment twice gives the same picture', again.lit, rest.lit)

  // A placement's vars reach the code. Compared by pixel hash, not lit count: the title is white
  // on an already-lit gradient, so a count cannot see it change — which is how the first version
  // of this check failed against working code. The same-moment hash above is the control.
  check('the pixel hash is stable for the same moment (the control for the next check)', again.hash, rest.hash)
  await evaluate(`window.bayEngine.store.getState().setCompositionVariable(${JSON.stringify(written.value.itemId)}, 'title', 'W')`)
  const shorter = await render(Math.round(fps * 2))
  check('a placement override reaches the module (a one-letter title is a different picture)', shorter.hash !== rest.hash, true)

  // -- timing against the HTML lower third ------------------------------------------------------
  const brfTimes = []
  for (let f = 0; f < 10; f++) brfTimes.push((await render(f * 6)).ms)
  const tpl = await call('add_template', { templateId: 'lower-third', atFrame: 0 })
  if (!tpl.ok) throw new PreconditionError('add_template failed; cannot time the HTML side', tpl.error)
  await evaluate(`(() => { const s = window.bayEngine.store.getState(); s.patchLayout(${JSON.stringify(written.value.itemId)}, { opacity: 0 }) })()`)
  const htmlTimes = []
  for (let f = 0; f < 10; f++) htmlTimes.push((await render(f * 6 + 1)).ms)
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  console.log(`renderFrame median: .brf ${median(brfTimes).toFixed(1)} ms · HTML ${median(htmlTimes).toFixed(1)} ms (compose + PNG encode, 10 frames each)`)
  check('a .brf frame renders faster than an HTML composition frame', median(brfTimes) < median(htmlTimes), true)

  return true
})
