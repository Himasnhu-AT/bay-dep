import { useEffect, useState, type ReactNode } from 'react'
import { Link2, LoaderCircle } from 'lucide-react'
import { checkDownloadUrl } from '@shared/url-import'
import { Button, Field, InlineAlert, Modal, TextField } from '@/components'
import { importUrl } from '@/mcp/urlImport'
import { useEditor } from '@/store/editor'

/**
 * Media Pool › Import URL: one web page's video, downloaded by the user's own yt-dlp into bay's
 * downloads folder and imported like any file. It runs `import_url`'s own function, so the address
 * is checked the same way (`checkDownloadUrl`), the same limits apply (2 GB, 15 minutes, ≤1080p,
 * no playlists) and the file lands through the same import path. A person typing the address is
 * the consent the agent's native dialog asks for, so there is no second question here.
 */
export function ImportUrlDialog({
  open,
  onClose,
  onImported
}: {
  open: boolean
  onClose(): void
  /** The new (or reused) asset's id, once it is in the pool. */
  onImported(assetId: string): void
}): ReactNode {
  const notify = useEditor((state) => state.notify)
  const [url, setUrl] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setTouched(false)
  }, [open])

  const checked = url.trim() ? checkDownloadUrl(url.trim()) : null
  const problem = touched && checked && !checked.ok ? checked.error : null

  const start = async (): Promise<void> => {
    setTouched(true)
    if (!checked?.ok || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = (await importUrl({ url: checked.url })) as { asset?: { id: string; name: string; reused?: boolean } }
      const asset = result.asset
      if (asset) {
        notify(asset.reused ? `${asset.name} was already in the pool.` : `Imported ${asset.name} from ${checked.host}.`)
        onImported(asset.id)
      }
      setUrl('')
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Import from a web address"
      width={440}
      onClose={onClose}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {busy ? 'Close' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !checked?.ok}
            icon={busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
            onClick={() => void start()}
          >
            {busy ? 'Downloading…' : 'Download and import'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5 px-4 py-3">
        <Field label="Address">
          <TextField
            label="Web address of the video"
            placeholder="https://…"
            value={url}
            autoFocus
            invalid={problem !== null}
            disabled={busy}
            onChange={(event) => setUrl(event.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void start()
              }
            }}
          />
        </Field>
        {problem && <p className="text-[11px] text-pretty text-danger">{problem}</p>}
        <p className="text-[11px] leading-relaxed text-pretty text-ink-2">
          {busy
            ? 'Downloading with yt-dlp. A long video can take a few minutes; closing this does not stop it, and the file joins the pool when it lands.'
            : 'One video from the page, at up to 1080p, downloaded by the yt-dlp installed on this Mac. Nothing else is sent anywhere.'}
        </p>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Modal>
  )
}
