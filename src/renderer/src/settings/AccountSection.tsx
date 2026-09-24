import { useState, type ReactNode } from 'react'
import { REFERRAL_LIMIT, describeAccess } from '@shared/access'
import { Button } from '@/components'
import { useAccess } from '@/access/AccessGate'
import { bay } from '@/lib/bay'
import { cn } from '@/lib/cn'
import { Row, Section } from './parts'

/**
 * Who is signed in, and referrals: an approved account can give up to five people access
 * (`REFERRAL_LIMIT`). Main commits the grant and the count together, and names why when it
 * cannot — already has access, none left, not approved.
 */
export function AccountSection(): ReactNode {
  const status = useAccess()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  if (!status || status.state !== 'entitled') return null
  const { detail } = describeAccess(status)

  const refer = async (): Promise<void> => {
    const api = bay()
    if (!api || busy) return
    setBusy(true)
    setResult(null)
    try {
      const outcome = await api.access.refer(email)
      if (outcome.ok) {
        setResult({ ok: true, text: `${outcome.email} now has access. You have ${outcome.referralsLeft} referral${outcome.referralsLeft === 1 ? '' : 's'} left.` })
        setEmail('')
      } else {
        setResult({ ok: false, text: outcome.error })
      }
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  if (status.bypass) {
    return (
      <Section title="Account" description="Access check skipped: BAY_ACCESS=dev in an unpackaged build. No account is signed in.">
        {null}
      </Section>
    )
  }

  const left = status.referralsLeft
  return (
    <Section title="Account" description={detail}>
      <Row label={status.email} hint={status.persisted ? undefined : 'Kept in memory only (no system keychain): you will sign in again after quitting.'}>
        <Button variant="ghost" onClick={() => void bay()?.access.signOut()}>
          Sign out
        </Button>
      </Row>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h4 className="text-[12px] font-medium text-ink-0">Refer someone</h4>
          <span className="text-[11px] text-ink-2">
            {left === null ? `Up to ${REFERRAL_LIMIT} referrals` : `${left} of ${REFERRAL_LIMIT} referrals left`}
          </span>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void refer()
          }}
        >
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="friend@example.com"
            aria-label="Email to refer"
            disabled={busy || left === 0}
            className="h-7 min-w-0 flex-1 rounded-sm border border-line-strong bg-surface-2 px-2 text-[12px] text-ink-0 outline-none placeholder:text-ink-2 focus:border-accent disabled:opacity-40"
          />
          <Button type="submit" variant="primary" disabled={busy || left === 0 || !email.trim()}>
            {busy ? 'Referring…' : 'Give access'}
          </Button>
        </form>
        <p className="text-[11px] text-pretty text-ink-2">
          They sign in to bay with this address. A referral cannot be taken back, so use it for someone you know.
        </p>
        {result && <p className={cn('text-[12px] text-pretty', result.ok ? 'text-success' : 'text-danger')}>{result.text}</p>}
      </div>
    </Section>
  )
}
