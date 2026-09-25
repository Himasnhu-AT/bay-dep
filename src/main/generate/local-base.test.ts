import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localGenerationBase } from './local-base'
import { providerHttp, type Fetch } from './http'

const STUB = 'http://127.0.0.1:8471'

test('unset: the providers, untouched', () => {
  assert.deepEqual(localGenerationBase(false, {}), { kind: 'none' })
  assert.deepEqual(localGenerationBase(true, {}), { kind: 'none' })
})

test('a checkout honours a loopback stub, as the only host the fence admits', () => {
  // Positive control for the two refusals below: the same value, in the build that honours it.
  const local = localGenerationBase(false, { BAY_GENERATION_BASE: `${STUB}/ignored/path` })
  assert.equal(local.kind, 'local')
  assert.ok(local.kind === 'local')
  assert.equal(local.baseUrl, STUB)
  assert.deepEqual(local.policy.apiHosts, ['127.0.0.1'])
  for (const other of ['http://localhost:9', 'http://[::1]:9']) {
    assert.equal(localGenerationBase(false, { BAY_GENERATION_BASE: other }).kind, 'local', other)
  }
})

test('an installed bay ignores it, whatever the value', () => {
  const packaged = localGenerationBase(true, { BAY_GENERATION_BASE: STUB })
  assert.equal(packaged.kind, 'ignored')
  assert.ok(packaged.kind === 'ignored' && /installed/.test(packaged.reason))
})

test('a host that is not literally loopback is refused, names included', () => {
  for (const value of ['http://example.com', 'https://api.openai.com', 'http://127.0.0.1.example.com:80', 'http://10.0.0.1', 'http://192.168.1.2:80', 'http://0.0.0.0:80']) {
    const result = localGenerationBase(false, { BAY_GENERATION_BASE: value })
    assert.equal(result.kind, 'ignored', value)
    assert.ok(result.kind === 'ignored' && /on this Mac/.test(result.reason), value)
  }
  assert.equal(localGenerationBase(false, { BAY_GENERATION_BASE: 'not a url' }).kind, 'ignored')
  assert.equal(localGenerationBase(false, { BAY_GENERATION_BASE: 'file:///etc/hosts' }).kind, 'ignored')
})

test('under the stub, the fence admits the stub and refuses the real provider', async () => {
  const local = localGenerationBase(false, { BAY_GENERATION_BASE: STUB })
  assert.ok(local.kind === 'local')
  const reached: string[] = []
  const fetch: Fetch = async (url) => {
    reached.push(url)
    return new Response('{}', { status: 200 })
  }
  const http = providerHttp(fetch, local.policy, 'OpenAI')
  assert.equal((await http.api(`${local.baseUrl}/v1/images/generations`)).status, 200)
  await assert.rejects(http.api('https://api.openai.com/v1/images/generations'), /refused to contact api\.openai\.com/)
  assert.deepEqual(reached, [`${STUB}/v1/images/generations`])
})
