/**
 * Is any item in the File menu dead?
 *
 * The menu is the one channel that runs main -> renderer, and it has to: the renderer owns
 * the project, so `project.save(project)` needs a project a menu item in main does not
 * have. The failure mode that justified the channel is silent — every item draws, every
 * item is enabled, and clicking does nothing, because nobody subscribed to
 * `app.onMenuCommand`. No unit test can see that; it needs the real menu bar.
 *
 * Two pieces of evidence per item, because they fail independently:
 *
 * - **The command reached the renderer.** The probe subscribes its own listener through the
 *   same preload bridge (`window.bay.app.onMenuCommand`) and records what arrives. This needs
 *   no window focus, so it cannot be fooled by a Space switch.
 * - **What the renderer did with it.** Export is renderer-side, so the modal in the DOM. Open /
 *   Save / Save As / Import end in a native dialog, and the dialog is identified **by its
 *   title** (`Open project`, `Save project`, `Import media`) in the window server's list
 *   (`CGWindowListCopyWindowInfo`, through JXA): a window of this pid with that title that is
 *   on screen, or whose window number did not exist before the click (the list spans every
 *   Space; "on screen" means the active one).
 *
 * Why not the AppleScript sheet count this used to read — it reported Import and Save As
 * dead on runs where they were live, and a different item on each run:
 *
 * 1. **Accessibility lists only windows on the active Space.** With another app full-screen
 *    (measured: the user's chat app), `count of windows` of bay is 0 until `set frontmost`
 *    finishes switching Spaces, which took longer than the 0.4 s the click waited. A sheet
 *    that was there read as "0". The window server's list does not depend on the Space.
 * 2. **The dismissing Escape was a global keystroke.** `key code 53` goes to whichever app is
 *    frontmost *when it lands*. When focus had moved back, it went to another app (a draft in
 *    the user's chat window), the sheet stayed, the next item's dialog queued behind it, and
 *    counts lagged by one item: an item was scored by its predecessor's sheet. Escape is now
 *    sent only after `frontmost` is re-checked in the same script, and the probe waits for the
 *    dialog to be gone before the next click — a precondition, not a hope.
 * 3. **Save on a project that has a file writes silently** — no dialog, by design. A freshly
 *    created project has a `filePath`, so Save's "no sheet" was correct behaviour. The probe
 *    clears `filePath` in the store for the Save check (so the first-save dialog must appear,
 *    and is cancelled — nothing is written), and the restore puts it back.
 *
 * Needs the menu bar, so it drives the GUI process by AppleScript: the pid listening on PORT.
 */

import { execFileSync } from 'node:child_process'
import { attach, PreconditionError, runProbe } from './cdp.mjs'

const PORT = Number(process.env.PORT ?? 9222)

const osa = (script, lang = 'AppleScript') => {
  try {
    return execFileSync('osascript', ['-l', lang, '-e', script], { encoding: 'utf8' }).trim() || 'ok'
  } catch (error) {
    return 'ERR ' + String(error.message).split('\n').slice(1, 2).join('').slice(0, 120)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * The pid that owns a menu bar — of THE app on PORT. Not "the first Electron with a menu bar":
 * with an isolated probe instance beside the user's, that once clicked File › Save As in another
 * agent's window. The process listening on the debugging port is the app's main process.
 */
const findGuiPid = () => {
  let pid = ''
  try {
    pid = execFileSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')[0] ?? ''
  } catch {
    return 'none'
  }
  if (!/^\d+$/.test(pid)) return 'none'
  const owns = osa(`tell application "System Events"
  try
    get name of menu bar item 1 of menu bar 1 of (first process whose unix id is ${pid})
    return "yes"
  end try
  return "no"
end tell`)
  return owns === 'yes' ? pid : 'none'
}

let guiPid = 'none'

/**
 * This pid's titled windows from the window server: `[number, title, onscreen]`. Unlike
 * Accessibility it lists windows on every Space — but "on screen" is still only the active
 * Space, so a dialog is recognised either by being on screen or by being a window number that
 * did not exist before the click (AppKit keeps a closed panel around off screen, same title).
 */
const windows = () => {
  const out = osa(`ObjC.import('CoreGraphics');
    const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0)));
    JSON.stringify(all.filter((w) => w.kCGWindowOwnerPID === ${guiPid} && w.kCGWindowName).map((w) => [w.kCGWindowNumber, w.kCGWindowName, Boolean(w.kCGWindowIsOnscreen)]))`, 'JavaScript')
  if (out.startsWith('ERR')) throw new PreconditionError(`cannot read the window list: ${out}`,
    'does this terminal have Screen Recording permission (window titles need it)?')
  return JSON.parse(out)
}
const onscreenTitles = () => windows().filter((w) => w[2]).map((w) => w[1])

/** Front the app and wait until it really is frontmost with its window listed, then click. */
const clickFile = (item) =>
  osa(`tell application "System Events" to tell (first process whose unix id is ${guiPid})
    set frontmost to true
    repeat 40 times
      if frontmost and (count of windows) > 0 then exit repeat
      delay 0.1
    end repeat
    click menu item "${item}" of menu 1 of menu bar item "File" of menu bar 1
  end tell`)

/**
 * Escape, but only into bay. Re-fronts, re-checks `frontmost` in the same script, and sends the
 * key only if it still holds — a global keystroke must never land in the user's other app.
 */
const escapeIntoApp = () =>
  osa(`tell application "System Events"
    tell (first process whose unix id is ${guiPid}) to set frontmost to true
    repeat 40 times
      if frontmost of (first process whose unix id is ${guiPid}) then exit repeat
      delay 0.1
    end repeat
    if frontmost of (first process whose unix id is ${guiPid}) then
      key code 53
      return "sent"
    end if
    return "not front"
  end tell`)

const waitFor = async (predicate, ms, every = 150) => {
  const end = Date.now() + ms
  for (;;) {
    const value = predicate()
    if (value) return value
    if (Date.now() > end) return null
    await sleep(every)
  }
}

/** Dismiss a dialog by title and PROVE it is gone, or refuse to go on. */
const front = () => osa(`tell application "System Events" to tell (first process whose unix id is ${guiPid})
    set frontmost to true
    repeat 40 times
      if frontmost then exit repeat
      delay 0.1
    end repeat
  end tell`)
const dismiss = async (title) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    // "On screen" means on the active Space, so bay's Space must be the active one before an
    // absence counts: otherwise a dialog on another Space reads as closed.
    front()
    await sleep(300)
    if (!onscreenTitles().includes(title)) return
    escapeIntoApp()
    if (await waitFor(() => !onscreenTitles().includes(title), 2000)) return
  }
  throw new PreconditionError(`the "${title}" dialog would not close`,
    'close it by hand; a dialog left open queues the next one behind it and scores the wrong item')
}

