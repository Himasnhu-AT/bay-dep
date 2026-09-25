import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Download, Square, Trash2, X } from 'lucide-react'
import { describeJob, formatModelBytes, VISION_MODEL, VISION_MODEL_BYTES, type VisionStatus } from '@shared/visual-search'
import { Badge, Button, IconButton, ProgressBar } from '@/components'
import { bay } from '@/lib/bay'
import { useEditor } from '@/store/editor'
import { Row, Section, SwitchRow } from './parts'

/**
 * Settings › Visual search: the SigLIP model search_footage runs on, and the indexing job.
 *
 * The model is the one download; the agent's `index_footage` fetches it only when "Download models
 * when needed" is on — the same switch as Transcription's, because it is the same promise: bay
 * reaches Hugging Face for a model when asked, and for nothing else.
 */
export function VisualSearchSection(): ReactNode {
  const autoDownload = useEditor((state) => state.autoDownloadModels)
  const setAutoDownload = useEditor((state) => state.setAutoDownloadModels)
  const notify = useEditor((state) => state.notify)
  const [status, setStatus] = useState<VisionStatus | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const next = await bay()?.vision.status().catch(() => null)
    if (next) setStatus(next)
  }, [])

  useEffect(() => {
    void refresh()
    return bay()?.vision.onChange(setStatus)
  }, [refresh])

  const api = bay()
  const download = status?.download ?? null
  const downloading = download?.state === 'downloading' || download?.state === 'verifying'
  const job = status?.index ?? null

  const startDownload = async (): Promise<void> => {
    const result = await api?.vision.download()
    if (result && !result.ok && !/cancelled/.test(result.error)) notify(result.error, 'error')
    await refresh()
  }

  const remove = async (): Promise<void> => {
    const result = await api?.vision.deleteModel()
    if (result && !result.ok) notify(result.error ?? 'The model could not be deleted.', 'error')
    await refresh()
  }

  return (
    <Section
      title="Visual search"
      description="The agent can find shots by describing them (“a dog running on a beach”). Frames are sampled and matched on this Mac by an image/text model; your footage never leaves it."
    >
      <div className="flex flex-col gap-1">
        <ul className="flex flex-col overflow-hidden rounded-md border border-line">
          <li className="flex min-h-12 items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[12px] font-medium text-ink-0">{VISION_MODEL.label}</span>
                {status?.installed && <Badge tone="success">Installed</Badge>}
              </div>
              {downloading ? (
                <div className="mt-1 flex items-center gap-2">
                  <ProgressBar
                    value={download.totalBytes > 0 ? Math.min(1, download.receivedBytes / download.totalBytes) : 0}
                    label={`Downloading ${VISION_MODEL.label}`}
                    className="flex-1"
                  />
                  <span className="shrink-0 text-[11px] text-ink-2 tabular-nums">
                    {download.state === 'verifying' ? 'Checking…' : `${formatModelBytes(download.receivedBytes)} of ${formatModelBytes(download.totalBytes)}`}
                  </span>
                </div>
              ) : download?.state === 'failed' ? (
                <p className="mt-0.5 text-[11px] text-pretty text-danger">{download.error ?? 'The download failed.'}</p>
              ) : (
                <p className="mt-0.5 truncate text-[11px] text-ink-2">
                  Google’s SigLIP, from Hugging Face · {formatModelBytes(status?.installed ? status.bytesOnDisk : VISION_MODEL_BYTES)}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {status === null ? (
                <span className="text-[12px] text-ink-2">Checking…</span>
              ) : downloading ? (
                <Button variant="ghost" icon={<X className="size-3.5" />} onClick={() => void api?.vision.cancelDownload()}>
                  Cancel
                </Button>
              ) : status.installed ? (
                <IconButton label={`Delete ${VISION_MODEL.label}`} icon={<Trash2 className="size-3.5" />} onClick={() => void remove()} />
              ) : (
                <Button icon={<Download className="size-3.5" />} onClick={() => void startDownload()}>
                  Download
                </Button>
              )}
            </div>
          </li>
        </ul>
        {status && (
          <p className="text-[11px] text-pretty text-ink-2">
            The model goes to <span className="text-ink-1 select-text">{status.modelDir}</span>. The index of your footage is
            kept by bay’s cache and rebuilt if it is cleared.
          </p>
        )}
      </div>

      <SwitchRow
        label="Download models when needed"
        description={`When the agent indexes footage and the model is missing, bay downloads it (${formatModelBytes(VISION_MODEL_BYTES)}) from Hugging Face and checks it before use. The same switch covers transcription models.`}
        checked={autoDownload}
        onChange={setAutoDownload}
      />

      <Row label="Indexing" hint={job ? describeJob(job) : 'Nothing indexed this session. The agent indexes the project’s footage with index_footage.'}>
        {job?.state === 'running' && (
          <Button variant="subtle" icon={<Square className="size-3" />} onClick={() => void api?.vision.cancelIndex()}>
            Stop
          </Button>
        )}
      </Row>
    </Section>
  )
}
