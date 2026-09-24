import { useEffect, useState, type ReactNode } from 'react'
import { GENERATION_PROVIDERS, PROVIDERS, type GenerationProvider, type ProviderKeyStatus } from '@shared/generation'
import { Button } from '@/components'
import { bay } from '@/lib/bay'
import { cn } from '@/lib/cn'
import { Row, Section } from './parts'

/**
 * Keys for AI image and video generation (`generate_image`, `generate_video`).
 *
 * A key goes to main and does not come back: this page only ever learns whether one is set, and
 * whether it could be kept in the keychain. The inputs clear once a key is saved. bay contacts a
 * provider only when a generation tool is called — setting a key sends nothing anywhere.
 */
export function ProvidersSection(): ReactNode {
  const [keys, setKeys] = useState<ProviderKeyStatus[] | null>(null)

  useEffect(() => {
    let live = true
    void bay()
      ?.generation.keys()
      .then((status) => {
        if (live) setKeys(status)
      })
    return () => {
      live = false
    }
  }, [])

  return (
    <Section
      title="Providers"
      description="Keys for generating pictures and clips with AI. bay sends a prompt (and a reference picture, when one is chosen) to the provider only when the agent generates something, and the provider bills your account."
    >
      {GENERATION_PROVIDERS.map((provider) => (
        <ProviderRow key={provider} provider={provider} status={keys?.find((k) => k.provider === provider) ?? null} onChange={setKeys} />
      ))}
    </Section>
  )
}

function ProviderRow(props: {
  provider: GenerationProvider
  status: ProviderKeyStatus | null
  onChange(keys: ProviderKeyStatus[]): void
}): ReactNode {
  const spec = PROVIDERS[props.provider]
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const set = props.status?.set === true
  const filled = spec.keyFields.every((f) => (fields[f.id] ?? '').trim())

  const save = async (): Promise<void> => {
    const api = bay()
    if (!api || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await api.generation.setKey(props.provider, fields)
      if (result.ok) {
        props.onChange(result.keys)
        setFields({})
        const kept = result.keys.find((k) => k.provider === props.provider)?.persisted !== false
        setMessage({ ok: true, text: kept ? 'Saved in the keychain.' : 'Kept in memory only (no system keychain): set it again after quitting.' })
      } else {
        setMessage({ ok: false, text: result.error })
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const clear = async (): Promise<void> => {
    const api = bay()
    if (!api || busy) return
    setBusy(true)
    try {
      props.onChange(await api.generation.clearKey(props.provider))
      setMessage({ ok: true, text: 'Removed.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Row label={spec.label} hint={set ? (props.status?.persisted === false ? 'Set — in memory only until bay quits.' : 'Set.') : `Not set. Get a key at ${spec.keyPage}.`}>
        {set && (
          <Button variant="ghost" disabled={busy} onClick={() => void clear()}>
            Remove
          </Button>
        )}
      </Row>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {spec.keyFields.map((field) => (
          <input
            key={field.id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={fields[field.id] ?? ''}
            onChange={(event) => setFields((current) => ({ ...current, [field.id]: event.target.value }))}
            placeholder={set ? `Replace ${field.label.toLowerCase()}` : field.label}
            aria-label={`${spec.label} ${field.label}`}
            disabled={busy}
            className="h-7 min-w-0 flex-1 rounded-sm border border-line-strong bg-surface-2 px-2 font-mono text-[12px] text-ink-0 outline-none placeholder:font-sans placeholder:text-ink-2 focus:border-accent disabled:opacity-40"
          />
        ))}
        <Button type="submit" variant="primary" disabled={busy || !filled}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </form>
      {message && <p className={cn('text-[12px] text-pretty', message.ok ? 'text-success' : 'text-danger')}>{message.text}</p>}
    </div>
  )
}
