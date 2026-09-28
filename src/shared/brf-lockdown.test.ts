import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { lockdown } from './brf-lockdown'

type Realm = { context: vm.Context; g: Record<string, unknown> & { Function: FunctionConstructor } }

/**
 * A worker-shaped global in its own realm: network and messaging on a prototype, as
 * `WorkerGlobalScope.prototype` holds them, so the chain walk is what is being tested.
 */
function workerRealm(): Realm {
  const context = vm.createContext({})
  vm.runInContext(
    `const scope = {
       fetch() { return 'reached the network' },
       XMLHttpRequest: function () {},
       importScripts() { return 'loaded' },
       postMessage(m) { globalThis.__sent.push(m) },
       addEventListener(type, listener) { globalThis.__listeners.push(listener) },
       // The platform's timers: a function is called, a string is compiled. Called at once here,
       // so what happened is readable on the next line.
       setTimeout(handler, ms, ...args) {
         if (typeof handler === 'function') { handler(...args); return 'called' }
         globalThis.__compiled.push(String(handler))
         return 'compiled'
       },
       setInterval(handler, ms, ...args) {
         if (typeof handler === 'function') { handler(...args); return 'called' }
         globalThis.__compiled.push(String(handler))
         return 'compiled'
       },
       FontFace: function () {},
       OffscreenCanvas: function () { this.getContext = () => ({ getParameter: () => 'the GPU' }) },
       fonts: { add() { return 'queued a font request' } },
       webkitRequestFileSystem() { return 'a filesystem' }
     }
     globalThis.__compiled = []
     globalThis.__sent = []
     globalThis.__listeners = []
     Object.setPrototypeOf(globalThis, scope)`,
    context
  )
  // The realm's own global carries its builtins; the context object seen from outside does not.
  return { context, g: vm.runInContext('globalThis', context) }
}

const run = (realm: Realm, code: string): unknown => vm.runInContext(code, realm.context)
const attempt = (realm: Realm, code: string): string => {
  try {
    return `ran: ${String(run(realm, code))}`
  } catch (error) {
    return `threw: ${(error as Error).message}`
  }
}

test('the positive control: before the lock, every door is open', () => {
  const realm = workerRealm()
  assert.equal(run(realm, 'fetch()'), 'reached the network')
  assert.equal(run(realm, 'Object.getPrototypeOf(globalThis).fetch()'), 'reached the network')
  assert.equal(run(realm, '(function () {}).constructor("return 7")()'), 7)
  assert.equal(run(realm, 'eval("1 + 1")'), 2)
  assert.equal(run(realm, 'setTimeout("x = 1", 0)'), 'compiled')
  assert.equal(run(realm, 'Object.getPrototypeOf(globalThis).setInterval("x = 1", 0)'), 'compiled')
  assert.equal(run(realm, 'typeof FontFace + typeof fonts + typeof webkitRequestFileSystem'), 'functionobjectfunction')
  assert.equal(run(realm, 'new OffscreenCanvas(1, 1).getContext("webgl2").getParameter(0)'), 'the GPU')
})

test('after the lock the network and code loading are gone, on the global and its prototype', () => {
  const realm = workerRealm()
  lockdown(realm.g)
  for (const code of ['fetch', 'Object.getPrototypeOf(globalThis).fetch', 'XMLHttpRequest', 'importScripts', 'postMessage', 'addEventListener']) {
    assert.equal(run(realm, `typeof ${code}`), 'undefined', code)
  }
  assert.match(attempt(realm, 'fetch("https://example.com")'), /threw/)
})

test('after the lock no door makes new code — and the loader keeps its own', () => {
  const realm = workerRealm()
  const { makeFunction } = lockdown(realm.g)
  for (const code of [
    'eval("1 + 1")',
    'Function("return 1")()',
    '(function () {}).constructor("return 1")()',
    '(async function () {}).constructor("return 1")',
    '(function* () {}).constructor("return 1")',
    '(async function* () {}).constructor("return 1")',
    '(() => 0).constructor.constructor("return globalThis")()'
  ]) {
    assert.match(attempt(realm, code), /threw: creating code at run time is not available/, code)
  }
  assert.equal(makeFunction('a', 'return a * 2')(21), 42)
})

