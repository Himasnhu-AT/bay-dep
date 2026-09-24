/**
 * The two lines a composition page needs before its own scripts run.
 *
 * The composition contract — the one bay publishes at `bay://guide/composition/contract` — says
 * a composition registers its timeline as `window.__timelines["<id>"] = tl`, and that it does
 * **not** need to create the registry first because the HyperFrames runtime makes one. bay
 * renders the page directly and loads no such runtime, so without this an agent that followed
 * bay's own documentation assigns into `undefined`, the assignment throws inside a page nobody
 * is watching, the timeline is never registered, and every frame of that clip comes back blank
 * with nothing to explain why.
 *
 * A preload rather than CDP. `Page.addScriptToEvaluateOnNewDocument` is the textbook hook for
 * "before page script, main world", and it was tried first — but `webContents.debugger` cannot
 * attach while the app is running under `--remote-debugging-port`, which is exactly how every
 * probe and every debugging session runs it. A mechanism that works in production and fails
 * under test is worse than one that does neither, because it is only ever exercised where
 * nobody is looking.
 *
 * This runs with `contextIsolation: false`, which is what puts it in the page's own world.
 * That is a narrow, deliberate trade: the composition window has `nodeIntegration: false` and a
 * session of its own, so the page cannot reach Node either way, and this file deliberately
 * exposes nothing but an empty object the page was already told to expect.
 */

declare global {
  interface Window {
    __timelines?: Record<string, unknown>
  }
}

window.__timelines = window.__timelines ?? {}

export {}
