/**
 * Gemini image models ("Nano Banana"): `models/{model}:generateContent` with image output.
 *
 * Synchronous. The picture is an `inlineData` part of the first candidate. A prompt Gemini
 * declines comes back 200 with no image part and a `finishReason`/`blockReason` — that is a
 * refusal, reported as one, not an empty success.
 */

import type { Adapter, AdapterContext, Output } from './adapter'
import { ProviderError, httpFailure, readJson } from './adapter'
import type { GenerationRequest } from '@shared/generation'

interface Part {
  text?: string
  inlineData?: { mimeType?: string; data?: string }
  inline_data?: { mime_type?: string; data?: string }
}

function pictureOf(body: unknown): Output {
  const record = (body ?? {}) as {
    candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]
    promptFeedback?: { blockReason?: string }
  }
  const candidate = record.candidates?.[0]
  for (const part of candidate?.content?.parts ?? []) {
    const data = part.inlineData?.data ?? part.inline_data?.data
    const mime = part.inlineData?.mimeType ?? part.inline_data?.mime_type ?? 'image/png'
    if (typeof data === 'string' && data) return { bytes: Buffer.from(data, 'base64'), mime }
  }
  const reason = record.promptFeedback?.blockReason ?? candidate?.finishReason
  const said = (candidate?.content?.parts ?? []).map((p) => p.text).filter(Boolean).join(' ').slice(0, 300)
  throw new ProviderError(
    `Gemini returned no picture${reason ? ` (${reason})` : ''}${said ? `: "${said}"` : ''}. Rephrase the prompt and generate again.`,
    false
  )
}

export const geminiImage: Adapter = {
  async start(request: GenerationRequest, ctx: AdapterContext) {
    const parts: Part[] = [{ text: request.prompt }]
    if (ctx.reference) parts.push({ inlineData: { mimeType: ctx.reference.mime, data: ctx.reference.bytes.toString('base64') } })
    const imageConfig: Record<string, string> = {}
    if (request.aspectRatio) imageConfig.aspectRatio = request.aspectRatio
    if (request.size) imageConfig.imageSize = request.size
    const response = await ctx.http.api(`${ctx.baseUrl}/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': ctx.credentials.apiKey ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig }
      })
    })
    const body = await readJson(response)
    if (!response.ok) throw httpFailure('gemini', response.status, body)
    return { kind: 'done', output: pictureOf(body) }
  }
}
