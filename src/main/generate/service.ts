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
  type GenerationLimits,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationSpending,
  type ProviderKeyStatus,
  type StartRefused
} from '@shared/generation'
import { DubRecords, type StoredDub } from './dub-records'
import type { Cipher } from '../auth/token-store'
import { probe } from '../ffmpeg/probe'
import { generatedDir } from '../paths'
import { isAllowed } from '../protocol'
import type { Adapter } from './adapter'
import { geminiImage } from './gemini-image'
import { providerHttp, policyFor, type Fetch } from './http'
import { GenerationJobs } from './jobs'
import { KeyRing, type KeyStorage } from './keys'
import { localGenerationBase } from './local-base'
import { kling } from './kling'
import { GenerationLimitsStore } from './limits'
import { openaiImage } from './openai-image'
import { elevenlabsSpeech, geminiSpeech, openaiSpeech, withSpeech } from './speech-adapters'
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
let limits: GenerationLimitsStore | null = null
let ready: Promise<void> | null = null

/**
 * A file under userData, written through a temp file. Callers chain their own writes (`KeyRing`,
 * `GenerationLimitsStore`), so one file's temp is never written by two saves at once.
 */
function userFile(name: string): KeyStorage {
  const file = join(app.getPath('userData'), name)
  return {
    read: () => readFile(file).catch(() => null),
    write: async (bytes) => {
      await writeFile(`${file}.tmp`, bytes, { mode: 0o600 })
      await rename(`${file}.tmp`, file)
    }
  }
}

function ring(): KeyRing {
  keys ??= new KeyRing(cipher, userFile('generation-keys.json'))
  return keys
}

function limitsStore(): GenerationLimitsStore {
  limits ??= new GenerationLimitsStore(userFile('generation-limits.json'))
  return limits
}

/**
 * Every entry below awaits this first. Without it, a key saved or a job started before
 * `startGeneration` finished reading the files would write a file lacking what they held.
 * A load that fails is logged and not retried: the entries then work on what did load.
 */
function whenReady(): Promise<void> {
  ready ??= (async () => {
    await Promise.all([ring().load(), limitsStore().load()])
    await table().load()
  })().catch((error: unknown) => {
    console.error(`[bay] generation: could not load: ${error instanceof Error ? error.message : String(error)}`)
  })
  return ready
}

function table(): GenerationJobs {
  if (!jobs) {
    // A checkout run against bay's stub (`BAY_GENERATION_BASE`); see `local-base.ts`.
    const local = localGenerationBase(app.isPackaged, process.env)
    if (local.kind === 'ignored') console.error(`[bay] generation: ${local.reason}`)
    if (local.kind === 'local') console.log(`[bay] generation: every provider is the local stub ${local.baseUrl} (BAY_GENERATION_BASE)`)
    jobs = new GenerationJobs({
      file: join(app.getPath('userData'), 'generation-jobs.json'),
      outDir: generatedDir(),
      adapters: {
        openai: withSpeech(openaiImage, openaiSpeech),
        gemini: withSpeech(adapterFor(geminiImage, veo), geminiSpeech),
        kling,
        elevenlabs: withSpeech(null, elevenlabsSpeech)
      },
      http: (provider) => providerHttp(nodeFetch, local.kind === 'local' ? local.policy : policyFor(provider), PROVIDERS[provider].label),
      baseUrl: (provider) => (local.kind === 'local' ? local.baseUrl : `https://${PROVIDERS[provider].apiHosts[0]}`),
      credentials: (provider) => ring().get(provider),
      probe: (path) => probe(path),
      // Only a file already admitted to `bay://` — an imported asset — may be sent as a reference.
      referenceAllowed: (path) => isAllowed(path),
      limits: () => limitsStore().get()
    })
  }
  return jobs
}

/** Loads the keys, the limits and the job table, and resumes polling any job that was running. */
export function startGeneration(): Promise<void> {
  return whenReady()
}

export function stopGeneration(): void {
  jobs?.stop()
}

export async function generationKeys(): Promise<ProviderKeyStatus[]> {
  await whenReady()
  return ring().status()
}

export async function setGenerationKey(
  provider: GenerationProvider,
  fields: Record<string, string>
): Promise<{ ok: true; keys: ProviderKeyStatus[] } | { ok: false; error: string }> {
  await whenReady()
  const result = await ring().set(provider, fields ?? {})
  return result.ok ? { ok: true, keys: ring().status() } : result
}

export async function clearGenerationKey(provider: GenerationProvider): Promise<ProviderKeyStatus[]> {
  await whenReady()
  if (PROVIDERS[provider]) await ring().clear(provider)
  return ring().status()
}

export async function startGenerationJob(
  request: GenerationRequest,
  options?: { reservationId?: string }
): Promise<{ ok: true; job: GenerationJob; spending: GenerationSpending } | StartRefused> {
  await whenReady()
  const reservationId = typeof options?.reservationId === 'string' ? options.reservationId : undefined
  return table().start(request, reservationId !== undefined ? { reservationId } : {})
}

export async function reserveGeneration(
  totalUsd: number
): Promise<{ ok: true; reservationId: string; spending: GenerationSpending } | StartRefused> {
  await whenReady()
  return table().reserve(totalUsd)
}

export async function releaseGeneration(reservationId: string): Promise<GenerationSpending> {
  await whenReady()
  return table().release(reservationId)
}

let dubRecords: DubRecords | null = null
function dubStore(): DubRecords {
  dubRecords ??= new DubRecords(join(app.getPath('userData'), 'generation-dubs.json'))
  return dubRecords
}

export function generationDubs(): Promise<StoredDub[]> {
  return dubStore().list()
}

export function saveGenerationDub(record: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  return dubStore().save(record)
}

export async function generationJob(id: string): Promise<GenerationJob | null> {
  await whenReady()
  return table().get(String(id))
}

export async function generationJobs(): Promise<GenerationJob[]> {
  await whenReady()
  return table().list()
}

export async function generationSpending(): Promise<GenerationSpending> {
  await whenReady()
  return table().spending()
}

export async function setGenerationLimits(
  input: GenerationLimits
): Promise<{ ok: true; spending: GenerationSpending } | { ok: false; error: string }> {
  await whenReady()
  const result = await limitsStore().set(input)
  return result.ok ? { ok: true, spending: table().spending() } : result
}
