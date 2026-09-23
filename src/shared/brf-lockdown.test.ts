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
       addEventListener(type, listener) { globalThis.__listeners.push(listener) }
     }
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
  const listeners = run(realm, '__listeners') as ((e: { data: unknown }) => void)[]
  assert.equal(listeners.length, 1)
  listeners[0]!({ data: 'load' })
  assert.deepEqual(received, ['load'])
  post('scene')
  assert.deepEqual(JSON.parse(String(run(realm, 'JSON.stringify(__sent)'))), ['scene'])
  assert.equal(run(realm, 'typeof addEventListener'), 'undefined', 'user code cannot add a second listener')
})
