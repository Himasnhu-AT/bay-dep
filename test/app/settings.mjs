/**
 * The Settings dialog, in the running app, opened the way a person opens it.
 *
 * Checks the dialog against sources it does not draw from itself: the whisper rows against
 * `window.bay.whisper.status()` (what main finds on disk), the model list against the shared
 * catalog (`src/shared/whisper.ts`, imported here directly), and the switches against the store
 * and the localStorage keys they are remembered under.
 *
 * Never clicks Download (network), Delete (removes files) or Install (runs brew). The two switches
 * it flips are flipped back, and both localStorage keys are put back to exactly what they were —
 * including absent — whatever happens.
 */

import { attach, runProbe, check, PreconditionError } from './cdp.mjs'
import { WHISPER_MODELS, whisperFileName } from '../../src/shared/whisper.ts'

const { evaluate, send } = await attach()

const KEYS = ['bay.autoDownloadModels', 'bay.agentApproval']

await runProbe(async () => {
  const S = 'window.bayEngine.store.getState()'
  const frames = () => evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`)
  const DIALOG = `document.querySelector('[role="dialog"][aria-label="Preferences"]')`
  const saved = await evaluate(`(() => Object.fromEntries(${JSON.stringify(KEYS)}.map((k) => [k, localStorage.getItem(k)])))()`)
  const storeBefore = await evaluate(`(() => { const s = ${S}; return { auto: s.autoDownloadModels, approval: s.agentApproval } })()`)

  try {
    if ((await evaluate(`${S}.screen`)) !== 'editor') throw new PreconditionError('the editor is not showing')
    if (await evaluate(`${S}.settingsOpen`)) throw new PreconditionError('Settings is already open', 'close it first')

    console.log('\n── opening from the top bar')
    check('control: no Settings dialog before the click', await evaluate(`${DIALOG} === null`), true)
    const clicked = await evaluate(`(() => {
      const b = document.querySelector('header button[aria-label="Settings"]')
      if (!b) return false
      b.click(); return true
    })()`)
    check('the top bar has a Settings button, clicked', clicked, true)
    await frames()
    check('the dialog is open', await evaluate(`${DIALOG} !== null`), true)
    check('and the store says so', await evaluate(`${S}.settingsOpen`), true)
    // Preferences is paged; the store names the page to show, and the open dialog follows it.
    await evaluate(`(${S}.setSettingsOpen(true, 'transcription'), true)`)
    await frames()

    const headings = await evaluate(`[...${DIALOG}.querySelectorAll('h3')].map((h) => h.textContent.trim())`)
    check('it has a Transcription section', headings.includes('Transcription'), true)

    console.log('\n── whisper.cpp, against what main finds')
    const status = await evaluate(`window.bay.whisper.status(${S}.whisperModel)`)
    // The row resolves from "Checking…" once the dialog's own status call answers.
    const ENGINE_ROW = `(() => {
      const label = [...${DIALOG}.querySelectorAll('div')].find((d) => d.textContent.trim() === 'whisper.cpp' && d.children.length === 0)
      const row = label?.parentElement?.parentElement
      return row ? row.lastElementChild.textContent.trim() : null
    })()`
    let engineRow = null
    for (let i = 0; i < 40; i++) {
      engineRow = await evaluate(ENGINE_ROW)
      if (engineRow && engineRow !== 'Checking…') break
      await new Promise((r) => setTimeout(r, 100))
    }
    const expectedEngine = status.engine ? 'Installed' : status.brew ? /Install with Homebrew|Installing/ : /brew install whisper-cpp/
    console.log(`     main says: engine ${status.engine ?? 'none'}, brew ${status.brew ?? 'none'}`)
    check(`the whisper.cpp row reads ${expectedEngine}`, engineRow,
      (t) => typeof expectedEngine === 'string' ? t === expectedEngine : expectedEngine.test(t ?? ''))

    console.log('\n── the models, against the catalog and the disk')
    const installedFiles = new Set(status.installed.map((m) => m.file))
    const others = [...installedFiles].filter((f) => !WHISPER_MODELS.some((m) => whisperFileName(m.id) === f))
    const rows = await evaluate(`[...${DIALOG}.querySelectorAll('ul > li')].map((li) => ({
      label: li.querySelector('span.font-medium')?.textContent.trim(),
      buttons: [...li.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim())
    }))`)
    check(`${WHISPER_MODELS.length} catalog rows plus ${others.length} found elsewhere`, rows.length, WHISPER_MODELS.length + others.length)
    // Which of the two row states this machine can exercise. With both, a list that drew every
    // row the same way fails one side; with one, say so rather than imply the other was checked.
    const catalogInstalled = WHISPER_MODELS.filter((m) => installedFiles.has(whisperFileName(m.id))).length
    console.log(`     ${catalogInstalled} catalog model(s) installed, ${WHISPER_MODELS.length - catalogInstalled} not` +
      (catalogInstalled === 0 || catalogInstalled === WHISPER_MODELS.length ? ' — only one row state is exercised here' : ' — both row states exercised'))
    for (const [i, spec] of WHISPER_MODELS.entries()) {
      const row = rows[i]
      const installed = installedFiles.has(whisperFileName(spec.id))
      check(`row ${i + 1} is "${spec.label}" and shows ${installed ? 'Use/Chosen' : 'Download'}`,
        row, (r) => r?.label === spec.label && (installed
          ? r.buttons.some((b) => b === 'Use' || b === 'Chosen') && !r.buttons.includes('Download')
          : r.buttons.includes('Download')))
    }

    // A switch, clicked in the dialog, then clicked back: store, localStorage and aria-checked.
    const flip = async (label, storeKey, lsKey) => {
      const SWITCH = `${DIALOG}.querySelector('button[role="switch"][aria-label=${JSON.stringify(label)}]')`
      const read = () => evaluate(`(() => ({ aria: ${SWITCH}?.getAttribute('aria-checked') ?? null,
        store: ${S}.${storeKey}, ls: localStorage.getItem(${JSON.stringify(lsKey)}) }))()`)
      const start = await read()
      check(`"${label}" reflects the store`, start.aria, String(start.store))
      await evaluate(`(${SWITCH}.click(), true)`)
      await frames()
      const flipped = await read()
      check(`clicking it flips the store`, flipped.store, !start.store)
      check(`and the switch — the reading above can see a change`, flipped.aria, String(!start.store))
      check(`and remembers it in ${lsKey}`, flipped.ls, !start.store ? '1' : '0')
      await evaluate(`(${SWITCH}.click(), true)`)
      await frames()
      const back = await read()
      check(`clicking again puts the store back`, back.store, start.store)
      check(`and ${lsKey} follows`, back.ls, start.store ? '1' : '0')
    }

    console.log('\n── "Download models when needed"')
    await flip('Download models when needed', 'autoDownloadModels', 'bay.autoDownloadModels')
    console.log('\n── "Ask before editing"')
    await evaluate(`(${S}.setSettingsOpen(true, 'agent'), true)`)
    await frames()
    await flip('Ask before editing', 'agentApproval', 'bay.agentApproval')

    console.log('\n── Escape closes it')
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await frames()
    check('the store says closed', await evaluate(`${S}.settingsOpen`), false)
    check('and the dialog is gone', await evaluate(`${DIALOG} === null`), true)
    return true
  } finally {
    // Neither the store's autoDownloadModels nor settingsOpen is in runProbe's restore; put back
    // what this touched, and the keys exactly — a key that was absent is removed, not written.
    await evaluate(`(() => {
      const s = ${S}
      if (s.autoDownloadModels !== ${storeBefore.auto}) s.setAutoDownloadModels(${storeBefore.auto})
      if (s.agentApproval !== ${storeBefore.approval}) s.setAgentApproval(${storeBefore.approval})
      s.setSettingsOpen(false)
      for (const [k, v] of Object.entries(${JSON.stringify(saved)})) {
        if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v)
      }
      return true
    })()`)
    const now = await evaluate(`(() => Object.fromEntries(${JSON.stringify(KEYS)}.map((k) => [k, localStorage.getItem(k)])))()`)
    console.log(`[settings] localStorage put back: ${JSON.stringify(now)} (was ${JSON.stringify(saved)})`)
  }
})
