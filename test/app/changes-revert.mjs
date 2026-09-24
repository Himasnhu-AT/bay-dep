/**
 * The agent's diff-and-revert, in the running app, driven without a model.
 *
 * A turn is only the events the runtime would emit (`AgentEvent` in `src/shared/agent.ts`), and
 * an edit made through `window.bayMcp.execute` while a turn is running counts as the agent's
 * (the executor wraps every handler in `asAgent`). So this drives exactly what a real turn
 * does — `started`, a real tool call, `done` — and then reads the card the user would see:
 *
 *   - a turn that only reads leaves no card (the control: the card locator is then shown to see
 *     a card as soon as a write turn leaves one, so its silence here means something);
 *   - a write turn leaves one, whose line is derived from the item's own name and volumes;
 *   - clicking its Revert puts the pre-turn project back (JSON, ignoring `updatedAt`) and the
 *     card reads "Reverted"; the top bar's Undo brings the change back and Revert returns;
 *   - an edit the user made mid-turn (a store call outside any tool call) earns the card's note;
 *   - a different project id expires every card: "Can no longer be reverted", no Revert button.
 *
 * Everything is put back by `runProbe` (project, history, agent state, approval setting).
 */

import { attach, runProbe, check, PreconditionError } from './cdp.mjs'

const { evaluate } = await attach()

