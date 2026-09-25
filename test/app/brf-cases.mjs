/**
 * test.md §2.2, §2.4, §2.6 and §2.8 — the `.brf` cases that were never run — as one probe.
 *
 *   PORT=9273 node test/app/brf-cases.mjs                 # every case
 *   PORT=9273 CASES=playback,heavy node test/app/brf-cases.mjs
 *
 * Cases (each prints `ok`/`FAIL` lines and numbers; the verdict is every check passing):
 *
 * - `playback` (§2.2): the guide's Kinetic captions over a video clip. Plays 4 s with and without
 *   the `.brf` (pictures/s, composite p99 from `engine.stats()`), and records **every preview
 *   draw** by wrapping `Compositor.prototype.drawFrame`: a draw that names the `.brf` in
 *   `pendingNames` drew nothing for it — a blink. Then scrubs by dragging the mouse (CDP
 *   `Input.dispatchMouseEvent`) back and forth across the ruler for 5 s and counts the same.
 * - `undo` (§2.4): create+place, Cmd+Z, Cmd+Shift+Z (real key events); replace, undo, redo. Each
 *   step one history entry; the picture and `read_brf` follow.
 * - `variables` (§2.6): the Lower third placed twice; the Inspector's fields (typed through CDP
 *   `Input.insertText`, the colour well through its own input/change events); the preview
 *   changes; one edit across two placements is one undo step; `inspect_item` reports it; an
 *   undeclared variable is refused naming the real ones.
 * - `heavy` (§2.8): an endless loop, a 2 GB allocation, 5,000 rects, 60 s at 60 fps, nine
 *   modules on one frame, and `Math.random` determinism (the relaunch half is in
 *   `brf-persist.mjs`).
 *
 * Every check that says "nothing was drawn" has a control that shows the instrument sees a draw.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { attach, check, checksPassed, PreconditionError, runProbe, showInspector } from './cdp.mjs'

const PORT = Number(process.env.PORT ?? 9222)
const CASES = (process.env.CASES ?? 'playback,undo,variables,heavy').split(',')
const CLIP = resolve(process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4')

/** The guide's examples by heading — the same text an agent reads. */
const guide = readFileSync(resolve('src/main/mcp/docs/brf.md'), 'utf8')
const example = (title) => {
  const at = guide.indexOf(`### ${title}`)
  if (at < 0) throw new PreconditionError(`no example "${title}" in the guide`, 'was it renamed?')
  const m = /```tsx\n([\s\S]*?)```/.exec(guide.slice(at))
  return m[1]
}

const { send, evaluate } = await attach(PORT)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** `check`, but a miss is recorded and the cases go on; arrays and objects compare by value. */
const failures = []
const verify = (label, actual, expected) => {
  try {
    check(label, actual, typeof expected === 'object' && expected !== null
      ? Object.assign((a) => JSON.stringify(a) === JSON.stringify(expected), { toString: () => JSON.stringify(expected) })
      : expected)
  } catch (error) {
    failures.push(label)
    console.log(`  FAIL ${error.message}`)
  }
}