const DIALOGS = [
  ['Import Media…', 'file.import', 'Import media'],
  ['Open…', 'file.open', 'Open project'],
  ['Save', 'file.save', 'Save project'],
  ['Save As…', 'file.saveAs', 'Save project']
]

const { evaluate } = await attach(PORT)

await runProbe(async () => {
  guiPid = findGuiPid()
  if (guiPid === 'none' || guiPid.startsWith('ERR')) {
    throw new PreconditionError(`no app with a menu bar is listening on port ${PORT}`,
      'is the app running on that port, and does this terminal have Accessibility permission?')
  }
  console.log('gui pid', guiPid)
  const screen = await evaluate(`window.bayEngine.store.getState().screen`)
  if (screen !== 'editor') throw new PreconditionError(`the app is on "${screen}", not the editor`, 'Import and Save need a project open')

  // The renderer-side listener. Same bridge the app's own handler uses; removed in the restore
  // by the page going on without it (it only records), and cleared here first.
  await evaluate(`(() => {
    window.__bayMenuSeen = []
    if (!window.__bayMenuListening) {
      window.__bayMenuListening = true
      window.bay.app.onMenuCommand((c) => window.__bayMenuSeen.push(c.type === 'command' ? c.id : c.type))
    }
    return true
  })()`)
  const seen = () => evaluate(`window.__bayMenuSeen.slice()`)

  // No dialog of ours may be up before the first click.
  for (const title of new Set(DIALOGS.map((d) => d[2]))) await dismiss(title)

  const results = []

  // Export: renderer-side, the modal is the evidence.
  const closeModal = `(() => { const b = [...document.querySelectorAll('[role=dialog] button')]
    .find((x) => x.textContent.trim() === 'Close'); if (b) b.click(); return true })()`
  await evaluate(closeModal)
  await sleep(400)
  const dialogBefore = await evaluate(`!!document.querySelector('[role=dialog]')`)
  await evaluate(`window.__bayMenuSeen.length = 0`)
  clickFile('Export…')
  let modal = false
  for (let i = 0; i < 20 && !modal; i++) { await sleep(150); modal = await evaluate(`!!document.querySelector('[role=dialog]')`) }
  results.push({ item: 'Export…', got: (await seen()).join(','), evidence: `modal ${dialogBefore}→${modal}`, live: !dialogBefore && modal })
  await evaluate(closeModal)
  await sleep(600)

  for (const [item, command, title] of DIALOGS) {
    // Save with a file writes silently (by design): make this a first save so it must ask.
    if (command === 'file.save') {
      await evaluate(`(() => { const s = window.bayEngine.store; const p = s.getState().project
        const { filePath, ...rest } = p; s.setState({ project: rest }); return true })()`)
    }
    await evaluate(`window.__bayMenuSeen.length = 0`)
    const before = onscreenTitles().includes(title)
    if (before) throw new PreconditionError(`"${title}" was already on screen before clicking ${item}`, 'dismiss it first')
    const known = new Set(windows().filter((w) => w[1] === title).map((w) => w[0]))
    const clicked = clickFile(item)
    const shown = await waitFor(() => windows().some((w) => w[1] === title && (w[2] || !known.has(w[0]))), 6000)
    const got = (await seen()).join(',')
    results.push({ item, got, evidence: `dialog "${title}" ${shown ? 'on screen' : 'never appeared'}${clicked.startsWith('ERR') ? ' — click ' + clicked : ''}`,
      live: Boolean(shown) && got === command })
    await dismiss(title)
    await sleep(400)
  }

  for (const r of results) {
    console.log(`${r.live ? 'PASS' : 'FAIL'}  ${r.item.padEnd(14)} renderer got [${r.got}]  ${r.evidence}`)
  }
  const ok = results.every((r) => r.live)
  console.log(ok ? '\nPASS: every File item reached the renderer and did its job' : '\nFAIL: at least one File item is dead')

  if (process.env.VERIFY_PROBE === '1') {
    // Self-check against a build whose renderer does not subscribe to onMenuCommand (or with
    // the app's handler removed): the dialogs must not appear, and a pass here is the failure.
    console.log(ok ? 'SELF-CHECK FAILED: the probe cannot see a dead menu' : 'SELF-CHECK PASSED: the probe notices a dead menu')
    return !ok
  }
  return ok
})
