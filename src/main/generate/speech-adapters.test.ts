/**
 * What each speech adapter puts on the wire and makes of the answer — against the local stub,
 * never a live API. Bodies are asserted as literals (the providers' documented shapes, see
 * `@shared/speech`), so a refactor that moves a field fails here rather than at the provider.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GenerationRequest } from '@shared/generation'
import { SPEECH_STYLES, validateSpeech } from '@shared/speech'
import type { Adapter, AdapterContext } from './adapter'
import { providerHttp, type Fetch } from './http'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { probe } from '../ffmpeg/probe'
import { elevenlabsSpeech, geminiSpeech, openaiSpeech, pcmToWav, withSpeech } from './speech-adapters'
import { STUB_POLICY, json, startStub, type Stub } from './stub-server'

const realFetch: Fetch = (url, init) => fetch(url, init)
/** An MPEG audio frame header — enough for bytes to be told apart; the stub never decodes. */
const MP3 = Buffer.from('fffb9064000000000000', 'hex')

function ctx(stub: Stub, credentials: Record<string, string> = { apiKey: 'key-1' }): AdapterContext {
  return {
    http: providerHttp(realFetch, STUB_POLICY, 'Stub'),
    credentials,
    baseUrl: stub.api,
    reference: null,
    now: () => 1_700_000_000_000
  }
}

function speech(input: Record<string, unknown>): GenerationRequest {
  const checked = validateSpeech(input)
  assert.ok(checked.ok, checked.ok ? '' : checked.errors.join(' '))
  return checked.request
}

function audio(response: import('node:http').ServerResponse, bytes: Buffer, type = 'audio/mpeg'): void {
  response.statusCode = 200
  response.setHeader('content-type', type)
  response.end(bytes)
}

test('OpenAI: /v1/audio/speech with the bearer key, the preset as instructions, and speed only when asked', async () => {
  const stub = await startStub((_r, response) => audio(response, MP3))
  try {
    const result = await openaiSpeech.start(speech({ model: 'gpt-4o-mini-tts', text: 'Hello there.', voice: 'cedar', style: 'calm' }), ctx(stub))
    const sent = stub.requests[0]!
    assert.equal(sent.method, 'POST')
    assert.equal(sent.url, '/v1/audio/speech')
    assert.equal(sent.headers.authorization, 'Bearer key-1')
    assert.deepEqual(JSON.parse(sent.body.toString()), {
      model: 'gpt-4o-mini-tts',
      input: 'Hello there.',
      voice: 'cedar',
      response_format: 'mp3',
      instructions: 'Keep the voice quiet, even and reassuring, and let the pauses breathe.'
    })
    assert.equal(result.kind, 'done')
    assert.deepEqual(result.kind === 'done' ? result.output : null, { bytes: MP3, mime: 'audio/mpeg' })

    await openaiSpeech.start(speech({ model: 'gpt-4o-mini-tts', text: 'Hi.', speed: 1.25, instructions: 'Whisper it.' }), ctx(stub))
    const second = JSON.parse(stub.requests[1]!.body.toString()) as Record<string, unknown>
    assert.equal(second.speed, 1.25)
    assert.equal(second.instructions, 'Whisper it.', 'custom instructions alone, with no preset put in front')
    assert.ok(!String(second.instructions).includes(SPEECH_STYLES.natural.instructions))
  } finally {
    await stub.close()
  }
})

test('OpenAI: a refused key points at Settings; a 200 that is not audio is a refusal, not an empty file', async () => {
  let status = 401
  const stub = await startStub((_r, response) => json(response, status, status === 401 ? { error: { message: 'Incorrect API key provided' } } : { note: 'queued' }))
  try {
    const request = speech({ model: 'gpt-4o-mini-tts', text: 'Hi.' })
    await assert.rejects(openaiSpeech.start(request, ctx(stub)), /refused the key \(401\).*Incorrect API key provided.*Settings › Providers/)
    status = 200
    await assert.rejects(openaiSpeech.start(request, ctx(stub)), /OpenAI answered without audio/)
  } finally {
    await stub.close()
  }
})

