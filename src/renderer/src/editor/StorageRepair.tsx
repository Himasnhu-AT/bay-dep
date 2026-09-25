/**
 * The project database's status, and the one button that fixes it.
 *
 * The database holds the recents list and a few remembered values — never a project — so
 * "Storage unavailable" costs the user their recent projects and nothing else. Repair (main's
 * `repairStorage`) sets the broken file aside, carries over what it still yields, and lists the
 * projects folder again; projects are files and are never touched. Every place that shows the
 * warning (the projects screen, the status bar, Preferences › Storage) shares this state, and a
 * repair anywhere tells the others through `STORAGE_REPAIRED_EVENT`.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Wrench } from 'lucide-react'
import { Button, type ButtonSize } from '@/components'
import { bay } from '@/lib/bay'
import { useEditor } from '@/store/editor'

export const STORAGE_REPAIRED_EVENT = 'bay:storage-repaired'

export interface StorageState {
  ready: boolean
  error: string | null
}

/** The database's status, asked at mount and again after any repair. Null until it answers. */
export function useStorageStatus(): StorageState | null {
  const [status, setStatus] = useState<StorageState | null>(null)
  useEffect(() => {
    let live = true
    const ask = (): void => {
      void bay()
        ?.app.storageReady()
        .then((result) => {
          if (live) setStatus(result)
        })
        .catch(() => undefined)
    }
    ask()
    window.addEventListener(STORAGE_REPAIRED_EVENT, ask)
    return () => {
      live = false
      window.removeEventListener(STORAGE_REPAIRED_EVENT, ask)
    }
  }, [])
  return status
}

/** Repairs the database, says what happened, and tells every other view to look again. */
export function useStorageRepair(): { repair(): Promise<boolean>; repairing: boolean } {
  const notify = useEditor((state) => state.notify)
  const [repairing, setRepairing] = useState(false)
  const repair = useCallback(async (): Promise<boolean> => {
    const api = bay()
    if (!api || repairing) return false
    setRepairing(true)
    try {
      const result = await api.app.repairStorage()
      if (result.ready) {
        const kept = result.movedAside.length > 0 ? ` The old file is kept beside it as ${result.movedAside[0]!.split('/').pop()}.` : ''
        notify(`Storage repaired: ${result.recents} recent ${result.recents === 1 ? 'project' : 'projects'} listed.${kept} No project was changed.`)
      } else {
        notify(`Storage could not be repaired: ${result.error ?? 'unknown reason'}. Your projects are untouched.`, 'error')
      }
      window.dispatchEvent(new Event(STORAGE_REPAIRED_EVENT))
      return result.ready
    } catch (error) {
      notify(`Storage could not be repaired: ${error instanceof Error ? error.message : String(error)}`, 'error')
      return false
    } finally {
      setRepairing(false)
    }
  }, [notify, repairing])
  return { repair, repairing }
}

/** The Repair button, for wherever the warning shows. */
export function StorageRepairButton({ size = 'sm' }: { size?: ButtonSize }): ReactNode {
  const { repair, repairing } = useStorageRepair()
  return (
    <Button
      variant="subtle"
      size={size}
      icon={<Wrench aria-hidden="true" className="size-3" />}
      disabled={repairing}
      onClick={() => void repair()}
      title="Sets the broken database aside (it is kept, not deleted), carries over what it still holds, and lists your projects folder again. Projects are never changed."
    >
      {repairing ? 'Repairing…' : 'Repair storage'}
    </Button>
  )
}