test('the host handler is installed before the channel is sealed, and replies still go out', () => {
  const realm = workerRealm()
  const received: unknown[] = []
  const { post } = lockdown(realm.g, (data) => received.push(data))
  const listeners = run(realm, '__listeners') as ((e: { data: unknown; isTrusted?: boolean }) => void)[]
  assert.equal(listeners.length, 1)
  listeners[0]!({ data: 'load', isTrusted: true })
  assert.deepEqual(received, ['load'])
  post('scene')
  assert.deepEqual(JSON.parse(String(run(realm, 'JSON.stringify(__sent)'))), ['scene'])
  assert.equal(run(realm, 'typeof addEventListener'), 'undefined', 'user code cannot add a second listener')
})

test('timers refuse a string, through the global and the prototype — and still take a function', () => {
  const realm = workerRealm()
  lockdown(realm.g)
  for (const code of [
    'setTimeout("globalThis.opened = 1", 0)',
    'setInterval("globalThis.opened = 1", 0)',
    'Object.getPrototypeOf(globalThis).setTimeout("globalThis.opened = 1", 0)',
    'Object.getOwnPropertyDescriptor(Object.getPrototypeOf(globalThis), "setInterval").value.call(globalThis, "globalThis.opened = 1")',
    'setTimeout({ toString() { return "globalThis.opened = 1" } }, 0)'
  ]) {
    assert.match(attempt(realm, code), /threw: set(Timeout|Interval) takes a function in a \.brf/, code)
  }
  assert.equal(run(realm, '__compiled.length'), 0, 'nothing reached the compiler')
  // The positive control: the legal form still runs, arguments and all, through both timers.
  assert.equal(run(realm, 'let got = []; setTimeout((a, b) => got.push(a + b), 0, 2, 3); setInterval((a) => got.push(a), 0, 9); got.join()'), '5,9')
  // The wrapper cannot be swapped back out where it lives (a module shadowing it on the global
  // with its own function is harmless: that function cannot compile a string either).
  assert.throws(() => run(realm, 'Object.defineProperty(Object.getPrototypeOf(globalThis), "setTimeout", { value: () => "mine" })'), /redefine/)
})

test('a timer wrapper does not hand its original to a tampered Reflect.apply or Function.prototype.call', () => {
  const realm = workerRealm()
  lockdown(realm.g)
  const leaked = run(
    realm,
    `let leaked = []
     Reflect.apply = (f) => leaked.push(f)
     // Not \`Function.prototype\`: after the lock \`Function\` is the stand-in, whose prototype is
     // not the one every function inherits from — a tamper through it would test nothing.
     const fnProto = Object.getPrototypeOf(() => 0)
     fnProto.call = function () { leaked.push(this) }
     fnProto.apply = function () { leaked.push(this) }
     if ((() => 0).call !== fnProto.call) throw new Error('the tamper did not land')
     let ran = 0
     setTimeout(() => { ran = 1 }, 0)
     ran + ':' + leaked.length`
  )
  assert.equal(leaked, '1:0')
})

test('fonts and the sandboxed filesystem are gone after the lock', () => {
  const realm = workerRealm()
  lockdown(realm.g)
  for (const name of ['FontFace', 'fonts', 'webkitRequestFileSystem']) {
    assert.equal(run(realm, `typeof ${name}`), 'undefined', name)
  }
})

test('the GPU is gone after the lock, on the global and its prototype', () => {
  const realm = workerRealm()
  lockdown(realm.g)
  assert.equal(run(realm, 'typeof OffscreenCanvas'), 'undefined')
  assert.equal(run(realm, 'typeof Object.getPrototypeOf(globalThis).OffscreenCanvas'), 'undefined')
  assert.match(attempt(realm, 'new OffscreenCanvas(1, 1).getContext("webgl2")'), /^threw: /)
})

test('only a trusted message reaches the host handler: a dispatched MessageEvent is ignored', () => {
  const realm = workerRealm()
  const received: unknown[] = []
  lockdown(realm.g, (data) => received.push(data))
  const [listener] = run(realm, '__listeners') as ((e: { data: unknown; isTrusted?: boolean }) => void)[]
  listener!({ data: 'forged', isTrusted: false })
  listener!({ data: 'forged, no flag' })
  assert.deepEqual(received, [], 'a synthetic event reached the handler')
  listener!({ data: 'from the host', isTrusted: true })
  assert.deepEqual(received, ['from the host'], 'the host\'s own message must still arrive')
})