await runProbe(async () => {
  let seq = 0
  const call = (tool, args = {}) => evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `c${++seq}`, tool, args })})`, 120_000)
  const state = (expr) => evaluate(`(() => { const s = window.bayEngine.store.getState(); const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId); return ${expr} })()`)
  const past = () => state('s.past.length')
  const clear = async () => {
    const ids = await state('tl.tracks.flatMap((t) => t.items.map((i) => i.id))')
    if (ids.length) {
      const r = await call('delete_items', { itemIds: ids })
      if (!r.ok) throw new PreconditionError('could not clear the timeline', r.error)
    }
  }
  /** renderFrame, as preview_frame does: a hash and how much is lit. */
  const render = (frame) => evaluate(`(async () => {
    const st = window.bayEngine.store.getState()
    const r = await window.bayEngine.renderFrame({ project: st.project, timelineId: st.project.activeTimelineId, frame: ${frame} })
    const img = new Image(); img.src = r.dataUrl; await img.decode()
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, c.width, c.height).data
    let lit = 0, hash = 5381
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) lit++
      hash = ((hash * 33) ^ (d[i] + d[i + 1] * 3 + d[i + 2] * 7)) >>> 0
    }
    return { lit: +(lit / (d.length / 4)).toFixed(4), hash, drawn: r.drawn, pending: r.pending, placeholders: r.placeholders }
  })()`, 90_000)

  // Every preview draw, recorded. Installed once; `window.__brfDraws` is reset per measurement.
  await evaluate(`(() => {
    const proto = window.bayEngine.Compositor.prototype
    if (!proto.__brfCasesWrapped) {
      const original = proto.drawFrame
      window.__brfCasesOriginal = original
      proto.drawFrame = function (...args) {
        const stats = original.apply(this, args)
        if (window.__brfDraws) window.__brfDraws.push({ at: performance.now(), frame: args[3], pending: stats.pendingNames.slice(), drawn: stats.drawn, placeholders: stats.placeholders })
        return stats
      }
      proto.__brfCasesWrapped = true
    }
    return true
  })()`)
  const unwrap = () => evaluate(`(() => { const p = window.bayEngine.Compositor.prototype; if (p.__brfCasesWrapped) { p.drawFrame = window.__brfCasesOriginal; delete p.__brfCasesWrapped } delete window.__brfDraws; return true })()`)

  const results = {}
  try {
    await clear()

    // -- 2.2 live playback ------------------------------------------------------------------------
    if (CASES.includes('playback')) {
      console.log('\n== 2.2 live playback')
      const placed = await evaluate(`(async () => {
        const { store } = window.bayEngine
        const [r] = await window.bay.media.importPaths([${JSON.stringify(CLIP)}])
        store.getState().addAssets([r.asset])
        return store.getState().placeAsset(r.asset.id, 0)
      })()`)
      if (!placed) throw new PreconditionError('could not place the video clip', CLIP)
      const play = (ms) => evaluate(`(async () => {
        const { engine, store } = window.bayEngine
        store.getState().setPlaying(false); store.getState().setPlayhead(0)
        await new Promise((r) => setTimeout(r, 1200))
        engine.clock.resetStats()
        window.__brfDraws = []
        const t0 = performance.now()
        store.getState().setPlaying(true)
        await new Promise((r) => setTimeout(r, ${ms}))
        store.getState().setPlaying(false)
        const s = engine.stats()
        const draws = window.__brfDraws.map((d) => ({ ...d, at: d.at - t0 })); window.__brfDraws = null
        return { pps: +s.picturesPerSecond.toFixed(1), p50: +s.compositeP50Ms.toFixed(2), p99: +s.compositeP99Ms.toFixed(2), skipped: s.skippedFrames, draws }
      })()`, 60_000)
      const base = await play(4000)
      console.log(`   video only:      ${base.pps} pictures/s · composite p50 ${base.p50} ms · p99 ${base.p99} ms · ${base.draws.length} draws`)

      const w = await call('write_brf', { code: example('Kinetic captions, back to back'), name: 'Kinetic captions', atFrame: 0 })
      verify('Kinetic captions written and placed', w.ok ? 'ok' : w.error, 'ok')
      const withBrf = await play(4000)
      const steady = withBrf.draws.filter((d) => d.at > 500)
      const blinks = steady.filter((d) => d.pending.includes('Kinetic captions'))
      const early = withBrf.draws.filter((d) => d.at <= 500 && d.pending.includes('Kinetic captions')).length
      console.log(`   video + .brf:    ${withBrf.pps} pictures/s · composite p50 ${withBrf.p50} ms · p99 ${withBrf.p99} ms · ${withBrf.draws.length} draws`)
      console.log(`   draws with the .brf pending: ${early} in the first 0.5 s, ${blinks.length} of ${steady.length} after it${blinks.length ? ' at ' + blinks.map((b) => Math.round(b.at) + 'ms/f' + b.frame).join(', ') : ''}`)
      // The control: the recorder does see the .brf pending — on a cold cache after a far seek.
      verify('pictures/s at the project fps (29-31.5, the rolling rate reads 30.9 without the .brf too) with the .brf', withBrf.pps, (v) => v >= 29 && v <= 31.5)
      verify('composite p99 rises by ≤ 2 ms over the same timeline without it', +(withBrf.p99 - base.p99).toFixed(2), (d) => d <= 2)
      verify('no blink of the graphic during steady playback (after the first 0.5 s)', blinks.length, 0)
      results.playback = { base, withBrf: { ...withBrf, draws: withBrf.draws.length }, early, blinks: blinks.length }

      // Scrub with the mouse across the ruler, over the clip's first 4 s.
      const ruler = await evaluate(`(() => {
        const s = window.bayEngine.store.getState()
        // The ruler by its own name. The smallest element reading "0:00" and "0:01" used to be
        // the ruler; the transport bar now shows 00:00:00:00 / 00:00:01:00 and is smaller.
        const ruler = document.querySelector('[aria-label="Playhead — drag to scrub"]')
        const r = ruler?.getBoundingClientRect()
        const labels = [...(ruler?.querySelectorAll('*') ?? [])].filter((e) => /^0:0[0-4]$/.test(e.textContent.trim())).map((e) => ({ t: e.textContent.trim(), x: e.getBoundingClientRect().left }))
        return r ? { left: r.left, top: r.top, width: r.width, height: r.height, labels } : null
      })()`)
      if (!ruler) throw new PreconditionError('could not find the timeline ruler', 'the DOM changed?')
      const x0 = ruler.labels.find((l) => l.t === '0:00')?.x ?? ruler.left + 10
      const x4 = ruler.labels.find((l) => l.t === '0:04')?.x ?? x0 + 400
      const y = ruler.top + ruler.height / 2
      // The control first: with the runtime's cache and workers dropped, a draw must report the
      // .brf pending — or "0 pending" below would also be what a recorder that cannot see it says.
      const control = await evaluate(`(async () => {
        const { store, brfRuntime } = window.bayEngine
        brfRuntime.dispose()
        window.__brfDraws = []
        store.getState().setPlayhead(90)
        await new Promise((r) => setTimeout(r, 800))
        const d = window.__brfDraws; window.__brfDraws = null
        return { pending: d.filter((x) => x.pending.includes('Kinetic captions')).length, draws: d.length, lastPending: d.at(-1)?.pending ?? null }
      })()`)
      console.log(`   control, cold runtime then seek: ${control.pending} of ${control.draws} draws had the .brf pending; the last had [${control.lastPending}]`)
      verify('the control: the recorder sees the .brf pending on a cold seek, then drawn', [control.pending > 0, control.lastPending?.length], [true, 0])
      await evaluate(`window.bayEngine.brfRuntime.dispose(); window.__brfDraws = []; window.__brfScrubT0 = performance.now(); true`)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0 + 2, y, button: 'left', clickCount: 1 })
      const t0 = Date.now()
      let dir = 1, x = x0 + 2
      while (Date.now() - t0 < 5000) {
        x += dir * (x4 - x0) / 60
        if (x >= x4 - 2 || x <= x0 + 2) dir = -dir
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 })
        await sleep(16)
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
      await sleep(700)
      const scrub = await evaluate(`(() => { const d = window.__brfDraws.map((x) => ({ ...x, at: x.at - window.__brfScrubT0 })); window.__brfDraws = null; return d })()`)
      const inCaption = scrub.filter((d) => d.frame < 120)
      const pend = inCaption.filter((d) => d.pending.includes('Kinetic captions'))
      let run = 0, longest = 0
      for (const d of inCaption) { run = d.pending.includes('Kinetic captions') ? run + 1 : 0; longest = Math.max(longest, run) }
      const frames = new Set(inCaption.map((d) => d.frame))
      if (process.env.DEBUG) console.log('   scrub frames', JSON.stringify([...new Set(scrub.map((d) => d.frame))]), 'x0', x0, 'x4', x4, 'y', y)
      const last = scrub.at(-1)
      console.log(`   scrub (cold runtime): ${scrub.length} draws over ${frames.size} distinct frames; .brf pending in ${pend.length} (longest run ${longest} draws); placeholders ${scrub.reduce((a, d) => a + d.placeholders, 0)}; last draw frame ${last?.frame} pending [${last?.pending}]`)
      verify('the scrub moved the playhead across the clip (instrument control)', Math.max(...frames) - Math.min(...frames), (n) => n >= 100)
      verify('scrubbing never draws a placeholder card', scrub.reduce((a, d) => a + d.placeholders, 0), 0)
      verify('after the scrub stops, the graphic is drawn (not pending)', last?.pending.includes('Kinetic captions') ?? true, false)
      results.scrub = { draws: scrub.length, frames: frames.size, pending: pend.length, longest }
      await clear()
    }

    // -- 2.4 undo / redo --------------------------------------------------------------------------
    if (CASES.includes('undo')) {
      console.log('\n== 2.4 undo / redo')
      const key = async (k, code, shift = false) => {
        const modifiers = 4 | (shift ? 8 : 0) // meta (+ shift)
        await evaluate(`document.activeElement && document.activeElement.blur && document.activeElement.blur(); true`)
        for (const type of ['rawKeyDown', 'keyUp']) {
          await send('Input.dispatchKeyEvent', { type, modifiers, key: k, code, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), commands: [] })
        }
        await sleep(400)
      }
      // Counted against what the pool already holds: the project the probe opened may have .brf
      // assets of its own, and "0 left" would be a literal about that project's history.
      const brfState = () => state(`({ assets: s.project.assets.filter((a) => a.kind === 'brf').map((a) => a.id), items: tl.tracks.flatMap((t) => t.items).length, past: s.past.length, future: s.future.length })`)
      const assetsBefore = (await brfState()).assets.length
      const counter = example('Counter with a growing bar')
      const p0 = await past()
      const w = await call('write_brf', { code: counter, name: 'Counter', atFrame: 0 })
      verify('create+place accepted', w.ok ? 'ok' : w.error, 'ok')
      const afterCreate = await brfState()
      const picCreated = await render(90)
      verify('create+place is one history entry', afterCreate.past - p0, 1)
      await key('z', 'KeyZ')
      const afterUndo = await brfState()
      const picUndone = await render(90)
      console.log(`   create ${JSON.stringify(afterCreate)} → Cmd+Z ${JSON.stringify(afterUndo)}; lit ${picCreated.lit} → ${picUndone.lit}`)
      verify('Cmd+Z removes the asset and the item (one entry back)', [afterUndo.assets.length - assetsBefore, afterUndo.items, afterCreate.past - afterUndo.past, afterUndo.assets.includes(w.value.assetId)], [0, 0, 1, false])
      verify('…and the picture with them', picUndone.lit < picCreated.lit / 4, true)
      await key('z', 'KeyZ', true)
      const afterRedo = await brfState()
      const picRedone = await render(90)
      verify('Cmd+Shift+Z brings both back, same picture', [afterRedo.assets.length - assetsBefore, afterRedo.items, afterRedo.assets.includes(w.value.assetId), picRedone.hash === picCreated.hash], [1, 1, true, true])

      const assetId = w.value.assetId
      const replaced = counter.replace("accent: '#FFB020'", "accent: '#3B82F6'").replace('value: 3200', 'value: 7')
      if (replaced === counter) throw new PreconditionError('the replacement did not change the source', 'the guide example changed')
      const pr = await past()
      const r = await call('write_brf', { code: replaced, assetId })
      verify('replace accepted', r.ok ? 'ok' : r.error, 'ok')
      const picReplaced = await render(90)
      verify('replace is one history entry and changes the picture', [(await past()) - pr, picReplaced.hash !== picCreated.hash], [1, true])
      await key('z', 'KeyZ')
      const src = await call('read_brf', { assetId })
      const picBack = await render(90)
      verify('undo of a replace restores the previous source and picture', [src.value?.code === counter, picBack.hash === picCreated.hash], [true, true])
      await key('z', 'KeyZ', true)
      const src2 = await call('read_brf', { assetId })
      verify('redo puts the replacement back', [src2.value?.code === replaced, (await render(90)).hash === picReplaced.hash], [true, true])
      await clear()
    }

    // -- 2.6 Inspector variables ------------------------------------------------------------------
    if (CASES.includes('variables')) {
      console.log('\n== 2.6 Inspector variables')
      const lower = example('Lower third, as components')
      const w = await call('write_brf', { code: lower, name: 'Lower third', atFrame: 0 })
      verify('Lower third placed', w.ok ? 'ok' : w.error, 'ok')
      const assetId = w.value.assetId
      const second = await evaluate(`window.bayEngine.store.getState().placeAsset(${JSON.stringify(assetId)}, 200)`)
      const itemIds = await state(`tl.tracks.flatMap((t) => t.items).filter((i) => i.assetId === ${JSON.stringify(assetId)}).map((i) => i.id)`)
      verify('two placements', itemIds.length, 2)
      await evaluate(`window.bayEngine.store.getState().select([${JSON.stringify(itemIds[0])}]); window.bayEngine.store.getState().setPlayhead(45); true`)
      // A .brf's variables are on the Inspector's Title tab (the tabbed Inspector shows one tab).
      verify('the Inspector shows the Title tab', await showInspector(evaluate, 'title'), true)
      await sleep(600)
      const fields = await evaluate(`(() => {
        const labels = [...document.querySelectorAll('label')].map((l) => ({ text: l.querySelector('span')?.textContent?.trim(), input: l.querySelector('input')?.type })).filter((l) => l.input)
        const colour = [...document.querySelectorAll('input[type=color]')].map((i) => i.getAttribute('aria-label'))
        return { labels, colour }
      })()`)
      console.log('   inspector fields:', JSON.stringify(fields))
      const hasText = (name) => fields.labels.some((l) => l.text?.toLowerCase() === name && l.input === 'text')
      verify('the Inspector shows name and role as text fields and accent as a colour well',
        [hasText('name'), hasText('role'), fields.colour.some((c) => /accent/i.test(c ?? ''))], [true, true, true])

      const canvasHash = `(() => { const c = document.querySelector('canvas'); const x = c.getContext('2d', { willReadFrequently: true }); const d = x.getImageData(0, 0, c.width, c.height).data; let h = 5381; for (let i = 0; i < d.length; i += 16) h = ((h * 33) ^ d[i] ^ (d[i+1] << 8)) >>> 0; return h })()`
      const typeInto = async (label, text) => {
        await evaluate(`(() => { const l = [...document.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent?.trim().toLowerCase() === ${JSON.stringify(label)} && l.querySelector('input[type=text]')); const i = l.querySelector('input'); i.focus(); i.select(); return true })()`)
        await send('Input.insertText', { text })
        await evaluate(`document.activeElement.blur(); true`)
      }
      const before = await evaluate(canvasHash)
      const pastBefore = await past()
      const current = await call('inspect_item', { itemId: itemIds[0] })
      const oldName = current.value?.variables?.name ?? 'Ada Lovelace'
      const newName = oldName === 'Jane Goodall' ? 'Dian Fossey' : 'Jane Goodall'
      await typeInto('name', newName)
      await sleep(200)
      const after = await evaluate(canvasHash)
      verify('typing a name changes the preview within ~200 ms', before !== after, true)
      verify('…as one undo step', (await past()) - pastBefore, 1)
      await typeInto('role', 'Primatologist')
      const ins = await call('inspect_item', { itemId: itemIds[0] })
      console.log('   inspect_item variables:', JSON.stringify(ins.value?.variables ?? ins))
      verify('inspect_item reports the overrides', [ins.value?.variables?.name, ins.value?.variables?.role], [newName, 'Primatologist'])

      // The colour: the native picker cannot be driven, so its hex field — typed, then Enter.
      const colourBefore = await evaluate(canvasHash)
      const pc = await past()
      const accentNow = (await call('inspect_item', { itemId: itemIds[0] })).value?.variables?.accent ?? '#11D1A0'
      const accentNext = accentNow.toUpperCase() === '#FF3366' ? '#3366FF' : '#FF3366'
      await evaluate(`(() => { const i = document.querySelector('input[aria-label="Accent hex"]'); i.focus(); i.select(); return true })()`)
      await send('Input.insertText', { text: accentNext })
      for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await sleep(300)
      const colourAfter = await evaluate(canvasHash)
      const insC = await call('inspect_item', { itemId: itemIds[0] })
      verify('the accent (hex field, Enter) is set, the preview changes, one undo step',
        [insC.value?.variables?.accent?.toUpperCase(), colourBefore !== colourAfter, (await past()) - pc], [accentNext, true, 1])

      // Two placements, one edit.
      await evaluate(`window.bayEngine.store.getState().select(${JSON.stringify(itemIds)}); true`)
      await sleep(400)
      const p2 = await past()
      await typeInto('name', 'Birutė Galdikas')
      const both = await Promise.all(itemIds.map((id) => call('inspect_item', { itemId: id })))
      verify('one edit across two placements: both change, one undo step',
        [both.map((b) => b.value?.variables?.name), (await past()) - p2], [['Birutė Galdikas', 'Birutė Galdikas'], 1])
      const refused = await call('edit_item', { itemId: itemIds[0], variables: { nope: 1 } })
      console.log('   edit_item { nope: 1 }:', refused.ok ? 'ACCEPTED' : refused.error)
      verify('an undeclared variable is refused naming the real ones', refused.ok ? 'accepted' : refused.error,
        (e) => /nope/.test(e) && /name/.test(e) && /role/.test(e) && /accent/.test(e))
      const legal = await call('edit_item', { itemId: itemIds[0], variables: { role: 'Ethologist' } })
      verify('the control: a declared variable is accepted', legal.ok ? 'ok' : legal.error, 'ok')
      void second
      await clear()
    }

    // -- 2.8 hostile and heavy --------------------------------------------------------------------
    if (CASES.includes('heavy')) {
      console.log('\n== 2.8 hostile and heavy')
      const responsive = async () => { const t = Date.now(); await evaluate('1 + 1', 5000); return Date.now() - t }
      const heap = async () => {
        // The page's JS heap, and the resident size of every process of this app (by its debugging
        // port's owner and that process's children: renderer, GPU, and the .brf workers' renderer).
        const js = await evaluate(`Math.round(performance.memory.usedJSHeapSize / 1e6)`)
        let rss = null
        try {
          const main = execFileSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')[0]
          const ps = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number))
          rss = Math.round(ps.filter(([pid, ppid]) => pid === +main || ppid === +main).reduce((a, [, , kb]) => a + kb, 0) / 1024)
        } catch {}
        return `js ${js} MB, app RSS ${rss} MB`
      }
      const runtime = () => evaluate(`window.bayEngine.brfRuntime.stats`)
      console.log('   memory at start:', await heap(), 'runtime', JSON.stringify(await runtime()))

      // A healthy clip that must keep drawing through the hostile ones.
      const bystander = await call('write_brf', { code: example('Counter with a growing bar'), name: 'Bystander', atFrame: 0 })
      verify('a bystander .brf placed', bystander.ok ? 'ok' : bystander.error, 'ok')
      const byPic = await render(90)

      let t = Date.now()
      const loop = await call('write_brf', { code: `for (;;) {}\nexport default () => <scene duration={1} />` })
      const loopMs = Date.now() - t
      console.log(`   for(;;) at top level: ${loopMs} ms → ${loop.ok ? 'ACCEPTED' : loop.error}`)
      verify('an endless loop is refused after ~3 s, saying so', [loop.ok, /longer than 3s/.test(loop.error ?? ''), loopMs < 10_000], [false, true, true])
      verify('…and the app answers at once afterwards', await responsive(), (ms) => ms < 1000)

      t = Date.now()
      const big = await call('write_brf', { code: `const a = new Array(3e8).fill(0)\nexport default () => <scene duration={1}><rect w={a.length % 7} h={1} fill="#fff" /></scene>` })
      const bigMs = Date.now() - t
      console.log(`   2 GB allocation: ${bigMs} ms → ${big.ok ? 'ACCEPTED' : big.error}`)
      verify('a 2 GB allocation is refused with an error', big.ok, false)
      verify('…the app answers at once', await responsive(), (ms) => ms < 1000)
      const byAfter = await render(90)
      verify('…and the bystander still draws the same picture', byAfter.hash === byPic.hash && byAfter.pending === 0, true)
      console.log('   memory after hostile:', await heap(), 'runtime', JSON.stringify(await runtime()))
      await clear()

      // 5,000 rects per frame, played.
      const many = `export default ({ t, width, height }) => (
  <scene duration={4}>
    {Array.from({ length: 5000 }, (_, i) => (
      <rect key={i} x={(i % 100) * width / 100 + 5 * Math.sin(t * 3 + i)} y={Math.floor(i / 100) * height / 50} w={width / 120} h={height / 60} fill={i % 2 ? '#3B82F6' : '#11D1A0'} />
    ))}
  </scene>
)`
      t = Date.now()
      const m = await call('write_brf', { code: many, name: '5000 rects', atFrame: 0 })
      console.log(`   5,000 rects: write_brf ${Date.now() - t} ms → ${m.ok ? 'ok' : m.error}`)
      verify('5,000 rects per frame is accepted', m.ok ? 'ok' : m.error, 'ok')
      const mPic = await render(30)
      verify('…and draws', mPic.lit > 0.2 && mPic.pending === 0, true)
      const mPlay = await evaluate(`(async () => {
        const { engine, store } = window.bayEngine
        store.getState().setPlayhead(0); await new Promise((r) => setTimeout(r, 1500))
        engine.clock.resetStats(); window.__brfDraws = []
        store.getState().setPlaying(true); await new Promise((r) => setTimeout(r, 3000)); store.getState().setPlaying(false)
        const s = engine.stats(); const d = window.__brfDraws; window.__brfDraws = null
        return { pps: +s.picturesPerSecond.toFixed(1), p50: +s.compositeP50Ms.toFixed(2), p99: +s.compositeP99Ms.toFixed(2), pendingDraws: d.filter((x) => x.pending.length).length, draws: d.length }
      })()`, 60_000)
      console.log(`   5,000 rects playing: ${mPlay.pps} pictures/s · composite p50 ${mPlay.p50} ms · p99 ${mPlay.p99} ms · ${mPlay.pendingDraws}/${mPlay.draws} draws pending`)
      results.rects = mPlay
      await clear()

      // 60 s at 60 fps: scrub anywhere, time to a drawn frame.
      const fpsBefore = await state('tl.fps')
      await evaluate(`window.bayEngine.store.getState().setFps(60); true`)
      verify('timeline at 60 fps', await state('tl.fps'), 60)
      const long = `import { interpolate } from 'bay'
