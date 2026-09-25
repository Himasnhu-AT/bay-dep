/**
 * The shared half of every probe: find the renderer, talk to it, and fail loudly.
 *
 * Three things here are not incidental, and each one cost a wrong conclusion before it was
 * understood — see README.md.
 *
 * - **A closed socket rejects every pending call.** Without that, a crashed renderer leaves
 *   the promise unsettled, the event loop empties, and node exits 0. A dead app reported as
 *   a clean run is the worst outcome a measurement can have.
 * - **`bringToFront` before measuring anything.** An occluded window stops
 *   `requestAnimationFrame`, so the clock freezes and the preview never updates. It is
 *   indistinguishable from a dead engine.
 * - **The probe surface is opt-in.** `window.bayEngine` only exists when `bay.debug` is set
 *   in localStorage, so the flag goes in and the page reloads before the engine mounts — once.
 *   A page that already has the handle is not reloaded: an unconditional reload flashed the
 *   whole editor on every probe run.
 * - **A probe runs in the user's live app, and leaves it as it found it.** `attach()` snapshots
 *   the project, its undo history, the dirty flag, playhead, selection, the agent state and
 *   which screen was showing; `runProbe` puts all of it back in a `finally` — on a pass, a
 *   failure, a precondition that did not hold, the watchdog, and Ctrl-C. The restore goes
 *   through the store (`setState` with the very objects that were there before), so the
 *   user's Cmd+Z stack and their unsaved-changes flag end exactly as they began, and the
 *   project carries its own `filePath` again — Cmd+S can never write a probe's timeline over
 *   the user's file. Prototype patches made through `patch()` are undone in the same place.
 */

export const PROBE_FLAG = 'bay.debug'

const DEV_SERVER_ROOT = /^http:\/\/(localhost|127\.0\.0\.1):\d+\/(\?.*)?$/

export async function findRenderer(port, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      // The built app loads `…/renderer/index.html`; under `pnpm dev` the editor is the Vite dev
      // server's root, `http://localhost:5173/` (or the next free port), with no file name at all.
      const page = list.find((t) => t.type === 'page' && (t.url.includes('index.html') || DEV_SERVER_ROOT.test(t.url)))
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // The app is still starting; the debugging port refuses connections until it is up.
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new PreconditionError(
    `no renderer target on port ${port}`,
    'is the app built and running? it may have been killed by someone else'
  )
}

function socket(url) {
  const ws = new WebSocket(url)
  const pending = new Map()
  let id = 0
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  const abort = (error) => {
    for (const [, entry] of pending) entry.reject(error)
    pending.clear()
  }
  ws.addEventListener('close', () =>
    abort(new PreconditionError('the debugging socket closed', 'the renderer died')))
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })
  return {
    ready,
    /**
     * Every call is bounded. The close handler above covers a socket that died; it does not
     * cover a socket that is still open while the page behind it has stopped answering —
     * which is what a reload, a crashed renderer or a frozen compositor look like from here.
     * An unbounded call leaves its promise pending, the event loop empties, and Node exits
     * 13 with "unsettled top-level await": a status no caller interprets, and a message
     * naming the harness rather than the check. A rejection is a verdict; a hang is not.
     */
    send(method, params, timeoutMs = 30_000) {
      id += 1
      const mine = id
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(mine)
          // A harness failure, not a finding about the code: the page stopped answering.
          reject(new PreconditionError(`CDP ${method} did not answer within ${timeoutMs}ms`,
            'the renderer is gone, frozen, or mid-reload'))
        }, timeoutMs)
        pending.set(mine, {
          resolve: (value) => { clearTimeout(timer); resolve(value) },
          reject: (error) => { clearTimeout(timer); reject(error) }
        })
        ws.send(JSON.stringify({ id: mine, method, params }))
      })
    },
    close: () => ws.close()
  }
}

/**
 * The one connection this process has attached, and what it must put back.
 *
 * Module state rather than something each probe threads through, because the probes that most
 * need cleanup are the ones whose author did not think about it — the same reasoning as the
 * exit handlers at the bottom of this file.
 */
