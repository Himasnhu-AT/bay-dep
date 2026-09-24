/**
 * The projects screen, reached and left the way a person does it.
 *
 *   - With unsaved changes, "All projects" asks "Save changes before leaving?"; Cancel keeps the
 *     editor. **Save is never clicked** — it would write the probe's edit over the user's file.
 *   - With none, it goes straight to the projects screen, whose recents list the open project.
 *   - The search filters: a string no project name contains shows "No project matches", and
 *     Clear search brings the card back (the card being there first is what makes its absence
 *     mean something).
 *   - Clicking the card opens the project again, in the editor.
 *
 * `window.bayEngine` belongs to the editor and is deleted on the projects screen, so the store is
 * held through a reference taken while it existed. If anything fails while the projects screen is
 * showing, the `finally` puts the snapshot project back in the editor so `runProbe` can restore.
 */

import { attach, runProbe, check, PreconditionError } from './cdp.mjs'

const { evaluate, send } = await attach()

await runProbe(async () => {
  const S = 'window.__probeStore.getState()'
  const frames = () => evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`)
  const until = async (label, expr, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs
    let last
    while (Date.now() < deadline) {
      last = await evaluate(`(() => { try { return ${expr} } catch (e) { return 'threw: ' + e.message } })()`)
      if (last === true) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return last
  }
  const click = (selector) => evaluate(`(() => {
    const b = document.querySelector(${JSON.stringify(selector)})
    if (!b || b.disabled) return false
    b.click(); return true
  })()`)
  const DIALOG = `document.querySelector('[role="dialog"][aria-label="Save changes before leaving?"]')`

  await evaluate(`(window.__probeStore = window.bayEngine.store, true)`)
  const start = await evaluate(`(() => { const s = ${S}; return { screen: s.screen, name: s.project.name,
    filePath: s.project.filePath ?? null, dirty: s.dirty } })()`)
  if (start.screen !== 'editor') throw new PreconditionError('the editor is not showing')
  if (!start.filePath) throw new PreconditionError('the open project has never been saved', 'it would not be in the recents list')
  if (start.dirty) throw new PreconditionError('the open project has unsaved changes', 'this probe needs to start clean so it can leave without a Save dialog')
  const CARD = `document.querySelector('button[title=${JSON.stringify(start.filePath)}]')`

  try {
    console.log('\n── unsaved changes: leaving asks first')
    check('control: no leave dialog before anything is clicked', await evaluate(`${DIALOG} === null`), true)
    await evaluate(`(() => { ${S}.renameProject(${JSON.stringify(start.name + ' (probe)')}); return true })()`)
    check('a store edit makes the project dirty', await evaluate(`${S}.dirty`), true)
    check('"All projects" is clicked', await click('button[aria-label="All projects"]'), true)
    await frames()
    check('"Save changes before leaving?" appears', await evaluate(`${DIALOG} !== null`), true)
    check('naming the project', await evaluate(`${DIALOG}.textContent`), (t) => t.includes(`${start.name} (probe)`))
    const cancelled = await evaluate(`(() => {
      const b = [...${DIALOG}.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Cancel')
      if (!b) return false
      b.click(); return true
    })()`)
    check('its Cancel button is clicked (never Save)', cancelled, true)
    await frames()
    check('the dialog closed', await evaluate(`${DIALOG} === null`), true)
    check('and the editor is still showing', await evaluate(`${S}.screen`), 'editor')
    check('with the edit still there', await evaluate(`${S}.project.name`), `${start.name} (probe)`)

    // Undo takes the edit away but leaves `dirty` set — the store does not track a save point.
    // Reported rather than asserted; the flag is then put back to how it was at attach, which is
    // not a save (nothing is written).
    await evaluate(`(() => { ${S}.undo(); return true })()`)
    check('undo takes the rename away', await evaluate(`${S}.project.name`), start.name)
    console.log(`     after undo, dirty is ${await evaluate(`${S}.dirty`)} (the store keeps no save point)`)
    await evaluate(`(() => { window.__probeStore.setState({ dirty: false }); return true })()`)

    console.log('\n── no unsaved changes: straight to the projects screen')
    check('"All projects" is clicked', await click('button[aria-label="All projects"]'), true)
    check('the store is on the projects screen', await until('home', `${S}.screen === 'home'`), true)
    check('with no dialog on the way', await evaluate(`${DIALOG} === null`), true)
    check(`the recents list has "${start.name}" (its card, by file path)`,
      await until('card', `${CARD}?.textContent.includes(${JSON.stringify(start.name)}) === true`), true)

    console.log('\n── the search')
    const miss = await evaluate(`(() => {
      const names = [...document.querySelectorAll('button[title]')].map((b) => b.textContent.toLowerCase())
      let q = 'zq-no-such-project'
      while (names.some((n) => n.includes(q))) q += '-x'
      return q
    })()`)
    await evaluate(`(document.querySelector('input[aria-label="Search projects"]').focus(), true)`)
    await send('Input.insertText', { text: miss })
    await frames()
    check('the field holds the query', await evaluate(`document.querySelector('input[aria-label="Search projects"]').value`), miss)
    check(`"No project matches “${miss}”." is shown`, await evaluate(`document.body.textContent.includes(${JSON.stringify(`No project matches “${miss}”.`)})`), true)
    check('and the card is gone', await evaluate(`${CARD} === null`), true)
    check('Clear search is clicked', await click('button[aria-label="Clear search"]'), true)
    await frames()
    check('the field is empty', await evaluate(`document.querySelector('input[aria-label="Search projects"]').value`), '')
    check('the card is back', await evaluate(`${CARD} !== null`), true)
    check('and the no-match line is gone', await evaluate(`document.body.textContent.includes('No project matches')`), false)

    console.log('\n── the card opens the project')
    check('the card is clicked', await evaluate(`(${CARD}.click(), true)`), true)
    check('the editor is showing again', await until('editor', `${S}.screen === 'editor' && !!window.bayEngine`, 20_000), true)
    check(`on "${start.name}"`, await evaluate(`${S}.project.name`), start.name)
    check('from its file', await evaluate(`${S}.project.filePath`), start.filePath)
    return true
  } finally {
    // runProbe restores through window.bayEngine, which only exists in the editor.
    await evaluate(`(async () => {
      const st = window.__probeStore
      const dialog = document.querySelector('[role="dialog"][aria-label="Save changes before leaving?"]')
      if (dialog) [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel')?.click()
      if (st.getState().screen !== 'editor') st.getState().enterProject(window.__bayProbeSnapshot.state.project)
      for (let i = 0; i < 80 && !window.bayEngine; i++) await new Promise((r) => setTimeout(r, 250))
      delete window.__probeStore
      return true
    })()`, 30_000).catch((e) => console.error(`[projects-home] could not return to the editor: ${e.message}`))
  }
})
