/**
 * Speech adapters: OpenAI `/v1/audio/speech`, Gemini TTS over `/v1beta/interactions`, and
 * ElevenLabs `/v1/text-to-speech/{voice}`. Shapes and sources are in the header of `@shared/speech`.
 *
 * OpenAI and ElevenLabs answer with the audio as the response body. Gemini answers with an
 * Interaction whose audio is base64 in `steps[].content[]`; if it answers before the audio is
 * ready (`in_progress`/`queued`), the job polls the interaction instead of paying for another.
 *
 * `withSpeech` puts a speech adapter beside a provider's image/video adapter, since `jobs.ts`
 * holds one adapter per provider: `start` is chosen by the request's kind, and a speech handle
 * carries a prefix so `poll` and `collect` reach the adapter that made it.
 */

import type { Adapter, AdapterContext, Output, PollResult } from './adapter'
import { ProviderError, httpFailure, readJson } from './adapter'
import { speechInstructions } from '@shared/speech'
import type { GenerationProvider, GenerationRequest } from '@shared/generation'

/** The largest audio file bay keeps from one call. A 40,000-character read is far under this. */
export const SPEECH_MAX_BYTES = 100 * 1024 * 1024

async function audioBody(provider: GenerationProvider, label: string, response: Response): Promise<Output> {
  if (!response.ok) throw httpFailure(provider, response.status, providerBody(await readJson(response)))
  const mime = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (mime.includes('json') || mime.startsWith('text/')) {
    const body = await readJson(response)
    throw new ProviderError(`${label} answered without audio${body ? `: ${JSON.stringify(body).slice(0, 300)}` : ''}. Generate again.`, false)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0) throw new ProviderError(`${label} answered with an empty file. Generate again.`, false)
  if (bytes.length > SPEECH_MAX_BYTES) throw new ProviderError(`${label}'s audio passed bay's ${SPEECH_MAX_BYTES}-byte limit and was not kept.`, false)
  return { bytes, mime: mime.startsWith('audio/') ? mime : 'audio/mpeg' }
}

/** ElevenLabs reports errors as `{ detail: { message } }` (or a string); map it to the usual shape. */
function providerBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const detail = (body as { detail?: unknown }).detail
  if (typeof detail === 'string') return { message: detail }
  if (detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string') {
    return { message: (detail as { message: string }).message }
  }
  return body
}

export const openaiSpeech: Adapter = {
  async start(request: GenerationRequest, ctx: AdapterContext) {
    const instructions = speechInstructions(request)
    const response = await ctx.http.api(`${ctx.baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.credentials.apiKey ?? ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        input: request.prompt,
        voice: request.voice,
        response_format: 'mp3',
        ...(instructions ? { instructions } : {}),
        ...(request.speed !== undefined ? { speed: request.speed } : {})
      })
    })
    return { kind: 'done', output: await audioBody('openai', 'OpenAI', response) }
  }
}

export const elevenlabsSpeech: Adapter = {
  async start(request: GenerationRequest, ctx: AdapterContext) {
    const voice = encodeURIComponent(request.voice ?? '')
    const response = await ctx.http.api(`${ctx.baseUrl}/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': ctx.credentials.apiKey ?? '', 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: request.prompt,
        model_id: request.model,
        ...(request.speed !== undefined ? { voice_settings: { speed: request.speed } } : {})
      })
    })
    return { kind: 'done', output: await audioBody('elevenlabs', 'ElevenLabs', response) }
  }
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

interface AudioBlock {
  type?: string
  data?: string
  mime_type?: string
  sample_rate?: number
  channels?: number
}

interface Interaction {
  id?: string
  status?: string
  steps?: { content?: AudioBlock[] }[]
  outputs?: AudioBlock[]
  errors?: { code?: string; message?: string }[]
}

/** A 44-byte RIFF header over 16-bit little-endian PCM, which is what `audio/l16` is. */
export function pcmToWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const header = Buffer.alloc(44)
  const blockAlign = channels * 2
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * blockAlign, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

