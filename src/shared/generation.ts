/**
 * AI image and video generation: the contract, written before any adapter.
 *
 * This is bay's fourth network exception (CLAUDE.md, "Nothing reaches the network"). Main — never
 * the renderer — calls a provider's first-party API with a key the user pasted into Settings ›
 * Providers, and only when a generation tool is called. What is sent is the prompt, the options
 * and, for image-to-image or image-to-video, the one reference picture the call named. Nothing
 * else about the project leaves the machine. For speech (`@shared/speech`) the prompt is the text
 * to be spoken, with the voice and delivery options; no audio is ever sent.
 *
 * Everything here is data plus pure functions, so both processes compile it and the tests can
 * hold it still:
 *
 * - `PROVIDERS`: who is called, on which hosts, with which key fields. The hosts are the
 *   allowlist `src/main/generate/http.ts` enforces, redirects included.
 * - `MODELS`: each model's kind, capabilities, the values each option may take, and a rough cost.
 * - `validateGeneration`: **refuses** a value the model does not take and names the ones it
 *   does. It never narrows silently — a 12-second request is not quietly sent as 8, because the
 *   agent would then plan the edit around a clip that is not the length it asked for. Omitted
 *   options take the model's default, and the result says which defaults were applied.
 * - `GenerationJob`: the row main persists before submitting and polls until it lands.
 *
 * API shapes were checked against the providers' docs in September 2026: OpenAI Images
 * (`/v1/images/generations`, `/v1/images/edits`), Gemini `generateContent` with image output,
 * Veo 3.1 `predictLongRunning`, and Kling's `/v1/videos/{text2video,image2video}` with an HS256
 * JWT signed from the access key and secret key. The catalog's shape follows OpenCreator's
 * provider catalog (Apache-2.0), rewritten for bay.
 *
 * Costs are estimates for the agent to weigh a call, never a bill: they are list prices at the
 * time of writing and the provider's own dashboard is the authority.
 */

export type GenerationProvider = 'openai' | 'gemini' | 'kling' | 'elevenlabs'
/** `speech` is a voiceover from text; its catalog and validator are `@shared/speech`. */
export type GenerationKind = 'image' | 'video' | 'speech'
/**
 * - `t2i`/`t2v`: from a prompt alone.
 * - `i2i`: a reference picture edited or restyled into a new picture.
 * - `i2v`: a reference picture animated into a clip.
 * - `firstFrame`: the reference is used as the clip's exact first frame (Veo, Kling i2v).
 */
export type GenerationCapability = 't2i' | 'i2i' | 't2v' | 'i2v' | 'firstFrame'

export const GENERATION_PROVIDERS: readonly GenerationProvider[] = ['openai', 'gemini', 'kling', 'elevenlabs']

export interface ProviderSpec {
  id: GenerationProvider
  label: string
  /** Hosts the API itself is called on. https only. */
  apiHosts: readonly string[]
  /**
   * Hosts a result may be downloaded from, and a redirect may land on. An entry starting with a
   * dot matches that domain's subdomains (`.klingai.com`); anything else matches exactly.
   * Credentials are sent only to `apiHosts`, never to one of these.
   */
  downloadHosts: readonly string[]
  /** What Settings asks for. Kling signs a JWT from two values; the others take one key. */
  keyFields: readonly { id: string; label: string }[]
  /** Where a person gets a key, shown in Settings as text. */
  keyPage: string
}

export const PROVIDERS: Record<GenerationProvider, ProviderSpec> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    apiHosts: ['api.openai.com'],
    // gpt-image returns the picture inline as base64; nothing is downloaded.
    downloadHosts: [],
    keyFields: [{ id: 'apiKey', label: 'API key' }],
    keyPage: 'platform.openai.com/api-keys'
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    apiHosts: ['generativelanguage.googleapis.com'],
    // A Veo result is a `generativelanguage` files URI that redirects to Google's storage.
    // The redirect target has not been observed from here (no live calls are made by the tests);
    // these are the hosts Google serves download redirects from.
    downloadHosts: ['generativelanguage.googleapis.com', '.googleusercontent.com', 'storage.googleapis.com'],
    keyFields: [{ id: 'apiKey', label: 'API key' }],
    keyPage: 'aistudio.google.com/apikey'
  },
  kling: {
    id: 'kling',
    label: 'Kling',
    apiHosts: ['api-singapore.klingai.com'],
    // Kling's result URLs are on its own CDN domains; not observed from here either.
    downloadHosts: ['.klingai.com', '.kling.ai'],
    keyFields: [
      { id: 'accessKey', label: 'Access key' },
      { id: 'secretKey', label: 'Secret key' }
    ],
    keyPage: 'app.klingai.com/global/dev (API keys)'
  },
  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    apiHosts: ['api.elevenlabs.io'],
    // Speech comes back as the response body; nothing is downloaded.
    downloadHosts: [],
    keyFields: [{ id: 'apiKey', label: 'API key' }],
    keyPage: 'elevenlabs.io/app/settings/api-keys'
  }
}