let session = null

/** Keys of the editor store a probe may move and must put back. Every `agent*` key joins them. */
const RESTORED_KEYS = ['project', 'past', 'future', 'dirty', 'playhead', 'selection', 'playing', 'panel', 'debugMode']
const APPROVAL_KEY = 'bay.agentApproval'

/**
 * Connects, enables the probe surface, brings the window to front, and waits for the engine.
 * Returns `{ send, evaluate, close, patch, reloaded, opened }`.
 *
 * - `reloaded` — whether this attach had to reload the page to switch the probe surface on.
 * - `opened` — `'editor'` if a project was already open, else what `open_project` opened.
 * - `patch(target, key, factory)` — replaces `target[key]` with `factory(original)` in the page
 *   and records the original, so the restore puts it back. Use it for every sabotage.
 * - `close()` — inside `runProbe` it only marks the socket for closing; the restore still needs
 *   it. Outside `runProbe` it restores, then closes, and must be awaited.
 */
export async function attach(port = Number(process.env.PORT ?? 9222)) {
  const cdp = socket(await findRenderer(port))
  await cdp.ready
  await cdp.send('Runtime.enable', {})
  await cdp.send('Page.enable', {})

  const evaluateOnce = async (expression, timeout) => {
    // Two bounds, deliberately: `timeout` is Chromium's cap on running the expression, and
    // the third argument is our cap on ever hearing back at all. The first cannot fire if
    // the page has stopped processing CDP messages, which is exactly the case that hangs.
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout
    }, timeout + 15_000)
    if (result.exceptionDetails) {
      throw new Error(
        result.result?.description ??
          result.exceptionDetails.exception?.description ??
          JSON.stringify(result.exceptionDetails)
      )
    }
    return result.result.value
  }

  /**
   * "Promise was collected" is Chromium saying the page garbage-collected the promise handle
   * CDP was awaiting — a fact about the debugging session, not about bay. It came back
   * intermittently from an awaited `importPaths` in `playback-probe.mjs`. It is retried exactly
   * once and nothing else is: any other error is a result. A retry re-runs the expression, so
   * a probe should keep a non-idempotent step (placing a clip) out of the same evaluate as the
   * awaited one — `importPaths` dedupes by path and is safe to repeat.
   */
  const evaluate = async (expression, timeout = 30_000) => {
    try {
      return await evaluateOnce(expression, timeout)
    } catch (error) {
      if (!/Promise was collected/.test(String(error?.message))) throw error
      console.error('[cdp] "Promise was collected" — the page dropped the handle; retrying once')
      return evaluateOnce(expression, timeout)
    }
  }

  // The flag has to be set before the engine mounts, so a page without the probe handle gets the
  // flag and one reload. A page that already has it is left alone: this used to reload
  // unconditionally, so every probe run flashed the whole editor window — reported as "the
  // screen flickers every time the agent count goes up", because the probes also connect. It
  // was never the count, and never a tool call; a marker set in the page survived a tool call
  // and an agent-browser connect, and did not survive `attach()`.
  const ready = await evaluate(`Boolean(window.bayEngine || window.bayMcp) && localStorage.getItem(${JSON.stringify(PROBE_FLAG)}) === '1'`)
  const reloaded = !ready
  if (!ready) {
    await evaluate(`localStorage.setItem(${JSON.stringify(PROBE_FLAG)}, '1')`)
    await cdp.send('Page.reload', {})
    await new Promise((r) => setTimeout(r, 2500))
  }
  await cdp.send('Page.bringToFront', {})

  // bay launches on its projects screen with no project open, and every probe measures a
  // project. `window.bayEngine` belongs to the editor, so it does not exist yet; the executor's
  // own probe handle does, and `list_projects` + `open_project` are exactly how an agent gets
  // past that screen — so the probes take the same road. Opens the most recently edited project;
  // probes that need a particular one still require it as a precondition.
  const opened = await evaluate(`(async () => {
    for (let i = 0; i < 120 && !window.bayMcp && !window.bayEngine; i++) await new Promise((r) => setTimeout(r, 250))
    if (window.bayEngine?.store.getState().screen === 'editor') return 'editor'
    const listed = await window.bayMcp.execute({ id: 'attach-list', tool: 'list_projects', args: {} })
    const latest = listed.ok ? listed.value.projects[0] : null
    if (!latest) return 'no projects'
    const opened = await window.bayMcp.execute({ id: 'attach-open', tool: 'open_project', args: { filePath: latest.filePath } })
    if (!opened.ok) throw new Error(opened.error)
    for (let i = 0; i < 120 && !window.bayEngine; i++) await new Promise((r) => setTimeout(r, 250))
    return 'opened ' + latest.name
  })()`, 45_000)
  await evaluate(`(async () => {
    for (let i = 0; i < 120; i++) {
      if (window.bayEngine) return true
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('window.bayEngine never appeared - is ${PROBE_FLAG} set and the build current?')
  })()`, 45_000)

  // The snapshot is held in the page by reference: the store never mutates a project in place
  // (`edit()` clones), so the objects captured here *are* the state as it stood, and putting
  // them back restores it exactly — undo stack included — at no serialisation cost. A JSON copy
  // of the project is kept here as well, for the one case the page copy cannot survive: a probe
  // that reloads the page.
  const snapshot = await evaluate(`(() => {
    const st = window.bayEngine.store.getState()
    const state = {}
    for (const [k, v] of Object.entries(st)) {
      if (typeof v === 'function') continue
      if (${JSON.stringify(RESTORED_KEYS)}.includes(k) || k.startsWith('agent')) state[k] = v
    }
    let approval = null
    try { approval = localStorage.getItem(${JSON.stringify(APPROVAL_KEY)}) } catch {}
    const leftover = !!window.__bayProbeSnapshot
    // The workspace page and the Inspector/Library tabs are remembered per machine, so they are
    // put back through their own setters (which write the remembered value), not by setState.
    const workspace = { page: st.page, inspectorTab: st.inspectorTab, libraryTab: st.libraryTab }
    window.__bayProbeSnapshot = { state, approval, workspace }
    window.__bayProbePatches = window.__bayProbePatches || []
    return { leftover, fingerprint: ${FINGERPRINT}, project: JSON.stringify(st.project),
             dirty: st.dirty, playhead: st.playhead }
  })()`, 60_000)
  if (snapshot.leftover) {
    console.error('[cdp] WARNING: an earlier probe left its snapshot behind (killed before it could restore?).')
    console.error('[cdp]          The state now open may be that probe\'s; check the project before trusting it.')
  }

  session = {
    evaluate,
    cdp,
    screenBefore: opened === 'editor' ? 'editor' : 'home',
    fingerprint: snapshot.fingerprint,
    projectJson: snapshot.project,
    dirty: snapshot.dirty,
    playhead: snapshot.playhead,
    restored: false,
    closeRequested: false,
    inRunProbe: false
  }

  const patch = (target, key, factory) => evaluate(`(() => {
    const target = ${target}
    const key = ${JSON.stringify(key)}
    const own = Object.prototype.hasOwnProperty.call(target, key)
    const original = target[key]
    ;(window.__bayProbePatches = window.__bayProbePatches || []).push({ target, key, own, original })
    target[key] = (${factory})(original)
    return true
  })()`)

  const close = async () => {
    if (session?.inRunProbe) {
      session.closeRequested = true
      return
    }
    await restoreSession()
    cdp.close()
  }

  return { send: cdp.send, evaluate, close, patch, reloaded, opened }
}

