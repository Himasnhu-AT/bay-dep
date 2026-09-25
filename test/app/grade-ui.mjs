/**
 * Does the inspector's Grade section render for a picture clip, offer an imported LUT, and write
 * the grade through the store? Selects a placed clip, reads the accessibility tree, commits the
 * LUT choice through the real <select>, and reads the item back. Needs MEDIA (grey.mp4) and
 * AB_SESSION (an agent-browser session attached to the same PORT). The harness undoes it all.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { attach, runProbe, showInspector } from './cdp.mjs'

const run = promisify(execFile)
const MEDIA = process.env.MEDIA
const SESSION = process.env.AB_SESSION
const PORT = process.env.PORT
if (!MEDIA || !SESSION || !PORT) throw new Error('set MEDIA, AB_SESSION and PORT')
const { evaluate, close } = await attach()
const ab = async (...args) => (await run('agent-browser', ['--session', SESSION, '--cdp', PORT, ...args])).stdout

await runProbe(async () => {
  const cube = join(MEDIA, 'ui-swap.cube')
  const rows = ['TITLE "UI swap"', 'LUT_3D_SIZE 2']
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${b} ${g} ${r}`)
  await writeFile(cube, rows.join('\n'))
  const mcp = (tool, args) => evaluate(`window.bayMcp.execute({ id: 'ui-' + Math.random(), tool: ${JSON.stringify(tool)}, args: ${JSON.stringify(args)} })`, 60_000)
  const imp = await mcp('import_media', { paths: [join(MEDIA, 'grey.mp4'), cube] })
  const placed = await mcp('place_asset', { assetId: imp.value.assets[0].id, atFrame: 0 })
  const itemId = placed.value.itemId
  await evaluate(`window.bayEngine.store.getState().select([${JSON.stringify(itemId)}])`)
  // The Grade section is on the Inspector's Color tab, on the Edit page (remembered per machine).
  const onTab = await showInspector(evaluate, 'color')
  console.log(`${onTab ? 'ok  ' : 'FAIL'}  the Edit page shows the Inspector's Color tab`)
  await new Promise((r) => setTimeout(r, 500))
  const tree = await ab('snapshot', '-i')
  const hasSection = /Temperature \(K\)/.test(tree) && /Halation/.test(tree) && /LUT/.test(tree)
  console.log(`${hasSection ? 'ok  ' : 'FAIL'}  the Grade section renders for a selected video clip`)
  const lutRef = /combobox "LUT" \[[^\]]*ref=(e\d+)\]/.exec(tree)?.[1]
  let wrote = false
  if (lutRef) {
    await ab('select', `@${lutRef}`, imp.value.assets[1].name)
    await new Promise((r) => setTimeout(r, 300))
    const grade = await evaluate(`(() => { const s = window.bayEngine.store.getState()
      for (const t of s.project.timelines) for (const tr of t.tracks) for (const i of tr.items) if (i.id === ${JSON.stringify(itemId)}) return i.grade ?? null
      return null })()`)
    wrote = grade?.lut?.assetId === imp.value.assets[1].id && grade.lut.intensity === 1
    console.log(`${wrote ? 'ok  ' : 'FAIL'}  choosing the LUT in the inspector writes grade.lut  — ${JSON.stringify(grade)}`)
  } else {
    console.log('FAIL  no LUT combobox in the tree:\n' + tree.split('\n').filter((l) => /LUT|Grade|Blend/.test(l)).join('\n'))
  }
  close()
  return onTab && hasSection && wrote
})
