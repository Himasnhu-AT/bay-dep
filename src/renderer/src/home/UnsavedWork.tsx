import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { recoverySentence, type RecoveryOffer } from '@shared/autosave'
import { Button, InlineAlert } from '@/components'
import { ago, discardOffer, restoreOffer } from '@/lib/autosave'
import { bay } from '@/lib/bay'

/**
 * Projects bay autosaved that were never saved, on the projects screen: a project with no file
 * has nowhere else to be found. One line each, from `@shared/autosave`'s sentences, with Restore
 * (opens it, unsaved) and Discard. Nothing is listed when there is nothing — the common case.
 */
export function UnsavedWork(): ReactNode {
  const [offers, setOffers] = useState<RecoveryOffer[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    // Quietly: a list that cannot be read is an empty one here, and the storage alert beside
    // this already says when bay's own folder is in trouble.
    setOffers((await bay()?.project.unsaved().catch(() => [])) ?? [])
  }, [])
  useEffect(() => void load(), [load])

  const run = (work: () => Promise<unknown>): void => {
    if (busy) return
    setBusy(true)
    void work().finally(() => {
      setBusy(false)
      void load()
    })
  }

  if (offers.length === 0) return null
  return (
    <section aria-label="Unsaved work" className="m-3 mb-0 flex flex-col gap-2">
      {offers.map((offer) => (
        <InlineAlert key={offer.target.id} tone={offer.state === 'newer' ? 'notice' : 'warning'} className="items-center">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 select-text">
              {offer.state === 'newer'
                ? recoverySentence(offer, ago(offer.autosavedAt), null)
                : recoverySentence(offer, '', null)}
            </span>
            {offer.state === 'newer' ? (
              <Button size="sm" variant="primary" disabled={busy} onClick={() => run(() => restoreOffer(offer))}>
                Restore
              </Button>
            ) : (
              <Button size="sm" variant="subtle" disabled={busy} onClick={() => void bay()?.project.revealRecovery(offer.target)}>
                Show in Finder
              </Button>
            )}
            <Button size="sm" variant="danger" disabled={busy} onClick={() => run(() => discardOffer(offer))}>
              Discard
            </Button>
          </div>
        </InlineAlert>
      ))}
    </section>
  )
}
