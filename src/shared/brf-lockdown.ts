/**
 * What the `.brf` worker does to its own global before any user code runs.
 *
 * Measured, not assumed: a Worker the renderer starts from its own origin does **not** inherit
 * the page's Content-Security-Policy. Inside one, `new Function` ran and `fetch` to a remote
 * origin reached the network. It has no bridge to main and no `require`, so bay's privileged API
 * is out of reach — but "cannot touch bay" is not "cannot phone home", and a `.brf` sees project
 * text (its vars). Two layers close that:
 *
 * 1. **Here, in JS:** every network, code-loading and storage API is replaced by a non-configurable
 *    `undefined`, and every way to make new code — `eval`, `Function` and the constructors
 *    reachable from any function's prototype — throws. The loader keeps a private copy of
 *    `Function` taken before the lock; user code has no path to it. With code generation gone,
 *    the only `import()` a module can contain is one written literally in its source, and the
 *    compiler has already turned those into `require`, which answers only `bay` and `remotion`.
 * 2. **Outside JS, in main** (`src/main/offline.ts`): the app window's session cancels every remote
 *    request, so even an API this list does not know about has nowhere to go.
 *
 * The message channel is sealed too: user code could otherwise post a reply that looks like the
 * host's answer, or read the next request. The host's handler is installed first, the ways to
 * add another are removed, and it answers only trusted events — a `dispatchEvent`ed one is not.
 *
 * `setTimeout`/`setInterval` keep their function form and refuse a string, which the platform
 * would compile. The indirect doors of test.md §2.7 were each tried in the real worker; what was
 * found open is named where it is closed below, and `test/app/brf-sandbox.mjs` re-tries them all.
 */

type Global = Record<string, unknown> & {
  Function: FunctionConstructor
  postMessage?: (message: unknown) => void
  addEventListener?: (type: string, listener: (event: { data: unknown; isTrusted?: boolean }) => void) => void
}

/** Removed outright: every way out of the worker, and every way to load more code. */
export const REMOVED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebSocketStream',
  'EventSource',
  'WebTransport',
  'importScripts',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'indexedDB',
  'caches',
  'Request',
  'navigator',
  'onmessage',
  'postMessage',
  'addEventListener',
  'removeEventListener',
  'close',
  // Measured in the real worker, 2026-09-23: `new FontFace('x', 'url(https://…)')` added to
  // `self.fonts` issued a request that only main's session filter stopped. A font is a network
  // door like any other; `.brf` text names families the editor already has.
  'FontFace',
  'fonts',
  // Audited in a real worker after lockdown, 2026-09-28: `new OffscreenCanvas(…).getContext('webgl2')`
  // ran shaders, read pixels back and named the exact GPU (WEBGL_debug_renderer_info). Nothing
  // leaves through it, but it fingerprints the machine and can exhaust the GPU the editor's grade
  // context shares. A module's scene is JSON painted by the compositor; the worker draws nothing.
  'OffscreenCanvas',
  // The old sandboxed-filesystem API is exposed in Chromium workers: storage that outlives the
  // module, so a render could depend on what an earlier one wrote.
  'webkitRequestFileSystem',
  'webkitRequestFileSystemSync',
  'webkitResolveLocalFileSystemURL',
  'webkitResolveLocalFileSystemSyncURL'
] as const

/**
 * Take a callback — or a string, which the platform compiles as code. Measured in the real worker
 * before this existed: `setTimeout('globalThis.x = 1', 0)` ran, through the global and through
 * `WorkerGlobalScope.prototype`, and a generated `import()` inside the string would have got past
 * the compiler's source check. They stay (a function is harmless) but refuse anything that is not
 * one. `queueMicrotask`, `requestAnimationFrame` and `scheduler.postTask` already take only
 * functions — measured, they throw a TypeError on a string — so they are not wrapped.
 */
export const STRING_EVALUATING_TIMERS = ['setTimeout', 'setInterval'] as const

export interface Locked {
  /** The Function constructor, for the loader alone. */
  makeFunction: (...args: string[]) => (...args: unknown[]) => unknown
  /** Sends a message to the host. */
  post: (message: unknown) => void
}