export default ({ t }) => (
  <scene duration={60}>
    <rect x="50%" y="50%" w="80%" h="20%" fill="#111118" />
    <text x="50%" y="50%" size="8%" weight={900} fill="#fff">{t.toFixed(2)}</text>
    <rect x={interpolate(t, [0, 60], [100, 1820])} y="80%" w={40} h={40} fill="#FFB020" />
  </scene>
)`
      const l = await call('write_brf', { code: long, name: 'Sixty', atFrame: 0 })
      verify('a 60 s module at 60 fps is accepted', l.ok ? 'ok' : l.error, 'ok')
      const seeks = await evaluate(`(async () => {
        const { store } = window.bayEngine
        const out = []
        const frames = [3300, 120, 2710, 1805, 60, 3540, 900, 2222, 15, 3000]
        for (const f of frames) {
          window.__brfDraws = []
          const t0 = performance.now()
          store.getState().setPlayhead(f)
          let ms = null
          while (performance.now() - t0 < 3000) {
            await new Promise((r) => requestAnimationFrame(r))
            const hit = window.__brfDraws.find((d) => d.frame === f && !d.pending.includes('Sixty') && d.drawn > 0)
            if (hit) { ms = Math.round(hit.at - t0); break }
          }
          out.push({ f, ms })
        }
        window.__brfDraws = null
        return out
      })()`, 60_000)
      console.log('   60 s @ 60 fps, seek → drawn:', seeks.map((s) => `f${s.f} ${s.ms ?? 'never'}ms`).join(', '))
      verify('every seek draws the graphic within 0.5 s', seeks.filter((s) => s.ms === null || s.ms > 500).map((s) => s.f), [])
      const rt = await runtime()
      console.log('   runtime after the long module', JSON.stringify(rt), await heap())
      verify('the scene cache stays bounded (≤ 6000)', rt.scenes, (n) => n <= 6000)
      await clear()
      await evaluate(`window.bayEngine.store.getState().setFps(${fpsBefore}); true`)

      // Nine different modules on one frame.
      const nine = Array.from({ length: 9 }, (_, i) => `export default ({ t }) => (
  <scene duration={4}>
    <rect x="${6 + i * 11}%" y="${20 + (i % 3) * 25}%" w="8%" h="14%" fill="#${['FFB020', '3B82F6', '11D1A0', 'EF4B3C', 'A855F7', 'F97316', '22D3EE', 'E11D48', '84CC16'][i]}" rotate={t * ${30 + i}} />
  </scene>
)`)
      const errorsBefore = (await runtime()).errors
      const tracks = []
      for (let i = 0; i < 9; i++) {
        const tr = await call('add_track', { kind: 'video' })
        if (!tr.ok) throw new PreconditionError('could not add a track', tr.error)
        tracks.push(tr.value.trackId)
      }
      for (let i = 0; i < 9; i++) {
        const r = await call('write_brf', { code: nine[i], name: `Nine ${i + 1}`, atFrame: 0, trackId: tracks[i] })
        verify(`module ${i + 1} of 9 accepted`, r.ok ? 'ok' : r.error, 'ok')
      }
      const nineRender = await render(45)
      console.log(`   9 modules, renderFrame: drawn ${nineRender.drawn}, pending ${nineRender.pending}, placeholders ${nineRender.placeholders}`)
      // Live preview, playing: every module must draw, and none may end up in error.
      const ninePlay = await evaluate(`(async () => {
        const { engine, store } = window.bayEngine
        store.getState().setPlayhead(0); await new Promise((r) => setTimeout(r, 1000))
        window.__brfDraws = []
        store.getState().setPlaying(true); await new Promise((r) => setTimeout(r, 3500)); store.getState().setPlaying(false)
        store.getState().setPlayhead(45); await new Promise((r) => setTimeout(r, 4500))
        const d = window.__brfDraws; window.__brfDraws = null
        const last = d.at(-1)
        return { draws: d.length, pendingDraws: d.filter((x) => x.pending.length).length, placeholders: d.reduce((a, x) => a + x.placeholders, 0), last, rt: window.bayEngine.brfRuntime.stats }
      })()`, 60_000)
      console.log(`   9 modules, live: ${ninePlay.draws} draws, ${ninePlay.pendingDraws} with something pending, placeholders ${ninePlay.placeholders}; last draw drawn ${ninePlay.last?.drawn} pending [${ninePlay.last?.pending}] placeholders ${ninePlay.last?.placeholders}; runtime ${JSON.stringify(ninePlay.rt)}`)
      console.log('   memory with nine modules:', await heap())
      const settled = await render(45)
      verify('nine modules on one frame all draw (renderFrame, after playback)', [settled.drawn, settled.pending, settled.placeholders], [9, 0, 0])
      verify('…and none was marked failed by the eviction (runtime errors unchanged)', ninePlay.rt.errors - errorsBefore, 0)
      verify('…and the live preview ends with all nine drawn', [ninePlay.last?.drawn, ninePlay.last?.placeholders], [9, 0])
      await clear()
      // The added tracks go with the restore.

      // Math.random determinism, within a session (relaunch: brf-persist.mjs).
      const rnd = `export default ({ t }) => (
  <scene duration={2}>
    {Array.from({ length: 60 }, (_, i) => <ellipse key={i} x={Math.random() * 1920} y={Math.random() * 1080} w={20 + Math.random() * 60} h={20 + Math.random() * 60} fill={Math.random() > 0.5 ? '#FFB020' : '#3B82F6'} />)}
  </scene>
)`
      const rw = await call('write_brf', { code: rnd, name: 'Random', atFrame: 0 })
      verify('a Math.random module is accepted', rw.ok ? 'ok' : rw.error, 'ok')
      const a1 = await render(20), b1 = await render(40), a2 = await render(20)
      await evaluate(`window.bayEngine.brfRuntime.dispose(); true`) // cold runtime: a new worker
      const a3 = await render(20)
      console.log(`   Math.random: f20 ${a1.hash} / again ${a2.hash} / cold worker ${a3.hash}; f40 ${b1.hash}`)
      verify('the control: the module draws', a1.lit > 0.01, true)
      verify('same picture for the same frame, across renders and a fresh worker', [a1.hash === a2.hash, a1.hash === a3.hash], [true, true])
      await clear()
    }
  } finally {
    await unwrap()
  }

  console.log(`\n${checksPassed()} checks passed, ${failures.length} failed${failures.length ? ':\n  - ' + failures.join('\n  - ') : ''}`)
  return failures.length === 0
}, { timeoutMs: 900_000 })
