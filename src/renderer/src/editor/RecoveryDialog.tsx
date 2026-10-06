import { useState, type ReactNode } from 'react'
import { recoverySentence, type RecoveryOffer } from '@shared/autosave'
import { Button, Modal } from '@/components'
import { ago, discardOffer, restoreOffer } from '@/lib/autosave'
import { bay } from '@/lib/bay'
import { useAutosave } from '@/store/autosave-prefs'
import { useEditor } from '@/store/editor'

/**
 * The offer made when a project is opened and its autosave sidecar holds later work
 * (`@shared/autosave` has the sentence for each state). A dialog rather than a banner because it
 * must be answered before editing goes on: the sidecar is the only copy of that work, and the
 * next autosave of this project is written over it. Until it is answered, autosave waits.
 *
 * Escape is "Discard" for neither state — closing the dialog without choosing is not a choice to
 * delete someone's work. For readable work it does nothing; for a file that will not load it is
 * "Keep the file", which moves it aside where nothing overwrites it.
 */
export function RecoveryDialog(): ReactNode {
  const recovery = useAutosave((state) => state.recovery)
  const notify = useEditor((state) => state.notify)
  const [busy, setBusy] = useState(false)
  const offer: RecoveryOffer | null = recovery === 'checking' ? null : recovery

  const run = (work: () => Promise<unknown>): void => {
    if (busy) return
    setBusy(true)
    void work().finally(() => setBusy(false))
  }

  if (!offer) return null

  const restore = (): void => run(() => restoreOffer(offer))
  const discard = (): void => run(() => discardOffer(offer))
  const keep = (): void =>
    run(async () => {
      try {
        const kept = await bay()?.project.setAsideRecovery(offer.target)
        if (kept) notify(`Kept as ${kept}.`)
      } catch (error) {
        notify(`The file could not be moved aside: ${error instanceof Error ? error.message : String(error)}`, 'error')
        return
      }
      useAutosave.getState().setRecovery(null)
    })

  const sentence =
    offer.state === 'newer'
      ? recoverySentence(offer, ago(offer.autosavedAt), offer.savedAt === null ? null : ago(offer.savedAt))
      : recoverySentence(offer, '', null)

  return (
    <Modal
      open
      title={offer.state === 'newer' ? 'Restore unsaved work?' : 'Unsaved work could not be read'}
      onClose={offer.state === 'newer' ? () => undefined : keep}
      width={420}
      footer={
        offer.state === 'newer' ? (
          <>
            <Button variant="danger" onClick={discard} disabled={busy} className="mr-auto">
              Discard
            </Button>
            <Button variant="primary" onClick={restore} disabled={busy}>
              Restore
            </Button>
          </>
        ) : (
          <>
            <Button variant="danger" onClick={discard} disabled={busy} className="mr-auto">
              Discard
            </Button>
            <Button variant="subtle" onClick={() => void bay()?.project.revealRecovery(offer.target)} disabled={busy}>
              Show in Finder
            </Button>
            <Button variant="primary" onClick={keep} disabled={busy}>
              Keep the file
            </Button>
          </>
        )
      }
    >
      <p className="px-4 py-3 text-[12px] leading-relaxed text-pretty text-ink-1 select-text">{sentence}</p>
    </Modal>
  )
}