await runProbe(async () => {
  const S = 'window.bayEngine.store.getState()'
  let n = 0
  const call = (tool, args = {}) =>
    evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `cr${++n}`, tool, args })})`, 60_000)
  const act = (expr) => evaluate(`(() => { ${S}.${expr}; return true })()`)
  const frames = () => evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`)
  /** Project content without the timestamp every edit stamps. */
  const content = () => evaluate(`(() => { const { updatedAt, ...rest } = ${S}.project; return JSON.stringify(rest) })()`)

  // Every change card in the page, read the way a person reads it. Located by structure — a
  // heading row followed by the list of lines — so it finds a card whatever the heading says.
  const CARDS = `[...document.querySelectorAll('div')].filter((d) => {
      const head = d.firstElementChild
      return head && head.firstElementChild?.matches('span.font-medium') && d.querySelector(':scope > ul > li')
    }).map((d) => ({
      heading: d.firstElementChild.firstElementChild.textContent.trim(),
      lines: [...d.querySelectorAll(':scope > ul > li span:last-child')].map((s) => s.textContent.trim()),
      revert: [...d.querySelectorAll('button')].some((b) => /^Revert/.test(b.textContent.trim())),
      note: d.querySelector(':scope > p')?.textContent.trim() ?? null
    }))`
  const cards = () => evaluate(CARDS)
  const changesEntries = () => evaluate(`${S}.agentLog.filter((e) => e.kind === 'changes').length`)

  const pre = await evaluate(`(() => { const s = ${S}; return { screen: s.screen, running: s.agentRunning } })()`)
  if (pre.screen !== 'editor') throw new PreconditionError('the editor is not showing', `screen is ${pre.screen}`)
  if (pre.running) throw new PreconditionError('an agent turn is running in the app', 'wait for it to finish')

  // The clip to edit: the first on the active timeline, and what a card would call it.
  const target = await evaluate(`(() => {
    const s = ${S}
    const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId)
    const item = tl?.tracks.flatMap((t) => t.items)[0]
    if (!item) return null
    const asset = s.project.assets.find((a) => a.id === item.assetId)
    const name = !asset ? 'a clip' : asset.kind === 'text' ? '“' + (asset.text ?? asset.name) + '”' : '“' + asset.name + '”'
    return { itemId: item.id, volume: item.volume, name }
  })()`)
  if (!target) throw new PreconditionError('the open project has no clip to edit', 'open a project with one clip on its timeline')

  await act(`setPanel('agent')`)
  await act('setAgentApproval(false)') // the default: the agent edits and the card is the review
  await act('startAgentSession()')
  await frames()
  const cardsAtStart = (await cards()).length
  const entriesAtStart = await changesEntries()

  console.log('\n── control: a turn that only reads leaves no card')
  await act(`applyAgentEvent({ type: 'started', runId: 'probe-read' })`)
  check('read_project answers inside the turn', (await call('read_project')).ok, true)
  await act(`applyAgentEvent({ type: 'done', runId: 'probe-read', reason: 'complete' })`)
  await frames()
  check('no changes entry in the log', await changesEntries(), entriesAtStart)
  check('no card in the panel', (await cards()).length, cardsAtStart)

  console.log('\n── a turn that edits leaves a card')
  const before = await content()
  const nextVolume = target.volume === 0.5 ? 0.3 : 0.5
  const expectedLine = `Volume of ${target.name}: ${Math.round(target.volume * 100)}% → ${Math.round(nextVolume * 100)}%`
  await act(`applyAgentEvent({ type: 'started', runId: 'probe-edit' })`)
  const edited = await call('edit_item', { itemId: target.itemId, volume: nextVolume })
  check('edit_item answers ok inside the turn', edited.ok, true)
  await act(`applyAgentEvent({ type: 'done', runId: 'probe-edit', reason: 'complete' })`)
  await frames()
  const after = await content()
  check('the edit changed the project', after !== before, true)

  const entry = await evaluate(`${S}.agentLog.filter((e) => e.kind === 'changes').at(-1) ?? null`)
  check('one new changes entry', await changesEntries(), entriesAtStart + 1)
  check('it is applied', entry?.state, 'applied')
  check(`its only line is "${expectedLine}"`, JSON.stringify(entry?.lines.map((l) => l.text)), JSON.stringify([expectedLine]))
  check('and it carries no note (only the agent edited)', entry?.note ?? null, null)

  let shown = await cards()
  check('a card appeared in the panel — the locator the control relied on can see one', shown.length, cardsAtStart + 1)
  let card = shown.at(-1)
  check('the card lists the line', JSON.stringify(card.lines), JSON.stringify([expectedLine]))
  check('the card heading counts one change', card.heading, '1 change')
  check('the card offers Revert', card.revert, true)
  check('the card shows no note', card.note, null)

  console.log('\n── Revert, clicked on the card')
  const clicked = await evaluate(`(() => {
    const li = [...document.querySelectorAll('li')].filter((l) => l.textContent.includes(${JSON.stringify(expectedLine)})).at(-1)
    const button = [...(li?.closest('ul')?.parentElement.querySelectorAll('button') ?? [])].find((b) => /^Revert/.test(b.textContent.trim()))
    if (!button) return false
    button.click()
    return true
  })()`)
  if (!clicked) throw new PreconditionError('found the card but not its Revert button')
  await frames()
  check('the project content is back to before the turn', (await content()) === before, true)
  check('the entry reads reverted', await evaluate(`${S}.agentLog.find((e) => e.id === ${JSON.stringify(entry.id)}).state`), 'reverted')
  card = (await cards()).at(-1)
  check('the card reads "Reverted"', card.heading, 'Reverted')
  check('and offers no Revert', card.revert, false)

  console.log('\n── the top bar\'s Undo brings the change back')
  const undid = await evaluate(`(() => {
    const b = document.querySelector('button[aria-label="Undo"]')
    if (!b || b.disabled) return false
    b.click(); return true
  })()`)
  check('the Undo button is enabled and clicked', undid, true)
  await frames()
  check('the project content is the edited one again', (await content()) === after, true)
  check('the entry is applied again', await evaluate(`${S}.agentLog.find((e) => e.id === ${JSON.stringify(entry.id)}).state`), 'applied')
  card = (await cards()).at(-1)
  check('the card heading is "1 change" again', card.heading, '1 change')
  check('and Revert is back', card.revert, true)

  console.log('\n── a user edit made mid-turn is owned up to')
  const name = await evaluate(`${S}.project.name`)
  const volume2 = nextVolume === 0.5 ? 0.3 : 0.5
  await act(`applyAgentEvent({ type: 'started', runId: 'probe-mixed' })`)
  check('an agent edit inside the turn', (await call('edit_item', { itemId: target.itemId, volume: volume2 })).ok, true)
  await act(`renameProject(${JSON.stringify(name + ' (probe)')})`) // outside any tool call: the user's
  await act(`applyAgentEvent({ type: 'done', runId: 'probe-mixed', reason: 'complete' })`)
  await frames()
  const mixed = await evaluate(`${S}.agentLog.filter((e) => e.kind === 'changes').at(-1)`)
  check('the new entry names the rename among its lines', mixed.lines.map((l) => l.text).includes(`Renamed the project to “${name} (probe)”`), true)
  check('the entry carries the note', mixed.note ?? '', (t) => t.startsWith('Includes edits you made'))
  card = (await cards()).at(-1)
  check('the card shows "Includes edits you made…"', card.note ?? '', (t) => t.startsWith('Includes edits you made'))

  console.log('\n── another project: every card expires')
  const liveCards = (await cards()).filter((c) => c.revert).length
  check('before the switch, cards offer Revert', liveCards, (v) => v >= 2)
  await evaluate(`(() => {
    const s = ${S}
    // A clone under a new id and with no file, so nothing could ever save it over the user's.
    const clone = JSON.parse(JSON.stringify(s.project))
    clone.id = 'prj_probe_switched'
    delete clone.filePath
    s.setProject(clone)
    return true
  })()`)
  await frames()
  const expired = await cards()
  const probeCards = expired.slice(cardsAtStart)
  check('the store marks every probe entry expired',
    await evaluate(`${S}.agentLog.filter((e) => e.kind === 'changes').slice(${entriesAtStart}).every((e) => e.state === 'expired')`), true)
  check('every probe card reads "Can no longer be reverted"', probeCards.every((c) => c.heading === 'Can no longer be reverted') && probeCards.length === 2, true)
  check('and none offers Revert', probeCards.some((c) => c.revert), false)

  await act('endAgentSession()')
  return true
})
