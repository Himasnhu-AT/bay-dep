import type { ReactNode } from 'react'
import type { Asset } from '@shared/project'
import { assetFacts } from '@shared/media-library'
import { formatSourceDuration } from '@/lib/bay'
import { usePoster } from '@/lib/useMediaCache'

const KIND_NAME: Record<Asset['kind'], string> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Image',
  gif: 'Animated image',
  text: 'Title',
  html: 'HTML composition',
  brf: 'Motion graphic',
  lut: 'Colour LUT',
  font: 'Font'
}

/**
 * The Media page's details column for the selected asset — Resolve's Metadata panel, cut down to
 * what bay knows: its picture, kind, length, frame size and rate, sound, file, size, how often the
 * timeline uses it and any beats found — then its actions as buttons.
 */
export function AssetDetails({
  asset,
  bytes,
  uses,
  missing,
  actions
}: {
  asset: Asset
  bytes: number | undefined
  uses: number
  missing: boolean
  actions: ReactNode
}): ReactNode {
  const poster = usePoster(asset, 320)
  const rows: [string, string][] = [
    ['Kind', KIND_NAME[asset.kind]],
    ...(asset.durationUs > 0 ? ([['Length', formatSourceDuration(asset.durationUs)]] as [string, string][]) : []),
    ...(asset.width && asset.height ? ([['Frame', `${asset.width}×${asset.height}`]] as [string, string][]) : []),
    ...(assetFacts(asset, bytes ?? null)
      .filter((fact) => !/^\d+×\d+$/.test(fact))
      .map((fact) => ['', fact]) as [string, string][]),
    ['Used', uses === 0 ? 'Not on the timeline' : `${uses} clip${uses === 1 ? '' : 's'}`],
    ...(asset.text ? ([['Text', asset.text]] as [string, string][]) : [])
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="aspect-video w-full shrink-0 overflow-hidden border-b border-line bg-surface-0">
        {poster && <img src={poster} alt="" className="size-full object-contain" draggable={false} />}
      </div>
      <div className="px-3 py-2.5">
        <p className="text-[12px] font-semibold break-words text-ink-0">{asset.name}</p>
        {missing && <p className="mt-0.5 text-[11px] text-warning">The file is missing from where it was imported.</p>}
        {asset.error && <p className="mt-0.5 text-[11px] text-danger">Could not be read: {asset.error}</p>}
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          {rows.map(([label, value], index) => (
            <div key={`${label}:${index}`} className="contents">
              <dt className="text-ink-2">{label}</dt>
              <dd className="min-w-0 break-words text-ink-1 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {asset.path && (
          <p className="mt-2 text-[10px] leading-snug break-all text-ink-2 select-text" title={asset.path}>
            {asset.path}
          </p>
        )}
      </div>
      <div className="border-t border-line px-2 py-2">{actions}</div>
    </div>
  )
}
