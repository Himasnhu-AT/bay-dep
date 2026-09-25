/**
 * The Generate tab's decisions, kept out of React so they can be tested: what a form asks for,
 * what it costs, whether it may start, and the sentence the user reads when it may not.
 *
 * The catalog is `@shared/generation` / `@shared/speech` — the same one `generate_image`,
 * `generate_video` and `generate_speech` check against — so a form this module passes is a call
 * those tools take. Main checks again on start (keys, the spend guard); this is for showing the
 * price and the reason before anyone clicks, not the lock.
 */

import {
  modelsOf,
  PROVIDERS,
  spendRefusalOf,
  validateGeneration,
  type GenerationJob,
  type GenerationKind,
  type GenerationProvider,
  type GenerationSpending,
  type ModelSpec,
  type OptionName,
  type ProviderKeyStatus
} from '@shared/generation'
import { SPEECH_MODELS, SPEECH_STYLE_IDS, validateSpeech, type SpeechModelSpec, type SpeechStyle } from '@shared/speech'

export interface GenerateForm {
  kind: GenerationKind
  /** A model id from the catalog for `kind`. */
  model: string
  /** The prompt, or for speech the exact words to be spoken. */
  prompt: string
  /** Image/video options the model takes; absent means the model's default. */
  options: Partial<Record<OptionName, string>>
  /** Speech only. */
  voice?: string
  style?: SpeechStyle
}

/** The option controls a model shows, in the order the form lays them out. */
export const OPTION_LABELS: readonly { option: OptionName; label: string; key: keyof ModelSpec }[] = [
  { option: 'aspectRatio', label: 'Aspect', key: 'aspectRatios' },
  { option: 'size', label: 'Size', key: 'sizes' },
  { option: 'quality', label: 'Quality', key: 'qualities' },
  { option: 'durationSeconds', label: 'Length', key: 'durations' },
  { option: 'resolution', label: 'Resolution', key: 'resolutions' },
  { option: 'mode', label: 'Mode', key: 'modes' }
]

/** Every model the form offers for a kind, as `{ id, label, provider }`. */
export function modelChoices(kind: GenerationKind): { id: string; label: string; provider: GenerationProvider }[] {
  const list: readonly (ModelSpec | SpeechModelSpec)[] = kind === 'speech' ? SPEECH_MODELS : modelsOf(kind)
  return list.map((m) => ({ id: m.id, label: m.label, provider: m.provider }))
}

export function providerOf(kind: GenerationKind, modelId: string): GenerationProvider | null {
  return modelChoices(kind).find((m) => m.id === modelId)?.provider ?? null
}

/** The choices for one option of an image/video model, or null when the model does not take it. */
export function optionValues(kind: GenerationKind, modelId: string, option: OptionName): string[] | null {
  if (kind === 'speech') return null
  const model = modelsOf(kind).find((m) => m.id === modelId)
  const entry = OPTION_LABELS.find((o) => o.option === option)
  if (!model || !entry) return null
  const values = model[entry.key] as readonly (string | number)[] | undefined
  return values ? values.map(String) : null
}

/** The value an option shows: what was chosen if the model takes it, else the model's default. */
export function optionValue(form: GenerateForm, option: OptionName): string | null {
  const values = optionValues(form.kind, form.model, option)
  if (!values) return null
  const chosen = form.options[option]
  if (chosen !== undefined && values.includes(chosen)) return chosen
  const model = modelsOf(form.kind).find((m) => m.id === form.model)
  const fallback = model?.defaults[option]
  return fallback !== undefined ? String(fallback) : (values[0] ?? null)
}

export function speechModel(modelId: string): SpeechModelSpec | undefined {
  return SPEECH_MODELS.find((m) => m.id === modelId)
}

/**
 * The tool call the form stands for — the arguments `generate_image`/`generate_video`/
 * `generate_speech` take. Options the model does not take are left out rather than refused: the
 * form keeps them so switching back restores them.
 */
export function toolCall(form: GenerateForm): { tool: 'generate_image' | 'generate_video' | 'generate_speech'; args: Record<string, unknown> } {
  if (form.kind === 'speech') {
    const model = speechModel(form.model)
    return {
      tool: 'generate_speech',
      args: {
        model: form.model,
        text: form.prompt,
        ...(form.voice ? { voice: form.voice } : {}),
        ...(form.style && model?.instructions ? { style: form.style } : {})
      }
    }
  }
  const args: Record<string, unknown> = { model: form.model, prompt: form.prompt }
  for (const { option } of OPTION_LABELS) {
    const value = optionValues(form.kind, form.model, option) ? optionValue(form, option) : null
    if (value === null) continue
    args[option] = option === 'durationSeconds' ? Number(value) : value
  }
  return { tool: form.kind === 'image' ? 'generate_image' : 'generate_video', args }
}

