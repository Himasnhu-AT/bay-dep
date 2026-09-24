/**
 * Generation in the running app: the wiring of `keys`, `jobs`, `http` and the adapters to
 * Electron's `safeStorage`, `userData`, ffprobe and the `bay://` allowlist.
 *
 * **Network.** Node's own `fetch`, like the access check — never Electron's `net.fetch`, which
 * rides the editor's session that `offline.ts` keeps offline. Every request goes through
 * `providerHttp`, fenced to the provider's hosts in `@shared/generation`. Nothing is contacted
 * until a generation tool starts a job, or bay restarts with a job still running.
 */

import { app, safeStorage } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PROVIDERS,
  type GenerationJob,
  type GenerationProvider,
  type GenerationRequest,
  type ProviderKeyStatus
} from '@shared/generation'
import type { Cipher } from '../auth/token-store'
import { probe } from '../ffmpeg/probe'
import { generatedDir } from '../paths'
import { isAllowed } from '../protocol'
import type { Adapter } from './adapter'
import { geminiImage } from './gemini-image'
import { providerHttp, policyFor, type Fetch } from './http'
import { GenerationJobs } from './jobs'
import { KeyRing } from './keys'
import { kling } from './kling'
import { openaiImage } from './openai-image'
import { veo } from './veo'

const cipher: Cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (sealed) => safeStorage.decryptString(sealed)
}

const nodeFetch: Fetch = (url, init) => fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(5 * 60 * 1000) })

/** One adapter per provider, chosen by the model's kind where a provider has two. */
function adapterFor(image: Adapter, video: Adapter): Adapter {
  return {
    start: (request, ctx) => (request.kind === 'video' ? video : image).start(request, ctx),
    poll: (handle, ctx) => (video.poll ? video.poll(handle, ctx) : Promise.resolve({ kind: 'failed', error: 'Nothing to poll.' })),
    collect: (location, ctx) => (video.collect ? video.collect(location, ctx) : Promise.reject(new Error('Nothing to collect.')))
  }
}

let keys: KeyRing | null = null
let jobs: GenerationJobs | null = null

function ring(): KeyRing {
  if (!keys) {
    const file = join(app.getPath('userData'), 'generation-keys.json')
    keys = new KeyRing(cipher, {
      read: () => readFile(file).catch(() => null),
      write: async (bytes) => {
        await writeFile(`${file}.tmp`, bytes, { mode: 0o600 })
        await rename(`${file}.tmp`, file)
      }
    })
  }
  return keys
}

function table(): GenerationJobs {
  if (!jobs) {
    jobs = new GenerationJobs({
      file: join(app.getPath('userData'), 'generation-jobs.json'),
      outDir: generatedDir(),
      adapters: { openai: openaiImage, gemini: adapterFor(geminiImage, veo), kling },
      http: (provider) => providerHttp(nodeFetch, policyFor(provider), PROVIDERS[provider].label),
      baseUrl: (provider) => `https://${PROVIDERS[provider].apiHosts[0]}`,
      credentials: (provider) => ring().get(provider),
      probe: (path) => probe(path),
      // Only a file already admitted to `bay://` — an imported asset — may be sent as a reference.
      referenceAllowed: (path) => isAllowed(path)
    })
  }
  return jobs
}

/** Loads the keys and the job table, and resumes polling any job that was running. */
export async function startGeneration(): Promise<void> {
  await ring().load()
  await table().load()
}

export function stopGeneration(): void {
  jobs?.stop()
}

export async function generationKeys(): Promise<ProviderKeyStatus[]> {
  return ring().status()
}

export async function setGenerationKey(
  provider: GenerationProvider,
  fields: Record<string, string>
): Promise<{ ok: true; keys: ProviderKeyStatus[] } | { ok: false; error: string }> {
  const result = await ring().set(provider, fields ?? {})
  return result.ok ? { ok: true, keys: ring().status() } : result
}

export async function clearGenerationKey(provider: GenerationProvider): Promise<ProviderKeyStatus[]> {
  if (PROVIDERS[provider]) await ring().clear(provider)
  return ring().status()
}

export function startGenerationJob(request: GenerationRequest): Promise<{ ok: true; job: GenerationJob } | { ok: false; error: string }> {
  return table().start(request)
}

export async function generationJob(id: string): Promise<GenerationJob | null> {
  return table().get(String(id))
}

export async function generationJobs(): Promise<GenerationJob[]> {
  return table().list()
}