/**
 * Locks `g` down. `onMessage` is installed as the one message handler before the ways to add
 * another are removed. Call once, first thing.
 */
export function lockdown(g: Global, onMessage?: (data: unknown) => void): Locked {
  const Fn = g.Function
  // The stand-in is made in `g`'s realm too: its own `.constructor` is then the locked one below.
  // Made here, in this module's realm, `blocked.constructor` would be a live Function from
  // another realm — which is exactly what the test caught.
  const blocked = new Fn("throw new Error('creating code at run time is not available in a .brf')")
  const post = g.postMessage?.bind(g) ?? (() => {})
  // Only a message the host sent. `dispatchEvent` (on `EventTarget.prototype`, which the worker's
  // own ports and streams need) could otherwise deliver a forged request to this very listener:
  // measured, a module that dispatched a synthetic `load` after it was accepted replaced itself
  // with code that had never been probed. A synthetic event is never trusted; the host's is.
  if (onMessage && g.addEventListener) {
    g.addEventListener('message', (event) => {
      if (event.isTrusted === true) onMessage(event.data)
    })
  }

  // On the global and on every prototype above it: in a real worker `fetch` lives on
  // `WorkerGlobalScope.prototype`, and shadowing it on `self` alone would leave
  // `Object.getPrototypeOf(self).fetch` one line away.
  for (let target: object | null = g; target && target !== Object.prototype; target = Object.getPrototypeOf(target)) {
    for (const name of REMOVED_GLOBALS) {
      if (target !== g && !Object.prototype.hasOwnProperty.call(target, name)) continue
      try {
        Object.defineProperty(target, name, { value: undefined, writable: false, configurable: false })
      } catch {
        // Non-configurable already; not ours to replace, and main's session filter stands behind it.
      }
    }
  }

  // Timers keep their function form and lose their string form, at every level they are found.
  // The wrapper is made in `g`'s realm (like `blocked`) and holds `Reflect.apply` taken now, so
  // user code that later replaces `Function.prototype.call` or `Reflect.apply` cannot catch the
  // original timer passing through.
  const guardTimer = new Fn(
    'original',
    'self',
    'apply',
    'name',
    'return function (handler, ...rest) {' +
      "  if (typeof handler !== 'function') throw new TypeError(name + ' takes a function in a .brf: a string would be compiled as code, and a .brf cannot create code at run time');" +
      '  return apply(original, self, [handler, ...rest])' +
      '}'
  ) as (original: unknown, self: unknown, apply: unknown, name: string) => unknown
  const apply = (g.Reflect as typeof Reflect).apply
  for (let target: object | null = g; target && target !== Object.prototype; target = Object.getPrototypeOf(target)) {
    for (const name of STRING_EVALUATING_TIMERS) {
      const own = Object.getOwnPropertyDescriptor(target, name)
      if (typeof own?.value !== 'function') continue
      // No catch: a timer that cannot be wrapped still compiles strings, and a worker that cannot
      // be locked must fail to start rather than run user code with the door open.
      Object.defineProperty(target, name, { value: guardTimer(own.value, g, apply, name), writable: false, configurable: false })
    }
  }

  // Every function constructor, through every door: the global names, and `.constructor` on the
  // prototypes that `(async () => {}).constructor` and friends walk to.
  // Taken from `g`'s own realm (through its Function, before the lock), not from this module's
  // function literals — the same thing in a worker, and the right thing in a test's sandbox.
  const prototypes = new Fn(
    'return [Function.prototype, Object.getPrototypeOf(async function () {}), ' +
      'Object.getPrototypeOf(function* () {}), Object.getPrototypeOf(async function* () {})]'
  )() as object[]
  for (const proto of prototypes) {
    Object.defineProperty(proto, 'constructor', { value: blocked, writable: false, configurable: false })
  }
  Object.defineProperty(g, 'Function', { value: blocked, writable: false, configurable: false })
  Object.defineProperty(g, 'eval', { value: blocked, writable: false, configurable: false })

  return { makeFunction: (...args) => new Fn(...args) as (...args: unknown[]) => unknown, post }
}