/**
 * Shows the Edit page with the Inspector on `tab` ('video' | 'audio' | 'effects' | 'color' | …).
 *
 * The Inspector is tabbed and the workspace page is remembered per machine, so a probe that
 * reads an Inspector section must ask for the page and tab it reads rather than assume the app
 * was left on them. `attach()` records both, and the restore puts them back.
 */
export async function showInspector(evaluate, tab) {
  return evaluate(`(async () => {
    const st = window.bayEngine.store
    if (st.getState().page !== 'edit') st.getState().setPage('edit')
    st.getState().setInspectorTab(${JSON.stringify(tab)})
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return st.getState().page === 'edit' && st.getState().inspectorTab === ${JSON.stringify(tab)}
  })()`)
}

/** What a restore is checked against: identity-free, so it also works after a JSON fallback. */
const FINGERPRINT = `(() => {
  const st = window.bayEngine.store.getState()
  const json = JSON.stringify(st.project)
  let h = 5381
  for (let i = 0; i < json.length; i++) h = ((h * 33) ^ json.charCodeAt(i)) >>> 0
  return { project: h, filePath: st.project.filePath ?? null, past: st.past.length,
           future: st.future.length, dirty: st.dirty, playhead: st.playhead,
           playing: st.playing, screen: st.screen, gate: st.agentGate === null ? null : 'set',
           approval: st.agentApproval }
})()`

