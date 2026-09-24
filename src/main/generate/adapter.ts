/**
 * What every provider adapter is: `start` a request, `poll` a long-running one, `collect` its file.
 *
 * An image provider answers `start` with the picture itself; a video provider answers with a
 * handle that `poll` checks until it names a location, which `collect` downloads. `jobs.ts` drives
 * all of them the same way and owns persistence, retries and the output file — an adapter only
 * speaks its provider's HTTP.
 */

import type { GenerationProvider, GenerationRequest } from '@shared/generation'
import type { ProviderHttp } from './http'

export type Credentials = Record<string, string>

export interface Reference {
  bytes: Buffer
  mime: string
  name: string
}

export interface AdapterContext {
  http: ProviderHttp
  credentials: Credentials
  /** `https://<api host>` in the app; a local stub in the tests. */
  baseUrl: string
  reference: Reference | null
  /** Milliseconds since the epoch; Kling's JWT is signed against it. */
  now(): number
}

export interface Output {
  bytes: Buffer
  mime: string
}

export type StartResult = { kind: 'done'; output: Output } | { kind: 'pending'; handle: string }

export type PollResult =
  | { kind: 'running'; progress?: number }
  | { kind: 'ready'; location: string }
  | { kind: 'failed'; error: string }

export interface Adapter {
  start(request: GenerationRequest, ctx: AdapterContext): Promise<StartResult>
  poll?(handle: string, ctx: AdapterContext): Promise<PollResult>
  collect?(location: string, ctx: AdapterContext): Promise<Output>
}

/**
 * A provider's refusal. `retryable` separates "try the same call later" (a 5xx, a rate limit
 * while polling) from "this call will never work" (a bad key, a refused prompt).
 */
export class ProviderError extends Error {
  readonly retryable: boolean
  readonly status: number | null
  constructor(message: string, retryable: boolean, status: number | null = null) {
    super(message)
    this.name = 'ProviderError'
    this.retryable = retryable
    this.status = status
  }
}

const LABEL: Record<GenerationProvider, string> = { openai: 'OpenAI', gemini: 'Gemini', kling: 'Kling', elevenlabs: 'ElevenLabs' }

/** Pulls the provider's own message out of an error body, whichever of the usual shapes it has. */
export function providerMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return typeof body === 'string' ? body.slice(0, 400) : ''
  const record = body as Record<string, unknown>
  const error = record.error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') return message.slice(0, 400)
  }
  if (typeof error === 'string') return error.slice(0, 400)
  if (typeof record.message === 'string') return record.message.slice(0, 400)
  return ''
}

/**
 * The sentence for a failed HTTP call, written for the agent that has to decide what to do next.
 */
export function httpFailure(provider: GenerationProvider, status: number, body: unknown): ProviderError {
  const label = LABEL[provider]
  const detail = providerMessage(body)
  const said = detail ? ` ${label} said: "${detail}"` : ''
  if (status === 401 || status === 403) {
    return new ProviderError(
      `${label} refused the key (${status}).${said} Ask the user to check the ${label} key in Settings › Providers — never ask for a key in chat.`,
      false,
      status
    )
  }
  if (status === 429) {
    return new ProviderError(`${label} is rate-limiting or the account is out of quota (429).${said} Wait a minute, or ask the user to check billing.`, true, status)
  }
  if (status >= 500) return new ProviderError(`${label} had a server error (${status}).${said} Try again shortly.`, true, status)
  return new ProviderError(`${label} refused the request (${status}).${said}`, false, status)
}

export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** The file extension bay writes for a MIME type a provider returned. */
export function extensionFor(mime: string): string | null {
  const base = mime.split(';')[0]!.trim().toLowerCase()
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav'
  }
  return map[base] ?? null
}
