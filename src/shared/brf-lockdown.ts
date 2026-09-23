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
 * host's answer, or read the next request. The host's handler is installed first and the ways to
 * add another are removed.
 */

type Global = Record<string, unknown> & {
  Function: FunctionConstructor
  postMessage?: (message: unknown) => void
  addEventListener?: (type: string, listener: (event: { data: unknown }) => void) => void
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
  'close'
] as const

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
  if (onMessage && g.addEventListener) g.addEventListener('message', (event) => onMessage(event.data))

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