/** Methods the probes are known to sabotage; after a restore each must be native again. */
const NATIVES = `(() => {
  const native = (f) => typeof f === 'function' && Function.prototype.toString.call(f).includes('[native code]')
  const out = {
    'CanvasRenderingContext2D.drawImage': native(CanvasRenderingContext2D.prototype.drawImage),
    'HTMLCanvasElement.toDataURL': native(HTMLCanvasElement.prototype.toDataURL),
    'AnalyserNode.connect': native(AnalyserNode.prototype.connect),
    'AnalyserNode.disconnect': native(AnalyserNode.prototype.disconnect)
  }
  return Object.entries(out).filter(([, ok]) => !ok).map(([name]) => name)
})()`

/**
 * Puts the live app back as `attach()` found it. Returns whether it managed to, and says so.
 *
 * Order matters: patches first (a sabotaged `drawImage` would otherwise paint the restored
 * frame wrong), then playback stopped through `setPlaying` so the engine releases its media,
 * then the store, then the approval setting, then the screen.
 */
async function restoreSession() {
  const s = session
  if (!s || s.restored) return true
  s.restored = true
  try {
    const result = await s.evaluate(`(() => {
      const patches = window.__bayProbePatches || []
      const undone = patches.length
      for (let i = patches.length - 1; i >= 0; i--) {
        const p = patches[i]
        if (p.own) p.target[p.key] = p.original
        else delete p.target[p.key]
      }
      window.__bayProbePatches = []
      const snap = window.__bayProbeSnapshot
      if (!window.bayEngine) return { undone, restored: false, reason: 'window.bayEngine is gone (the page reloaded or left the editor)' }
      const store = window.bayEngine.store
      store.getState().setPlaying(false)
      if (!snap) return { undone, restored: false, reason: 'the page lost its snapshot (it reloaded)' }
      const { playing, ...rest } = snap.state
      store.setState(rest)
      if (playing) store.getState().setPlaying(true)
      const ws = snap.workspace
      if (ws) {
        const now = store.getState()
        if (ws.page && now.page !== ws.page) now.setPage(ws.page)
        if (ws.inspectorTab && store.getState().inspectorTab !== ws.inspectorTab) store.getState().setInspectorTab(ws.inspectorTab)
        if (ws.libraryTab && store.getState().libraryTab !== ws.libraryTab) store.getState().setLibraryTab(ws.libraryTab)
      }
      try {
        if (snap.approval === null) localStorage.removeItem(${JSON.stringify(APPROVAL_KEY)})
        else localStorage.setItem(${JSON.stringify(APPROVAL_KEY)}, snap.approval)
      } catch {}
      delete window.__bayProbeSnapshot
      return { undone, restored: true, identical: store.getState().project === rest.project && store.getState().past === rest.past }
    })()`, 30_000)

    if (!result.restored) {
      // The page copy is gone. Put the project back from the JSON copy if the editor is up;
      // the undo history cannot come back that way, and the message says so.
      const fallback = result.reason.includes('snapshot') ? await s.evaluate(`(() => {
        const store = window.bayEngine.store
        store.setState({ project: JSON.parse(${JSON.stringify(s.projectJson)}), past: [], future: [],
                         dirty: ${JSON.stringify(s.dirty)}, playhead: ${JSON.stringify(s.playhead)}, selection: [] })
        return true
      })()`).catch(() => false) : false
      console.error(`[cdp] RESTORE INCOMPLETE: ${result.reason}.`)
      console.error(fallback
        ? '[cdp]   The project was put back from a JSON copy; its undo history could not be.'
        : '[cdp]   Nothing was saved, so the file on disk is untouched; the open project may carry the probe\'s edits.')
      return false
    }

    // Compared before leaving the editor, so a probe that started on the home screen is held to
    // the same check: the project `attach()` opened must be back as it was opened.
    const after = await s.evaluate(FINGERPRINT)
    if (s.screenBefore === 'home') {
      await s.evaluate(`(() => { window.bayEngine.store.getState().showHome(); return true })()`)
    }
    const unpatched = await s.evaluate(NATIVES)
    const differs = Object.keys(s.fingerprint).filter((k) => JSON.stringify(s.fingerprint[k]) !== JSON.stringify(after[k]))
    const fp = s.fingerprint
    if (differs.length || unpatched.length) {
      console.error(`[cdp] RESTORE INCOMPLETE: ${differs.length ? 'state differs in ' + differs.join(', ') : ''}` +
        `${unpatched.length ? ' still patched: ' + unpatched.join(', ') : ''}`)
      if (differs.length) console.error(`[cdp]   before ${JSON.stringify(fp)}\n[cdp]   after  ${JSON.stringify(after)}`)
      return false
    }
    console.log(`[cdp] restored: project ${fp.filePath ?? '(unsaved)'}, past ${fp.past} / future ${fp.future}, ` +
      `dirty ${fp.dirty}, playing ${fp.playing}${s.screenBefore === 'home' ? ', back on the home screen' : ''}; ` +
      `${result.undone} patch(es) undone, no known prototype left patched`)
    return true
  } catch (error) {
    console.error(`[cdp] RESTORE FAILED: ${error?.message ?? error}`)
    console.error('[cdp]   Nothing was saved, so the file on disk is untouched; the open project may carry the probe\'s edits.')
    return false
  }
}

