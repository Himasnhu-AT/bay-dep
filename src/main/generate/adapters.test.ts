/**
 * What each adapter puts on the wire, and what it makes of the answer — against a local stub,
 * never a live API. The shapes asserted are the providers' documented ones (see the header of
 * `@shared/generation`), written here as literals so a refactor that moves a field fails.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { validateGeneration, type GenerationRequest } from '@shared/generation'
import type { AdapterContext, Reference } from './adapter'
import { providerHttp, type Fetch } from './http'
import { geminiImage } from './gemini-image'
import { kling, klingToken } from './kling'
import { openaiImage } from './openai-image'
import { veo } from './veo'
import { STUB_POLICY, json, startStub, type Stub } from './stub-server'

const realFetch: Fetch = (url, init) => fetch(url, init)
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const reference: Reference = { bytes: PNG, mime: 'image/png', name: 'ref.png' }

function ctx(stub: Stub, credentials: Record<string, string>, ref: Reference | null = null): AdapterContext {
  return {
    http: providerHttp(realFetch, STUB_POLICY, 'Stub'),
    credentials,
    baseUrl: stub.api,
    reference: ref,
    now: () => 1_700_000_000_000
  }
}

function request(input: Record<string, unknown>, kind: 'image' | 'video'): GenerationRequest {
  const checked = validateGeneration(input, kind)
  assert.ok(checked.ok, checked.ok ? '' : checked.errors.join(' '))
  return checked.request
}

test('OpenAI: a prompt goes to /v1/images/generations as JSON with the bearer key', async () => {
  const stub = await startStub((_r, response) => json(response, 200, { data: [{ b64_json: PNG.toString('base64') }] }))
  try {
    const result = await openaiImage.start(request({ model: 'gpt-image-1', prompt: 'a red kite', size: '1536x1024', quality: 'low' }, 'image'), ctx(stub, { apiKey: 'sk-test' }))
    const sent = stub.requests[0]!
    assert.equal(sent.method, 'POST')
    assert.equal(sent.url, '/v1/images/generations')
    assert.equal(sent.headers.authorization, 'Bearer sk-test')
    assert.deepEqual(JSON.parse(sent.body.toString()), { model: 'gpt-image-1', prompt: 'a red kite', n: 1, size: '1536x1024', quality: 'low' })
    assert.equal(result.kind, 'done')
    assert.deepEqual(result.kind === 'done' ? result.output.bytes : null, PNG)
  } finally {
    await stub.close()
  }
})

test('OpenAI: a reference goes to /v1/images/edits as multipart with image[]', async () => {
  const stub = await startStub((_r, response) => json(response, 200, { data: [{ b64_json: PNG.toString('base64') }] }))
  try {
    await openaiImage.start(request({ model: 'gpt-image-1.5', prompt: 'make it night' }, 'image'), ctx(stub, { apiKey: 'sk-test' }, reference))
    const sent = stub.requests[0]!
    assert.equal(sent.url, '/v1/images/edits')
    assert.match(String(sent.headers['content-type']), /^multipart\/form-data; boundary=/)
    const body = sent.body.toString('latin1')
    assert.match(body, /name="model"\r\n\r\ngpt-image-1\.5\r\n/)
    assert.match(body, /name="prompt"\r\n\r\nmake it night\r\n/)
    assert.match(body, /name="image\[\]"; filename="ref\.png"\r\nContent-Type: image\/png/)
  } finally {
    await stub.close()
  }
})

test('OpenAI: a refused key says to fix it in Settings, not in chat', async () => {
  const stub = await startStub((_r, response) => json(response, 401, { error: { message: 'Incorrect API key provided' } }))
  try {
    await assert.rejects(
      openaiImage.start(request({ model: 'gpt-image-1', prompt: 'x' }, 'image'), ctx(stub, { apiKey: 'bad' })),
      /refused the key \(401\).*Incorrect API key provided.*Preferences › AI providers/
    )
  } finally {
    await stub.close()
  }
})

test('Gemini image: generateContent with IMAGE output, the ratio, the size and the reference inline', async () => {
  const stub = await startStub((_r, response) =>
    json(response, 200, { candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] })
  )
  try {
    const result = await geminiImage.start(
      request({ model: 'gemini-3-pro-image', prompt: 'a harbour', aspectRatio: '9:16', size: '4K' }, 'image'),
      ctx(stub, { apiKey: 'g-key' }, reference)
    )
    const sent = stub.requests[0]!
    assert.equal(sent.url, '/v1beta/models/gemini-3-pro-image:generateContent')
    assert.equal(sent.headers['x-goog-api-key'], 'g-key')
    assert.deepEqual(JSON.parse(sent.body.toString()), {
      contents: [{ role: 'user', parts: [{ text: 'a harbour' }, { inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16', imageSize: '4K' } }
    })
    assert.equal(result.kind === 'done' ? result.output.mime : '', 'image/png')
  } finally {
    await stub.close()
  }
})

test('Gemini image: a 200 with no picture is a refusal carrying the reason', async () => {
  const stub = await startStub((_r, response) => json(response, 200, { candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }))
  try {
    await assert.rejects(geminiImage.start(request({ model: 'gemini-2.5-flash-image', prompt: 'x' }, 'image'), ctx(stub, { apiKey: 'k' })), /no picture \(IMAGE_SAFETY\).*Rephrase/)
  } finally {
    await stub.close()
  }
})

test('Veo: predictLongRunning, then the operation, then a download that drops the key at the redirect', async () => {
  let polls = 0
  const stub = await startStub((r, response) => {
    if (r.url.endsWith(':predictLongRunning')) return json(response, 200, { name: 'models/veo-3.1-generate-preview/operations/op123' })
    if (r.url === '/v1beta/models/veo-3.1-generate-preview/operations/op123') {
      polls++
      if (polls === 1) return json(response, 200, { name: 'x', done: false })
      return json(response, 200, { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${stub.api}/v1beta/files/abc:download?alt=media` } }] } } })
    }
    if (r.url.startsWith('/v1beta/files/abc')) {
      response.statusCode = 302
      response.setHeader('location', `${stub.cdn}/blob/abc.mp4`)
      return void response.end()
    }
    if (r.url === '/blob/abc.mp4') {
      response.setHeader('content-type', 'video/mp4')
      return void response.end('mp4-bytes')
    }
    json(response, 404, {})
  })
  try {
    const c = ctx(stub, { apiKey: 'g-key' }, reference)
    const req = request({ model: 'veo-3.1-generate-preview', prompt: 'waves', negativePrompt: 'people', resolution: '1080p' }, 'video')
    const started = await veo.start(req, c)
    assert.deepEqual(started, { kind: 'pending', handle: 'models/veo-3.1-generate-preview/operations/op123' })
    const sent = stub.requests[0]!
    assert.equal(sent.url, '/v1beta/models/veo-3.1-generate-preview:predictLongRunning')
    assert.equal(sent.headers['x-goog-api-key'], 'g-key')
    assert.deepEqual(JSON.parse(sent.body.toString()), {
      instances: [{ prompt: 'waves', image: { inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } } }],
      parameters: { aspectRatio: '16:9', durationSeconds: 8, resolution: '1080p', negativePrompt: 'people' }
    })

    assert.deepEqual(await veo.poll!('models/veo-3.1-generate-preview/operations/op123', c), { kind: 'running' })
    const ready = await veo.poll!('models/veo-3.1-generate-preview/operations/op123', c)
    assert.equal(ready.kind, 'ready')
    const output = await veo.collect!(ready.kind === 'ready' ? ready.location : '', c)
    assert.equal(output.bytes.toString(), 'mp4-bytes')
    const cdn = stub.requests.find((r) => r.url === '/blob/abc.mp4')!
    assert.equal(cdn.headers['x-goog-api-key'], undefined)
    const files = stub.requests.find((r) => r.url.startsWith('/v1beta/files/'))!
    assert.equal(files.headers['x-goog-api-key'], 'g-key', 'positive control: the API host is sent the key')
  } finally {
    await stub.close()
  }
})

test('Veo: a finished operation with the clip withheld is a failure naming why', async () => {
  const stub = await startStub((_r, response) =>
    json(response, 200, { done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ['The prompt names a real person.'] } } })
  )
  try {
    const result = await veo.poll!('models/v/operations/o', ctx(stub, { apiKey: 'k' }))
    assert.equal(result.kind, 'failed')
    assert.match(result.kind === 'failed' ? result.error : '', /withheld the clip: The prompt names a real person\..*Rephrase/)
  } finally {
    await stub.close()
  }
})

test('Veo: an operation name that walks out of /v1beta is not followed', async () => {
  const stub = await startStub((_r, response) => json(response, 200, { done: false }))
  try {
    const result = await veo.poll!('../../evil', ctx(stub, { apiKey: 'k' }))
    assert.equal(result.kind, 'failed')
    assert.equal(stub.requests.length, 0)
    // Positive control: a real-shaped name is polled.
    assert.equal((await veo.poll!('models/v/operations/o', ctx(stub, { apiKey: 'k' }))).kind, 'running')
  } finally {
    await stub.close()
  }
})

test('Kling: the JWT is HS256 over iss/exp/nbf, signed with the secret key', () => {
  const token = klingToken('ak-1', 'sk-1', 1_700_000_000_000)
  const [header, payload, signature] = token.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(header!, 'base64url').toString()), { alg: 'HS256', typ: 'JWT' })
  assert.deepEqual(JSON.parse(Buffer.from(payload!, 'base64url').toString()), { iss: 'ak-1', exp: 1_700_001_800, nbf: 1_699_999_995 })
  const expected = createHmac('sha256', 'sk-1').update(`${header}.${payload}`).digest('base64url')
  assert.equal(signature, expected)
  assert.notEqual(klingToken('ak-1', 'sk-2', 1_700_000_000_000).split('.')[2], expected, 'a different secret signs differently')
})

test('Kling: text2video with aspect ratio; image2video with bare base64 and no ratio; polled per endpoint', async () => {
  const stub = await startStub((r, response) => {
    if (r.method === 'POST') return json(response, 200, { code: 0, message: 'SUCCEED', data: { task_id: 'task-9', task_status: 'submitted' } })
    if (r.url === '/v1/videos/image2video/task-9') {
      return json(response, 200, { code: 0, data: { task_status: 'succeed', task_result: { videos: [{ url: `${stub.cdn}/k.mp4` }] } } })
    }
    json(response, 404, {})
  })
  try {
    const t2v = await kling.start(request({ model: 'kling-v2-6', prompt: 'a fox', durationSeconds: 10, mode: 'pro', aspectRatio: '9:16' }, 'video'), ctx(stub, { accessKey: 'ak', secretKey: 'sk' }))
    assert.deepEqual(t2v, { kind: 'pending', handle: 'text2video/task-9' })
    const first = stub.requests[0]!
    assert.equal(first.url, '/v1/videos/text2video')
    assert.equal(first.headers.authorization, `Bearer ${klingToken('ak', 'sk', 1_700_000_000_000)}`)
    assert.deepEqual(JSON.parse(first.body.toString()), { model_name: 'kling-v2-6', prompt: 'a fox', duration: '10', mode: 'pro', aspect_ratio: '9:16' })

    const i2v = await kling.start(request({ model: 'kling-v2-6', prompt: 'the fox runs', referencePath: '/m/fox.png' }, 'video'), ctx(stub, { accessKey: 'ak', secretKey: 'sk' }, reference))
    assert.deepEqual(i2v, { kind: 'pending', handle: 'image2video/task-9' })
    const second = JSON.parse(stub.requests[1]!.body.toString()) as Record<string, unknown>
    assert.equal(stub.requests[1]!.url, '/v1/videos/image2video')
    assert.equal(second.image, PNG.toString('base64'))
    assert.equal('aspect_ratio' in second, false)

    const ready = await kling.poll!('image2video/task-9', ctx(stub, { accessKey: 'ak', secretKey: 'sk' }))
    assert.deepEqual(ready, { kind: 'ready', location: `${stub.cdn}/k.mp4` })
  } finally {
    await stub.close()
  }
})

test('Kling: a 200 with a non-zero code is a refusal with Kling’s message', async () => {
  const stub = await startStub((_r, response) => json(response, 200, { code: 1102, message: 'Account balance not enough' }))
  try {
    await assert.rejects(
      kling.start(request({ model: 'kling-v2-5-turbo', prompt: 'x' }, 'video'), ctx(stub, { accessKey: 'ak', secretKey: 'sk' })),
      /code 1102.*Account balance not enough/
    )
  } finally {
    await stub.close()
  }
})
