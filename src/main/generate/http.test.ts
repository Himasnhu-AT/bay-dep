/**
 * The generation host fence. Every refusal here is paired with the nearest call that must still
 * work, because a fence that refuses everything passes every refusal test.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hostMatches, policyFor, providerHttp, type Fetch } from './http'
import { STUB_POLICY, json, startStub } from './stub-server'

const realFetch: Fetch = (url, init) => fetch(url, init)

test('the production policies name each provider’s own hosts and nothing else', () => {
  // Literal, from the requirement (CLAUDE.md's fourth exception) — not derived from the catalog.
  assert.deepEqual(policyFor('openai').apiHosts, ['api.openai.com'])
  assert.deepEqual(policyFor('gemini').apiHosts, ['generativelanguage.googleapis.com'])
  assert.deepEqual(policyFor('kling').apiHosts, ['api-singapore.klingai.com'])
  assert.equal(policyFor('openai').insecureHosts, undefined)
})

test('a suffix pattern matches subdomains only, and an exact one matches exactly', () => {
  assert.equal(hostMatches('v15.klingai.com', ['.klingai.com']), true)
  // A lookalike that merely ends in the same letters is not a subdomain.
  assert.equal(hostMatches('evilklingai.com', ['.klingai.com']), false)
  assert.equal(hostMatches('klingai.com', ['.klingai.com']), false)
  assert.equal(hostMatches('api.openai.com', ['api.openai.com']), true)
  assert.equal(hostMatches('api.openai.com.evil.net', ['api.openai.com']), false)
})

test('the API fence refuses another host before any request, and reaches its own', async () => {
  let called = 0
  const counting: Fetch = async () => {
    called++
    return new Response('{}', { status: 200 })
  }
  const http = providerHttp(counting, policyFor('openai'), 'OpenAI')
  await assert.rejects(http.api('https://example.com/v1/images/generations'), /refused to contact example\.com.*only api\.openai\.com/)
  await assert.rejects(http.api('http://api.openai.com/v1/x'), /only https/)
  assert.equal(called, 0, 'a refused host must never be requested')
  // Positive control: the provider's own host goes through.
  const ok = await http.api('https://api.openai.com/v1/images/generations')
  assert.equal(ok.status, 200)
  assert.equal(called, 1)
})

test('a download host is not an API host', async () => {
  const http = providerHttp(async () => new Response('x'), policyFor('gemini'), 'Gemini')
  await assert.rejects(http.api('https://storage.googleapis.com/x'), /refused to contact storage\.googleapis\.com/)
  // …but it is a download host.
  const got = await http.download('https://storage.googleapis.com/x', undefined, 10)
  assert.equal(got.bytes.toString(), 'x')
})

test('a redirect to a host outside the list is refused, and one inside it is followed without the key', async () => {
  const stub = await startStub((request, response) => {
    if (request.url === '/escape') {
      response.statusCode = 302
      response.setHeader('location', 'https://example.com/steal')
      return void response.end()
    }
    if (request.url === '/file') {
      response.statusCode = 302
      response.setHeader('location', `${stub.cdn}/blob`)
      return void response.end()
    }
    if (request.url === '/blob') {
      response.setHeader('content-type', 'video/mp4')
      return void response.end('clip-bytes')
    }
    json(response, 404, {})
  })
  try {
    const http = providerHttp(realFetch, STUB_POLICY, 'Stub')
    await assert.rejects(http.download(`${stub.api}/escape`, { headers: { 'x-goog-api-key': 'k' } }, 1000), /refused to contact example\.com/)

    stub.requests.length = 0
    const got = await http.download(`${stub.api}/file`, { headers: { 'x-goog-api-key': 'secret-key' } }, 1000)
    assert.equal(got.bytes.toString(), 'clip-bytes')
    assert.equal(got.contentType, 'video/mp4')
    const [first, second] = stub.requests
    assert.equal(first?.host, '127.0.0.1')
    assert.equal(first?.headers['x-goog-api-key'], 'secret-key', 'positive control: the API host gets the key')
    assert.equal(second?.host, 'localhost')
    assert.equal(second?.headers['x-goog-api-key'], undefined, 'the download host must not get the key')
  } finally {
    await stub.close()
  }
})

test('a download over the cap is abandoned; one under it lands', async () => {
  const stub = await startStub((_request, response) => {
    // No content-length: chunked, so only the streaming check can catch it.
    response.write(Buffer.alloc(600))
    response.end(Buffer.alloc(600))
  })
  try {
    const http = providerHttp(realFetch, STUB_POLICY, 'Stub')
    await assert.rejects(http.download(`${stub.api}/big`, undefined, 1000), /passed bay's 1000-byte limit/)
    const ok = await http.download(`${stub.api}/big`, undefined, 2000)
    assert.equal(ok.bytes.length, 1200)
  } finally {
    await stub.close()
  }
})
