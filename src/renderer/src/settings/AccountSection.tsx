import type { ReactNode } from 'react'
import { describeAccess } from '@shared/access'
import { Button } from '@/components'
import { useAccess } from '@/access/AccessGate'
import { bay } from '@/lib/bay'
import { Group, Row, Section } from './parts'

/** Who is signed in, when access was last verified, and Sign out. */
export function AccountSection(): ReactNode {
  const status = useAccess()
  if (!status || status.state !== 'entitled') return null

  if (status.bypass) {
    return (
      <Section title="Account" description="Access check skipped: BAY_ACCESS=dev in an unpackaged build. No account is signed in.">
        {null}
      </Section>
    )
  }

  return (
    <Section title="Account" description={describeAccess(status).detail}>
      <Group title="Signed in">
        <Row label={status.email} hint={status.persisted ? undefined : 'Kept in memory only (no system keychain): you will sign in again after quitting.'}>
          <Button variant="ghost" onClick={() => void bay()?.access.signOut()}>
            Sign out
          </Button>
        </Row>
      </Group>
    </Section>
  )
}
