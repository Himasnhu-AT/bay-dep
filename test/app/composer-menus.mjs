/**
 * The agent composer's `/` and `@` menus, driven with real key input and never sent.
 *
 * Text goes in through CDP's `Input.insertText` and the arrows through `Input.dispatchKeyEvent`,
 * so React sees the same events typing produces. Enter is the one key sent differently: in this
 * composer Enter with no menu open **sends the message**, which starts a paid agent turn. So
 * Enter is dispatched from inside the page in the same task that checks the menu is open — there
 * is no gap between the check and the key in which the menu could close.
 *
 * The menu is found through the textarea's own `aria-controls`, never by `[role=listbox]`, which
 * also matches every timeline track (docs/testing.md). Expectations come from sources the menu
 * does not draw from: the skill list from `src/shared/skills.ts`, the pin list from the project in
 * the store. The composer's draft is put back to what it was, and the pins by `runProbe`.
 */

import { attach, runProbe, check, PreconditionError } from './cdp.mjs'
import { BAY_SKILLS } from '../../src/shared/skills.ts'

const { evaluate, send } = await attach()

await runProbe(async () => {
  const S = 'window.bayEngine.store.getState()'
  const frames = () => evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`)
  const BOX = `document.querySelector('textarea[aria-label="Message the agent"]')`
  const MENU = `(() => { const id = ${BOX}?.getAttribute('aria-controls'); return id ? document.getElementById(id) : null })()`
  const setDraft = (text) => evaluate(`(() => {
    const box = ${BOX}
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(text)})
    box.dispatchEvent(new Event('input', { bubbles: true }))
    box.focus()
    box.setSelectionRange(box.value.length, box.value.length)
    return true
  })()`)
  const type = async (text) => {
    await evaluate(`(${BOX}.focus(), true)`)
    await send('Input.insertText', { text })
    await frames()
  }
  const key = async (name, code) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code })
    await frames()
  }
  const menu = () => evaluate(`(() => {
    const box = ${BOX}, m = ${MENU}
    const options = m ? [...m.querySelectorAll('[role="option"]')] : []
    const r = m?.getBoundingClientRect()
    return {
      expanded: box.getAttribute('aria-expanded'),
      label: m?.getAttribute('aria-label') ?? null,
      options: options.map((o) => o.querySelector('span > span')?.textContent.trim()),
      active: options.findIndex((o) => o.getAttribute('aria-selected') === 'true'),
      activedescendant: box.getAttribute('aria-activedescendant'),
      ids: options.map((o) => o.id),
      overflows: m ? m.scrollHeight > m.clientHeight + 1 : false,
      // Whether each option is wholly inside the menu's visible box.
      visible: options.map((o) => { const b = o.getBoundingClientRect(); return b.top >= r.top - 0.5 && b.bottom <= r.bottom + 0.5 })
    }
  })()`)

  if ((await evaluate(`${S}.screen`)) !== 'editor') throw new PreconditionError('the editor is not showing')
  if (await evaluate(`${S}.agentRunning`)) throw new PreconditionError('an agent turn is running', 'the composer would offer Stop, and this must not touch it')
  await evaluate(`(() => { ${S}.setPanel('agent'); return true })()`)
  await frames()
  if (!(await evaluate(`${BOX} !== null`))) throw new PreconditionError('the agent panel has no composer')
  const draftBefore = await evaluate(`${BOX}.value`)

  try {
    await setDraft('')
    check('control: the empty composer has no menu open', (await menu()).expanded, 'false')

    console.log('\n── "/" opens the commands and skills')
    await type('/')
    let m = await menu()
    check('the textarea says expanded', m.expanded, 'true')
    check('the menu is the composer\'s own ("Commands and skills")', m.label, 'Commands and skills')
    const expected = ['New conversation', ...BAY_SKILLS.map((s) => `/${s.slug}`)]
    check(`it lists New conversation and the ${BAY_SKILLS.length} skills, in order`, JSON.stringify(m.options), JSON.stringify(expected))
    check('the first row is highlighted', m.active, 0)
    check('and is the active descendant', m.activedescendant, m.ids[0])

    await key('ArrowDown', 40)
    m = await menu()
    check('ArrowDown moves the highlight to the second row', m.active, 1)
    check('and the active descendant with it', m.activedescendant, m.ids[1])

    console.log('\n── the highlight is kept in view')
    if (!m.overflows) throw new PreconditionError('the skills menu does not overflow here', 'nothing to scroll; the scroll check would be vacuous')
    const last = m.options.length - 1
    check('control: the last row starts out of view, so the visibility reading can see "hidden"', m.visible[last], false)
    await key('ArrowUp', 38)
    await key('ArrowUp', 38) // 1 → 0 → wraps to the last
    m = await menu()
    check('ArrowUp past the top wraps to the last row', m.active, last)
    check('and the last row has been scrolled into view', m.visible[last], true)
    check('which took the first row out of view', m.visible[0], false)
    await key('ArrowDown', 40) // wraps back to the first
    m = await menu()
    check('ArrowDown past the bottom wraps to the first row, back in view', m.active === 0 && m.visible[0], true)

    console.log('\n── Enter inserts the highlighted skill')
    await key('ArrowDown', 40)
    m = await menu()
    const chosen = m.options[m.active]
    check('the highlighted row is a skill', chosen, (label) => typeof label === 'string' && label.startsWith('/'))
    const pressed = await evaluate(`(() => {
      const box = ${BOX}
      // Enter with no menu open sends the message: refuse to press it unless the menu is open now.
      if (box.getAttribute('aria-expanded') !== 'true') return false
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
      return true
    })()`)
    if (!pressed) throw new PreconditionError('the menu closed before Enter could be pressed safely')
    await frames()
    const after = await evaluate(`(() => { const b = ${BOX}; return { value: b.value, caret: b.selectionStart, expanded: b.getAttribute('aria-expanded') } })()`)
    check(`the draft is "${chosen} "`, after.value, `${chosen} `)
    check('the caret sits after it', after.caret, after.value.length)
    check('and the menu closed', after.expanded, 'false')
    check('nothing was sent', await evaluate(`${S}.agentRunning || ${S}.agentLog.some((e) => e.kind === 'user' && e.text.includes(${JSON.stringify(chosen)}))`), false)

    console.log('\n── "@" opens the pin menu with the project\'s clips and assets')
    await evaluate(`(() => { ${S}.select([]); return true })()`) // no "Selection" row: the list is then just the project
    await setDraft('')
    await type('@')
    m = await menu()
    check('the textarea says expanded', m.expanded, 'true')
    check('the menu is "Pin to this conversation"', m.label, 'Pin to this conversation')
    const pinExpected = await evaluate(`(() => {
      const p = ${S}.project
      const tl = p.timelines.find((t) => t.id === p.activeTimelineId)
      const name = (item) => { const a = p.assets.find((x) => x.id === item.assetId)
        return a?.kind === 'text' ? '“' + (a.text ?? a.name) + '”' : a?.name ?? item.id }
      const clips = (tl?.tracks ?? []).flatMap((t) => t.items.map(name))
      return ['Time range…', ...[...clips, ...p.assets.map((a) => a.name)].slice(0, 12)]
    })()`)
    check('the project has something to pin (else this proves nothing)', pinExpected.length, (n) => n > 1)
    check(`it lists ${JSON.stringify(pinExpected)}`, JSON.stringify(m.options), JSON.stringify(pinExpected))

    await key('Escape', 27)
    m = await menu()
    check('Escape closes it', m.expanded, 'false')
    check('and the menu is gone from the page', m.label, null)
    check('leaving the typed "@" alone', await evaluate(`${BOX}.value`), '@')
    return true
  } finally {
    await setDraft(draftBefore).catch(() => {})
    await evaluate(`(() => { ${S}.clearAgentPins(); return true })()`).catch(() => {})
  }
})
