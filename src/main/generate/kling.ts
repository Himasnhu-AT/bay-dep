/**
 * Kling video: `/v1/videos/text2video` or `/v1/videos/image2video`, polled by task id.
 *
 * Auth is a short-lived HS256 JWT signed with the secret key, `iss` = the access key — the
 * scheme Kling documents for access-key/secret-key pairs, and the one OpenCreator's
 * `kling-auth.ts` (Apache-2.0) implements; this is a rewrite of that idea with `node:crypto`.
 * A fresh token is signed for every request, so a job resumed hours later never sends an
 * expired one.
 *
 * The handle is `<endpoint>/<task id>` because the task is queried under the endpoint that
 * created it.
 */

import { createHmac } from 'node:crypto'
import type { Adapter, AdapterContext } from './adapter'
import { ProviderError, httpFailure, readJson } from './adapter'
import { RESULT_MAX_BYTES, type GenerationRequest } from '@shared/generation'

/** Signed per request; valid 30 minutes, and 5 seconds before now for clock skew. */
export function klingToken(accessKey: string, secretKey: string, nowMs: number): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(nowMs / 1000)
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const payload = encode({ iss: accessKey, exp: now + 1800, nbf: now - 5 })
  const signature = createHmac('sha256', secretKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

interface KlingBody {
  code?: number
  message?: string
  data?: {
    task_id?: string
    task_status?: 'submitted' | 'processing' | 'succeed' | 'failed'
    task_status_msg?: string
    task_result?: { videos?: { url?: string; duration?: string }[] }
  }
}

function auth(ctx: AdapterContext): Record<string, string> {
  return { Authorization: `Bearer ${klingToken(ctx.credentials.accessKey ?? '', ctx.credentials.secretKey ?? '', ctx.now())}` }
}

/** Kling answers errors as HTTP 200 with a non-zero `code` as often as with a 4xx. */
function refused(body: KlingBody | null, status: number): ProviderError {
  if (status >= 400) return httpFailure('kling', status, body)
  return new ProviderError(`Kling refused the request (code ${body?.code ?? '?'}): "${body?.message ?? 'no message'}".`, false, status)
}

const ENDPOINTS = ['text2video', 'image2video'] as const

export const kling: Adapter = {
  async start(request: GenerationRequest, ctx: AdapterContext) {
    const endpoint = ctx.reference ? 'image2video' : 'text2video'
    const body: Record<string, unknown> = { model_name: request.model, prompt: request.prompt }
    if (request.negativePrompt) body.negative_prompt = request.negativePrompt
    if (request.durationSeconds) body.duration = String(request.durationSeconds)
    if (request.mode) body.mode = request.mode
    // Kling takes the image as bare base64, without a `data:` prefix.
    if (ctx.reference) body.image = ctx.reference.bytes.toString('base64')
    else if (request.aspectRatio) body.aspect_ratio = request.aspectRatio
    const response = await ctx.http.api(`${ctx.baseUrl}/v1/videos/${endpoint}`, {
      method: 'POST',
      headers: { ...auth(ctx), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const answer = (await readJson(response)) as KlingBody | null
    if (!response.ok || answer?.code !== 0) throw refused(answer, response.status)
    const id = answer.data?.task_id
    if (!id) throw new ProviderError('Kling accepted the request but returned no task id. Generate again.', false)
    return { kind: 'pending', handle: `${endpoint}/${id}` }
  },

  async poll(handle: string, ctx: AdapterContext) {
    const [endpoint, id] = handle.split('/')
    if (!endpoint || !id || !(ENDPOINTS as readonly string[]).includes(endpoint) || !/^[\w-]+$/.test(id)) {
      return { kind: 'failed', error: `bay cannot follow the Kling task "${handle.slice(0, 80)}".` }
    }
    const response = await ctx.http.api(`${ctx.baseUrl}/v1/videos/${endpoint}/${id}`, { headers: auth(ctx) })
    const answer = (await readJson(response)) as KlingBody | null
    if (!response.ok || answer?.code !== 0) throw refused(answer, response.status)
    const status = answer.data?.task_status
    if (status === 'failed') return { kind: 'failed', error: `Kling failed: ${answer.data?.task_status_msg ?? 'no reason given'}.` }
    if (status !== 'succeed') return { kind: 'running' }
    const url = answer.data?.task_result?.videos?.[0]?.url
    if (!url) return { kind: 'failed', error: 'Kling finished without a clip. Generate again.' }
    return { kind: 'ready', location: url }
  },

  async collect(location: string, ctx: AdapterContext) {
    // The result URL is Kling's CDN, not the API: no token goes with it.
    const { bytes, contentType } = await ctx.http.download(location, undefined, RESULT_MAX_BYTES)
    return { bytes, mime: contentType.startsWith('video/') ? contentType : 'video/mp4' }
  }
}
