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
 */

export const PROBE_FLAG = 'bay.debug'

export async function findRenderer(port, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
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
 * Connects, enables the probe surface, brings the window to front, and waits for the engine.
 * Returns `{ send, evaluate, close }`.
 */
export async function attach(port = Number(process.env.PORT ?? 9222)) {
  const cdp = socket(await findRenderer(port))
  await cdp.ready
  await cdp.send('Runtime.enable', {})
  await cdp.send('Page.enable', {})

  const evaluate = async (expression, timeout = 30_000) => {
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

  // The flag has to be set before the engine mounts, so a page without the probe handle gets the
  // flag and one reload. A page that already has it is left alone: this used to reload
  // unconditionally, so every probe run flashed the whole editor window — reported as "the
  // screen flickers every time the agent count goes up", because the probes also connect. It
  // was never the count, and never a tool call; a marker set in the page survived a tool call
  // and an agent-browser connect, and did not survive `attach()`.
  const ready = await evaluate(`Boolean(window.bayEngine) && localStorage.getItem(${JSON.stringify(PROBE_FLAG)}) === '1'`)
  if (!ready) {
    await evaluate(`localStorage.setItem(${JSON.stringify(PROBE_FLAG)}, '1')`)
    await cdp.send('Page.reload', {})
    await new Promise((r) => setTimeout(r, 2500))
  }
  await cdp.send('Page.bringToFront', {})
  await evaluate(`(async () => {
    for (let i = 0; i < 120; i++) {
      if (window.bayEngine) return true
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('window.bayEngine never appeared - is ${PROBE_FLAG} set and the build current?')
  })()`, 45_000)

  return { send: cdp.send, evaluate, close: cdp.close }
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
 * Wraps a probe body so an unmet precondition exits 2 rather than 1.
 *
 *   0  measured, and it is right
 *   1  measured, and it is wrong        <- a real finding about the code
 *   2  could not measure                <- a finding about the harness
 */
export async function runProbe(body, { timeoutMs = 120_000 } = {}) {
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
  try {
    const ok = await Promise.race([body(), watchdog])
    clearTimeout(timer)
    // `undefined` is not `false`. Several probes return `false` on purpose, so the exit code
    // genuinely has to come from this value — but a body that simply forgot the final
    // `return true` then prints "N/N checks passed" and exits 1, and a caller reading either
    // one alone gets the opposite answer. That contradiction is the same class as a mutation
    // that never applied: the fault is in the layer between the result and the report of it.
    // So an absent verdict is a setup failure, named, rather than a silent red.
    if (ok === undefined) {
      console.error('\nCANNOT MEASURE: the probe body returned undefined, so it has no verdict.')
      console.error('A probe must end with `return true`; `false` is reserved for a real failure.')
      process.exit(2)
    }
    process.exit(ok ? 0 : 1)
  } catch (error) {
    clearTimeout(timer)
    if (error instanceof PreconditionError) {
      console.error(`\nCANNOT MEASURE: ${error.message}`)
      console.error('This is a setup failure, not a fault in the code under test.')
      process.exit(2)
    }
    console.error(`\nPROBE ERROR: ${error.message}`)
    process.exit(2)
  }
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
  if (error instanceof PreconditionError) {
    console.error(`\nCANNOT MEASURE: ${error.message}`)
    console.error('This is a setup failure, not a fault in the code under test.')
  } else {
    console.error(`\nPROBE ERROR: ${error?.stack ?? error?.message ?? error}`)
    console.error('The probe itself failed; nothing was measured.')
  }
  process.exit(2)
}

process.on('uncaughtException', classifyAndExit)
process.on('unhandledRejection', classifyAndExit)