export type FormCheck =
  | { ok: true; estimatedCostUsd: number; /** Speech: the estimated spoken length. */ seconds?: number }
  | { ok: false; errors: string[]; /** The price when only the prompt is missing (it does not depend on it). */ estimatedCostUsd: number | null }

/** Whether the form is a call the catalog takes, and what it would cost. */
export function checkForm(form: GenerateForm): FormCheck {
  const { args } = toolCall(form)
  if (form.kind === 'speech') {
    const checked = validateSpeech(args)
    if (checked.ok) return { ok: true, estimatedCostUsd: checked.estimatedCostUsd, seconds: checked.estimate.seconds }
    // Speech is priced by its words, so there is no price without them.
    return { ok: false, errors: form.prompt.trim() ? checked.errors : [], estimatedCostUsd: null }
  }
  const checked = validateGeneration(args, form.kind)
  if (checked.ok) return { ok: true, estimatedCostUsd: checked.estimatedCostUsd }
  if (!form.prompt.trim()) {
    // An empty prompt is the form not yet filled in, not a mistake — no error, but the price
    // still shows, because no image or video model prices by the prompt.
    const priced = validateGeneration({ ...args, prompt: 'x' }, form.kind)
    return { ok: false, errors: priced.ok ? [] : priced.errors, estimatedCostUsd: priced.ok ? priced.estimatedCostUsd : null }
  }
  return { ok: false, errors: checked.errors, estimatedCostUsd: null }
}

/**
 * Why a generation cannot start now, as the user reads it, or null when it can. `providers` is
 * true when the fix is in Preferences › AI providers, so the form shows the way there.
 *
 * The order is the order of the fix: without a key nothing else matters; a full queue clears on
 * its own; a budget only the user can raise.
 */
export function startBlocker(input: {
  provider: GenerationProvider | null
  keys: readonly ProviderKeyStatus[] | null
  spending: GenerationSpending | null
  estimatedCostUsd: number | null
}): { reason: 'loading' | 'no-key' | 'room' | 'budget'; text: string; providers: boolean } | null {
  const { provider, keys, spending, estimatedCostUsd } = input
  if (!provider) return null
  if (keys === null) return { reason: 'loading', text: 'Checking provider keys…', providers: false }
  const label = PROVIDERS[provider].label
  const status = keys.find((k) => k.provider === provider)
  if (!status?.set) {
    return {
      reason: 'no-key',
      text: status?.problem
        ? `The ${label} key saved earlier could not be read (${status.problem}). Set it again in Preferences › AI providers.`
        : `No ${label} key is set. Add one in Preferences › AI providers; bay never asks for keys in chat.`,
      providers: true
    }
  }
  if (!spending || estimatedCostUsd === null) return null
  const refusal = spendRefusalOf(spending, estimatedCostUsd)
  if (!refusal) return null
  if (refusal.reason === 'room') {
    return {
      reason: 'room',
      text:
        `${spending.active} generation${spending.active === 1 ? ' is' : 's are'} already running, the most at once. ` +
        'This can start when one finishes, or raise “Jobs at once” in Preferences › AI providers.',
      providers: true
    }
  }
  const reserved = spending.reservedUsd ?? 0
  return {
    reason: 'budget',
    text:
      `This (~${usd(estimatedCostUsd)}) would pass this session’s generation budget: ${usd(spending.spentUsd)} spent` +
      (reserved > 0 ? `, ${usd(reserved)} held for a dub` : '') +
      ` of ${usd(spending.budgetUsd)}. Raise the budget in Preferences › AI providers to go on.`,
    providers: true
  }
}

export function usd(value: number): string {
  // Cents, unless that would hide a price: $0.013 an image is not "$0.01".
  const cents = value.toFixed(2)
  return `$${Math.abs(Number(cents) - value) < 1e-9 || value >= 0.1 ? cents : value.toFixed(3)}`
}

/** One line for a job in the list: where it stands, in words. */
export function jobStatusLine(job: GenerationJob, imported: boolean, now: number): string {
  const seconds = Math.max(0, Math.round((now - job.createdAt) / 1000))
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  switch (job.status) {
    case 'queued':
      return `Queued · ${elapsed}`
    case 'running':
      return job.progress !== undefined ? `Generating · ${Math.round(job.progress * 100)}% · ${elapsed}` : `Generating · ${elapsed}`
    case 'failed':
      return `Failed: ${job.error ?? 'no reason was given'}`
    case 'done':
      return imported ? 'In the media pool' : 'Done — not imported yet'
  }
}

export const STYLE_CHOICES: readonly SpeechStyle[] = SPEECH_STYLE_IDS

/** The form a kind opens with: the first model of its catalog and no prompt. */
export function initialForm(kind: GenerationKind): GenerateForm {
  return { kind, model: modelChoices(kind)[0]?.id ?? '', prompt: '', options: {} }
}
