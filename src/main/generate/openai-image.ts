/**
 * OpenAI GPT Image: `/v1/images/generations` from a prompt, `/v1/images/edits` with a reference.
 *
 * Synchronous — the picture comes back in the response as base64 (`data[0].b64_json`), so there
 * is nothing to poll or download.
 */

import type { Adapter, AdapterContext, Output } from './adapter'
import { ProviderError, httpFailure, readJson } from './adapter'
import type { GenerationRequest } from '@shared/generation'

function pictureOf(body: unknown): Output {
  const data = (body as { data?: { b64_json?: unknown }[] } | null)?.data
  const b64 = data?.[0]?.b64_json
  if (typeof b64 !== 'string' || !b64) {
    throw new ProviderError('OpenAI answered without a picture. Generate again, perhaps with a plainer prompt.', false)
  }
  return { bytes: Buffer.from(b64, 'base64'), mime: 'image/png' }
}

export const openaiImage: Adapter = {
  async start(request: GenerationRequest, ctx: AdapterContext) {
    const auth = { Authorization: `Bearer ${ctx.credentials.apiKey ?? ''}` }
    let response: Response
    if (ctx.reference) {
      const form = new FormData()
      form.append('model', request.model)
      form.append('prompt', request.prompt)
      if (request.size) form.append('size', request.size)
      if (request.quality) form.append('quality', request.quality)
      form.append('n', '1')
      form.append('image[]', new Blob([new Uint8Array(ctx.reference.bytes)], { type: ctx.reference.mime }), ctx.reference.name)
      response = await ctx.http.api(`${ctx.baseUrl}/v1/images/edits`, { method: 'POST', headers: auth, body: form })
    } else {
      response = await ctx.http.api(`${ctx.baseUrl}/v1/images/generations`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          n: 1,
          ...(request.size ? { size: request.size } : {}),
          ...(request.quality ? { quality: request.quality } : {})
        })
      })
    }
    const body = await readJson(response)
    if (!response.ok) throw httpFailure('openai', response.status, body)
    return { kind: 'done', output: pictureOf(body) }
  }
}