/**
 * A per-band profile of the visible canvas.
 *
 * Bands with `%nonZero`, not a mean and not a point sample. A mean averages a dark region
 * into a lit one and hides both; a point sample lands wherever the footage happens to be
 * black and reports an empty canvas. Percent-non-zero per band is what distinguishes "the
 * clip is dark here" from "nothing was drawn here".
 */
export const CANVAS_PROFILE = `(() => {
  const c = document.querySelector('canvas')
  const x = c.getContext('2d', { willReadFrequently: true })
  const d = x.getImageData(0, 0, c.width, c.height).data
  const bands = []
  const BANDS = 20
  let lit = 0, minRow = -1, maxRow = -1, minCol = c.width, maxCol = -1
  for (let b = 0; b < BANDS; b++) {
    const y0 = Math.floor(c.height * b / BANDS), y1 = Math.floor(c.height * (b + 1) / BANDS)
    let nz = 0, n = 0, sum = 0, max = 0
    for (let y = y0; y < y1; y += 2) for (let px = 0; px < c.width; px += 4) {
      const i = (y * c.width + px) * 4
      const v = (d[i] * 299 + d[i+1] * 587 + d[i+2] * 114) / 1000
      n++; sum += v; if (v > max) max = v
      if (v > 0) { nz++; lit++; if (minRow < 0) minRow = y; maxRow = y
                   if (px < minCol) minCol = px; if (px > maxCol) maxCol = px }
    }
    bands.push({ band: b, yFrom: y0, mean: +(sum / n).toFixed(1), max: Math.round(max),
                 nonZero: +((nz / n) * 100).toFixed(1) })
  }
  return { size: [c.width, c.height], lit, rowExtent: [minRow, maxRow], colExtent: [minCol, maxCol], bands }
})()`