test('ElevenLabs: the voice in the path, xi-api-key and no Authorization, speed in voice_settings', async () => {
  const stub = await startStub((_r, response) => audio(response, MP3))
  try {
    const result = await elevenlabsSpeech.start(
      speech({ model: 'eleven_multilingual_v2', text: 'Welcome.', voice: 'JBFqnCBsd6RMkjVDRZzb', speed: 0.9 }),
      ctx(stub, { apiKey: 'xi-1' })
    )
    const sent = stub.requests[0]!
    assert.equal(sent.url, '/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128')
    assert.equal(sent.headers['xi-api-key'], 'xi-1')
    assert.equal(sent.headers.authorization, undefined)
    assert.deepEqual(JSON.parse(sent.body.toString()), { text: 'Welcome.', model_id: 'eleven_multilingual_v2', voice_settings: { speed: 0.9 } })
    assert.equal(result.kind === 'done' ? result.output.mime : '', 'audio/mpeg')

    await elevenlabsSpeech.start(speech({ model: 'eleven_flash_v2_5', text: 'Hi.' }), ctx(stub, { apiKey: 'xi-1' }))
    assert.deepEqual(JSON.parse(stub.requests[1]!.body.toString()), { text: 'Hi.', model_id: 'eleven_flash_v2_5' }, 'no speed asked, none sent')
  } finally {
    await stub.close()
  }
})

test('ElevenLabs: its { detail: { message } } error reaches the agent', async () => {
  const stub = await startStub((_r, response) => json(response, 401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } }))
  try {
    await assert.rejects(
      elevenlabsSpeech.start(speech({ model: 'eleven_flash_v2_5', text: 'Hi.' }), ctx(stub)),
      /ElevenLabs refused the key \(401\)\. ElevenLabs said: "Invalid API key".*Settings › Providers/
    )
  } finally {
    await stub.close()
  }
})

const WAV = pcmToWav(Buffer.alloc(24000 * 2), 24000, 1)

test('Gemini: /v1beta/interactions with the style as speech_metadata and the voice in speech_config', async () => {
  const stub = await startStub((_r, response) =>
    json(response, 200, {
      id: 'int-1',
      status: 'completed',
      steps: [{ content: [{ type: 'text', text: 'ok' }] }, { content: [{ type: 'audio', data: WAV.toString('base64'), mime_type: 'audio/wav', sample_rate: 24000, channels: 1 }] }]
    })
  )
  try {
    const result = await geminiSpeech.start(speech({ model: 'gemini-3.8-flash-tts', text: 'Have a wonderful day!', voice: 'Puck', instructions: 'cheerful and friendly' }), ctx(stub, { apiKey: 'g-1' }))
    const sent = stub.requests[0]!
    assert.equal(sent.url, '/v1beta/interactions')
    assert.equal(sent.headers['x-goog-api-key'], 'g-1')
    assert.deepEqual(JSON.parse(sent.body.toString()), {
      model: 'gemini-3.8-flash-tts',
      input: [
        {
          type: 'user_input',
          content: [{ type: 'text', text: 'Have a wonderful day!', annotations: [{ type: 'speech_metadata', style: 'cheerful and friendly' }] }]
        }
      ],
      response_format: { type: 'audio', mime_type: 'audio/wav' },
      generation_config: { speech_config: [{ voice: 'Puck' }] }
    })
    assert.equal(result.kind, 'done')
    assert.deepEqual(result.kind === 'done' ? result.output : null, { bytes: WAV, mime: 'audio/wav' })
  } finally {
    await stub.close()
  }
})

test('Gemini: headerless L16 audio is wrapped in a RIFF header at its own rate', async () => {
  const pcm = Buffer.alloc(16000 * 2, 1)
  const stub = await startStub((_r, response) =>
    json(response, 200, { status: 'completed', steps: [{ content: [{ type: 'audio', data: pcm.toString('base64'), mime_type: 'audio/l16', sample_rate: 16000, channels: 1 }] }] })
  )
  try {
    const result = await geminiSpeech.start(speech({ model: 'gemini-3.8-flash-lite-tts', text: 'Hi.' }), ctx(stub))
    const output = result.kind === 'done' ? result.output : null
    assert.ok(output)
    assert.equal(output.mime, 'audio/wav')
    assert.equal(output.bytes.subarray(0, 4).toString('ascii'), 'RIFF')
    assert.equal(output.bytes.readUInt32LE(24), 16000)
    assert.deepEqual(output.bytes.subarray(44), pcm)
  } finally {
    await stub.close()
  }
})