function audioOf(interaction: Interaction): Output | null {
  const blocks = [...(interaction.steps ?? []).flatMap((step) => step.content ?? []), ...(interaction.outputs ?? [])]
  const block = blocks.reverse().find((b) => b?.type === 'audio' && typeof b.data === 'string' && b.data.length > 0)
  if (!block?.data) return null
  const bytes = Buffer.from(block.data, 'base64')
  const mime = (block.mime_type ?? 'audio/wav').toLowerCase()
  const riff = bytes.subarray(0, 4).toString('ascii') === 'RIFF'
  if (!riff && (mime.includes('l16') || mime.includes('pcm'))) {
    return { bytes: pcmToWav(bytes, block.sample_rate ?? 24000, block.channels ?? 1), mime: 'audio/wav' }
  }
  return { bytes, mime: mime.includes('mp3') || mime.includes('mpeg') ? 'audio/mpeg' : 'audio/wav' }
}

function failureOf(interaction: Interaction): string {
  const said = (interaction.errors ?? []).map((e) => e.message).filter(Boolean).join(' ')
  return `Gemini did not finish the speech (${interaction.status ?? 'no status'})${said ? `: "${said.slice(0, 300)}"` : ''}. Rephrase the text or change the voice, and generate again.`
}

const RUNNING = new Set(['in_progress', 'queued'])

async function fetchInteraction(id: string, ctx: AdapterContext): Promise<Interaction> {
  const response = await ctx.http.api(`${ctx.baseUrl}/v1beta/interactions/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: { 'x-goog-api-key': ctx.credentials.apiKey ?? '' }
  })
  const body = await readJson(response)
  if (!response.ok) throw httpFailure('gemini', response.status, body)
  return (body ?? {}) as Interaction
}

export const geminiSpeech: Adapter = {
  async start(request: GenerationRequest, ctx: AdapterContext) {
    const style = speechInstructions(request)
    const response = await ctx.http.api(`${ctx.baseUrl}/v1beta/interactions`, {
      method: 'POST',
      headers: { 'x-goog-api-key': ctx.credentials.apiKey ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        input: [
          {
            type: 'user_input',
            content: [
              {
                type: 'text',
                text: request.prompt,
                ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {})
              }
            ]
          }
        ],
        response_format: { type: 'audio', mime_type: 'audio/wav' },
        generation_config: { speech_config: [{ voice: request.voice }] }
      })
    })
    const body = await readJson(response)
    if (!response.ok) throw httpFailure('gemini', response.status, body)
    const interaction = (body ?? {}) as Interaction
    const audio = audioOf(interaction)
    if (audio) return { kind: 'done', output: audio }
    if (interaction.status && RUNNING.has(interaction.status) && interaction.id) return { kind: 'pending', handle: interaction.id }
    throw new ProviderError(failureOf(interaction), false)
  },
  async poll(handle: string, ctx: AdapterContext): Promise<PollResult> {
    const interaction = await fetchInteraction(handle, ctx)
    if (audioOf(interaction)) return { kind: 'ready', location: handle }
    if (interaction.status && RUNNING.has(interaction.status)) return { kind: 'running' }
    return { kind: 'failed', error: failureOf(interaction) }
  },
  async collect(location: string, ctx: AdapterContext): Promise<Output> {
    const audio = audioOf(await fetchInteraction(location, ctx))
    if (!audio) throw new ProviderError('Gemini reported the speech ready and then returned none. Generate again.', false)
    return audio
  }
}

// ---------------------------------------------------------------------------
// One adapter per provider
// ---------------------------------------------------------------------------

const PREFIX = 'speech:'

/** A provider's adapter with speech beside it: chosen by kind, and by handle prefix after that. */
export function withSpeech(base: Adapter | null, speech: Adapter): Adapter {
  const none = (what: string): never => {
    throw new ProviderError(`This provider has nothing to ${what}.`, false)
  }
  return {
    async start(request, ctx) {
      if (request.kind !== 'speech') return base ? base.start(request, ctx) : none('generate but speech')
      const started = await speech.start(request, ctx)
      return started.kind === 'pending' ? { kind: 'pending', handle: PREFIX + started.handle } : started
    },
    async poll(handle, ctx) {
      if (handle.startsWith(PREFIX)) {
        if (!speech.poll) return { kind: 'failed', error: 'This speech job has nothing to poll. Generate again.' }
        const result = await speech.poll(handle.slice(PREFIX.length), ctx)
        return result.kind === 'ready' ? { kind: 'ready', location: PREFIX + result.location } : result
      }
      return base?.poll ? base.poll(handle, ctx) : { kind: 'failed', error: 'Nothing to poll.' }
    },
    async collect(location, ctx) {
      if (location.startsWith(PREFIX)) return speech.collect ? speech.collect(location.slice(PREFIX.length), ctx) : none('collect')
      return base?.collect ? base.collect(location, ctx) : none('collect')
    }
  }
}