/**
 * Raised when a probe cannot get into a state where its measurement means anything.
 *
 * This is a separate type because "I could not measure this" and "I measured it and it is
 * wrong" are different results and must not share an exit code. A probe that reports a
 * setup failure as a fault accuses a subsystem that never ran — and that is worse than a
 * flake, because a flake only teaches people to re-run while a false accusation sends them
 * into code that was working.
 */
export class PreconditionError extends Error {
  constructor(label, detail) {
    super(detail ? `${label} (${detail})` : label)
    this.name = 'PreconditionError'
    this.label = label
  }
}

/**
 * Raised when a probe measured something and it is wrong: exit 1.
 *
 * This exists because the other two outcomes had classes and this one did not. Every probe's
 * `check()` threw a plain `Error`, and `runProbe` maps anything unclassified to exit 2 — so a
 * real assertion failure read "PROBE ERROR ... nothing was measured", which is the false
 * *acquittal*: the code was measured, it was wrong, and the report said the harness broke.
 * `node:assert`'s `AssertionError` is treated the same way, so `assert.equal` works too.
 */
export class ProbeFailure extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProbeFailure'
  }
}

const isFailure = (error) =>
  error instanceof ProbeFailure || error?.name === 'AssertionError' || error?.code === 'ERR_ASSERTION'

/**
 * The shared form of the `check()` every probe used to define for itself: `expected` is a value
 * compared with `===`, or a predicate. Throws `ProbeFailure`, so a miss exits 1.
 */
let passedChecks = 0
export function check(label, actual, expected) {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  if (!ok) throw new ProbeFailure(`${label}\n  got:      ${JSON.stringify(actual)}\n  expected: ${expected}`)
  passedChecks += 1
  console.log(`  ok  ${label}`)
}
export const checksPassed = () => passedChecks

/**
 * Polls `expression` until it returns truthy, or throws `PreconditionError`.
 *
 * Waiting on the condition rather than on a timer is the point. Every fixed sleep in a
 * probe is a guess about a cold start, and the guess is wrong on the machine that is busy
 * compiling something else.
 */
export async function requirePrecondition(evaluate, label, expression, { timeoutMs = 20_000, every = 250 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await evaluate(`(() => { try { return ${expression} } catch (e) { return 'threw: ' + e.message } })()`)
    if (last === true) return
    await new Promise((r) => setTimeout(r, every))
  }
  throw new PreconditionError(label, `still ${JSON.stringify(last)} after ${timeoutMs}ms`)
}

/**
 * Wraps a probe body: restores the app afterwards, and turns the outcome into an exit code.
 *
 *   0  measured, and it is right
 *   1  measured, and it is wrong        <- a real finding about the code
 *                                          (the body returned false, or threw ProbeFailure /
 *                                          an AssertionError)
 *   2  could not measure                <- a finding about the harness
 *                                          (PreconditionError, or anything else that escaped)
 *
 * The restore runs in a `finally`, before the exit, whatever the outcome. A restore that
 * fails turns a pass into exit 2 — a green run has to mean the user's app was left as found.
 */
/**
 * `PROBE_TIMEOUT_MS` raises every probe's watchdog. On a machine whose video decoder is busy with
 * something else (Photos' mediaanalysisd, another editor) a seek takes seconds instead of
 * milliseconds, and a probe that renders or plays media then runs out of time without anything
 * being broken — "too slow here" and "hung" are otherwise the same exit 2.
 */
const WATCHDOG_MS = Number(process.env.PROBE_TIMEOUT_MS) || 120_000