/** A per-unit price keyed by one option's value, or a flat one. */
export interface CostTable {
  /** Which option the price varies with; absent for a flat price. */
  by?: 'quality' | 'size' | 'resolution' | 'mode'
  /** USD per image (image models) or per second of output (video models). */
  usd: Record<string, number> | number
}

export interface ModelSpec {
  id: string
  provider: GenerationProvider
  kind: GenerationKind
  label: string
  capabilities: readonly GenerationCapability[]
  /** Allowed values per option. An option with no entry is one this model does not take. */
  aspectRatios?: readonly string[]
  sizes?: readonly string[]
  qualities?: readonly string[]
  durations?: readonly number[]
  resolutions?: readonly string[]
  modes?: readonly string[]
  negativePrompt?: boolean
  /** Defaults applied when the call leaves an option out. */
  defaults: Partial<Record<OptionName, string | number>>
  /**
   * When a reference picture is given, its own shape decides the frame, and an `aspectRatio`
   * would be ignored by the provider — so it is refused rather than sent to be ignored.
   */
  aspectFromReference?: boolean
  /** Combinations the provider refuses, stated so bay refuses them first. */
  rules?: readonly ModelRule[]
  /** Whether the output carries sound. A clip that should and does not is a finding. */
  audio?: boolean
  maxPromptChars: number
  cost: CostTable
}

export type OptionName = 'aspectRatio' | 'size' | 'quality' | 'durationSeconds' | 'resolution' | 'mode'

export interface ModelRule {
  /** Applies when this option has one of these values (after defaults), or when a reference is given. */
  when: { option: OptionName; values: readonly (string | number)[] } | { reference: true }
  /** Then this option must be one of these values. */
  require: { option: OptionName; values: readonly (string | number)[] }
  why: string
}

const OPENAI_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const
const GEMINI_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const