test('Gemini: a failed interaction says why; an unfinished one is polled, not paid for twice', async () => {
  let polls = 0
  const stub = await startStub((request, response) => {
    if (request.method === 'POST') {
      const text = (JSON.parse(request.body.toString()) as { input: { content: { text: string }[] }[] }).input[0]!.content[0]!.text
      if (text === 'fail') return json(response, 200, { id: 'int-f', status: 'failed', errors: [{ code: 'x', message: 'voice unavailable' }] })
      return json(response, 200, { id: 'int-2', status: 'in_progress' })
    }
    assert.equal(request.url, '/v1beta/interactions/int-2')
    polls += 1
    if (polls < 2) return json(response, 200, { id: 'int-2', status: 'in_progress' })
    return json(response, 200, { id: 'int-2', status: 'completed', steps: [{ content: [{ type: 'audio', data: WAV.toString('base64'), mime_type: 'audio/wav' }] }] })
  })
  try {
    await assert.rejects(geminiSpeech.start(speech({ model: 'gemini-3.8-flash-tts', text: 'fail' }), ctx(stub)), /Gemini did not finish the speech \(failed\): "voice unavailable"/)

    // Through `withSpeech`, as the job table sees it: the handle is marked as speech.
    const adapter = withSpeech(null, geminiSpeech)
    const started = await adapter.start(speech({ model: 'gemini-3.8-flash-tts', text: 'slow one' }), ctx(stub))
    assert.deepEqual(started, { kind: 'pending', handle: 'speech:int-2' })
    assert.deepEqual(await adapter.poll!('speech:int-2', ctx(stub)), { kind: 'running' })
    const ready = await adapter.poll!('speech:int-2', ctx(stub))
    assert.deepEqual(ready, { kind: 'ready', location: 'speech:int-2' })
    const collected = await adapter.collect!('speech:int-2', ctx(stub))
    assert.deepEqual(collected.bytes, WAV)
    assert.equal(stub.requests.filter((r) => r.method === 'POST').length, 2, 'one POST per start, never one per poll')
  } finally {
    await stub.close()
  }
})

test('withSpeech sends images and video to the provider’s own adapter, and speech handles to speech', async () => {
  const calls: string[] = []
  const base: Adapter = {
    start: async (r) => {
      calls.push(`base.start:${r.kind}`)
      return { kind: 'pending', handle: 'op-1' }
    },
    poll: async (h) => {
      calls.push(`base.poll:${h}`)
      return { kind: 'ready', location: 'https://cdn/x.mp4' }
    },
    collect: async (l) => {
      calls.push(`base.collect:${l}`)
      return { bytes: Buffer.alloc(1), mime: 'video/mp4' }
    }
  }
  const voice: Adapter = {
    start: async () => {
      calls.push('speech.start')
      return { kind: 'pending', handle: 'op-1' }
    },
    poll: async (h) => {
      calls.push(`speech.poll:${h}`)
      return { kind: 'ready', location: h }
    },
    collect: async (l) => {
      calls.push(`speech.collect:${l}`)
      return { bytes: Buffer.alloc(1), mime: 'audio/wav' }
    }
  }
  const adapter = withSpeech(base, voice)
  const video: GenerationRequest = { provider: 'gemini', model: 'veo-3.1-generate-preview', kind: 'video', prompt: 'x' }
  const said: GenerationRequest = { provider: 'gemini', model: 'gemini-3.8-flash-tts', kind: 'speech', prompt: 'x' }
  const noCtx = {} as AdapterContext
  assert.deepEqual(await adapter.start(video, noCtx), { kind: 'pending', handle: 'op-1' })
  assert.deepEqual(await adapter.start(said, noCtx), { kind: 'pending', handle: 'speech:op-1' })
  await adapter.poll!('op-1', noCtx)
  await adapter.poll!('speech:op-1', noCtx)
  await adapter.collect!('https://cdn/x.mp4', noCtx)
  await adapter.collect!('speech:op-1', noCtx)
  assert.deepEqual(calls, [
    'base.start:video',
    'speech.start',
    'base.poll:op-1',
    'speech.poll:op-1',
    'base.collect:https://cdn/x.mp4',
    'speech.collect:op-1'
  ])
  // A speech-only provider refuses a picture rather than sending it somewhere.
  await assert.rejects(withSpeech(null, voice).start(video, noCtx), /nothing to generate but speech/)
})

const FFPROBE = vendoredTools()?.ffprobe

test('the WAV bay writes from raw PCM is one ffprobe reads as audio of the right length', { skip: FFPROBE ? false : NO_VENDORED_FFMPEG }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bay-speech-'))
  const path = join(dir, 'one-second.wav')
  await writeFile(path, pcmToWav(Buffer.alloc(24000 * 2), 24000, 1))
  const probed = await probe(path)
  assert.equal(probed.hasAudio, true)
  assert.equal(probed.hasVideo, false)
  assert.ok(Math.abs(probed.durationUs - 1_000_000) < 5000, `${probed.durationUs}µs`)
  // Negative control: the same bytes with a broken header are not audio ffprobe accepts.
  const broken = join(dir, 'broken.wav')
  await writeFile(broken, Buffer.concat([Buffer.from('RIFX'), pcmToWav(Buffer.alloc(24000 * 2), 24000, 1).subarray(4)]))
  await assert.rejects(probe(broken))
})