export async function runProbe(body, { timeoutMs = WATCHDOG_MS } = {}) {
  // The watchdog is not belt and braces; it is the difference between a verdict and exit 13.
  // A body whose promise never settles lets the event loop empty, and Node then reports
  // "unsettled top-level await" with a status no caller interprets and a message naming the
  // harness rather than the check. A timeout that rejects is still a verdict.
  let timer
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new PreconditionError('the probe did not finish', `no verdict after ${timeoutMs}ms`)),
      timeoutMs
    )
  })
  if (session) session.inRunProbe = true
  let code
  try {
    const ok = await Promise.race([body(), watchdog])
    // `undefined` is not `false`. Several probes return `false` on purpose, so the exit code
    // genuinely has to come from this value — but a body that simply forgot the final
    // `return true` then prints "N/N checks passed" and exits 1, and a caller reading either
    // one alone gets the opposite answer. That contradiction is the same class as a mutation
    // that never applied: the fault is in the layer between the result and the report of it.
    // So an absent verdict is a setup failure, named, rather than a silent red.
    if (ok === undefined) {
      console.error('\nCANNOT MEASURE: the probe body returned undefined, so it has no verdict.')
      console.error('A probe must end with `return true`; `false` is reserved for a real failure.')
      code = 2
    } else {
      code = ok ? 0 : 1
    }
  } catch (error) {
    code = report(error)
  } finally {
    clearTimeout(timer)
  }
  await finish(code)
}

/** Prints an escaped error under the label its class earns, and returns the exit code. */
function report(error) {
  if (error instanceof PreconditionError) {
    console.error(`\nCANNOT MEASURE: ${error.message}`)
    console.error('This is a setup failure, not a fault in the code under test.')
    return 2
  }
  if (isFailure(error)) {
    console.error(`\nFAIL: ${error.message}`)
    return 1
  }
  console.error(`\nPROBE ERROR: ${error?.stack ?? error?.message ?? error}`)
  console.error('The probe itself failed; nothing was measured.')
  return 2
}

let finishing = false
/** Restore, close, exit — once, whichever path gets here first. */
async function finish(code) {
  if (finishing) return
  finishing = true
  const clean = await restoreSession()
  session?.cdp.close()
  if (!clean && code === 0) {
    console.error('\nCLEANUP FAILED: the probe passed but could not put the app back as it found it.')
    process.exit(2)
  }
  process.exit(code)
}

/** The preconditions every canvas measurement depends on. */
export const CANVAS_READY = {
  sized: ['the preview canvas has been sized by the engine',
          `(() => { const c = document.querySelector('canvas')
             return !!c && !(c.width === 300 && c.height === 150) && c.width > 0 })()`],
  drawn: ['the engine has composited at least one frame',
          `window.bayEngine.engine.stats().samples > 0`],
  onTimeline: ['the timeline has an item under the playhead',
          `(() => { const st = window.bayEngine.store.getState()
             const tl = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
             return !!tl && tl.tracks.some(t => t.items.length > 0) })()`]
}


/**
 * The same three-outcome discipline, applied to failures that escape `runProbe`.
 *
 * Every probe here calls `attach()` at module top level, *outside* the wrapper — so a
 * connection failure was landing as an unhandled rejection and exiting **1**, which this
 * file defines as "measured, and it is wrong: a finding about the code". An app that
 * someone else killed was reading as a bug in the compositor. That is the false-accusation
 * class again, one level below where it was fixed last time.
 *
 * Installed at import rather than asked of each probe, because the probes that most need it
 * are the ones whose author did not think about it.
 */
function classifyAndExit(error) {
  // Still restores: a probe whose attach succeeded and whose top level then threw has edited
  // the user's project as surely as one that failed inside `runProbe`.
  finish(report(error))
}

process.on('uncaughtException', classifyAndExit)
process.on('unhandledRejection', classifyAndExit)

// Ctrl-C mid-probe used to leave its clip on the user's timeline and its sabotage in the page.
process.on('SIGINT', () => {
  console.error('\ninterrupted — restoring the app before exiting')
  finish(130)
})
