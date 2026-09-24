/**
 * test.md §2.3 — a `.brf` survives save, reopen and a full relaunch — and the relaunch half of
 * §2.8's `Math.random` determinism.
 *
 *   PORT=9273 PHASE=write  node test/app/brf-persist.mjs   # creates + saves a scratch project
 *   (quit bay completely, launch it again)
 *   PORT=9273 PHASE=verify node test/app/brf-persist.mjs   # reopens it after the relaunch
 *
 * `write` creates a NEW project through `project.create()` (a scratch `.bay` under ~/Movies/bay,
 * never a fixture), writes the guide's Lower third with a placement override and a
 * `Math.random` module, saves it, and records `renderFrame` hashes at three frames of each and
 * `read_brf`'s source in RECORD (a JSON file). Then it goes home, reopens the file through
 * `open_project`, and compares. `verify` opens the same file in the relaunched app and compares
 * again, reads the `.bay` text (a plain `brfCode` string, `kind: "brf"`), and deletes the scratch
 * file unless KEEP=1. The user's own project is restored by `runProbe` either way.
 *
 * The control for "identical": the override changes the picture (a hash that ignored the
 * variables would also be stable), shown before anything is saved.
 */

import { readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { attach, check, PreconditionError, runProbe } from './cdp.mjs'

const PORT = Number(process.env.PORT ?? 9222)
const PHASE = process.env.PHASE ?? 'write'
const RECORD = process.env.RECORD ?? join(tmpdir(), `bay-brf-persist-${PORT}.json`)
const FRAMES = [10, 45, 100]

const guide = readFileSync(resolve('src/main/mcp/docs/brf.md'), 'utf8')
const example = (title) => /```tsx\n([\s\S]*?)```/.exec(guide.slice(guide.indexOf(`### ${title}`)))[1]
const RANDOM = `export default ({ t }) => (
  <scene duration={4}>
    {Array.from({ length: 60 }, (_, i) => <ellipse key={i} x={Math.random() * 1920} y={Math.random() * 1080} w={20 + Math.random() * 60} h={20 + Math.random() * 60} fill={Math.random() > 0.5 ? '#FFB020' : '#3B82F6'} opacity={0.5 + 0.5 * Math.sin(t)} />)}
  </scene>
)`

const { evaluate } = await attach(PORT)

await runProbe(async () => {
  let seq = 0
  const call = (tool, args = {}) => evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `p${++seq}`, tool, args })})`, 120_000)
  /** Hash of one layer rendered alone: every other item hidden by a filtered project copy. */
  const render = (frame, onlyItem) => evaluate(`(async () => {
    const st = window.bayEngine.store.getState()
    const only = ${JSON.stringify(onlyItem ?? null)}
    const project = only ? { ...st.project, timelines: st.project.timelines.map((tl) => ({ ...tl, tracks: tl.tracks.map((t) => ({ ...t, items: t.items.filter((i) => i.id === only) })) })) } : st.project
    const r = await window.bayEngine.renderFrame({ project, timelineId: st.project.activeTimelineId, frame: ${frame} })
    const img = new Image(); img.src = r.dataUrl; await img.decode()
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, c.width, c.height).data
    let lit = 0, hash = 5381
    for (let i = 0; i < d.length; i += 4) { if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) lit++; hash = ((hash * 33) ^ (d[i] + d[i + 1] * 3 + d[i + 2] * 7)) >>> 0 }
    return { hash, lit: lit / (d.length / 4), pending: r.pending, placeholders: r.placeholders }
  })()`, 90_000)
  const snapshot = async (rec) => {
    const out = {}
    for (const [key, itemId] of Object.entries(rec.items)) out[key] = await Promise.all(FRAMES.map((f) => render(f, itemId)))
    return out
  }
  const compare = (label, rec, now) => {
    for (const key of Object.keys(rec.items)) {
      const was = rec.hashes[key].map((h) => h.hash), is = now[key].map((h) => h.hash)
      check(`${label}: ${key} draws identically at frames ${FRAMES.join('/')}`, JSON.stringify(is), JSON.stringify(was))
    }
  }
  const openFile = async (filePath) => {
    const r = await call('open_project', { filePath })
    if (!r.ok) throw new PreconditionError(`could not open ${filePath}`, r.error)
    for (let i = 0; i < 40 && (await evaluate(`window.bayEngine?.store.getState().project.filePath ?? null`)) !== filePath; i++) await new Promise((r) => setTimeout(r, 250))
  }

  if (PHASE === 'write') {
    const created = await evaluate(`window.bay.project.create().then((p) => { window.bayEngine.store.getState().setProject(p); return p.filePath })`)
    console.log('scratch project:', created)
    const lower = await call('write_brf', { code: example('Lower third, as components'), name: 'Lower third', atFrame: 0 })
    const random = await call('write_brf', { code: RANDOM, name: 'Random', atFrame: 0 })
    check('both modules written and placed', [lower.ok, random.ok].join(), 'true,true')
    const items = await evaluate(`(() => { const s = window.bayEngine.store.getState(); const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId)
      const by = (id) => tl.tracks.flatMap((t) => t.items).find((i) => i.assetId === id)?.id
      return { lower: by(${JSON.stringify(lower.value.assetId)}), random: by(${JSON.stringify(random.value.assetId)}) } })()`)
    const plain = await render(45, items.lower)
    const o = await call('edit_item', { itemId: items.lower, variables: { name: 'Jane Goodall', accent: '#FF3366' } })
    check('placement override accepted', o.ok ? 'ok' : o.error, 'ok')
    const overridden = await render(45, items.lower)
    check('the control: the override changes the picture', plain.hash !== overridden.hash && overridden.lit > 0.001, true)
    const rec = {
      filePath: created, items, assets: { lower: lower.value.assetId, random: random.value.assetId },
      source: { lower: (await call('read_brf', { assetId: lower.value.assetId })).value.code, random: (await call('read_brf', { assetId: random.value.assetId })).value.code }
    }
    rec.hashes = await snapshot(rec)
    const saved = await evaluate(`window.bay.project.save(window.bayEngine.store.getState().project).then((r) => r.filePath)`)
    check('saved to the scratch file', saved, created)
    writeFileSync(RECORD, JSON.stringify(rec, null, 2))

    // Close it (home), reopen it from disk.
    await evaluate(`window.bayEngine.store.getState().showHome(); true`)
    await openFile(created)
    const reopened = await snapshot(rec)
    compare('after reopen', rec, reopened)
    const ins = await call('inspect_item', { itemId: items.lower })
    check('after reopen: the override is kept', JSON.stringify(ins.value?.variables), JSON.stringify({ name: 'Jane Goodall', accent: '#FF3366' }))
    for (const k of ['lower', 'random']) {
      check(`after reopen: read_brf returns byte-identical source (${k})`, (await call('read_brf', { assetId: rec.assets[k] })).value.code === rec.source[k], true)
    }
    console.log(`\nrecord: ${RECORD}\nnow quit bay completely, relaunch it, and run PHASE=verify`)
    return true
  }

  if (!existsSync(RECORD)) throw new PreconditionError(`no record at ${RECORD}`, 'run PHASE=write first')
  const rec = JSON.parse(readFileSync(RECORD, 'utf8'))
  await openFile(rec.filePath)
  const now = await snapshot(rec)
  compare('after relaunch', rec, now)
  const ins = await call('inspect_item', { itemId: rec.items.lower })
  check('after relaunch: the override is kept', JSON.stringify(ins.value?.variables), JSON.stringify({ name: 'Jane Goodall', accent: '#FF3366' }))
  for (const k of ['lower', 'random']) {
    check(`after relaunch: read_brf returns byte-identical source (${k})`, (await call('read_brf', { assetId: rec.assets[k] })).value.code === rec.source[k], true)
  }
  const doc = JSON.parse(readFileSync(rec.filePath, 'utf8'))
  const brfs = doc.assets.filter((a) => a.brfCode !== undefined)
  check('the .bay holds each module as a plain string brfCode with kind "brf"',
    JSON.stringify(brfs.map((a) => [a.kind, typeof a.brfCode, a.brfCode === rec.source[a.id === rec.assets.lower ? 'lower' : 'random']])),
    JSON.stringify([['brf', 'string', true], ['brf', 'string', true]]))
  if (process.env.KEEP !== '1') { rmSync(rec.filePath, { force: true }); rmSync(RECORD, { force: true }); console.log('deleted', rec.filePath) }
  return true
})
