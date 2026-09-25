/**
 * Veo 3.1 on the Gemini API: `models/{model}:predictLongRunning`, then the operation it names.
 *
 * - start: POST the instance (prompt, optional first frame as `inlineData`) and parameters; the
 *   answer is `{ name: "models/…/operations/…" }`, which is the job's remote handle.
 * - poll: GET `/v1beta/{name}` until `done`; the clip is at
 *   `response.generateVideoResponse.generatedSamples[0].video.uri`.
 * - collect: download that URI with the key. It redirects to Google's storage, and `http.ts`
 *   drops the key at that hop.
 */

import type { Adapter, AdapterContext } from './adapter'
import { ProviderError, httpFailure, providerMessage, readJson } from './adapter'
import { RESULT_MAX_BYTES, type GenerationRequest } from '@shared/generation'

interface Operation {
  name?: string
  done?: boolean
  error?: { message?: string; code?: number }
  metadata?: { progressPercent?: number }
  response?: {
    generateVideoResponse?: {
      generatedSamples?: { video?: { uri?: string } }[]
      raiMediaFilteredReasons?: string[]
    }
  }
}

function key(ctx: AdapterContext): Record<string, string> {
  return { 'x-goog-api-key': ctx.credentials.apiKey ?? '' }
}

export const veo: Adapter = {
  async start(request: GenerationRequest, ctx: AdapterContext) {
    const instance: Record<string, unknown> = { prompt: request.prompt }
    if (ctx.reference) instance.image = { inlineData: { mimeType: ctx.reference.mime, data: ctx.reference.bytes.toString('base64') } }
    const parameters: Record<string, unknown> = {}
    if (request.aspectRatio) parameters.aspectRatio = request.aspectRatio
    if (request.durationSeconds) parameters.durationSeconds = request.durationSeconds
    if (request.resolution) parameters.resolution = request.resolution
    if (request.negativePrompt) parameters.negativePrompt = request.negativePrompt
    const response = await ctx.http.api(`${ctx.baseUrl}/v1beta/models/${encodeURIComponent(request.model)}:predictLongRunning`, {
      method: 'POST',
      headers: { ...key(ctx), 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [instance], parameters })
    })
    const body = (await readJson(response)) as Operation | null
    if (!response.ok) throw httpFailure('gemini', response.status, body)
    if (!body?.name) throw new ProviderError('Veo accepted the request but returned no operation to follow. Generate again.', false)
    return { kind: 'pending', handle: body.name }
  },

  async poll(handle: string, ctx: AdapterContext) {
    // The handle came from Veo; still, it is path segments under /v1beta and nothing else.
    if (!/^[\w./-]+$/.test(handle) || handle.includes('..')) {
      return { kind: 'failed', error: `bay will not follow the operation name "${handle.slice(0, 80)}".` }
    }
    const response = await ctx.http.api(`${ctx.baseUrl}/v1beta/${handle}`, { headers: key(ctx) })
    const body = (await readJson(response)) as Operation | null
    if (!response.ok) throw httpFailure('gemini', response.status, body)
    if (!body?.done) {
      const percent = body?.metadata?.progressPercent
      return typeof percent === 'number' ? { kind: 'running', progress: percent / 100 } : { kind: 'running' }
    }
    if (body.error) return { kind: 'failed', error: `Veo failed: ${body.error.message ?? providerMessage(body)}` }
    const result = body.response?.generateVideoResponse
    const uri = result?.generatedSamples?.[0]?.video?.uri
    if (!uri) {
      const filtered = result?.raiMediaFilteredReasons?.join(' ')
      return {
        kind: 'failed',
        error: filtered
          ? `Veo withheld the clip: ${filtered} Rephrase the prompt and generate again.`
          : 'Veo finished without a clip. Generate again.'
      }
    }
    return { kind: 'ready', location: uri }
  },

  async collect(location: string, ctx: AdapterContext) {
    const { bytes, contentType } = await ctx.http.download(location, { headers: key(ctx) }, RESULT_MAX_BYTES)
    return { bytes, mime: contentType.startsWith('video/') ? contentType : 'video/mp4' }
  }
}