export const MODELS: readonly ModelSpec[] = [
  {
    id: 'gpt-image-1.5',
    provider: 'openai',
    kind: 'image',
    label: 'GPT Image 1.5',
    capabilities: ['t2i', 'i2i'],
    sizes: OPENAI_SIZES,
    qualities: ['low', 'medium', 'high'],
    defaults: { size: '1024x1024', quality: 'medium' },
    maxPromptChars: 32000,
    cost: { by: 'quality', usd: { low: 0.013, medium: 0.05, high: 0.2 } }
  },
  {
    id: 'gpt-image-1',
    provider: 'openai',
    kind: 'image',
    label: 'GPT Image 1',
    capabilities: ['t2i', 'i2i'],
    sizes: OPENAI_SIZES,
    qualities: ['low', 'medium', 'high'],
    defaults: { size: '1024x1024', quality: 'medium' },
    maxPromptChars: 32000,
    cost: { by: 'quality', usd: { low: 0.016, medium: 0.063, high: 0.25 } }
  },
  {
    id: 'gemini-2.5-flash-image',
    provider: 'gemini',
    kind: 'image',
    label: 'Nano Banana (Gemini 2.5 Flash Image)',
    capabilities: ['t2i', 'i2i'],
    aspectRatios: GEMINI_RATIOS,
    defaults: { aspectRatio: '16:9' },
    maxPromptChars: 8000,
    cost: { usd: 0.039 }
  },
  {
    id: 'gemini-3-pro-image',
    provider: 'gemini',
    kind: 'image',
    label: 'Nano Banana Pro (Gemini 3 Pro Image)',
    capabilities: ['t2i', 'i2i'],
    aspectRatios: GEMINI_RATIOS,
    sizes: ['1K', '2K', '4K'],
    defaults: { aspectRatio: '16:9', size: '2K' },
    maxPromptChars: 8000,
    cost: { by: 'size', usd: { '1K': 0.134, '2K': 0.134, '4K': 0.24 } }
  },
  {
    id: 'veo-3.1-generate-preview',
    provider: 'gemini',
    kind: 'video',
    label: 'Veo 3.1',
    capabilities: ['t2v', 'i2v', 'firstFrame'],
    aspectRatios: ['16:9', '9:16'],
    durations: [4, 6, 8],
    resolutions: ['720p', '1080p', '4k'],
    negativePrompt: true,
    defaults: { aspectRatio: '16:9', durationSeconds: 8, resolution: '720p' },
    rules: [
      { when: { option: 'resolution', values: ['1080p', '4k'] }, require: { option: 'durationSeconds', values: [8] }, why: 'Veo renders 1080p and 4k only as 8-second clips' },
      { when: { reference: true }, require: { option: 'durationSeconds', values: [8] }, why: 'Veo takes a first frame only for 8-second clips' }
    ],
    audio: true,
    maxPromptChars: 4000,
    cost: { by: 'resolution', usd: { '720p': 0.4, '1080p': 0.4, '4k': 0.6 } }
  },
  {
    id: 'veo-3.1-fast-generate-preview',
    provider: 'gemini',
    kind: 'video',
    label: 'Veo 3.1 Fast',
    capabilities: ['t2v', 'i2v', 'firstFrame'],
    aspectRatios: ['16:9', '9:16'],
    durations: [4, 6, 8],
    resolutions: ['720p', '1080p', '4k'],
    negativePrompt: true,
    defaults: { aspectRatio: '16:9', durationSeconds: 8, resolution: '720p' },
    rules: [
      { when: { option: 'resolution', values: ['1080p', '4k'] }, require: { option: 'durationSeconds', values: [8] }, why: 'Veo renders 1080p and 4k only as 8-second clips' },
      { when: { reference: true }, require: { option: 'durationSeconds', values: [8] }, why: 'Veo takes a first frame only for 8-second clips' }
    ],
    audio: true,
    maxPromptChars: 4000,
    cost: { by: 'resolution', usd: { '720p': 0.15, '1080p': 0.15, '4k': 0.35 } }
  },
  {
    id: 'kling-v2-6',
    provider: 'kling',
    kind: 'video',
    label: 'Kling 2.6',
    capabilities: ['t2v', 'i2v', 'firstFrame'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    durations: [5, 10],
    modes: ['std', 'pro'],
    negativePrompt: true,
    aspectFromReference: true,
    defaults: { aspectRatio: '16:9', durationSeconds: 5, mode: 'std' },
    maxPromptChars: 2500,
    cost: { by: 'mode', usd: { std: 0.07, pro: 0.14 } }
  },
  {
    id: 'kling-v2-5-turbo',
    provider: 'kling',
    kind: 'video',
    label: 'Kling 2.5 Turbo',
    capabilities: ['t2v', 'i2v', 'firstFrame'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    durations: [5, 10],
    modes: ['std', 'pro'],
    negativePrompt: true,
    aspectFromReference: true,
    defaults: { aspectRatio: '16:9', durationSeconds: 5, mode: 'pro' },
    maxPromptChars: 2500,
    cost: { by: 'mode', usd: { std: 0.042, pro: 0.07 } }
  },
  {
    id: 'kling-v2-1-master',
    provider: 'kling',
    kind: 'video',
    label: 'Kling 2.1 Master',
    capabilities: ['t2v', 'i2v', 'firstFrame'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    durations: [5, 10],
    negativePrompt: true,
    aspectFromReference: true,
    defaults: { aspectRatio: '16:9', durationSeconds: 5 },
    maxPromptChars: 2500,
    cost: { usd: 0.28 }
  }
]

/** File types a reference picture may be. The providers take these three and nothing else. */
export const REFERENCE_IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}

/** The largest reference picture sent. Providers cap inline images near here; bay refuses first. */
export const REFERENCE_MAX_BYTES = 20 * 1024 * 1024

/** The largest result bay will download. A Veo 4k clip is well under this. */
export const RESULT_MAX_BYTES = 512 * 1024 * 1024

/** A request as main receives it: validated, with every default filled in. */
export interface GenerationRequest {
  provider: GenerationProvider
  model: string
  kind: GenerationKind
  prompt: string
  negativePrompt?: string
  aspectRatio?: string
  size?: string
  quality?: string
  durationSeconds?: number
  resolution?: string
  mode?: string
  /** An absolute path to the one picture sent with the prompt, for i2i/i2v. */
  referencePath?: string
  // Speech only (`@shared/speech`); `prompt` holds the words to be spoken.
  voice?: string
  /** A preset from `SPEECH_STYLES`. */
  style?: string
  /** Custom delivery instructions, sent after the preset's. */
  instructions?: string
  speed?: number
  /** The language the estimate used, when the call named one. */
  language?: string
  /** `@shared/speech-duration`'s estimate, compared with the measured length when it lands. */
  estimatedSeconds?: number
}

export type GenerationValidation =
  | {
      ok: true
      request: GenerationRequest
      model: ModelSpec
      /** Rough USD for this one call. See the module header: an estimate, never a bill. */
      estimatedCostUsd: number
      /** `option=value` for each default filled in, so the agent knows what it did not choose. */
      defaultsApplied: string[]
    }
  | { ok: false; errors: string[] }

export function findModel(id: string): ModelSpec | undefined {
  return MODELS.find((m) => m.id === id)
}

export function modelsOf(kind: GenerationKind, provider?: GenerationProvider): ModelSpec[] {
  return MODELS.filter((m) => m.kind === kind && (provider === undefined || m.provider === provider))
}

/**
 * The model list a tool description carries: id, provider, what it can do, options and price.
 * Derived from `MODELS`, so the catalog the agent reads cannot drift from the one bay enforces.
 */
export function describeModels(kind: GenerationKind): string {
  return (
    modelsOf(kind)
      .map((m) => {
        const options: string[] = []
        if (m.aspectRatios) options.push(`aspectRatio ${m.aspectRatios.join('/')}`)
        if (m.sizes) options.push(`size ${m.sizes.join('/')}`)
        if (m.qualities) options.push(`quality ${m.qualities.join('/')}`)
        if (m.durations) options.push(`durationSeconds ${m.durations.join('/')}`)
        if (m.resolutions) options.push(`resolution ${m.resolutions.join('/')}`)
        if (m.modes) options.push(`mode ${m.modes.join('/')}`)
        const unit = m.kind === 'video' ? '/s' : '/image'
        const prices = typeof m.cost.usd === 'number' ? [m.cost.usd] : Object.values(m.cost.usd)
        const low = Math.min(...prices)
        const high = Math.max(...prices)
        const price = low === high ? `~$${low}${unit}` : `~$${low}–${high}${unit}`
        return `${m.id} (${PROVIDERS[m.provider].label}; ${m.capabilities.join(', ')}; ${options.join('; ') || 'prompt only'}; ${price}${m.audio ? '; with sound' : ''})`
      })
      .join('. ') + '.'
  )
}

const OPTION_VALUES: Record<OptionName, keyof ModelSpec> = {
  aspectRatio: 'aspectRatios',
  size: 'sizes',
  quality: 'qualities',
  durationSeconds: 'durations',
  resolution: 'resolutions',
  mode: 'modes'
}

const OPTIONS = Object.keys(OPTION_VALUES) as OptionName[]

function list(values: readonly (string | number)[]): string {
  return values.map((v) => (typeof v === 'number' ? String(v) : `"${v}"`)).join(', ')
}

/**
 * Checks a call against the catalog. `input` is the tool's arguments (or the IPC request) as
 * given; `referencePath` is what the caller resolved a reference asset to, if any.
 *
 * Every error names what would be accepted, so the agent's next call can succeed.
 */
export function validateGeneration(
  input: Record<string, unknown>,
  kind: GenerationKind
): GenerationValidation {
  const errors: string[] = []
  const verb = kind === 'image' ? 'generate_image' : 'generate_video'
  const other = kind === 'image' ? 'generate_video' : 'generate_image'

  const modelId = typeof input.model === 'string' ? input.model : ''
  const model = findModel(modelId)
  const choices = modelsOf(kind)
    .map((m) => `${m.id} (${m.provider})`)
    .join(', ')
  if (!model) {
    return { ok: false, errors: [`There is no ${kind} model "${modelId}". ${verb} takes: ${choices}.`] }
  }
  if (model.kind !== kind) {
    return {
      ok: false,
      errors: [`${model.id} makes ${model.kind === 'image' ? 'images' : 'video'}; call ${other} for it. ${verb} takes: ${choices}.`]
    }
  }
  if (input.provider !== undefined && input.provider !== model.provider) {
    errors.push(`${model.id} is a ${PROVIDERS[model.provider].label} model, not "${String(input.provider)}". Leave provider out, or pass "${model.provider}".`)
  }

  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  if (!prompt) errors.push('prompt is empty. Describe the picture or shot to generate.')
  else if (prompt.length > model.maxPromptChars) {
    errors.push(`prompt is ${prompt.length} characters; ${model.id} takes at most ${model.maxPromptChars}. Shorten it.`)
  }

  let negativePrompt: string | undefined
  if (input.negativePrompt !== undefined) {
    if (!model.negativePrompt) {
      errors.push(`${model.id} does not take negativePrompt. Say what to avoid in the prompt itself, or use one of: ${MODELS.filter((m) => m.kind === kind && m.negativePrompt).map((m) => m.id).join(', ') || 'none'}.`)
    } else if (typeof input.negativePrompt !== 'string') {
      errors.push('negativePrompt must be a string.')
    } else {
      negativePrompt = input.negativePrompt
    }
  }

  const referencePath = typeof input.referencePath === 'string' && input.referencePath ? input.referencePath : undefined
  if (referencePath !== undefined) {
    const needs: GenerationCapability = kind === 'image' ? 'i2i' : 'i2v'
    if (!model.capabilities.includes(needs)) {
      const able = modelsOf(kind).filter((m) => m.capabilities.includes(needs)).map((m) => m.id)
      errors.push(`${model.id} does not take a reference picture. Models that do: ${able.join(', ') || 'none'}.`)
    }
    const ext = referencePath.split('.').pop()?.toLowerCase() ?? ''
    if (!(ext in REFERENCE_IMAGE_TYPES)) {
      errors.push(`The reference must be a PNG, JPEG or WebP picture; "${referencePath.split('/').pop()}" is not. Pass an image asset.`)
    }
  }

  const values: Partial<Record<OptionName, string | number>> = {}
  const defaultsApplied: string[] = []
  for (const option of OPTIONS) {
    const allowed = model[OPTION_VALUES[option]] as readonly (string | number)[] | undefined
    const given = input[option]
    if (given === undefined || given === null) {
      if (option === 'aspectRatio' && referencePath && model.aspectFromReference) continue
      const fallback = model.defaults[option]
      if (fallback !== undefined) {
        values[option] = fallback
        defaultsApplied.push(`${option}=${fallback}`)
      }
      continue
    }
    if (!allowed) {
      errors.push(`${model.id} does not take ${option}. It takes: ${OPTIONS.filter((o) => model[OPTION_VALUES[o]]).join(', ') || 'no options beyond the prompt'}.`)
      continue
    }
    if (option === 'aspectRatio' && referencePath && model.aspectFromReference) {
      errors.push(`${model.id} takes its frame from the reference picture, so aspectRatio would be ignored. Leave it out, or crop the reference to the shape you want.`)
      continue
    }
    const value = option === 'durationSeconds' ? Number(given) : String(given)
    if (!allowed.includes(value)) {
      errors.push(`${model.id} does not take ${option} ${typeof value === 'number' ? value : `"${value}"`}. Allowed: ${list(allowed)}.`)
      continue
    }
    values[option] = value
  }

  for (const rule of model.rules ?? []) {
    const applies =
      'reference' in rule.when
        ? referencePath !== undefined
        : rule.when.values.includes(values[rule.when.option] as string | number)
    if (!applies) continue
    const actual = values[rule.require.option]
    if (!rule.require.values.includes(actual as string | number)) {
      const cause = 'reference' in rule.when ? 'with a reference picture' : `with ${rule.when.option} ${String(values[rule.when.option])}`
      errors.push(`${rule.why}: ${rule.require.option} must be ${list(rule.require.values)} ${cause}, not ${String(actual)}.`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  const request: GenerationRequest = {
    provider: model.provider,
    model: model.id,
    kind,
    prompt,
    ...(negativePrompt ? { negativePrompt } : {}),
    ...(values.aspectRatio !== undefined ? { aspectRatio: String(values.aspectRatio) } : {}),
    ...(values.size !== undefined ? { size: String(values.size) } : {}),
    ...(values.quality !== undefined ? { quality: String(values.quality) } : {}),
    ...(values.durationSeconds !== undefined ? { durationSeconds: Number(values.durationSeconds) } : {}),
    ...(values.resolution !== undefined ? { resolution: String(values.resolution) } : {}),
    ...(values.mode !== undefined ? { mode: String(values.mode) } : {}),
    ...(referencePath ? { referencePath } : {})
  }
  return { ok: true, request, model, estimatedCostUsd: estimateCost(model, request), defaultsApplied }
}

/** USD for one call, rounded to the cent. */
export function estimateCost(model: ModelSpec, request: GenerationRequest): number {
  const { cost } = model
  let unit: number
  if (typeof cost.usd === 'number') unit = cost.usd
  else {
    const key = cost.by ? String(request[cost.by] ?? '') : ''
    unit = cost.usd[key] ?? Math.max(...Object.values(cost.usd))
  }
  const units = model.kind === 'video' ? (request.durationSeconds ?? 0) : 1
  return Math.round(unit * units * 100) / 100
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type GenerationStatus = 'queued' | 'running' | 'done' | 'failed'

export interface GenerationFinding {
  /** `blocking`: the result is not usable and was not imported. `warn`: usable, with a caveat. */
  severity: 'blocking' | 'warn'
  message: string
}

export interface GenerationJob {
  id: string
  provider: GenerationProvider
  model: string
  kind: GenerationKind
  status: GenerationStatus
  /** 0..1 when the provider reports it. */
  progress?: number
  /** The provider's handle for a long-running job (Veo operation name, Kling task id). */
  remote?: string
  request: GenerationRequest
  /** The collected file under `<userData>/generated`, once it has landed and been checked. */
  outputPath?: string
  error?: string
  findings?: GenerationFinding[]
  estimatedCostUsd?: number
  createdAt: number
  updatedAt: number
}

/** What Settings shows per provider: whether a key is set, never the key. */
export interface ProviderKeyStatus {
  provider: GenerationProvider
  set: boolean
  /** False when there is no system keychain: the key lasts until bay quits. */
  persisted: boolean
}

/** The shape of a probe the findings read. A subset of `ProbeResult`, so no import cycle. */
export interface ProbedOutput {
  durationUs: number
  width: number | null
  height: number | null
  hasVideo: boolean
  hasAudio: boolean
}

/**
 * What is wrong with a collected file, most hidden first. A blocking finding means the file is
 * not imported: a "video" with no picture in it would otherwise be placed as a silent blank.
 */
export function findingsFor(request: GenerationRequest, probed: ProbedOutput | null, probeError?: string): GenerationFinding[] {
  const findings: GenerationFinding[] = []
  if (!probed) {
    findings.push({ severity: 'blocking', message: `The provider returned a file bay cannot read${probeError ? ` (${probeError})` : ''}. Nothing was imported; generating again is the only fix.` })
    return findings
  }
  if (request.kind === 'speech') return speechFindings(request, probed)
  if (!probed.hasVideo) {
    findings.push({
      severity: 'blocking',
      message: request.kind === 'video' ? 'The returned file has no video stream. Nothing was imported.' : 'The returned file holds no picture. Nothing was imported.'
    })
  }
  const model = findModel(request.model)
  if (request.kind === 'video' && model?.audio && !probed.hasAudio) {
    findings.push({ severity: 'warn', message: `${request.model} normally returns sound, and this clip has none — it will play silent. Add music or voice on an audio track, or generate again.` })
  }
  if (request.kind === 'video' && request.durationSeconds) {
    const seconds = probed.durationUs / 1_000_000
    if (Math.abs(seconds - request.durationSeconds) > 0.5) {
      findings.push({ severity: 'warn', message: `Asked for ${request.durationSeconds}s and got ${seconds.toFixed(2)}s. Plan the edit around the length the clip actually has.` })
    }
  }
  return findings
}

/** A voiceover with no sound, or no length, is not imported; a length far from the estimate is a warning. */
function speechFindings(request: GenerationRequest, probed: ProbedOutput): GenerationFinding[] {
  const findings: GenerationFinding[] = []
  if (!probed.hasAudio) {
    findings.push({ severity: 'blocking', message: 'The returned file has no audio stream. Nothing was imported; generate again.' })
    return findings
  }
  const seconds = probed.durationUs / 1_000_000
  if (!(seconds > 0)) {
    findings.push({ severity: 'blocking', message: 'The returned audio has no length. Nothing was imported; generate again.' })
    return findings
  }
  const estimate = request.estimatedSeconds
  if (estimate && estimate > 0 && Math.abs(seconds - estimate) > Math.max(1, estimate * 0.35)) {
    findings.push({
      severity: 'warn',
      message: `Estimated ${estimate.toFixed(1)}s of speech and got ${seconds.toFixed(2)}s. Plan the edit around the measured length${seconds > estimate ? ', or shorten the script' : ''}.`
    })
  }
  return findings
}
